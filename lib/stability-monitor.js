const fs = require('fs');
const path = require('path');

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function tailFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size || 0;
    if (size <= 0) return '';
    const readBytes = Math.min(size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function parseLogStats(text) {
  const lines = String(text || '').split(/\r?\n/);
  let dtsIssues = 0;
  let decryptErrors = 0;
  let inputErrors = 0;
  let httpErrors = 0;
  let drops = 0;
  let lagEvents = 0;
  let lagSeconds = 0;
  let missingStreams = 0;
  const speeds = [];

  for (const ln of lines) {
    const l = ln.toLowerCase();
    if (!l) continue;
    if (l.includes('non-monotonous dts') || l.includes('invalid dts') || l.includes('invalid pts')) {
      dtsIssues++;
    }
    if (l.includes('decrypt') || l.includes('decryption') || l.includes('cenc')) {
      if (l.includes('error') || l.includes('fail') || l.includes('invalid')) decryptErrors++;
    }
    if (l.includes('error') && (l.includes('input') || l.includes('demux') || l.includes('mux')))
      inputErrors++;
    if (l.includes('http error') || l.includes('404') || l.includes('connection reset')) httpErrors++;
    if (l.includes('drop') && l.includes('frame')) drops++;
    if (l.includes('no longer receiving stream_index')) missingStreams++;
    const lagMatch = l.match(/after a lag of\s*([0-9.]+)s/);
    if (lagMatch) {
      lagEvents++;
      const v = parseFloat(lagMatch[1]);
      if (Number.isFinite(v)) lagSeconds += v;
    }
    const m = l.match(/speed=\s*([0-9.]+)x/);
    if (m) speeds.push(parseFloat(m[1]));
  }

  const speedAvg = speeds.length
    ? speeds.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / speeds.length
    : null;

  return { dtsIssues, decryptErrors, inputErrors, httpErrors, drops, speedAvg, lagEvents, lagSeconds, missingStreams };
}

function parsePlaylistDurations(text) {
  const lines = String(text || '').split(/\r?\n/);
  const durs = [];
  for (const ln of lines) {
    if (ln.startsWith('#EXTINF:')) {
      const m = ln.match(/^#EXTINF:([0-9.]+)/);
      if (m) durs.push(parseFloat(m[1]));
    }
  }
  return durs.filter((d) => Number.isFinite(d) && d > 0);
}

function findLatestPlaylist(streamDir) {
  try {
    const files = fs.readdirSync(streamDir).filter((f) => f.endsWith('.m3u8'));
    if (!files.length) return null;
    const media = files.filter((f) => f !== 'master.m3u8');
    const cand = media.length ? media : files;
    let best = null;
    let bestMtime = 0;
    for (const f of cand) {
      const fp = path.join(streamDir, f);
      const st = fs.statSync(fp);
      const mt = st.mtimeMs || 0;
      if (mt > bestMtime) {
        best = fp;
        bestMtime = mt;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function lastSegmentAgeFromPlaylist(playlistPath) {
  try {
    const text = fs.readFileSync(playlistPath, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    let lastSeg = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      if (ln && !ln.startsWith('#')) {
        lastSeg = ln.trim();
        break;
      }
    }
    if (!lastSeg) return null;
    const segPath = path.join(path.dirname(playlistPath), lastSeg);
    const st = fs.statSync(segPath);
    return Date.now() - (st.mtimeMs || 0);
  } catch {
    return null;
  }
}

function computeStabilityScore(channel, stats) {
  if (!channel || channel.status !== 'running') {
    return {
      score: 100,
      statusText: 'Idle',
      penalties: { idle: 0 },
    };
  }

  let score = 100;
  const penalties = {};

  const dtsPenalty = Math.min(40, stats.dtsIssues * 12);
  if (dtsPenalty) {
    penalties.dts = dtsPenalty;
    score -= dtsPenalty;
  }

  const decryptPenalty = Math.min(40, stats.decryptErrors * 20);
  if (decryptPenalty) {
    penalties.decrypt = decryptPenalty;
    score -= decryptPenalty;
  }

  const inputPenalty = Math.min(30, stats.inputErrors * 8);
  if (inputPenalty) {
    penalties.input = inputPenalty;
    score -= inputPenalty;
  }

  const httpPenalty = Math.min(30, stats.httpErrors * 10);
  if (httpPenalty) {
    penalties.http = httpPenalty;
    score -= httpPenalty;
  }

  const dropPenalty = Math.min(20, stats.drops * 5);
  if (dropPenalty) {
    penalties.drops = dropPenalty;
    score -= dropPenalty;
  }

  const missPenalty = Math.min(30, stats.missingStreams * 8);
  if (missPenalty) {
    penalties.missing = missPenalty;
    score -= missPenalty;
  }

  const lagPenalty = Math.min(40, Math.round((stats.lagSeconds || 0) * 5) + (stats.lagEvents || 0) * 8);
  if (lagPenalty) {
    penalties.lag = lagPenalty;
    score -= lagPenalty;
  }

  if (stats.speedAvg !== null) {
    if (stats.speedAvg < 0.9) {
      penalties.speed = 25;
      score -= 25;
    } else if (stats.speedAvg < 0.95) {
      penalties.speed = 15;
      score -= 15;
    }
  }

  if (stats.segmentAgeMs != null) {
    const seg = Math.max(1, Number(stats.segmentSeconds) || 4);
    if (stats.segmentAgeMs > seg * 5000) {
      penalties.segment = 40;
      score -= 40;
    } else if (stats.segmentAgeMs > seg * 3000) {
      penalties.segment = 25;
      score -= 25;
    } else if (stats.segmentAgeMs > seg * 1500) {
      penalties.segment = 10;
      score -= 10;
    }
  }

  if (stats.pipeStall) {
    penalties.pipe = 30;
    score -= 30;
  }

  score = clamp(score, 0, 100);
  let statusText = 'Stable';
  if (score < 60) statusText = 'Unstable';
  else if (score < 85) statusText = 'Warning';

  return { score, statusText, penalties };
}

function createStabilityMonitor(opts) {
  const {
    getChannels,
    getChannelById,
    streamDirFor,
    isMpegtsPipeOutput,
    tsBroadcasts,
    persistChannel,
    onAutoFix,
    dbApi,
    intervalMs = 5000,
    batchSize = 40,
  } = opts;

  const state = new Map();
  let cursor = 0;

  function getState(id) {
    let s = state.get(id);
    if (!s) {
      s = {
        lastBytes: 0,
        lastAt: Date.now(),
        goodStreak: 0,
        badStreak: 0,
        lastScore: 100,
        lastStatus: 'Stable',
        lastPersistAt: 0,
      };
      state.set(id, s);
    }
    return s;
  }

  function scanChannel(id, channel) {
    if (!channel || channel.status !== 'running') {
      const s = getState(id);
      const result = { score: 100, statusText: 'Idle', penalties: {} };
      const meta = { score: result.score, penalties: {} };
      const nowIso = new Date().toISOString();
      channel.stabilityScore = result.score;
      channel.stabilityStatus = result.statusText;
      channel.stabilityLastChecked = nowIso;
      channel.stabilityMeta = meta;

      const nowMs = Date.now();
      const scoreChanged = result.score !== s.lastScore;
      const statusChanged = result.statusText !== s.lastStatus;
      const timeElapsed = nowMs - s.lastPersistAt > 15000;
      if (scoreChanged || statusChanged || timeElapsed) {
        persistChannel(id).catch(() => {});
        dbApi.upsertChannelHealth(id, channel.userId, result.score, result.statusText, meta).catch(() => {});
        s.lastPersistAt = nowMs;
        s.lastScore = result.score;
        s.lastStatus = result.statusText;
      }
      return;
    }
    const streamDir = streamDirFor(id);
    const logFile = path.join(streamDir, '..', 'logs', `${id}.log`);
    const logText = tailFile(logFile, 96 * 1024);
    const logStats = parseLogStats(logText);

    let segmentAgeMs = null;
    let segmentSeconds = channel.hlsSegmentSeconds || 4;
    if (channel.outputFormat === 'hls') {
      const pl = findLatestPlaylist(streamDir);
      if (pl) {
        segmentAgeMs = lastSegmentAgeFromPlaylist(pl);
        try {
          const text = fs.readFileSync(pl, 'utf8');
          const durs = parsePlaylistDurations(text);
          if (durs.length) {
            const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
            segmentSeconds = Number.isFinite(avg) ? avg : segmentSeconds;
          }
        } catch {}
      }
    }

    let pipeStall = false;
    if (isMpegtsPipeOutput(channel)) {
      const s = getState(id);
      const now = Date.now();
      const bytes = tsBroadcasts.get(id)?.sessionBytes || 0;
      if (now - s.lastAt >= 5000) {
        pipeStall = bytes <= s.lastBytes;
        s.lastBytes = bytes;
        s.lastAt = now;
      }
    }

    const stats = {
      ...logStats,
      segmentAgeMs,
      segmentSeconds,
      pipeStall,
    };

    const result = computeStabilityScore(channel, stats);
    const s = getState(id);
    if (result.score >= 85) {
      s.goodStreak += 1;
      s.badStreak = 0;
    } else if (result.score < 60) {
      s.badStreak += 1;
      s.goodStreak = 0;
    } else {
      s.goodStreak = 0;
      s.badStreak = 0;
    }

    const meta = {
      ...stats,
      penalties: result.penalties,
      score: result.score,
    };

    const nowIso = new Date().toISOString();
    channel.stabilityScore = result.score;
    channel.stabilityStatus = result.statusText;
    channel.stabilityLastChecked = nowIso;
    channel.stabilityMeta = meta;

    const nowMs = Date.now();
    const scoreChanged = result.score !== s.lastScore;
    const statusChanged = result.statusText !== s.lastStatus;
    const timeElapsed = nowMs - s.lastPersistAt > 15000;

    if (scoreChanged || statusChanged || timeElapsed) {
      persistChannel(id).catch(() => {});
      dbApi.upsertChannelHealth(id, channel.userId, result.score, result.statusText, meta).catch(() => {});
      s.lastPersistAt = nowMs;
      s.lastScore = result.score;
      s.lastStatus = result.statusText;
    }

    if (channel.autoFixEnabled) {
      if (result.score < 60 && s.badStreak >= 2) {
        onAutoFix(id, 'degrade', result, meta);
      } else if (result.score > 85 && s.goodStreak >= 6) {
        onAutoFix(id, 'recover', result, meta);
      }
    }
  }

  function tick() {
    const list = getChannels();
    if (!list.length) return;
    const start = cursor;
    const end = Math.min(start + batchSize, list.length);
    for (let i = start; i < end; i++) {
      const id = list[i];
      const ch = getChannelById(id);
      if (!ch) continue;
      scanChannel(id, ch);
    }
    cursor = end >= list.length ? 0 : end;
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { createStabilityMonitor };
