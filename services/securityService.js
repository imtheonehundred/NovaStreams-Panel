'use strict';

const crypto = require('crypto');
const dbApi = require('../lib/db');
const { execute } = require('../lib/mariadb');
const lineService = require('./lineService');
const sessionService = require('./sessionService');
const sharingDetector = require('./sharingDetector');

let geoip;
try { geoip = require('geoip-lite'); } catch { geoip = null; }

// Bounded IP history map - prevents memory exhaustion attacks
const MAX_IP_HISTORY_ENTRIES = 10000;
const IP_HISTORY_CLEANUP_INTERVAL_MS = 60000; // 1 minute
const ipHistory = new Map();
const blockedUsers = new Set();
const sharingBlockCooldown = new Map();

const CONFIG = {
  ipWindowMs: 60000,
  ipThreshold: 3,
};

// Periodic cleanup of stale ipHistory entries to prevent memory bloat
const ipHistoryCleanupTimer = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [userId, arr] of ipHistory.entries()) {
    const filtered = arr.filter(a => now - a.ts <= CONFIG.ipWindowMs);
    if (filtered.length === 0) {
      ipHistory.delete(userId);
      removed++;
    } else if (filtered.length !== arr.length) {
      ipHistory.set(userId, filtered);
    }
  }
  // Emergency cleanup: if still over limit, remove oldest entries
  if (ipHistory.size > MAX_IP_HISTORY_ENTRIES) {
    const entries = [...ipHistory.entries()];
    entries.sort((a, b) => {
      const aOldest = a[1].length > 0 ? Math.min(...a[1].map(e => e.ts)) : 0;
      const bOldest = b[1].length > 0 ? Math.min(...b[1].map(e => e.ts)) : 0;
      return aOldest - bOldest;
    });
    const toRemove = entries.slice(0, entries.length - MAX_IP_HISTORY_ENTRIES);
    for (const [userId] of toRemove) {
      ipHistory.delete(userId);
    }
  }
}, IP_HISTORY_CLEANUP_INTERVAL_MS);

if (typeof ipHistoryCleanupTimer.unref === 'function') {
  ipHistoryCleanupTimer.unref();
}

async function getStreamSecret() {
  const fromEnv = process.env.STREAM_SECRET;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv);
  const fromDb = await dbApi.getSetting('live_streaming_pass');
  if (fromDb && String(fromDb).trim()) return String(fromDb);
  // Always throw if no secret is configured — no fallback.
  throw new Error('STREAM_SECRET environment variable or live_streaming_pass DB setting is required');
}

function getAesKeySync(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function isStreamTokenIpBindingEnabled() {
  return String(process.env.STREAM_TOKEN_BIND_IP || 'true').toLowerCase() !== 'false';
}

function normalizeClientIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function getMaskedIpBlock(ip) {
  const normalized = normalizeClientIp(ip);
  if (!normalized) return '';
  if (normalized.includes(':')) {
    return normalized.split(':').slice(0, 4).join(':');
  }
  const parts = normalized.split('.');
  if (parts.length === 4) return parts.slice(0, 3).join('.');
  return normalized;
}

async function ensureSecurityLogsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_type VARCHAR(64) NOT NULL,
      entity_type VARCHAR(32) NOT NULL DEFAULT 'line',
      entity_id VARCHAR(64) NOT NULL,
      details_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_security_logs_entity (entity_type, entity_id),
      KEY idx_security_logs_event (event_type, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function writeSecurityLog(eventType, entityId, details = {}) {
  await ensureSecurityLogsTable();
  await execute(
    'INSERT INTO security_logs (event_type, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?)',
    [eventType, 'line', String(entityId), JSON.stringify(details)]
  );
}

function getSharingBlockCooldownMs() {
  const minutes = parseInt(process.env.SHARING_BLOCK_COOLDOWN_MIN || '15', 10);
  return Math.max(1, Number.isFinite(minutes) ? minutes : 15) * 60 * 1000;
}

async function signStreamUrl(token, expires, channelId) {
  const secret = await getStreamSecret();
  return crypto.createHmac('sha256', secret).update(`${token}.${expires}.${channelId}`).digest('hex');
}

async function validateSignature(token, expires, sig, channelId) {
  if (!token || expires === undefined || expires === null || !sig || channelId === undefined || channelId === null) return false;
  if (Date.now() > Number(expires)) return false;
  const expect = await signStreamUrl(token, expires, channelId);
  try {
    const a = Buffer.from(expect, 'hex');
    const b = Buffer.from(String(sig), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function recordIp(userId, ip) {
  const now = Date.now();
  const arr = ipHistory.get(userId) || [];
  const filtered = arr.filter(a => now - a.ts <= CONFIG.ipWindowMs);
  filtered.push({ ip, ts: now });
  ipHistory.set(userId, filtered);
  const uniqueIps = new Set(filtered.map(a => a.ip)).size;
  return { flagged: uniqueIps >= CONFIG.ipThreshold, uniqueIps };
}

function blockUser(userId) { blockedUsers.add(userId); }
function isBlocked(userId) { return blockedUsers.has(userId); }

function log(event, payload) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

async function parseIntSetting(key, def) {
  const v = parseInt(String(await dbApi.getSetting(key) || ''), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

async function checkAuthFlood(ip, username) {
  await dbApi.recordAuthAttempt(ip, username);
  const limit = await parseIntSetting('auth_flood_limit', 10);
  const windowSec = await parseIntSetting('auth_flood_window_sec', 300);
  const total = await dbApi.getAuthAttempts(ip, windowSec);
  return { blocked: total > limit, remaining: Math.max(0, limit - total) };
}

async function checkBruteforce(ip) {
  const limit = await parseIntSetting('bruteforce_max_attempts', 10);
  const windowSec = await parseIntSetting('bruteforce_window_sec', 600);
  const total = await dbApi.getAuthAttempts(ip, windowSec);
  return { blocked: total >= limit, remaining: Math.max(0, limit - total) };
}

async function isIpBlocked(ip) { return await dbApi.isIpBlocked(ip); }
async function isUaBlocked(ua) { return await dbApi.isUaBlocked(ua); }

function parseCountryList(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  return new Set(s.split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean));
}

async function checkGeoIp(ip, line) {
  if (!geoip || !ip) return { ok: true, country: '', error: null };
  const lookup = geoip.lookup(ip);
  const country = lookup && lookup.country ? String(lookup.country).toUpperCase() : '';
  const allowRaw = await dbApi.getSetting('allow_countries');
  const allow = parseCountryList(allowRaw);
  if (allow && allow.size > 0) {
    if (!lookup) return { ok: true, country: '', error: null };
    if (!country || !allow.has(country)) return { ok: false, country, error: 'country_not_allowed' };
  }
  if (line && line.forced_country != null && String(line.forced_country).trim()) {
    const fc = String(line.forced_country).trim().toUpperCase();
    if (lookup && country && country !== fc) return { ok: false, country, error: 'forced_country_mismatch' };
  }
  return { ok: true, country, error: null };
}

/** Signed payload TTL is chosen by callers (e.g. panel nginx playback: `PLAYBACK_TOKEN_TTL_SEC`, 30–60s). */
async function generateStreamToken(userId, channelId, container, expirySec, opts = {}) {
  const expiry = Math.floor(Date.now() / 1000) + (parseInt(expirySec, 10) || 3600);
  const sessionUuid = opts && opts.sessionUuid ? String(opts.sessionUuid) : '';
  const ipHint = isStreamTokenIpBindingEnabled() ? getMaskedIpBlock(opts && opts.ip) : '';
  const payload = JSON.stringify({ userId, channelId: String(channelId), container: String(container || ''), expiry, sessionUuid, ipHint });
  const secret = await getStreamSecret();
  const key = getAesKeySync(secret);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, enc]).toString('base64url');
}

async function decryptStreamToken(token) {
  if (!token || typeof token !== 'string') return null;
  let buf;
  try {
    buf = Buffer.from(token, 'base64url');
    if (buf.length === 0) throw new Error('empty');
  } catch {
    try {
      const pad = 4 - (token.length % 4);
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
      buf = Buffer.from(b64, 'base64');
    } catch { return null; }
  }
  if (buf.length < 17) return null;
  try {
    const secret = await getStreamSecret();
    const key = getAesKeySync(secret);
    const iv = buf.subarray(0, 16);
    const enc = buf.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const o = JSON.parse(dec.toString('utf8'));
    if (o == null || typeof o !== 'object' || o.userId == null || o.channelId == null || o.expiry == null) return null;
    return {
      userId: o.userId,
      channelId: String(o.channelId),
      container: o.container != null ? String(o.container) : '',
      expiry: parseInt(o.expiry, 10),
      sessionUuid: o.sessionUuid ? String(o.sessionUuid) : '',
      ipHint: o.ipHint ? String(o.ipHint) : '',
    };
  } catch { return null; }
}

async function autoBlockSharedLine(userId, ip, uniqueIps) {
  const uid = String(userId);
  const now = Date.now();
  const cooldownMs = getSharingBlockCooldownMs();
  const lastBlockedAt = sharingBlockCooldown.get(uid) || 0;
  if ((now - lastBlockedAt) < cooldownMs) return false;
  sharingBlockCooldown.set(uid, now);
  blockUser(uid);
  await dbApi.updateLine(userId, { admin_enabled: 0 });
  await writeSecurityLog('sharing_auto_block', userId, { ip: normalizeClientIp(ip), uniqueIps, cooldownMs });
  return true;
}

async function flagSharingActivity(userId, ip) {
  const uid = String(userId);
  const ipStr = String(ip || '');
  const { flagged, uniqueIps } = await sharingDetector.recordAndCheck(uid, ipStr);
  if (flagged) {
    log('possible_account_sharing', { userId: uid, uniqueIps });
    sharingDetector.publishAlert(uid, uniqueIps);
    await autoBlockSharedLine(uid, ipStr, uniqueIps);
  }
}

async function validateStreamAccess({ token, expires, sig, ip, channelId }) {
  if (!(await validateSignature(token, expires, sig, channelId))) {
    log('stream_signature_invalid', { channelId, ip });
    return { ok: false, error: 'invalid_signature' };
  }
  const session = await sessionService.validateToken(token, ip);
  if (session) {
    if (isBlocked(session.user.id)) { log('user_blocked', { userId: session.user.id }); return { ok: false, error: 'blocked' }; }
    const { flagged } = recordIp(session.user.id, ip || '');
    if (flagged) log('suspicious_multi_ip', { userId: session.user.id, ip });
    return { ok: true, session, error: null };
  }
  const dec = await decryptStreamToken(token);
  if (dec && String(dec.channelId) === String(channelId)) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (dec.expiry < nowSec) { log('stream_line_token_expired', { channelId, ip }); return { ok: false, error: 'expired' }; }
    if (isStreamTokenIpBindingEnabled() && dec.ipHint && dec.ipHint !== getMaskedIpBlock(ip)) {
      log('stream_line_token_ip_mismatch', { channelId, ip });
      return { ok: false, error: 'ip_mismatch' };
    }
    if (dec.sessionUuid) {
      try {
        await lineService.refreshConnection(dec.userId, dec.sessionUuid);
        await lineService.touchRuntimeSession(dec.sessionUuid);
      } catch {}
    }
    await flagSharingActivity(dec.userId, ip || '');
    return { ok: true, lineUserId: dec.userId, sessionUuid: dec.sessionUuid || '', error: null };
  }
  log('stream_token_invalid', { channelId, ip });
  return { ok: false, error: 'invalid_token' };
}

const signUrl = signStreamUrl;

module.exports = {
  signStreamUrl, signUrl, validateSignature, validateStreamAccess,
  recordIp, blockUser, isBlocked,
  checkAuthFlood, checkBruteforce, isIpBlocked, isUaBlocked, checkGeoIp,
  generateStreamToken, decryptStreamToken, flagSharingActivity, log, CONFIG,
  getMaskedIpBlock,
};
