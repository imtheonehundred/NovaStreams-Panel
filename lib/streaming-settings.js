'use strict';

/**
 * Streaming performance settings: DB (settings table) with env fallback.
 * Resolution: DB non-empty value wins over process.env over code defaults.
 * Channel overrides are applied in getEffective* helpers.
 */

const KEYS = {
  prebuffer_enabled: 'streaming_prebuffer_enabled',
  prebuffer_size_mb: 'streaming_prebuffer_size_mb',
  prebuffer_on_demand_min_bytes: 'streaming_prebuffer_on_demand_min_bytes',
  prebuffer_on_demand_max_wait_ms: 'streaming_prebuffer_on_demand_max_wait_ms',
  ingest_style: 'streaming_ingest_style',
  low_latency_enabled: 'streaming_low_latency_enabled',
  minimal_ingest_enabled: 'streaming_minimal_ingest_enabled',
  prewarm_enabled: 'streaming_prewarm_enabled',
};

const DEFAULTS = {
  prebuffer_enabled: true,
  prebuffer_size_mb: 1,
  prebuffer_on_demand_min_bytes: 262144,
  prebuffer_on_demand_max_wait_ms: 500,
  ingest_style: 'webapp',
  low_latency_enabled: true,
  minimal_ingest_enabled: true,
  prewarm_enabled: true,
};

let cache = buildCacheFromEnvOnly();

function truthyEnv(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  return null;
}

function parseBoolFromDb(val, envKey, def) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const t = truthyEnv(val);
    if (t !== null) return t;
  }
  const ev = process.env[envKey];
  if (ev !== undefined && String(ev).trim() !== '') {
    const t = truthyEnv(ev);
    if (t !== null) return t;
  }
  return def;
}

function parseFloatFromDb(val, envKey, def, min, max) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const n = parseFloat(String(val), 10);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  }
  const ev = process.env[envKey];
  if (ev !== undefined && String(ev).trim() !== '') {
    const n = parseFloat(ev, 10);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  }
  return def;
}

function parseIntFromDb(val, envKey, def, min, max) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const n = parseInt(String(val), 10);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  }
  const ev = process.env[envKey];
  if (ev !== undefined && String(ev).trim() !== '') {
    const n = parseInt(ev, 10);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  }
  return def;
}

function parseIngestStyleFromDb(val) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const s = String(val).trim().toLowerCase();
    if (['webapp', 'xc', 'safe'].includes(s)) return s;
  }
  const raw = String(process.env.STREAM_INGEST_STYLE ?? '').trim().toLowerCase();
  if (!raw) return DEFAULTS.ingest_style;
  if (['0', 'false', 'no', 'off', 'none'].includes(raw)) return 'xc';
  if (raw === 'webapp') return 'webapp';
  return 'xc';
}

function buildCacheFromEnvOnly() {
  return {
    prebuffer_enabled: parseBoolFromDb(undefined, 'PREBUFFER_ENABLED', DEFAULTS.prebuffer_enabled),
    prebuffer_size_mb: parseFloatFromDb(undefined, 'PREBUFFER_SIZE_MB', DEFAULTS.prebuffer_size_mb, 0.5, 16),
    prebuffer_on_demand_min_bytes: (() => {
      const maxB = Math.round(parseFloatFromDb(undefined, 'PREBUFFER_SIZE_MB', DEFAULTS.prebuffer_size_mb, 0.5, 16) * 1024 * 1024);
      const defMin = Math.min(2097152, maxB);
      const v = process.env.PREBUFFER_ON_DEMAND_MIN_BYTES;
      if (v !== undefined && String(v).trim() !== '') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) return Math.min(maxB, n);
      }
      return defMin;
    })(),
    prebuffer_on_demand_max_wait_ms: parseIntFromDb(
      undefined,
      'PREBUFFER_ON_DEMAND_MAX_WAIT_MS',
      DEFAULTS.prebuffer_on_demand_max_wait_ms,
      100,
      60000
    ),
    ingest_style: parseIngestStyleFromDb(undefined),
    low_latency_enabled: parseBoolFromDb(undefined, 'STREAMING_LOW_LATENCY', DEFAULTS.low_latency_enabled),
    minimal_ingest_enabled: parseBoolFromDb(undefined, 'FFMPEG_MINIMAL_INGEST', DEFAULTS.minimal_ingest_enabled),
    prewarm_enabled: parseBoolFromDb(undefined, 'STREAMING_PREWARM_ENABLED', DEFAULTS.prewarm_enabled),
  };
}

function mergeDbRowIntoCache(row, base) {
  const prebuffer_size_mb = parseFloatFromDb(
    row[KEYS.prebuffer_size_mb],
    'PREBUFFER_SIZE_MB',
    base.prebuffer_size_mb,
    0.5,
    16
  );
  const maxB = Math.round(prebuffer_size_mb * 1024 * 1024);
  let odMin = base.prebuffer_on_demand_min_bytes;
  const rawOd = row[KEYS.prebuffer_on_demand_min_bytes];
  if (rawOd !== undefined && rawOd !== null && String(rawOd).trim() !== '') {
    const n = parseInt(String(rawOd), 10);
    if (Number.isFinite(n) && n >= 0) odMin = Math.min(maxB, n);
  }

  let ingest = base.ingest_style;
  if (row[KEYS.ingest_style] !== undefined && row[KEYS.ingest_style] !== null && String(row[KEYS.ingest_style]).trim() !== '') {
    const s = String(row[KEYS.ingest_style]).trim().toLowerCase();
    if (['webapp', 'xc', 'safe'].includes(s)) ingest = s;
  }

  return {
    prebuffer_enabled: parseBoolFromDb(row[KEYS.prebuffer_enabled], 'PREBUFFER_ENABLED', base.prebuffer_enabled),
    prebuffer_size_mb,
    prebuffer_on_demand_min_bytes: odMin,
    prebuffer_on_demand_max_wait_ms: parseIntFromDb(
      row[KEYS.prebuffer_on_demand_max_wait_ms],
      'PREBUFFER_ON_DEMAND_MAX_WAIT_MS',
      base.prebuffer_on_demand_max_wait_ms,
      100,
      60000
    ),
    ingest_style: ingest,
    low_latency_enabled: parseBoolFromDb(row[KEYS.low_latency_enabled], 'STREAMING_LOW_LATENCY', base.low_latency_enabled),
    minimal_ingest_enabled: parseBoolFromDb(row[KEYS.minimal_ingest_enabled], 'FFMPEG_MINIMAL_INGEST', base.minimal_ingest_enabled),
    prewarm_enabled: parseBoolFromDb(row[KEYS.prewarm_enabled], 'STREAMING_PREWARM_ENABLED', base.prewarm_enabled),
  };
}

/**
 * @param {import('../lib/db')} dbApi
 */
async function refreshStreamingSettings(dbApi) {
  const base = buildCacheFromEnvOnly();
  const row = {};
  for (const k of Object.values(KEYS)) {
    try {
      row[k] = await dbApi.getSetting(k);
    } catch {
      row[k] = '';
    }
  }
  cache = mergeDbRowIntoCache(row, base);
}

function getStreamingConfig() {
  return { ...cache };
}

function isPrebufferEnabled() {
  return !!cache.prebuffer_enabled;
}

function getPrebufferMaxBytes() {
  return Math.round(cache.prebuffer_size_mb * 1024 * 1024);
}

function getOnDemandMinBytes() {
  return Math.min(getPrebufferMaxBytes(), cache.prebuffer_on_demand_min_bytes);
}

function getEffectiveOnDemandMinBytes(channel) {
  const maxB = getEffectivePrebufferMaxBytes(channel);
  return Math.min(maxB, cache.prebuffer_on_demand_min_bytes);
}

function getOnDemandMaxWaitMs() {
  return cache.prebuffer_on_demand_max_wait_ms;
}

function getGlobalIngestStyle() {
  return cache.ingest_style;
}

function isLowLatencyEnabled() {
  return !!cache.low_latency_enabled;
}

function isGlobalMinimalIngestEnabled() {
  return !!cache.minimal_ingest_enabled;
}

function isPrewarmGloballyAllowed() {
  return !!cache.prewarm_enabled;
}

function normalizeIngestOverride(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'null' || s === 'undefined') return null;
  if (['webapp', 'xc', 'safe'].includes(s)) return s;
  return null;
}

function getEffectiveIngestStyle(channel) {
  const o = normalizeIngestOverride(channel && channel.ingest_style_override);
  if (o) return o;
  return getGlobalIngestStyle();
}

function getEffectivePrebufferSizeMb(channel) {
  const n = channel && channel.prebuffer_size_mb;
  if (n !== undefined && n !== null && n !== '') {
    const x = parseFloat(n, 10);
    if (Number.isFinite(x) && x > 0) return Math.min(16, Math.max(0.5, x));
  }
  return cache.prebuffer_size_mb;
}

function getEffectivePrebufferMaxBytes(channel) {
  return Math.round(getEffectivePrebufferSizeMb(channel) * 1024 * 1024);
}

function channelPreWarmEffective(channel) {
  return !!(channel && channel.preWarm) && isPrewarmGloballyAllowed();
}

let refreshTimer = null;

function startPeriodicRefresh(dbApi, intervalMs) {
  if (refreshTimer) clearInterval(refreshTimer);
  const ms = Math.min(300000, Math.max(30000, intervalMs || 45000));
  refreshTimer = setInterval(() => {
    refreshStreamingSettings(dbApi).catch((e) => console.error('[streaming-settings] refresh:', e.message));
  }, ms);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
}

module.exports = {
  KEYS,
  DEFAULTS,
  refreshStreamingSettings,
  getStreamingConfig,
  isPrebufferEnabled,
  getPrebufferMaxBytes,
  getOnDemandMinBytes,
  getEffectiveOnDemandMinBytes,
  getOnDemandMaxWaitMs,
  getGlobalIngestStyle,
  getEffectiveIngestStyle,
  getEffectivePrebufferSizeMb,
  getEffectivePrebufferMaxBytes,
  isLowLatencyEnabled,
  isGlobalMinimalIngestEnabled,
  isPrewarmGloballyAllowed,
  channelPreWarmEffective,
  startPeriodicRefresh,
  /** For tests: reset to env-only */
  _resetCacheForTests() {
    cache = buildCacheFromEnvOnly();
  },
};
