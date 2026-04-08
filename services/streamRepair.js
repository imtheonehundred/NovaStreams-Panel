'use strict';

/**
 * Stream Source Repair Tool
 *
 * Uses ffprobe to health-check channel stream URLs.
 * Results are stored in Redis for fast access (not DB, to avoid schema changes).
 *
 * Health states:
 *   ok     — stream URL is reachable and has valid streams
 *   slow   — reachable but buffering/lagging (bitrate low or fps dropped)
 *   broken — unreachable, timeout, or invalid stream
 */

const { spawn } = require('child_process');
const redis = require('../lib/redis');

const HEALTH_TTL_SEC = 15 * 60; // 15 minutes
const FFPROBE_TIMEOUT_MS = 10000; // 10s per probe
const BITRATE_THRESHOLD_KBS = 50; // below this = slow
const FPS_DROP_THRESHOLD = 0.5; // if actual_fps < expected * 0.5 = slow

// In-memory cache of last check results (channelId → {status, checkedAt, info})
const memCache = new Map();

function getRedisClient() {
  return redis.getClient();
}

/**
 * Run ffprobe on a channel URL and return parsed stream info.
 * @param {string} url - stream URL (mpd, hls, etc.)
 * @param {object} opts - { headers, inputType, timeoutMs }
 * @returns {Promise<{ok, duration, videoStreams, audioStreams, bitrate, fps, error}>}
 */
function runFfprobe(url, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs || FFPROBE_TIMEOUT_MS;
    const args = [
      '-v', 'error',
      '-show_streams', '-show_format',
      '-of', 'json',
      '-timeout', String(timeoutMs * 1000),
    ];

    // Add headers if present
    if (opts.headers && typeof opts.headers === 'object') {
      for (const [k, v] of Object.entries(opts.headers)) {
        args.push('-headers', `${k}: ${v}\r\n`);
      }
    }

    args.push('-i', url);

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ ok: false, error: 'timeout', duration: null, videoStreams: [], audioStreams: [], bitrate: null, fps: null });
    }, timeoutMs + 2000);

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        const errMsg = (stderr || '').split('\n')[0] || `exit ${code}`;
        resolve({ ok: false, error: errMsg, duration: null, videoStreams: [], audioStreams: [], bitrate: null, fps: null });
        return;
      }

      let info = {};
      try { info = JSON.parse(stdout || '{}'); } catch {}

      const format = info.format || {};
      const streams = Array.isArray(info.streams) ? info.streams : [];
      const videoStreams = streams.filter(s => s.codec_type === 'video');
      const audioStreams = streams.filter(s => s.codec_type === 'audio');

      // Extract bitrate
      let bitrate = null;
      if (format.bit_rate) bitrate = parseInt(format.bit_rate, 10);
      else if (videoStreams[0] && videoStreams[0].bit_rate) bitrate = parseInt(videoStreams[0].bit_rate, 10);

      // Extract fps
      let fps = null;
      if (videoStreams[0]) {
        const fpsStr = videoStreams[0].r_frame_rate || '';
        const parts = fpsStr.split('/');
        if (parts.length === 2) {
          const n = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          if (n && d) fps = Math.round(n / d);
        }
      }

      resolve({
        ok: true,
        error: null,
        duration: format.duration ? parseFloat(format.duration) : null,
        videoStreams: videoStreams.length,
        audioStreams: audioStreams.length,
        bitrate,
        fps,
        width: videoStreams[0] ? videoStreams[0].width : null,
        height: videoStreams[0] ? videoStreams[0].height : null,
        codec: videoStreams[0] ? videoStreams[0].codec_name : null,
      });
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, duration: null, videoStreams: [], audioStreams: [], bitrate: null, fps: null });
    });
  });
}

/**
 * Determine health status from ffprobe result.
 */
function assessHealth(result) {
  if (!result.ok) {
    if (result.error === 'timeout') return 'broken';
    return 'broken';
  }
  if (result.videoStreams === 0) return 'broken'; // no video = broken
  if (result.bitrate && result.bitrate < BITRATE_THRESHOLD_KBS * 1000) return 'slow';
  if (result.fps && result.fps < 5) return 'slow';
  return 'ok';
}

/**
 * Check a single channel's stream URL.
 * @param {string} channelId - the channel ID (Map key)
 * @param {object} channel - channel object with mpdUrl, headers, inputType, etc.
 * @returns {Promise<{channelId, status, checkedAt, info}>}
 */
async function checkChannel(channelId, channel) {
  const { mpdUrl, headers, inputType } = channel;
  if (!mpdUrl) return { status: 'broken', error: 'no_url', info: null };

  const result = await runFfprobe(mpdUrl, { headers, inputType });
  const status = assessHealth(result);

  const record = {
    status,
    checkedAt: Date.now(),
    info: result.ok ? {
      duration: result.duration,
      videoStreams: result.videoStreams,
      audioStreams: result.audioStreams,
      bitrate: result.bitrate,
      fps: result.fps,
      width: result.width,
      height: result.height,
      codec: result.codec,
    } : null,
    error: result.error,
  };

  // Cache in memory
  memCache.set(channelId, record);

  // Store in Redis
  try {
    const key = `stream:health:${channelId}`;
    await getRedisClient().setex(key, HEALTH_TTL_SEC, JSON.stringify(record));
  } catch {}

  return record;
}

/**
 * Get cached health for a channel (from memory or Redis).
 */
async function getChannelHealth(channelId) {
  // Check memory first
  if (memCache.has(channelId)) {
    const cached = memCache.get(channelId);
    if (Date.now() - cached.checkedAt < HEALTH_TTL_SEC * 1000) return cached;
  }

  // Check Redis
  try {
    const key = `stream:health:${channelId}`;
    const raw = await getRedisClient().get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      memCache.set(channelId, parsed);
      return parsed;
    }
  } catch {}

  return null;
}

/**
 * Get health for all channels (map of channelId → healthRecord).
 */
async function getAllChannelHealth(channelIds) {
  const results = {};
  for (const id of channelIds) {
    results[id] = await getChannelHealth(id);
  }
  return results;
}

/**
 * Check all channels (for bulk repair).
 * @param {Array} channelList - array of channel objects (must have id property or use map entry)
 * @param {Map} [channelsMap] - optional Map of id → channel for lookups
 * Returns {total, ok, slow, broken}
 */
async function checkAllChannels(channelList, channelsMap) {
  const results = { total: 0, ok: 0, slow: 0, broken: 0, details: [] };
  for (const ch of channelList) {
    const chId = ch.id || (channelsMap ? [...channelsMap.entries()].find(([, v]) => v === ch)?.[0] : null);
    if (!ch.mpdUrl) {
      results.total++;
      results.broken++;
      results.details.push({ id: chId || '?', name: ch.name || chId, status: 'broken', error: 'no_url' });
      continue;
    }
    results.total++;
    try {
      const record = await checkChannel(chId, ch);
      results[record.status]++;
      results.details.push({ id: chId || '?', name: ch.name || chId, status: record.status, error: record.error, info: record.info });
    } catch (e) {
      results.broken++;
      results.details.push({ id: chId || '?', name: ch.name || chId, status: 'broken', error: e.message });
    }
  }
  return results;
}

module.exports = { checkChannel, getChannelHealth, getAllChannelHealth, checkAllChannels, runFfprobe, assessHealth };
