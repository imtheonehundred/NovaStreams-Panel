'use strict';

const crypto = require('crypto');
const dbApi = require('../lib/db');
const redis = require('../lib/redis');

function parseJsonField(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return fallback;
    try { return JSON.parse(t); } catch { return fallback; }
  }
  return fallback;
}

function normalizeLineRow(row) {
  if (!row) return null;
  const normalized = {
    ...row,
    bouquet: parseJsonField(row.bouquet, []),
    allowed_outputs: parseJsonField(row.allowed_outputs, []),
    allowed_ips: parseJsonField(row.allowed_ips, []),
    allowed_ua: parseJsonField(row.allowed_ua, []),
  };
  delete normalized.password_hash;
  delete normalized.password_enc;
  return normalized;
}

function durationToSeconds(amount, unit) {
  const n = parseInt(amount, 10) || 0;
  const u = String(unit || 'day').toLowerCase();
  const multipliers = { minute: 60, hour: 3600, day: 86400, week: 604800, month: 30 * 86400, year: 365 * 86400 };
  return n * (multipliers[u] ?? multipliers.day);
}

function computeExpDateFromPackage(pkg, isTrialOverride) {
  const now = Math.floor(Date.now() / 1000);
  const isTrial = isTrialOverride !== undefined ? Number(isTrialOverride) === 1 : pkg.is_trial === 1;
  const duration = isTrial ? pkg.trial_duration : pkg.official_duration;
  const unit = isTrial ? pkg.trial_duration_in : pkg.official_duration_in;
  return now + durationToSeconds(duration, unit);
}

function applyPackageDefaults(draft, pkg) {
  if (draft.bouquet === undefined) draft.bouquet = parseJsonField(pkg.bouquets_json, []);
  if (draft.allowed_outputs === undefined) draft.allowed_outputs = parseJsonField(pkg.output_formats_json, []);
  if (draft.max_connections === undefined || draft.max_connections === null) draft.max_connections = pkg.max_connections ?? 1;
  if (draft.forced_country === undefined) draft.forced_country = pkg.forced_country || '';
  if (draft.is_trial === undefined) draft.is_trial = pkg.is_trial ?? 0;
  if (draft.is_mag === undefined) draft.is_mag = pkg.is_mag ?? 0;
  if (draft.is_e2 === undefined) draft.is_e2 = pkg.is_e2 ?? 0;
  if (draft.is_restreamer === undefined) draft.is_restreamer = pkg.is_restreamer ?? 0;
  if (draft.exp_date === undefined) draft.exp_date = computeExpDateFromPackage(pkg, draft.is_trial);
}

async function createLine(data, memberId) {
  if (!data || !data.username || !data.password) throw new Error('username and password required');
  if (!data.package_id) throw new Error('package_id is required');
  const draft = { ...data };
  if (memberId !== undefined && memberId !== null) draft.member_id = memberId;
  const pkg = await dbApi.getPackageById(draft.package_id);
  if (!pkg) throw new Error('Package not found');
  applyPackageDefaults(draft, pkg);
  draft.access_token = draft.access_token || crypto.randomBytes(16).toString('hex');
  const id = await dbApi.createLine(draft);
  return await dbApi.getLineById(id);
}

async function authenticateLine(username, password) {
  const line = await dbApi.getLineByUsername(String(username));
  if (!line || !(await dbApi.verifyLinePassword(line, password))) return { ok: false, line: null, error_code: 'INVALID' };
  if (line.admin_enabled === 0) return { ok: false, line, error_code: 'BANNED' };
  if (line.enabled === 0) return { ok: false, line, error_code: 'DISABLED' };
  const now = Math.floor(Date.now() / 1000);
  if (line.exp_date != null && line.exp_date !== '' && Number(line.exp_date) < now) return { ok: false, line, error_code: 'EXPIRED' };
  return { ok: true, line: { ...line, password: String(password) }, error_code: null };
}

// ─── Redis-based connection tracking ─────────────────────────────────

const CONN_TTL = 180;

function connKey(lineId, uuid) { return `conn:${lineId}:${uuid}`; }
function connSetKey(lineId) { return `conn:set:${lineId}`; }

async function openConnection(lineId, data) {
  const uuid = data.uuid || crypto.randomBytes(16).toString('hex');
  const payload = {
    user_id: lineId,
    stream_id: data.stream_id || 0,
    user_agent: data.user_agent || '',
    user_ip: data.user_ip || '',
    container: data.container || '',
    date_start: Math.floor(Date.now() / 1000),
    geoip_country_code: data.geoip_country_code || '',
  };
  const r = redis.getClient();
  await r.setex(connKey(lineId, uuid), CONN_TTL, JSON.stringify(payload));
  await r.sadd(connSetKey(lineId), uuid);
  await r.expire(connSetKey(lineId), CONN_TTL + 60);
  await dbApi.updateLineActivity(lineId, data.user_ip || '');
  return uuid;
}

async function closeConnection(lineId, uuid) {
  const r = redis.getClient();
  const raw = await r.get(connKey(lineId, uuid));
  await r.del(connKey(lineId, uuid));
  await r.srem(connSetKey(lineId), uuid);

  if (raw) {
    try {
      const d = JSON.parse(raw);
      await dbApi.writeActivityHistory({
        user_id: d.user_id,
        stream_id: d.stream_id,
        user_agent: d.user_agent,
        user_ip: d.user_ip,
        container: d.container,
        date_start: d.date_start,
        date_end: Math.floor(Date.now() / 1000),
        geoip_country_code: d.geoip_country_code,
      });
    } catch { /* ignore parse errors */ }
  }
  return true;
}

async function killConnections(lineId) {
  const conns = await getActiveConnections(lineId);
  for (const conn of conns) {
    await closeConnection(lineId, conn.uuid);
  }
  return conns.length;
}

async function countLiveConnections(lineId) {
  const r = redis.getClient();
  return await r.scard(connSetKey(lineId));
}

async function getActiveConnections(lineId) {
  const r = redis.getClient();
  const uuids = await r.smembers(connSetKey(lineId));
  const conns = [];
  for (const uuid of uuids) {
    const raw = await r.get(connKey(lineId, uuid));
    if (raw) {
      try { conns.push({ uuid, ...JSON.parse(raw) }); } catch {}
    } else {
      await r.srem(connSetKey(lineId), uuid);
    }
  }
  return conns;
}

async function refreshConnection(lineId, uuid) {
  const r = redis.getClient();
  await r.expire(connKey(lineId, uuid), CONN_TTL);
  await r.expire(connSetKey(lineId), CONN_TTL + 60);
}

async function canConnect(lineId) {
  const line = await dbApi.getLineById(lineId);
  if (!line) return false;
  const max = parseInt(line.max_connections, 10) || 1;
  const current = await countLiveConnections(lineId);
  return current < max;
}

// ─── Phase 4 — Live Runtime Session helpers ─────────────────────────

/**
 * Open a runtime session record for a line viewing a live channel on a remote node.
 * Wraps dbApi.openRuntimeSession().
 *
 * @param {Object} opts
 * @param {number} opts.lineId
 * @param {string} opts.streamType  — 'live'
 * @param {string|number} opts.streamId  — channel id
 * @param {number} [opts.placementId]
 * @param {number} [opts.originServerId]
 * @param {number} [opts.proxyServerId]
 * @param {string} [opts.container]  — 'ts' or 'm3u8'
 * @param {string} [opts.sessionUuid]
 * @param {string} [opts.playbackToken]
 * @param {string} [opts.userIp]
 * @param {string} [opts.userAgent]
 * @param {string} [opts.geoipCountryCode]
 * @param {string} [opts.isp]
 * @returns {Promise<number>}  inserted row id
 */
async function openRuntimeSession({ lineId, streamType, streamId, placementId, originServerId, proxyServerId, container, sessionUuid, playbackToken, userIp, userAgent, geoipCountryCode, isp }) {
  return await dbApi.openRuntimeSession({
    lineId,
    streamType,
    streamId,
    placementId,
    originServerId,
    proxyServerId,
    container,
    sessionUuid,
    playbackToken,
    userIp,
    userAgent,
    geoipCountryCode,
    isp,
  });
}

/**
 * Touch a runtime session to record a keep-alive (updates last_seen_at).
 * @param {string} sessionUuid
 */
async function touchRuntimeSession(sessionUuid) {
  await dbApi.touchRuntimeSession(sessionUuid);
}

/**
 * Close a runtime session (sets date_end).
 * @param {string} sessionUuid
 * @param {number} [dateEnd]  — unix timestamp; defaults to now
 */
async function closeRuntimeSession(sessionUuid, dateEnd) {
  await dbApi.closeRuntimeSession(sessionUuid, dateEnd);
}

// ─── Permission checks ──────────────────────────────────────────────

function checkOutputAllowed(line, outputFormat) {
  const allowed = parseJsonField(line.allowed_outputs, []);
  if (!allowed.length) return true;
  const fmt = String(outputFormat || '').toLowerCase();
  return allowed.some(a => String(a).toLowerCase() === fmt);
}

function checkIpAllowed(line, ip) {
  const list = parseJsonField(line.allowed_ips, []);
  if (!list.length) return true;
  return list.some(x => String(x) === String(ip || ''));
}

function checkUaAllowed(line, ua) {
  const list = parseJsonField(line.allowed_ua, []);
  if (!list.length) return true;
  return list.some(x => String(x) === String(ua || ''));
}

function checkCountry(line, countryCode) {
  const forced = line.forced_country != null ? String(line.forced_country).trim() : '';
  if (!forced) return true;
  return String(countryCode || '').toUpperCase() === forced.toUpperCase();
}

function getLineBouquetIds(line) {
  const raw = parseJsonField(line.bouquet, []);
  return raw.map(id => typeof id === 'string' ? parseInt(id, 10) || id : id);
}

function bouquetFieldForStreamType(streamType) {
  const t = String(streamType || '').toLowerCase();
  if (t === 'live') return 'bouquet_channels';
  if (t === 'movie') return 'bouquet_movies';
  if (t === 'series') return 'bouquet_series';
  if (t === 'radio') return 'bouquet_radios';
  return null;
}

async function isStreamInBouquet(line, streamId, streamType) {
  const field = bouquetFieldForStreamType(streamType);
  if (!field) return false;
  const sid = String(streamId);
  const bouquetIds = getLineBouquetIds(line);
  if (!bouquetIds.length) return false;
  const bouquets = await dbApi.getBouquetsByIds(bouquetIds);
  for (const b of bouquets) {
    const arr = parseJsonField(b[field], []);
    if (arr.some(x => String(x) === sid)) return true;
  }
  return false;
}

async function getUserInfo(line) {
  const activeCons = await countLiveConnections(line.id);
  const outputs = parseJsonField(line.allowed_outputs, []);
  return {
    username: line.username,
    password: line.password,
    message: '',
    auth: 1,
    status: 'Active',
    exp_date: line.exp_date != null ? String(line.exp_date) : '0',
    is_trial: String(line.is_trial || 0),
    active_cons: String(activeCons),
    max_connections: String(line.max_connections || 1),
    allowed_output_formats: outputs,
    created_at: line.created_at != null ? String(line.created_at) : '0',
    is_mag: String(line.is_mag || 0),
    is_e2: String(line.is_e2 || 0),
    is_restreamer: String(line.is_restreamer || 0),
    forced_country: line.forced_country || '',
    is_isplock: String(line.is_isplock || 0),
  };
}

async function listAll(memberId, limit, offset) {
  return await dbApi.listLines(memberId, limit, offset);
}

async function update(id, data) {
  if (data && data.password !== undefined && !String(data.password || '')) throw new Error('password required');
  await dbApi.updateLine(id, data);
  return await dbApi.getLineById(id);
}

async function remove(id) {
  return await dbApi.deleteLine(id);
}

module.exports = {
  createLine,
  authenticateLine,
  canConnect,
  checkOutputAllowed,
  checkIpAllowed,
  checkUaAllowed,
  checkCountry,
  getLineBouquetIds,
  isStreamInBouquet,
  openConnection,
  closeConnection,
  killConnections,
  countLiveConnections,
  getActiveConnections,
  refreshConnection,
  getUserInfo,
  listAll,
  update,
  remove,
  normalizeLineRow,
  // Phase 4 — live runtime sessions
  openRuntimeSession,
  touchRuntimeSession,
  closeRuntimeSession,
};
