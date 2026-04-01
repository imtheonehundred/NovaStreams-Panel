'use strict';

/**
 * Service Health Monitor — tracks panel uptime and response time.
 * Runs an internal health check every 30s and stores results in Redis.
 * Uses a simple in-memory fetch to the local /api/admin/health-check endpoint.
 */

const redis = require('../lib/redis');
const fetch = require('node-fetch');
const redisClient = redis.getClient();

const CHECK_INTERVAL_MS = 30 * 1000;
const STORE_TTL_SEC = 7 * 24 * 3600; // 7 days
const MAX_RESPONSE_TIME_MS = 5000;

let checkTimer = null;
let hasCompletedCheck = false;
let isUp = false;
let lastCheckAt = 0;
let lastResponseMs = null;
let lastError = '';
let consecutiveFails = 0;

// Rolling window: last 1440 checks (12h at 30s interval)
const HISTORY_KEY = 'health:history';
const MAX_HISTORY = 1440;

function getHealthKey() {
  const d = new Date();
  return `health:${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

async function runCheck() {
  const start = Date.now();
  lastCheckAt = Date.now();
  const panelUrl = process.env.PANEL_INTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  let timeoutHandle = null;

  try {
    const controller = new AbortController();
    timeoutHandle = setTimeout(() => controller.abort(), MAX_RESPONSE_TIME_MS);
    const res = await fetch(`${panelUrl}/api/admin/health-check`, {
      method: 'GET',
      headers: { 'User-Agent': 'NovaStreams-HealthCheck/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
    lastResponseMs = Date.now() - start;

    if (res.ok) {
      if (!isUp) {
        // Just recovered
        eventBusGetter.emit('health:recovered', { responseMs: lastResponseMs, at: new Date().toISOString() });
      }
      isUp = true;
      consecutiveFails = 0;
      lastError = '';
    } else {
      isUp = false;
      lastError = `HTTP ${res.status}`;
      consecutiveFails++;
      if (consecutiveFails === 1) {
        eventBusGetter.emit('health:down', { error: lastError, responseMs: lastResponseMs, at: new Date().toISOString() });
      }
    }
  } catch (e) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    lastResponseMs = Date.now() - start;
    isUp = false;
    lastError = e.name === 'AbortError' ? 'timeout' : e.message;
    consecutiveFails++;
    if (consecutiveFails === 1) {
      eventBusGetter.emit('health:down', { error: lastError, responseMs: lastResponseMs, at: new Date().toISOString() });
    }
  }

  hasCompletedCheck = true;

  // Store in Redis
  try {
    const record = JSON.stringify({ up: isUp ? 1 : 0, responseMs: lastResponseMs, ts: Date.now(), error: lastError });
    const key = getHealthKey();
    await redisClient.rpush(key, record);
    await redisClient.expire(key, STORE_TTL_SEC);
    await redisClient.ltrim(key, -MAX_HISTORY, -1);
  } catch {}
}

function start() {
  if (checkTimer) return;
  // Run immediately on start
  runCheck();
  checkTimer = setInterval(runCheck, CHECK_INTERVAL_MS);
}

function stop() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function isPanelUp() { return isUp; }
function hasPanelHealthSample() { return hasCompletedCheck; }
function getLastCheckAt() { return lastCheckAt; }
function getLastResponseMs() { return lastResponseMs; }
function getLastError() { return lastError; }
function getConsecutiveFails() { return consecutiveFails; }

/**
 * Get uptime % for a given date key (YYYY-MM-DD).
 * Returns {date, upCount, downCount, totalChecks, uptimePct, avgResponseMs}
 */
async function getDayStats(dateStr = null) {
  if (!dateStr) {
    const d = new Date();
    dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const key = `health:${dateStr}`;
  try {
    const raw = await redisClient.lrange(key, 0, -1);
    let upCount = 0, downCount = 0, totalMs = 0, total = 0;
    for (const r of raw) {
      try {
        const p = JSON.parse(r);
        if (p.up) upCount++;
        else downCount++;
        totalMs += p.responseMs || 0;
        total++;
      } catch {}
    }
    return {
      date: dateStr,
      upCount,
      downCount,
      totalChecks: total,
      uptimePct: total > 0 ? +((upCount / total) * 100).toFixed(2) : null,
      avgResponseMs: total > 0 ? Math.round(totalMs / total) : null,
    };
  } catch {
    return { date: dateStr, upCount: 0, downCount: 0, totalChecks: 0, uptimePct: null, avgResponseMs: null };
  }
}

/**
 * Get uptime % for the last N days.
 */
async function getUptimeHistory(days = 7) {
  const results = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    results.unshift(await getDayStats(dateStr));
  }
  return results;
}

// Lazy-load eventBus to avoid circular dependency
let eventBus = null;
function getEventBus() {
  if (!eventBus) {
    try { eventBus = require('./eventBus'); } catch {}
  }
  return eventBus;
}
const eventBusGetter = {
  emit(event, data) {
    const eb = getEventBus();
    if (eb && eb.emit) eb.emit(event, data);
  }
};

module.exports = { start, stop, isPanelUp, hasPanelHealthSample, getLastCheckAt, getLastResponseMs, getLastError, getConsecutiveFails, getDayStats, getUptimeHistory };
