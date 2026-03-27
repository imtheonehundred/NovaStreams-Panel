'use strict';

const crypto = require('crypto');
const dbApi = require('../lib/db');
const sessionService = require('./sessionService');
const sharingDetector = require('./sharingDetector');

let geoip;
try { geoip = require('geoip-lite'); } catch { geoip = null; }

// Bounded IP history map - prevents memory exhaustion attacks
const MAX_IP_HISTORY_ENTRIES = 10000;
const IP_HISTORY_CLEANUP_INTERVAL_MS = 60000; // 1 minute
const ipHistory = new Map();
const blockedUsers = new Set();

const CONFIG = {
  ipWindowMs: 60000,
  ipThreshold: 3,
};

// Periodic cleanup of stale ipHistory entries to prevent memory bloat
setInterval(() => {
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

async function getStreamSecret() {
  const fromEnv = process.env.STREAM_SECRET;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv);
  const fromDb = await dbApi.getSetting('live_streaming_pass');
  if (fromDb && String(fromDb).trim()) return String(fromDb);
  // In production, fail fast if no secret is configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('STREAM_SECRET environment variable must be set in production');
  }
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

function getAesKeySync(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
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
async function generateStreamToken(userId, channelId, container, expirySec) {
  const expiry = Math.floor(Date.now() / 1000) + (parseInt(expirySec, 10) || 3600);
  const payload = JSON.stringify({ userId, channelId: String(channelId), container: String(container || ''), expiry });
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
    return { userId: o.userId, channelId: String(o.channelId), container: o.container != null ? String(o.container) : '', expiry: parseInt(o.expiry, 10) };
  } catch { return null; }
}

async function flagSharingActivity(userId, ip) {
  const uid = String(userId);
  const ipStr = String(ip || '');
  const { flagged, uniqueIps } = await sharingDetector.recordAndCheck(uid, ipStr);
  if (flagged) {
    log('possible_account_sharing', { userId: uid, uniqueIps });
    sharingDetector.publishAlert(uid, uniqueIps);
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
    await flagSharingActivity(dec.userId, ip || '');
    return { ok: true, lineUserId: dec.userId, error: null };
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
};
