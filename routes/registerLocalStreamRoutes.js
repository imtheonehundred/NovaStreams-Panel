'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function registerLocalStreamRoutes({
  app,
  express,
  rootDir,
  channels,
  tsBroadcasts,
  hlsIdle,
  securityService,
  buildMergedHeaders,
  activeSourceUrl,
  activeStreamSlot,
  resolveEffectiveInputType,
  ensureTsBroadcast,
  lineService,
  onDemandLive,
  streamingSettings,
  waitForPrebuffer,
  snapshotPrebuffer,
  stopChannel,
  PassThrough,
  STREAMING_MODE,
  ALLOW_ADMIN_PREVIEW_UNSIGNED_TS,
  ALLOW_LOCAL_UNSIGNED_TS,
  isMpegtsPipeOutput,
  isInternalChannel,
}) {
  function channelIdParamOk(id) {
    return /^[a-f0-9]{8}$/i.test(id);
  }

  async function validateStreamRequest(req, res, channelId) {
    const token = req.query.token;
    const expires = req.query.expires;
    const sig = req.query.sig;
    const verdict = await securityService.validateStreamAccess({
      token: token && String(token),
      expires: expires && String(expires),
      sig: sig && String(sig),
      ip: req.ip,
      channelId,
    });
    if (!verdict.ok) {
      res.status(401).setHeader('Content-Type', 'text/plain').send('Unauthorized');
      return null;
    }
    return verdict;
  }

  function isDirectLoopbackClient(req) {
    const raw =
      (req.socket && req.socket.remoteAddress) ||
      (req.connection && req.connection.remoteAddress) ||
      '';
    const s = String(raw).replace(/^::ffff:/i, '');
    return s === '127.0.0.1' || s === '::1';
  }

  function canLocalUnsignedTs(req) {
    return ALLOW_LOCAL_UNSIGNED_TS && isDirectLoopbackClient(req);
  }

  function canAdminPreviewUnsignedTs(req, channelId) {
    if (!ALLOW_ADMIN_PREVIEW_UNSIGNED_TS) return false;
    const uid = req.session && req.session.userId;
    if (!uid) return false;
    const ch = channels.get(channelId);
    return !!(ch && ch.userId === uid);
  }

  function canUnsignedTsPlayback(req, channelId) {
    if (canAdminPreviewUnsignedTs(req, channelId)) return true;
    if (canLocalUnsignedTs(req)) return true;
    return false;
  }

  async function attachMpegTsClient(req, res, id) {
    if (!/^[a-f0-9]{8}$/i.test(id)) {
      return res.status(400).end();
    }
    let verdict;
    if (canUnsignedTsPlayback(req, id)) {
      verdict = { ok: true };
    } else {
      verdict = await validateStreamRequest(req, res, id);
      if (!verdict) return;
    }
    let ch = channels.get(id);
    if (!isMpegtsPipeOutput(ch)) {
      return res.status(404).setHeader('Content-Type', 'text/plain').send('Not an MPEG-TS channel');
    }
    if (ch && ch.on_demand) {
      try {
        await onDemandLive.ensureOnDemandStreamIfNeeded(id);
      } catch (e) {
        return res.status(503).setHeader('Content-Type', 'text/plain').send(e.message || 'Stream start failed');
      }
      ch = channels.get(id);
    }
    if (!ch || (ch.status !== 'running' && ch.status !== 'starting')) {
      return res.status(503).setHeader('Content-Type', 'text/plain').send('Stream not available');
    }
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming && ch.on_demand) {
      hlsIdle.touch(id);
    }
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Connection', 'keep-alive');
    try {
      req.socket.setNoDelay(true);
    } catch {}
    const b = ensureTsBroadcast(id);
    if (b.idleTimer) {
      clearTimeout(b.idleTimer);
      b.idleTimer = null;
    }
    const odMin = streamingSettings.getEffectiveOnDemandMinBytes(ch);
    const odWait = streamingSettings.getOnDemandMaxWaitMs();
    if (streamingSettings.isPrebufferEnabled() && ch.on_demand && odMin > 0) {
      await waitForPrebuffer(b, odMin, odWait);
    }
    const consumer = new PassThrough({ highWaterMark: 64 * 1024 });
    if (streamingSettings.isPrebufferEnabled()) {
      const snap = snapshotPrebuffer(b);
      if (snap.length > 0) {
        consumer.write(snap);
      }
    }
    b.consumers.add(consumer);
    consumer.pipe(res);
    const sessionLineId = verdict && verdict.lineUserId ? verdict.lineUserId : null;
    const sessionUuid = verdict && verdict.sessionUuid ? verdict.sessionUuid : '';
    const keepAliveTimer = sessionLineId && sessionUuid
      ? setInterval(() => {
          lineService.refreshConnection(sessionLineId, sessionUuid).catch(() => {});
          lineService.touchRuntimeSession(sessionUuid).catch(() => {});
        }, 120000)
      : null;
    if (keepAliveTimer && typeof keepAliveTimer.unref === 'function') keepAliveTimer.unref();
    req.on('close', () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (sessionLineId && sessionUuid) {
        lineService.closeConnection(sessionLineId, sessionUuid).catch(() => {});
        lineService.closeRuntimeSession(sessionUuid).catch(() => {});
      }
      b.consumers.delete(consumer);
      try {
        consumer.unpipe(res);
      } catch {}
      consumer.destroy();
      const chNow = channels.get(id);
      if (b.consumers.size === 0 && chNow && chNow.on_demand && !streamingSettings.channelPreWarmEffective(chNow)) {
        b.idleTimer = setTimeout(() => {
          const bNow = tsBroadcasts.get(id);
          const chIdle = channels.get(id);
          if (bNow && bNow.consumers.size === 0 && chIdle && !streamingSettings.channelPreWarmEffective(chIdle)) {
            console.log(`[IDLE-KILL] On-demand TS channel ${id} idle for 60s, stopping.`);
            stopChannel(id);
          }
        }, 60000);
      }
    });
  }

  app.get('/streams/:channelId/:playlistFile', async (req, res, next) => {
    const id = req.params.channelId;
    const playlistFile = req.params.playlistFile;
    if (!channelIdParamOk(id)) return next();
    if (!playlistFile.endsWith('.m3u8')) return next();
    if (playlistFile === 'master.m3u8') return next();

    hlsIdle.touch(id);

    const ch = channels.get(id);
    if (!ch || ch.outputFormat !== 'hls' || ch.hlsIngestMode !== 'buffered') return next();

    const delay = parseInt(ch.hlsBufferDelaySec, 10) || 0;
    if (delay <= 0) return next();

    const srcUrl = activeSourceUrl(ch) || String(ch.mpdUrl || '').trim();
    if (resolveEffectiveInputType(srcUrl, ch.inputType || 'auto') !== 'hls') return next();

    const verdict = await validateStreamRequest(req, res, id);
    if (!verdict) return;

    const filePath = path.join(rootDir, 'streams', id, activeStreamSlot(ch), playlistFile);
    fs.readFile(filePath, 'utf8', (err, text) => {
      if (err || !text || !text.includes('#EXTINF:')) return next();
      const seg = Math.max(2, Math.min(12, parseInt(ch.hlsSegmentSeconds, 10) || 4));
      const out = require('../lib/hls-delay-playlist').rewriteMediaPlaylistDelayed(text, delay, seg);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(out);
    });
  });

  app.get('/streams/:channelId/:file', async (req, res, next) => {
    const id = req.params.channelId;
    const file = req.params.file;
    if (!channelIdParamOk(id)) return next();
    if (!file) return next();

    const normalizedFile = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalizedFile !== file || normalizedFile.includes('..')) return next();
    file = normalizedFile;

    const ch = channels.get(id);
    if (!ch || ch.outputFormat !== 'hls') return next();

    const verdict = await validateStreamRequest(req, res, id);
    if (!verdict) return;

    hlsIdle.touch(id);

    const slot = activeStreamSlot(ch);
    const baseDir = path.join(rootDir, 'streams', id, slot);
    const filePath = path.join(baseDir, file);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(baseDir))) return next();
    if (!fs.existsSync(resolvedPath)) return next();

    if (resolvedPath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (resolvedPath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else {
      return next();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(resolvedPath);
  });

  app.get('/streams/:channelId/stream.ts', async (req, res) => {
    return attachMpegTsClient(req, res, req.params.channelId);
  });
};
