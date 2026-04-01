'use strict';

/**
 * Bandwidth Monitor — stores hourly bandwidth snapshots in Redis.
 * Tracks: rx_bytes, tx_bytes, rx_sec, tx_sec per sample.
 * Provides history for charts and reporting.
 */

const redis = require('../lib/redis');
const redisClient = redis.getClient();

// In-memory ring buffer for the last 60 data points (1 point/5s = 5min of live data)
const RING_SIZE = 60;
const liveRing = {
  times: [],
  rxBps: [],   // bytes per second
  txBps: [],
};

// Hourly archive keys: bandwidth:YYYY-MM-DD:HH → [{rxBps, txBps, ts}]
const ARCHIVE_TTL_SEC = 7 * 24 * 3600; // keep 7 days

function hourKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  return `bandwidth:${y}-${m}-${d}:${h}`;
}

function todayHourKey() {
  return hourKey(new Date());
}

/**
 * Record a bandwidth sample (called every time we collect system metrics).
 * @param {number} rxBps - bytes received per second
 * @param {number} txBps - bytes sent per second
 */
async function recordSample(rxBps, txBps) {
  const now = Date.now();
  const key = todayHourKey();

  // Ring buffer (live chart data)
  liveRing.times.push(now);
  liveRing.rxBps.push(rxBps);
  liveRing.txBps.push(txBps);
  if (liveRing.times.length > RING_SIZE) {
    liveRing.times.shift();
    liveRing.rxBps.shift();
    liveRing.txBps.shift();
  }

  // Hourly archive in Redis
  try {
    const point = JSON.stringify({ rxBps, txBps, ts: now });
    await redisClient.rpush(key, point);
    await redisClient.expire(key, ARCHIVE_TTL_SEC);
  } catch (e) {
    // Non-fatal: log and continue
  }
}

/**
 * Get bandwidth data for a time range.
 * @param {number} hoursBack - how many past hours to fetch
 * @returns {{ points: [{time, rxMB, txMB, rxMbps, txMbps}], totalRxMB, totalTxMB, peakInMbps, peakOutMbps }}
 */
async function getBandwidthHistory(hoursBack = 6) {
  const now = new Date();
  const points = [];
  let totalRxBytes = 0;
  let totalTxBytes = 0;
  let peakInBps = 0;
  let peakOutBps = 0;

  for (let h = 0; h < hoursBack; h++) {
    const d = new Date(now);
    d.setUTCHours(d.getUTCHours() - h);
    const key = hourKey(d);
    try {
      const data = await redisClient.lrange(key, 0, -1);
      for (const raw of data) {
        try {
          const p = JSON.parse(raw);
          const ageMs = now.getTime() - p.ts;
          if (ageMs < 0 || ageMs > 3600 * 1000 * (hoursBack + 1)) continue;

          const rxMB = p.rxBps / (1024 * 1024);
          const txMB = p.txBps / (1024 * 1024);
          points.push({ time: p.ts, rxMB: +rxMB.toFixed(4), txMB: +txMB.toFixed(4), rxMbps: +(rxMB * 8).toFixed(3), txMbps: +(txMB * 8).toFixed(3) });
          totalRxBytes += p.rxBps;
          totalTxBytes += p.txBps;
          if (p.rxBps > peakInBps) peakInBps = p.rxBps;
          if (p.txBps > peakOutBps) peakOutBps = p.txBps;
        } catch {}
      }
    } catch {}
  }

  // Add live ring buffer data (last 5 min)
  const liveStart = now.getTime() - (RING_SIZE * 5 * 1000);
  for (let i = 0; i < liveRing.times.length; i++) {
    if (liveRing.times[i] < liveStart) continue;
    const rxMB = liveRing.rxBps[i] / (1024 * 1024);
    const txMB = liveRing.txBps[i] / (1024 * 1024);
    points.push({ time: liveRing.times[i], rxMB: +rxMB.toFixed(4), txMB: +txMB.toFixed(4), rxMbps: +(rxMB * 8).toFixed(3), txMbps: +(txMB * 8).toFixed(3) });
    totalRxBytes += liveRing.rxBps[i];
    totalTxBytes += liveRing.txBps[i];
    if (liveRing.rxBps[i] > peakInBps) peakInBps = liveRing.rxBps[i];
    if (liveRing.txBps[i] > peakOutBps) peakOutBps = liveRing.txBps[i];
  }

  points.sort((a, b) => a.time - b.time);

  return {
    points,
    totalRxMB: +(totalRxBytes / (1024 * 1024)).toFixed(2),
    totalTxMB: +(totalTxBytes / (1024 * 1024)).toFixed(2),
    peakInMbps: +(peakInBps * 8 / (1024 * 1024)).toFixed(3),
    peakOutMbps: +(peakOutBps * 8 / (1024 * 1024)).toFixed(3),
  };
}

/**
 * Get the latest (live) bandwidth sample from the ring buffer.
 */
function getLatestSample() {
  if (liveRing.times.length === 0) {
    return { rxMbps: 0, txMbps: 0, rxMBps: 0, txMBps: 0 };
  }
  const n = liveRing.rxBps.length - 1;
  const rxMBps = liveRing.rxBps[n] / (1024 * 1024);
  const txMBps = liveRing.txBps[n] / (1024 * 1024);
  return {
    rxMbps: +(rxMBps * 8).toFixed(3),
    txMbps: +(txMBps * 8).toFixed(3),
    rxMBps: +rxMBps.toFixed(4),
    txMBps: +txMBps.toFixed(4),
  };
}

module.exports = { recordSample, getBandwidthHistory, getLatestSample };
