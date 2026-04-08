/**
 * FFmpeg lifecycle service - manages channel start/stop/restart and shadow channels.
 * Extracted from server.js to reduce god-file complexity.
 *
 * Usage:
 *   const ffmpegLifecycle = createFfmpegLifecycle({ dbApi, channels, processes, ... });
 */
const { ConflictError } = require('../lib/errors');

module.exports = function createFfmpegLifecycle({
  dbApi,
  hlsIdle,
  onDemandLive,
  eventBus,
  WS_EVENTS,
  path,
  fs,
  treeKill,
  spawn,
  PassThrough,
  PORT,
  STREAMING_MODE,
  IPTV_DISK_ROOT,
  MAX_FFMPEG_PROCESSES,
  streamingSettings,
  buildFfmpegArgs,
  buildNginxDualCopyFfmpegArgs,
  needsTranscode,
  activeSourceUrl,
  isMovieChannel,
  isInternalChannel,
  resolveEffectiveInputType,
  channelSources,
  sourceTitleFromUrl,
  channelRuntimeInfo,
  fetchTextWithTimeout,
  parseMpdInfo,
  parseHlsInfo,
  preDetectSource,
  mergeChannelOptions,
  normalizeSourceQueue,
  normalizeHex32,
  mpegtsMultiConflict,
  appendPrebufferChunk,
  clearPrebuffer,
  waitForPrebuffer,
  snapshotPrebuffer,
  applyStabilityFix,
  rootDir,
  // State getter/setter functions
  getChannel,
  setChannel,
  deleteChannel,
  hasChannel,
  getProcess,
  setProcess,
  deleteProcess,
  hasProcess,
  getProcessCount,
  getRunController,
  setRunController,
  deleteRunController,
  hasRunController,
  getShadowProcess,
  setShadowProcess,
  deleteShadowProcess,
  hasShadowProcess,
  getTsBroadcast,
  setTsBroadcast,
  deleteTsBroadcast,
  hasTsBroadcast,
}) {
  const countProcesses =
    typeof getProcessCount === 'function' ? getProcessCount : () => 0;

  // ---------- Helpers ----------
  function cleanupProcessListeners(proc) {
    if (!proc) return;
    try {
      if (proc.stdout) proc.stdout.removeAllListeners('data');
      if (proc.stderr) proc.stderr.removeAllListeners('data');
      proc.removeAllListeners('error');
      proc.removeAllListeners('close');
    } catch (e) {
      /* ignore */
    }
  }

  function activeStreamSlot(channel) {
    return channel && channel.streamSlot === 'b' ? 'b' : 'a';
  }

  function streamDirFor(id, slot) {
    return path.join(rootDir, 'streams', id, slot);
  }

  function isMpegtsPipeOutput(ch) {
    return !!(ch && ch.outputFormat === 'mpegts');
  }

  function waitForPlaylistReady(outPath, timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (fs.existsSync(outPath)) {
        return resolve(true);
      }
      const start = Date.now();
      const t = setInterval(() => {
        if (fs.existsSync(outPath)) {
          clearInterval(t);
          return resolve(true);
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          return resolve(false);
        }
      }, 300);
    });
  }

  function ensureTsBroadcast(id) {
    let b = getTsBroadcast(id);
    if (!b) {
      b = { consumers: new Set(), sessionBytes: 0 };
      setTsBroadcast(id, b);
    }
    return b;
  }

  function broadcastTsData(id, chunk) {
    const b = getTsBroadcast(id);
    if (!b || !chunk || chunk.length === 0) return;
    const ch = getChannel(id);
    if (streamingSettings.isPrebufferEnabled()) {
      appendPrebufferChunk(
        b,
        chunk,
        streamingSettings.getEffectivePrebufferMaxBytes(ch)
      );
    }
    b.sessionBytes += chunk.length;
    for (const c of b.consumers) {
      if (!c.destroyed && c.writable) c.write(chunk);
    }
  }

  async function persistChannel(id) {
    const ch = getChannel(id);
    if (!ch || !ch.userId) return;
    try {
      await dbApi.updateChannelRow(id, ch.userId, ch, ch.version);
    } catch (error) {
      if (error instanceof ConflictError) {
        if (Number.isFinite(Number(error.currentVersion))) {
          ch.version = Number(error.currentVersion);
        }
        return;
      }
      throw error;
    }
  }

  // ---------- Shadow channels ----------
  async function startShadowChannel(id, channel, slot) {
    const streamDir = streamDirFor(id, slot);
    if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });
    fs.readdirSync(streamDir).forEach((f) =>
      fs.unlinkSync(path.join(streamDir, f))
    );

    const runChannel = { ...channel, streamSlot: slot };
    const built = buildFfmpegArgs(runChannel, streamDir, id, rootDir);
    const { args: ffmpegArgs, playlist } = built;
    const outFilePath = path.join(streamDir, playlist);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    setShadowProcess(id, ffmpeg);

    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', () => {
      cleanupProcessListeners(ffmpeg);
      deleteShadowProcess(id);
    });

    const ready = await waitForPlaylistReady(outFilePath, 12000);
    return { ffmpeg, playlist, ready };
  }

  async function seamlessSwitchChannel(id, channel, newSlot) {
    if (channel.outputFormat !== 'hls') return false;
    const shadow = await startShadowChannel(id, channel, newSlot);
    if (!shadow.ready) {
      cleanupProcessListeners(shadow.ffmpeg);
      try {
        shadow.ffmpeg.kill('SIGTERM');
      } catch {}
      return false;
    }

    const oldProc = getProcess(id);
    channel.streamSlot = newSlot;
    setChannel(id, channel);

    setProcess(id, shadow.ffmpeg);
    deleteShadowProcess(id);

    if (oldProc) {
      cleanupProcessListeners(oldProc);
      try {
        oldProc.kill('SIGTERM');
      } catch {}
    }
    return true;
  }

  // ---------- stopChannel ----------
  function stopChannel(id) {
    const channel = getChannel(id);
    if (channel) {
      channel.status = 'stopped';
      channel.error = null;
      channel.startedAt = null;
      channel.nowPlayingTitle = null;
      channel.nowPlayingIndex = null;
      channel.nowPlayingTotal = null;
      persistChannel(id);
    }
    const br = getTsBroadcast(id);
    if (br) {
      for (const c of br.consumers) {
        try {
          c.destroy();
        } catch (e) {}
      }
      br.consumers.clear();
      deleteTsBroadcast(id);
    }
    const ctl = getRunController(id);
    if (ctl) {
      ctl.cancelled = true;
      for (const t of ctl.timers) {
        clearTimeout(t);
      }
      ctl.timers.clear();
      deleteRunController(id);
    }

    if (hasProcess(id)) {
      const proc = getProcess(id);
      cleanupProcessListeners(proc);
      try {
        treeKill(proc.pid, 'SIGTERM', (err) => {
          if (err) {
            try {
              proc.kill('SIGTERM');
            } catch (e) {}
          }
        });
        setTimeout(() => {
          try {
            treeKill(proc.pid, 'SIGKILL');
            proc.kill('SIGKILL');
          } catch (e) {}
        }, 5000);
      } catch (e) {
        console.error(`Error stopping ${id}:`, e.message);
      }
      deleteProcess(id);
    }
    if (hasShadowProcess(id)) {
      const proc = getShadowProcess(id);
      cleanupProcessListeners(proc);
      try {
        treeKill(proc.pid, 'SIGTERM', (err) => {
          if (err) {
            try {
              proc.kill('SIGTERM');
            } catch (e) {}
          }
        });
      } catch (e) {}
      deleteShadowProcess(id);
    }
  }

  // ---------- startChannel ----------
  async function startChannel(id, channel) {
    if (MAX_FFMPEG_PROCESSES > 0 && countProcesses() >= MAX_FFMPEG_PROCESSES) {
      throw new Error(
        `Server at capacity: ${countProcesses()}/${MAX_FFMPEG_PROCESSES} FFmpeg processes running`
      );
    }
    const baseStreamDir = path.join(rootDir, 'streams', id);
    channel.streamSlot = activeStreamSlot(channel);
    const streamDir = streamDirFor(id, channel.streamSlot);
    const logFile = path.join(rootDir, 'logs', `${id}.log`);
    const decryptionKey = `${channel.kid}:${channel.key}`;

    if (!channel.preDetectDoneAt && channel.outputMode === 'copy') {
      preDetectSource(channel)
        .then(() => {
          if (channel.outputMode === 'transcode') {
            setTimeout(() => {
              const ch = getChannel(id);
              if (ch && ch.status === 'running') restartChannel(id);
            }, 500);
          }
          channel.preDetectDoneAt = new Date().toISOString();
          persistChannel(id).catch(() => {});
        })
        .catch(() => {
          channel.preDetectDoneAt = new Date().toISOString();
          persistChannel(id).catch(() => {});
        });
    }

    const maxReconnect = Math.min(
      100,
      Math.max(0, parseInt(channel.maxRetries, 10) || 0)
    );
    const delaySec = Math.min(
      300,
      Math.max(1, parseInt(channel.retryDelaySec, 10) || 5)
    );
    let reconnectDone = 0;
    let movieSourceFailCount = 0;
    const controller = { cancelled: false, timers: new Set() };
    setRunController(id, controller);

    if (!fs.existsSync(baseStreamDir))
      fs.mkdirSync(baseStreamDir, { recursive: true });
    if (fs.existsSync(streamDir)) {
      fs.readdirSync(streamDir).forEach((f) =>
        fs.unlinkSync(path.join(streamDir, f))
      );
    } else {
      fs.mkdirSync(streamDir, { recursive: true });
    }

    const logStream = fs.createWriteStream(logFile, { flags: 'w' });
    let logClosed = false;
    logStream.on('error', (err) => {
      logClosed = true;
      console.error(`[${id}] log stream error:`, err.message);
    });
    logStream.on('close', () => {
      logClosed = true;
    });

    function writeLog(line) {
      if (logClosed || logStream.destroyed || logStream.writableEnded) return;
      try {
        logStream.write(line);
      } catch {
        logClosed = true;
      }
    }

    function closeLog() {
      if (logClosed || logStream.destroyed || logStream.writableEnded) return;
      try {
        logStream.end();
      } catch {
        logClosed = true;
      }
    }

    writeLog(
      `[${new Date().toISOString()}] Starting channel: ${channel.name}\n`
    );
    writeLog(
      `[${new Date().toISOString()}] MPD URL: ${activeSourceUrl(channel)}\n`
    );
    writeLog(`[${new Date().toISOString()}] Decryption Key: [redacted]\n`);
    writeLog(
      `[${new Date().toISOString()}] Mode: ${channel.outputMode}, transcode: ${needsTranscode(channel)}, stream: ${channel.streamMode || 'live'}\n`
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      let playlistTimer = null;

      function scheduleSpawn(delayMs) {
        const t = setTimeout(() => {
          controller.timers.delete(t);
          spawnOnce();
        }, delayMs);
        controller.timers.add(t);
      }

      function waitForOutputFile(outPath, isMpegts) {
        if (playlistTimer) clearInterval(playlistTimer);
        let attempts = 0;
        playlistTimer = setInterval(() => {
          attempts++;
          let ready = false;
          if (fs.existsSync(outPath)) {
            if (isMpegts) {
              try {
                ready = fs.statSync(outPath).size > 0;
              } catch {
                ready = false;
              }
            } else {
              ready = true;
            }
          }
          if (ready) {
            clearInterval(playlistTimer);
            playlistTimer = null;
            if (!settled) {
              settled = true;
              channel.status = 'running';
              if (!channel.startedAt)
                channel.startedAt = new Date().toISOString();
              eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
              resolve();
            }
          } else if (attempts >= 150) {
            clearInterval(playlistTimer);
            playlistTimer = null;
            if (!settled) {
              settled = true;
              channel.status = 'running';
              if (!channel.startedAt)
                channel.startedAt = new Date().toISOString();
              eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
              resolve();
            }
          }
        }, 20);
      }

      function waitForPipeMpegts(pipeId) {
        if (playlistTimer) clearInterval(playlistTimer);
        let attempts = 0;
        playlistTimer = setInterval(() => {
          attempts++;
          const sess = getTsBroadcast(pipeId)?.sessionBytes || 0;
          if (sess >= 188) {
            clearInterval(playlistTimer);
            playlistTimer = null;
            if (!settled) {
              settled = true;
              channel.status = 'running';
              if (!channel.startedAt)
                channel.startedAt = new Date().toISOString();
              eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
              resolve();
            }
          } else if (attempts >= 200) {
            clearInterval(playlistTimer);
            playlistTimer = null;
            if (!settled) {
              settled = true;
              channel.status = 'running';
              if (!channel.startedAt)
                channel.startedAt = new Date().toISOString();
              eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
              resolve();
            }
          }
        }, 20);
      }

      function spawnOnce() {
        if (controller.cancelled || !hasChannel(id)) {
          closeLog();
          if (!settled) {
            settled = true;
            reject(new Error('Channel start cancelled'));
          }
          return;
        }
        if (reconnectDone > 0) {
          writeLog(
            `\n\n--- [RECONNECT ${reconnectDone}/${maxReconnect}] after ${delaySec}s ---\n\n`
          );
        }

        let sourceUrl = activeSourceUrl(channel);
        if (!sourceUrl) {
          channel.status = 'error';
          channel.error = 'No input source URL configured';
          closeLog();
          if (!settled) {
            settled = true;
            reject(new Error(channel.error));
          }
          return;
        }
        const srcList = channelSources(channel);
        const idx = parseInt(channel.sourceIndex, 10);
        const safeIdx = Number.isFinite(idx)
          ? Math.max(0, Math.min(srcList.length - 1, idx))
          : 0;
        channel.sourceIndex = safeIdx;
        channel.nowPlayingTitle = sourceTitleFromUrl(sourceUrl);
        channel.nowPlayingIndex = safeIdx + 1;
        channel.nowPlayingTotal = srcList.length;
        channel.mpdUrl = sourceUrl;
        const runChannel = { ...channel, mpdUrl: sourceUrl };
        if (
          runChannel.hlsProxyMode &&
          resolveEffectiveInputType(sourceUrl, runChannel.inputType) === 'hls'
        ) {
          const enc = encodeURIComponent(sourceUrl);
          runChannel.mpdUrl = `http://127.0.0.1:${PORT}/proxy/hls/${id}?u=${enc}`;
        }
        let usePipe = isMpegtsPipeOutput(runChannel);
        if (usePipe) {
          const b = ensureTsBroadcast(id);
          b.sessionBytes = 0;
          clearPrebuffer(b);
        }
        let built;
        let ffmpegArgs;
        let playlist;
        let outFilePath;
        let isMpegtsOut;
        try {
          if (
            STREAMING_MODE === 'nginx' &&
            !needsTranscode(runChannel) &&
            !isMovieChannel(channel) &&
            !isInternalChannel(channel)
          ) {
            built = buildNginxDualCopyFfmpegArgs(
              runChannel,
              id,
              IPTV_DISK_ROOT
            );
            ffmpegArgs = built.args;
            playlist = built.playlist;
            outFilePath = built.hlsPath;
            channel.hlsUrl = built.hlsUrl;
            if (built.tsUrl) channel.liveTsUrl = built.tsUrl;
            else delete channel.liveTsUrl;
            channel.nginxStreaming = true;
            isMpegtsOut = false;
          } else {
            built = buildFfmpegArgs(runChannel, streamDir, id, rootDir);
            ffmpegArgs = built.args;
            playlist = built.playlist;
            outFilePath = path.join(streamDir, playlist);
            isMpegtsOut = playlist === 'stream.ts';
            if (isMpegtsOut) channel.hlsUrl = built.hlsUrl;
            else channel.hlsUrl = `/streams/${id}/${playlist}`;
            channel.nginxStreaming = false;
            delete channel.liveTsUrl;
          }
        } catch (e) {
          channel.status = 'error';
          channel.error = e.message;
          writeLog(`\n[ERROR] ${e.message}\n`);
          closeLog();
          if (!settled) {
            settled = true;
            reject(e);
          }
          return;
        }

        console.log(`[${id}] FFmpeg:`, ffmpegArgs.join(' '));
        writeLog(`[${new Date().toISOString()}] Source URL: [redacted]\n`);
        if (channel.nginxStreaming) {
          writeLog(
            `[${new Date().toISOString()}] Nginx mode: HLS on disk (${IPTV_DISK_ROOT})${built.tsUrl ? '; MPEG-TS via Node stdout pipe (no .ts file)' : ''}\n`
          );
        } else if (isMpegtsOut) {
          writeLog(
            `[${new Date().toISOString()}] MPEG-TS: stdout pipe (no disk file)\n`
          );
        }
        writeLog(`[${new Date().toISOString()}] FFmpeg args: [redacted]\n\n`);

        if (reconnectDone === 0) {
          if (usePipe) waitForPipeMpegts(id);
          else waitForOutputFile(outFilePath, false);
        }

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
          stdio: ['pipe', usePipe ? 'pipe' : 'ignore', 'pipe'],
        });

        setProcess(id, ffmpeg);
        channel.status = 'starting';
        channel.error = null;

        ffmpeg.stdout.on('data', (data) => {
          if (getProcess(id) !== ffmpeg) return;
          if (usePipe) broadcastTsData(id, data);
        });

        if (!channel.streamInfo) channel.streamInfo = {};

        ffmpeg.stderr.on('data', (data) => {
          if (getProcess(id) !== ffmpeg) return;
          const msg = data.toString();
          writeLog(msg);
          if (
            msg.includes('Opening') ||
            msg.includes('Output #0') ||
            msg.includes('Output #1')
          ) {
            channel.status = 'running';
            if (!channel.startedAt)
              channel.startedAt = new Date().toISOString();
          }

          const vMatch = msg.match(
            /Stream\s+#\d+:\d+.*Video:\s+(\w+).+?(\d{2,5})x(\d{2,5})/
          );
          if (vMatch && !channel.streamInfo._vDone) {
            channel.streamInfo.video_codec = vMatch[1];
            channel.streamInfo.width = parseInt(vMatch[2], 10);
            channel.streamInfo.height = parseInt(vMatch[3], 10);
            channel.streamInfo._vDone = true;
          }
          const fpsMatch = msg.match(/(\d+(?:\.\d+)?)\s+fps/);
          if (fpsMatch && !channel.streamInfo._fpsDone) {
            channel.streamInfo.fps = parseFloat(fpsMatch[1]);
            channel.streamInfo._fpsDone = true;
          }
          const aMatch = msg.match(/Stream\s+#\d+:\d+.*Audio:\s+(\w+)/);
          if (aMatch && !channel.streamInfo._aDone) {
            channel.streamInfo.audio_codec = aMatch[1];
            channel.streamInfo._aDone = true;
          }

          const brMatch = msg.match(/bitrate=\s*([\d.]+)kbits\/s/);
          if (brMatch)
            channel.streamInfo.bitrate = Math.round(parseFloat(brMatch[1]));
          const speedMatch = msg.match(/speed=\s*([\d.]+)x/);
          if (speedMatch) channel.streamInfo.speed = parseFloat(speedMatch[1]);
          const progFps = msg.match(/fps=\s*([\d.]+)/);
          if (progFps) channel.streamInfo.current_fps = parseFloat(progFps[1]);
        });

        ffmpeg.on('error', (err) => {
          if (getProcess(id) !== ffmpeg) {
            if (controller.cancelled && !settled) {
              settled = true;
              closeLog();
              if (getRunController(id) === controller) deleteRunController(id);
              reject(new Error('Channel start cancelled'));
            }
            return;
          }
          console.error(`[${id}] FFmpeg error:`, err.message);
          writeLog(`\n[ERROR] ${err.message}\n`);
          channel.status = 'error';
          channel.error = err.message;
          deleteProcess(id);
          if (!settled) {
            settled = true;
            closeLog();
            deleteRunController(id);
            reject(err);
          }
        });

        ffmpeg.on('close', (code) => {
          if (getProcess(id) !== ffmpeg) {
            cleanupProcessListeners(ffmpeg);
            closeLog();
            if (controller.cancelled && !settled) {
              settled = true;
              if (getRunController(id) === controller) deleteRunController(id);
              reject(new Error('Channel start cancelled'));
            }
            return;
          }
          console.log(`[${id}] FFmpeg exited with code ${code}`);
          writeLog(`\n[EXIT] FFmpeg exited with code ${code}\n`);
          deleteProcess(id);

          if (channel.status === 'stopped') {
            deleteRunController(id);
            closeLog();
            return;
          }

          if (code !== 0 && reconnectDone < maxReconnect) {
            reconnectDone++;
            if (isMovieChannel(channel)) movieSourceFailCount++;
            channel.status = 'starting';
            channel.error = null;
            scheduleSpawn(delaySec * 1000);
            return;
          }

          const srcList = channelSources(channel);
          let outBytes = 0;
          if (isMpegtsPipeOutput(channel)) {
            outBytes = getTsBroadcast(id)?.sessionBytes || 0;
          } else {
            try {
              outBytes = fs.existsSync(outFilePath)
                ? fs.statSync(outFilePath).size
                : 0;
            } catch {
              outBytes = 0;
            }
          }
          const emptyOutput = outBytes < 188 * 20;
          if (isMovieChannel(channel) && (code !== 0 || emptyOutput)) {
            movieSourceFailCount++;
            if (movieSourceFailCount <= 2) {
              channel.status = 'starting';
              channel.error = null;
              writeLog(
                `\n[RETRY] Movie source retry ${movieSourceFailCount}/2 (code=${code}, out=${outBytes} bytes)\n\n`
              );
              scheduleSpawn(1200);
              return;
            }
            movieSourceFailCount = 0;
          } else {
            movieSourceFailCount = 0;
          }
          if (
            code === 0 &&
            (channel.streamMode === 'vod' || isMovieChannel(channel)) &&
            srcList.length > 1
          ) {
            if (isMovieChannel(channel) && channel.movieLoop === false) {
              channel.status = 'stopped';
              channel.startedAt = null;
              channel.error = null;
              persistChannel(id);
              closeLog();
              return;
            }
            const idx = parseInt(channel.sourceIndex, 10);
            const safeIdx = Number.isFinite(idx)
              ? Math.max(0, Math.min(srcList.length - 1, idx))
              : 0;
            channel.sourceIndex = (safeIdx + 1) % srcList.length;
            channel.status = 'starting';
            channel.error = null;
            reconnectDone = 0;
            writeLog(
              `\n[NEXT] Switching to movie ${channel.sourceIndex + 1}/${srcList.length}: ${srcList[channel.sourceIndex]}\n\n`
            );
            persistChannel(id);
            scheduleSpawn(1000);
            return;
          }

          if (code !== 0) {
            channel.status = 'error';
            channel.error = `FFmpeg exited with code ${code}`;
          } else {
            channel.status = 'stopped';
            channel.startedAt = null;
          }
          persistChannel(id);
          deleteRunController(id);
          closeLog();
        });
      }

      spawnOnce();
    });
  }

  // ---------- restart helpers ----------
  function restartChannel(id) {
    stopChannel(id);
    const ch = getChannel(id);
    if (ch) {
      startChannel(id, ch);
    }
  }

  async function safeRestartChannel(id, channel) {
    stopChannel(id);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await startChannel(id, channel);
  }

  async function restartWithSeamlessIfPossible(id, channel) {
    if (channel.outputFormat === 'hls' && channel.status === 'running') {
      const nextSlot = activeStreamSlot(channel) === 'a' ? 'b' : 'a';
      const ok = await seamlessSwitchChannel(id, channel, nextSlot);
      if (ok) return true;
    }
    await safeRestartChannel(id, channel);
    return false;
  }

  // Register with onDemandLive
  onDemandLive.registerStartChannel(startChannel);

  return {
    startChannel,
    stopChannel,
    restartChannel,
    safeRestartChannel,
    restartWithSeamlessIfPossible,
    startShadowChannel,
    seamlessSwitchChannel,
    activeStreamSlot,
    streamDirFor,
    persistChannel,
  };
};
