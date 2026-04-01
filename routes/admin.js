'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { cacheMiddleware, keys, TTL, invalidateVod, invalidateSeries, invalidateCategories, invalidateBouquets, invalidateSettings, invalidateLines, invalidateEpisodes } = require('../lib/cache');
const lineService = require('../services/lineService');
const serverService = require('../services/serverService');
const provisionService = require('../services/provisionService');
const streamManager = require('../services/streamManager');
const categoryService = require('../services/categoryService');
const bouquetService = require('../services/bouquetService');
const packageService = require('../services/packageService');
const vodService = require('../services/vodService');
const seriesService = require('../services/seriesService');
const epgService = require('../services/epgService');
const tmdbService = require('../services/tmdbService');
const importService = require('../services/importService');
const dbService = require('../services/dbService');
const { XcApiClient } = require('../services/xcApiClient');
const importChannelBridge = require('../lib/importChannelBridge');
const { channels } = require('../lib/state');
const { query, queryOne, execute } = require('../lib/mariadb');
const streamingSettings = require('../lib/streaming-settings');
const { csrfProtection } = require('../middleware/csrf');

const router = express.Router();

// Internal health check — used by healthMonitor, must be BEFORE auth middleware
router.get('/health-check', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

function clearPanelUserSession(req, { preserveGateway = true } = {}) {
  if (!req.session) return;
  req.session.userId = null;
  if (!preserveGateway) {
    req.session.portalRole = null;
    req.session.accessCode = null;
    req.session.accessCodeId = null;
  }
}

async function validateAdminAccessCodeSession(req) {
  const session = req.session || null;
  if (typeof dbApi.getAccessCodeById !== 'function') {
    return session && session.portalRole === 'admin' ? { id: session.accessCodeId || null, role: 'admin', enabled: 1 } : null;
  }
  if (!session || !session.accessCodeId || !session.portalRole) {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  const row = await dbApi.getAccessCodeById(session.accessCodeId);
  const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
  if (!row || !enabled || row.role !== 'admin' || session.portalRole !== 'admin') {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  if (session.accessCode !== row.code) session.accessCode = row.code;
  return row;
}

async function adminAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  try {
    const accessCode = await validateAdminAccessCodeSession(req);
    if (!accessCode) return res.status(403).json({ error: 'access code invalid' });
    const user = await dbApi.findUserById(req.session.userId);
    if (!user || Number(user.status) !== 1) return res.status(403).json({ error: 'account disabled' });
    const isAdmin = await dbApi.isAdmin(req.session.userId);
    if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    return next();
  } catch (e) {
    return res.status(500).json({ error: e.message || 'auth failed' });
  }
}
router.use(adminAuth);
// CSRF protection for state-changing requests (POST/PUT/DELETE/PATCH)
router.use(csrfProtection);

router.get('/features', async (_req, res) => {
  try {
    res.json({
      serverProvisioning: await provisionService.isProvisioningEnabled(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

router.get('/version', async (req, res) => {
  const current = require('../package.json').version;
  const repo = 'imtheonehundred/NovaStreams-Panel';
  const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const gh = await fetch(ghUrl, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaStreams-Panel' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!gh.ok) throw new Error(`GitHub API ${gh.status}`);
    const data = await gh.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    const outdated = compareVersions(latest, current) > 0;
    res.json({
      current,
      latest,
      currentIsOutdated: outdated,
      releaseUrl: data.html_url || `https://github.com/${repo}/releases`,
      publishedAt: data.published_at || null,
    });
  } catch (e) {
    res.json({ current, latest: current, currentIsOutdated: false, releaseUrl: `https://github.com/${repo}/releases` });
  }
});

// Bandwidth history
router.get('/bandwidth', async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 6));
    const { getBandwidthHistory } = require('../services/bandwidthMonitor');
    const data = await getBandwidthHistory(hours);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Service health
router.get('/health', async (req, res) => {
  try {
    const { isPanelUp, hasPanelHealthSample, getLastCheckAt, getLastResponseMs, getLastError, getConsecutiveFails, getDayStats, getUptimeHistory } = require('../services/healthMonitor');
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    const today = await getDayStats();
    const history = await getUptimeHistory(days);
    const hasSample = hasPanelHealthSample();
    res.json({
      status: hasSample ? (isPanelUp() ? 'up' : 'down') : 'unknown',
      lastCheckAt: getLastCheckAt(),
      lastCheckMs: getLastCheckAt(),
      lastResponseMs: getLastResponseMs(),
      lastError: getLastError(),
      consecutiveFails: getConsecutiveFails(),
      today,
      history,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// System metrics snapshot (extended)
router.get('/system-metrics', async (req, res) => {
  try {
    const { collectSystemMetrics } = require('../lib/system-metrics');
    const m = await collectSystemMetrics();
    res.json(m);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream Repair — health check a single stream
router.get('/streams/:id/health', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing channel id' });
    const channel = channels.get(id);
    if (!channel) return res.status(404).json({ error: 'channel not found' });
    const { checkChannel, getChannelHealth } = require('../services/streamRepair');
    const cached = await getChannelHealth(id);
    if (cached && Date.now() - cached.checkedAt < 900000) {
      return res.json({ id, ...cached, source: 'cache' });
    }
    const result = await checkChannel(id, channel);
    return res.json({ id, ...result, source: 'live' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream Repair — repair (recheck) a single stream
router.post('/streams/:id/repair', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing channel id' });
    const channel = channels.get(id);
    if (!channel) return res.status(404).json({ error: 'channel not found' });
    const { checkChannel } = require('../services/streamRepair');
    const result = await checkChannel(id, channel);
    res.json({ id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream Repair — repair all streams (admin only)
router.post('/streams/repair-all', adminAuth, async (req, res) => {
  try {
    const isMovieChannel = (ch) => String(ch && ch.channelClass || 'normal') === 'movie';
    const isInternalChannel = (ch) => !!(ch && ch.is_internal);
    const allChannels = [...channels.values()].filter(c => !isMovieChannel(c) && !isInternalChannel(c));
    const { checkAllChannels } = require('../services/streamRepair');
    const result = await checkAllChannels(allChannels, channels);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get health for all streams (lightweight — reads from cache)
router.get('/streams/health-all', async (req, res) => {
  try {
    const isMovieChannel = (ch) => String(ch && ch.channelClass || 'normal') === 'movie';
    const isInternalChannel = (ch) => !!(ch && ch.is_internal);
    const allChannels = [...channels.values()].filter(c => !isMovieChannel(c) && !isInternalChannel(c));
    const { getAllChannelHealth } = require('../services/streamRepair');
    const healthMap = await getAllChannelHealth(allChannels.map(c => c.id));
    const result = {};
    for (const ch of allChannels) {
      result[ch.id] = healthMap[ch.id] || { status: null, checkedAt: null };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sharing Detection — get all users with their sharing status
router.get('/sharing', async (req, res) => {
  try {
    const { getSharingHistory } = require('../services/sharingDetector');
    const { SHARING_UNIQUE_IP_THRESHOLD } = require('../config/constants');
    const now = Math.floor(Date.now() / 1000);
    const rows = await query('SELECT id, username, enabled, exp_date FROM `lines` WHERE admin_enabled = 1');
    const results = [];
    for (const row of rows) {
      const ips = await getSharingHistory(row.id);
      const status = Number(row.enabled) !== 1
        ? 'Disabled'
        : (row.exp_date && Number(row.exp_date) < now ? 'Expired' : 'Active');
      results.push({
        userId: row.id,
        username: row.username,
        status,
        uniqueIps: ips.length,
        ips,
        flagged: ips.length >= SHARING_UNIQUE_IP_THRESHOLD,
      });
    }
    // Sort flagged first
    results.sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || b.uniqueIps - a.uniqueIps);
    res.json({ users: results, threshold: SHARING_UNIQUE_IP_THRESHOLD });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sharing Detection — clear history for a user
router.post('/sharing/:userId/clear', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'invalid user id' });
    const { clearHistory } = require('../services/sharingDetector');
    await clearHistory(userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sharing Detection — force scan now (re-check all users)
router.post('/sharing/scan', async (req, res) => {
  try {
    const rows = await query('SELECT id, username FROM `lines` WHERE admin_enabled = 1');
    const results = [];
    for (const row of rows) {
      const { getSharingHistory } = require('../services/sharingDetector');
      const ips = await getSharingHistory(row.id);
      results.push({ userId: row.id, username: row.username, uniqueIps: ips.length, flagged: ips.length >= 3 });
    }
    results.sort((a, b) => b.uniqueIps - a.uniqueIps);
    res.json({ users: results, scanned: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseLimitOffset(q) {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return { limit, offset };
}

function parseBoolInt(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1' || value === 1) return 1;
  return 0;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseExpiryMediaItems(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const scenario = String(row && row.scenario || '').trim();
    if (!['expiring', 'expired'].includes(scenario)) throw new Error('invalid expiry media scenario');
    const mediaUrl = String(row && row.media_url || '').trim();
    if (!/^https?:\/\//i.test(mediaUrl)) throw new Error('expiry media url must be http or https');
    const countryCode = String(row && row.country_code || '').trim().toUpperCase();
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new Error('invalid country code');
    return {
      scenario,
      country_code: countryCode,
      media_type: 'video',
      media_url: mediaUrl,
      sort_order: Number.isFinite(Number(row && row.sort_order)) ? Number(row.sort_order) : index,
    };
  });
}

function parsePackageOverrides(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const packageId = parseInt(row && row.package_id, 10);
    if (!Number.isFinite(packageId)) throw new Error('invalid package override');
    return {
      package_id: packageId,
      enabled: parseBoolInt(row && row.enabled, 1),
      trial_credits_override: parseOptionalNumber(row && row.trial_credits_override),
      official_credits_override: parseOptionalNumber(row && row.official_credits_override),
    };
  });
}

async function getUserGroupPayload(id) {
  return await queryOne(
    `SELECT g.*, COUNT(u.id) AS member_count
     FROM user_groups g
     LEFT JOIN users u ON u.member_group_id = g.group_id
     WHERE g.group_id = ?
     GROUP BY g.group_id`,
    [id]
  );
}

async function getResellerPayload(id) {
  const row = await queryOne(
    `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
            u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
     FROM users u
     INNER JOIN user_groups g ON u.member_group_id = g.group_id
     LEFT JOIN \`lines\` l ON l.member_id = u.id
     WHERE u.id = ? AND g.is_reseller = 1
     GROUP BY u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
              u.reseller_dns, u.owner_id, u.last_login, u.created_at`,
    [id]
  );
  if (!row) return null;
  const packageOverrides = await dbApi.listResellerPackageOverrides(id);
  return { ...row, package_overrides: packageOverrides || [] };
}

async function resolveResellerGroup(memberGroupId) {
  if (memberGroupId !== undefined && memberGroupId !== null && memberGroupId !== '') {
    const groupId = parseInt(memberGroupId, 10);
    if (!Number.isFinite(groupId)) return null;
    const group = await dbApi.getUserGroupById(groupId);
    if (!group || Number(group.is_reseller) !== 1) return null;
    return group;
  }
  return await queryOne('SELECT * FROM user_groups WHERE is_reseller = 1 ORDER BY group_id LIMIT 1');
}

// ─── Users ──────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try { res.json({ users: await dbApi.getAllUsers() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/user-groups', async (_req, res) => {
  try {
    const groups = await query(
      `SELECT g.*, COUNT(u.id) AS member_count
       FROM user_groups g
       LEFT JOIN users u ON u.member_group_id = g.group_id
       GROUP BY g.group_id
       ORDER BY g.group_id ASC`
    );
    res.json({ groups });
  }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/user-groups/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const group = await getUserGroupPayload(id);
    if (!group) return res.status(404).json({ error: 'not found' });
    res.json(group);
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/user-groups', async (req, res) => {
  const body = req.body || {};
  if (!String(body.group_name || '').trim()) return res.status(400).json({ error: 'group_name required' });
  try {
    const id = await dbApi.createUserGroup({
      group_name: String(body.group_name).trim(),
      is_admin: parseBoolInt(body.is_admin, 0),
      is_reseller: parseBoolInt(body.is_reseller, 1),
      allowed_pages: '[]',
    });
    await dbApi.updateUserGroup(id, {
      total_allowed_gen_trials: parseInt(body.total_allowed_gen_trials, 10) || 0,
      total_allowed_gen_in: String(body.total_allowed_gen_in || 'day'),
      delete_users: parseBoolInt(body.delete_users, 0),
      manage_expiry_media: parseBoolInt(body.manage_expiry_media, 0),
      notice_html: body.notice_html != null ? String(body.notice_html) : '',
    });
    const row = await getUserGroupPayload(id);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/user-groups/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getUserGroupById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await dbApi.updateUserGroup(id, {
      group_name: req.body && req.body.group_name !== undefined ? String(req.body.group_name).trim() : undefined,
      is_admin: req.body && req.body.is_admin !== undefined ? parseBoolInt(req.body.is_admin, 0) : undefined,
      is_reseller: req.body && req.body.is_reseller !== undefined ? parseBoolInt(req.body.is_reseller, 0) : undefined,
      total_allowed_gen_trials: req.body && req.body.total_allowed_gen_trials !== undefined ? (parseInt(req.body.total_allowed_gen_trials, 10) || 0) : undefined,
      total_allowed_gen_in: req.body && req.body.total_allowed_gen_in !== undefined ? String(req.body.total_allowed_gen_in || 'day') : undefined,
      delete_users: req.body && req.body.delete_users !== undefined ? parseBoolInt(req.body.delete_users, 0) : undefined,
      manage_expiry_media: req.body && req.body.manage_expiry_media !== undefined ? parseBoolInt(req.body.manage_expiry_media, 0) : undefined,
      notice_html: req.body && req.body.notice_html !== undefined ? String(req.body.notice_html || '') : undefined,
    });
    const row = await getUserGroupPayload(id);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/user-groups/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const row = await getUserGroupPayload(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (Number(row.member_count) > 0) return res.status(400).json({ error: 'group still has assigned members' });
  if (Number(row.is_admin) === 1) return res.status(400).json({ error: 'cannot delete admin group' });
  await dbApi.deleteUserGroup(id);
  res.json({ ok: true });
});

router.post('/users', async (req, res) => {
  const { username, password, email, member_group_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const id = await dbApi.createUser(String(username), String(password));
    const patch = {};
    if (email !== undefined) patch.email = String(email);
    if (member_group_id !== undefined) patch.member_group_id = parseInt(member_group_id, 10);
    if (Object.keys(patch).length) await dbApi.updateUser(id, patch);
    res.status(201).json({ id, username: String(username) });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/users/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await dbApi.updateUser(id, req.body || {});
    const row = await dbApi.findUserById(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/users/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteUser(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── Access Codes ────────────────────────────────────────────────────

router.get('/access-codes', async (_req, res) => {
  try { res.json({ codes: await dbApi.listAccessCodes() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/access-codes', async (req, res) => {
  try {
    const id = await dbApi.createAccessCode(req.body || {});
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.put('/access-codes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getAccessCodeById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await dbApi.updateAccessCode(id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'update failed' });
  }
});

router.delete('/access-codes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteAccessCode(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── System / Database Manager ───────────────────────────────────────

router.get('/system/db-status', async (_req, res) => {
  try { res.json(await dbService.getDatabaseStatus()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/system/db-performance', async (_req, res) => {
  try { res.json(await dbService.getDatabasePerformance()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/system/db-live', async (_req, res) => {
  try { res.json(await dbService.getDatabaseLive()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/system/db-optimize', async (_req, res) => {
  try { res.json(await dbService.optimizeDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
});

router.post('/system/db-repair', async (_req, res) => {
  try { res.json(await dbService.repairDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'repair failed' }); }
});

// ─── Lines ──────────────────────────────────────────────────────────

router.get('/lines', async (req, res) => {
  const mid = req.query.member_id;
  let memberId;
  if (mid !== undefined && mid !== '' && mid !== 'null') {
    memberId = parseInt(mid, 10);
    if (!Number.isFinite(memberId)) return res.status(400).json({ error: 'invalid member_id' });
  }
  try {
    const { limit, offset } = parseLimitOffset(req.query);
    const result = await lineService.listAll(memberId, limit, offset);
    const lines = (result.lines || result).map(r => lineService.normalizeLineRow(dbApi.attachLinePassword(r)));
    res.json({ lines, total: result.total || lines.length });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/lines/:id/connections', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line) return res.status(404).json({ error: 'not found' });
  const connections = await lineService.getActiveConnections(id);
  res.json({ connections });
});

router.post('/lines/:id/kill-connections', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line) return res.status(404).json({ error: 'not found' });
  const killed = await lineService.killConnections(id);
  res.json({ ok: true, killed });
});

router.post('/lines/expired/delete', async (_req, res) => {
  const deleted = await dbApi.deleteExpiredLines();
  await invalidateLines();
  res.json({ ok: true, deleted });
});

router.post('/lines/:id/ban', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  await lineService.update(id, { admin_enabled: 0 });
  await invalidateLines();
  res.json({ ok: true, id, admin_enabled: 0 });
});

router.post('/lines/:id/unban', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  await lineService.update(id, { admin_enabled: 1 });
  await invalidateLines();
  res.json({ ok: true, id, admin_enabled: 1 });
});

router.get('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const row = await dbApi.getLineById(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(lineService.normalizeLineRow(dbApi.attachLinePassword(row)));
});

router.post('/lines', async (req, res) => {
  try {
    const line = await lineService.createLine(req.body || {});
    await invalidateLines();
    res.status(201).json(lineService.normalizeLineRow(dbApi.attachLinePassword(line)));
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  try {
    const line = await lineService.update(id, req.body || {});
    await invalidateLines();
    res.json(lineService.normalizeLineRow(dbApi.attachLinePassword(line)));
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await lineService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateLines();
  res.json({ ok: true });
});

// ─── Bulk Import Lines ──────────────────────────────────────────────

router.post('/lines/bulk', async (req, res) => {
  try {
    const {
      users,
      package_id,
      member_id = 0,
      test_mode = false,
      skip_duplicates = true,
      max_connections,
      is_trial,
      bouquet,
    } = req.body || {};

    if (!Array.isArray(users) || !users.length) {
      return res.status(400).json({ error: 'No users provided' });
    }
    if (!package_id) {
      return res.status(400).json({ error: 'Package ID required' });
    }

    const basePayload = {
      package_id: parseInt(package_id, 10),
      member_id: parseInt(member_id, 10) || 0,
      admin_enabled: 1,
    };
    const pkg = await dbApi.getPackageById(basePayload.package_id);
    if (!pkg) {
      return res.status(400).json({ error: 'Package not found' });
    }
    if (max_connections !== undefined && max_connections !== null && max_connections !== '') {
      const mc = parseInt(max_connections, 10);
      if (Number.isFinite(mc) && mc > 0) basePayload.max_connections = mc;
    }
    if (is_trial !== undefined) {
      basePayload.is_trial = Number(is_trial) ? 1 : 0;
    }
    if (Array.isArray(bouquet) && bouquet.length) {
      basePayload.bouquet = bouquet.map(b => parseInt(b, 10)).filter(v => Number.isFinite(v));
    }

    // Get existing usernames for duplicate check
    const existingLines = await query('SELECT username FROM `lines`');
    const existingUsernames = new Set(existingLines.map(l => l.username?.toLowerCase()));

    const details = [];
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      const username = (user.username || '').trim();
      const password = (user.password || '').trim();

      if (!username) {
        details.push({ username: '(empty)', status: 'error', message: 'Empty username' });
        errors++;
        continue;
      }

      // Check for duplicate
      if (existingUsernames.has(username.toLowerCase())) {
        if (skip_duplicates) {
          details.push({ username, status: 'skipped', message: 'Duplicate username' });
          skipped++;
          continue;
        } else {
          details.push({ username, status: 'error', message: 'Duplicate username' });
          errors++;
          continue;
        }
      }

      if (test_mode) {
        details.push({ username, status: 'valid', message: 'Would be created' });
        created++;
        existingUsernames.add(username.toLowerCase());
      } else {
        try {
          const payload = { ...basePayload, username, password };
          const expDate = parseInt(user.exp_date, 10);
          if (Number.isFinite(expDate) && expDate > 0) payload.exp_date = expDate;
          if (user.exp_date === null) payload.exp_date = null;
          await lineService.createLine(payload);
          details.push({ username, status: 'created', message: 'User created' });
          created++;
          existingUsernames.add(username.toLowerCase());
        } catch (createErr) {
          details.push({ username, status: 'error', message: createErr.message || 'Creation failed' });
          errors++;
        }
      }
    }

    if (!test_mode && created > 0) {
      await invalidateLines();
    }

    res.json({
      test_mode,
      created,
      skipped,
      errors,
      total: users.length,
      details,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Bulk import failed' });
  }
});

// ─── Categories ─────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  try { res.json({ categories: await categoryService.listCategories(type) }); }
  catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/categories', async (req, res) => {
  try {
    const id = await categoryService.create(req.body || {});
    await invalidateCategories();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await categoryService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await categoryService.update(id, req.body || {});
    await invalidateCategories();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await categoryService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateCategories();
  res.json({ ok: true });
});

router.post('/categories/find-or-create', async (req, res) => {
  const { category_name, category_type } = req.body || {};
  if (!category_name || !category_type) return res.status(400).json({ error: 'category_name and category_type required' });
  try {
    const id = await importService.findOrCreateCategory(String(category_name), String(category_type), null);
    await invalidateCategories();
    res.json({ id, category_name: String(category_name) });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

// ─── Import providers & Xtream import ───────────────────────────────

router.get('/providers', async (_req, res) => {
  try { res.json({ providers: await dbApi.listImportProviders() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/providers', async (req, res) => {
  try {
    const id = await dbApi.createImportProvider(req.body || {});
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/providers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getImportProviderById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await dbApi.updateImportProvider(id, req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/providers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteImportProvider(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/providers/:id/validate', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const p = await dbApi.getImportProviderById(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const xc = new XcApiClient(p.url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
    await xc.ping();
    res.json({ ok: true, message: 'Connection OK' });
  } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
});

router.post('/providers/validate-preview', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  try {
    const xc = new XcApiClient(url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
    await xc.ping();
    res.json({ ok: true, message: 'Connection OK' });
  } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
});

router.post('/providers/:id/categories', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { type } = req.body || {};
  const p = await dbApi.getImportProviderById(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const xc = new XcApiClient(p.url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
    let categories = [];
    if (type === 'movies') categories = await xc.getVodCategories();
    else if (type === 'series') categories = await xc.getSeriesCategories();
    else if (type === 'live') categories = await xc.getLiveCategories();
    else return res.status(400).json({ error: 'type must be movies, series, or live' });
    res.json({ categories });
  } catch (e) { res.status(400).json({ error: e.message || 'fetch failed' }); }
});

router.post('/import/movies', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startMovieImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/series', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startSeriesImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/live', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startLiveImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/m3u', async (req, res) => {
  const { m3u_text, bouquet_id } = req.body || {};
  if (!m3u_text || typeof m3u_text !== 'string') return res.status(400).json({ error: 'm3u_text required' });
  try {
    const jobId = importService.startM3UImport(m3u_text, bouquet_id || 0);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.get('/import/jobs/:id', (req, res) => {
  const j = importService.getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'not found' });
  res.json(j);
});

router.post('/import/jobs/:id/cancel', (req, res) => {
  importService.cancelJob(req.params.id);
  res.json({ ok: true });
});

router.get('/movies/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllMovieStreamUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/titles', async (_req, res) => {
  try { res.json({ titles: await dbApi.listAllSeriesTitles() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/episodes/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllEpisodeStreamUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/channels/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllChannelMpdUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/channels/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllLiveChannelIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/movies/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllMovieIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllSeriesIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/lookup', async (_req, res) => {
  try {
    const rows = await query('SELECT id, title, category_id FROM series');
    const lookup = {};
    for (const r of rows) {
      lookup[`${r.title}||${String(r.category_id || '')}`] = r.id;
    }
    res.json(lookup);
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/channels/import-live', async (req, res) => {
  const body = req.body || {};
  const url = body.url || body.mpdUrl;
  if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
  try {
    const userId = await dbApi.getFirstAdminUserId();
    if (!userId) return res.status(500).json({ error: 'no admin user' });
    const { detectInputType } = require('../lib/input-detect');
    const inputType = body.inputType || detectInputType(url);
    const created = await importChannelBridge.importLiveChannel({
      name: body.name || 'Live',
      mpdUrl: url,
      inputType,
      category_id: body.category_id != null ? parseInt(body.category_id, 10) : undefined,
      logoUrl: body.logo || body.logoUrl || '',
      epgChannelId: body.epg_channel_id || body.epgChannelId || '',
    }, userId);
    res.status(201).json(created);
  } catch (e) { res.status(e.statusCode || 400).json({ error: e.message || 'failed' }); }
});

router.post('/movies/purge-all', async (_req, res) => {
  try {
    await execute('DELETE FROM movies');
    await invalidateVod();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/series/purge-all', async (_req, res) => {
  try {
    await execute('DELETE FROM episodes');
    await execute('DELETE FROM series');
    await invalidateSeries();
    await invalidateEpisodes();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/movies/bulk', async (req, res) => {
  const { movies } = req.body || {};
  if (!Array.isArray(movies)) return res.status(400).json({ error: 'movies array required' });
  let imported = 0;
  let errors = 0;
  for (const row of movies) {
    try {
      await vodService.create(row);
      imported += 1;
    } catch { errors += 1; }
  }
  await invalidateVod();
  res.json({ imported, errors });
});

router.post('/series/bulk', async (req, res) => {
  const { series } = req.body || {};
  if (!Array.isArray(series)) return res.status(400).json({ error: 'series array required' });
  const ids = [];
  let errors = 0;
  for (const row of series) {
    try {
      const id = await seriesService.create(row);
      ids.push(id);
    } catch { errors += 1; }
  }
  await invalidateSeries();
  res.json({ imported: ids.length, ids, errors });
});

router.post('/episodes/bulk', async (req, res) => {
  const { episodes } = req.body || {};
  if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes array required' });
  let imported = 0;
  let errors = 0;
  for (const row of episodes) {
    try {
      await seriesService.addEpisode(row);
      imported += 1;
    } catch { errors += 1; }
  }
  await invalidateEpisodes();
  res.json({ imported, errors });
});

router.post('/bouquets/:id/sync', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { type, ids } = req.body || {};
  const b = await dbApi.getBouquetById(id);
  if (!b) return res.status(404).json({ error: 'not found' });
  const field = type === 'movies' ? 'bouquet_movies' : type === 'series' ? 'bouquet_series' : 'bouquet_channels';
  if (!['bouquet_movies', 'bouquet_series', 'bouquet_channels'].includes(field)) {
    return res.status(400).json({ error: 'type must be movies, series, or channels' });
  }
  const parseField = (raw) => {
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(v) ? v.map((x) => String(x)) : [];
    } catch { return []; }
  };
  const cur = parseField(b[field]);
  const set = new Set(cur);
  for (const x of ids || []) set.add(String(x));
  const merged = [...set].map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : x;
  });
  try {
    await dbApi.updateBouquet(id, { [field]: merged });
    await invalidateBouquets();
    res.json({ ok: true, count: merged.length });
  } catch (e) { res.status(400).json({ error: e.message || 'sync failed' }); }
});

// ─── Bouquets ───────────────────────────────────────────────────────

router.get('/bouquets', async (_req, res) => {
  res.json({ bouquets: await bouquetService.list() });
});

router.post('/bouquets', async (req, res) => {
  try {
    const id = await bouquetService.create(req.body || {});
    await invalidateBouquets();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/bouquets/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await bouquetService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await bouquetService.update(id, req.body || {});
    await invalidateBouquets();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/bouquets/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await bouquetService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateBouquets();
  res.json({ ok: true });
});

// ─── Packages ───────────────────────────────────────────────────────

router.get('/packages', async (_req, res) => {
  res.json({ packages: await packageService.list() });
});

router.post('/packages', async (req, res) => {
  try { const id = await packageService.create(req.body || {}); res.status(201).json({ id }); }
  catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/packages/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await packageService.getById(id))) return res.status(404).json({ error: 'not found' });
  try { await packageService.update(id, req.body || {}); res.json({ ok: true, id }); }
  catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/packages/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await packageService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── Movies ─────────────────────────────────────────────────────────

router.get('/movies', async (req, res) => {
  const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
  const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
  const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
  const { limit, offset } = parseLimitOffset(req.query);
  try {
    const result = await vodService.listItems(categoryId, limit, offset, search, sortOrder);
    res.json({ movies: result.movies, total: result.total, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const movie = await vodService.getById(id);
  if (!movie) return res.status(404).json({ error: 'not found' });
  res.json(movie);
});

router.post('/movies', async (req, res) => {
  try {
    const id = await vodService.create(req.body || {});
    await invalidateVod();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await vodService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await vodService.update(id, req.body || {});
    await invalidateVod();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await vodService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateVod();
  res.json({ ok: true });
});

// ─── Series ─────────────────────────────────────────────────────────

router.get('/series', async (req, res) => {
  const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
  const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
  const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
  const { limit, offset } = parseLimitOffset(req.query);
  try {
    const result = await seriesService.listSeries(categoryId, limit, offset, search, sortOrder);
    res.json({ series: result.series, total: result.total, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const data = await seriesService.findSeries(id);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

router.post('/series', async (req, res) => {
  try {
    const id = await seriesService.create(req.body || {});
    await invalidateSeries();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/series/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getSeriesById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await seriesService.update(id, req.body || {});
    await invalidateSeries();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/series/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await seriesService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateSeries();
  res.json({ ok: true });
});

// ─── Episodes ───────────────────────────────────────────────────────

router.get('/episodes', async (req, res) => {
  const { search, series_id, limit, offset } = req.query;
  try {
    const data = await dbApi.listAllEpisodes({
      search: search || '', series_id: series_id ? parseInt(series_id) : null,
      limit: parseInt(limit) || 50, offset: parseInt(offset) || 0,
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message || 'list failed' }); }
});

router.post('/series/:id/episodes', async (req, res) => {
  const seriesId = parseIdParam(req.params.id);
  if (!Number.isFinite(seriesId)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getSeriesById(seriesId))) return res.status(404).json({ error: 'not found' });
  try {
    const id = await seriesService.addEpisode({ ...(req.body || {}), series_id: seriesId });
    await invalidateEpisodes();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.get('/episodes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ep = await dbApi.getEpisodeById(id);
  if (!ep) return res.status(404).json({ error: 'not found' });
  res.json(ep);
});

router.put('/episodes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getEpisodeById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await seriesService.updateEpisode(id, req.body || {});
    await invalidateEpisodes();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/episodes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await seriesService.removeEpisode(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateEpisodes();
  res.json({ ok: true });
});

// ─── EPG ────────────────────────────────────────────────────────────

router.get('/epg/sources', async (_req, res) => {
  res.json({ sources: await epgService.listSources() });
});

router.post('/epg/sources', async (req, res) => {
  const { name, url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  try {
    const id = await epgService.addSource(name != null ? String(name) : '', String(url));
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.delete('/epg/sources/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await epgService.removeSource(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/epg/refresh', async (req, res) => {
  try { res.json(await epgService.refreshAllSources()); }
  catch (e) { res.status(500).json({ error: e.message || 'refresh failed' }); }
});

// ─── Streaming servers / LB ─────────────────────────────────────────
// Static paths must be registered before `/servers/:id` (numeric id routes).

router.get('/servers', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers', async (req, res) => {
  try {
    const s = await serverService.createServer(req.body || {});
    res.status(201).json(s);
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.get('/servers/nginx-export', async (_req, res) => {
  try {
    const snippet = await serverService.buildNginxUpstreamSnippet();
    res.json({ snippet });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/provision', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const b = req.body || {};
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host') || '';
    const panelUrl = String(b.panel_url || process.env.PANEL_PUBLIC_URL || `${proto}://${host}`).replace(/\/+$/, '');
    const job = await provisionService.startProvisionJob({
      ...b,
      panel_url: panelUrl,
      userId: req.session && req.session.userId,
    });
    res.status(201).json(job);
  } catch (e) {
    res.status(400).json({ error: e.message || 'provision failed' });
  }
});

router.get('/servers/provision/:jobId', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const job = await provisionService.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({
      id: job.id,
      status: job.status,
      log: job.log || '',
      error: job.error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/servers/monitor-summary', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    const summary = await Promise.all(servers.map(async (s) => {
      const placements = await serverService.getRuntimePlacementsForServer(s.id);
      const activeSessions = await dbApi.countActiveRuntimeSessionsByServer(s.id);
      const health = await serverService.getServerHealthStatus(s.id);
      const runningPlacements = placements.filter((p) => p.status === 'running').length;
      const totalPlacements = placements.length;
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        public_host: s.public_host,
        public_ip: s.public_ip,
        private_ip: s.private_ip,
        enabled: s.enabled,
        proxied: s.proxied,
        timeshift_only: s.timeshift_only,
        max_clients: s.max_clients,
        network_mbps_cap: s.network_mbps_cap,
        network_interface: s.network_interface,
        network_speed: s.network_speed,
        os_info: s.os_info,
        ssh_port: s.ssh_port,
        http_port: s.http_port,
        https_port: s.https_port,
        runtime_enabled: s.runtime_enabled,
        proxy_enabled: s.proxy_enabled,
        controller_enabled: s.controller_enabled,
        domains_count: Array.isArray(s.domains) ? s.domains.length : 0,
        last_heartbeat_at: s.last_heartbeat_at,
        heartbeat_fresh: !!health.fresh,
        heartbeat_stale_ms: Number.isFinite(health.staleMs) ? health.staleMs : null,
        agent_version: s.agent_version,
        health_cpu_pct: s.health_cpu_pct,
        health_mem_pct: s.health_mem_pct,
        health_net_mbps: s.health_net_mbps,
        health_ping_ms: s.health_ping_ms,
        active_sessions: activeSessions,
        running_placements: runningPlacements,
        total_placements: totalPlacements,
      };
    }));
    res.json({ servers: summary });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const s = await serverService.getServer(id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const s = await serverService.updateServer(id, req.body || {});
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: e.message || 'update failed' });
  }
});

router.delete('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const ok = await serverService.deleteServer(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/servers/reorder', async (req, res) => {
  const orderings = req.body;
  if (!Array.isArray(orderings)) return res.status(400).json({ error: 'body must be an array of {id, sort_order}' });
  try {
    await serverService.reorderServers(orderings);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'reorder failed' });
  }
});

router.post('/servers/:id/actions/restart-services', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });
    const result = await streamManager.issueRemoteCommand({
      serverId: id,
      commandType: 'restart_services',
      issuedByUserId: req.session && req.session.userId,
    });
    if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
    res.json({ ok: true, commandId: result.commandId, message: 'Restart services command queued' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/:id/actions/reboot-server', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });
    const result = await streamManager.issueRemoteCommand({
      serverId: id,
      commandType: 'reboot_server',
      issuedByUserId: req.session && req.session.userId,
    });
    if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
    res.json({ ok: true, commandId: result.commandId, message: 'Reboot command queued' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/:id/actions/kill-connections', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });

    const sessions = await dbApi.listActiveRuntimeSessionsByServer(id);
    const reconcileKeys = new Set();
    let closed = 0;
    for (const session of sessions) {
      try {
        if (String(session.stream_type) === 'live' && session.line_id && session.session_uuid) {
          await lineService.closeConnection(session.line_id, session.session_uuid);
        }
      } catch (_) {}
      if (session.session_uuid) {
        await lineService.closeRuntimeSession(session.session_uuid);
        reconcileKeys.add(`${session.stream_type}:${session.stream_id}:${id}`);
        closed++;
      }
    }
    for (const key of reconcileKeys) {
      const [streamType, streamId, serverId] = key.split(':');
      await dbApi.reconcilePlacementClients(streamType, streamId, parseInt(serverId, 10));
    }
    res.json({ ok: true, closed, message: `Closed ${closed} active connection(s)` });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

// ─── Live Connections ────────────────────────────────────────────────

router.get('/live-connections', async (req, res) => {
  try {
    const type = String(req.query.type || '').trim();
    const serverId = parseInt(req.query.server_id, 10);
    let sql = `
      SELECT s.session_uuid, s.stream_type, s.stream_id, s.container,
             s.origin_server_id, s.proxy_server_id,
             s.geoip_country_code, s.isp, s.user_ip, s.last_seen_at,
             s.created_at,
             l.username,
             o.name AS origin_name, o.public_host AS origin_host,
             p.name AS proxy_name, p.public_host AS proxy_host
      FROM line_runtime_sessions s
      LEFT JOIN \`lines\` l ON l.id = s.line_id
      LEFT JOIN streaming_servers o ON o.id = s.origin_server_id
      LEFT JOIN streaming_servers p ON p.id = s.proxy_server_id
      WHERE s.date_end IS NULL`;
    const params = [];
    if (type && ['live', 'movie', 'episode'].includes(type)) {
      sql += ' AND s.stream_type = ?';
      params.push(type);
    }
    if (Number.isFinite(serverId)) {
      sql += ' AND s.origin_server_id = ?';
      params.push(serverId);
    }
    sql += ' ORDER BY s.last_seen_at DESC LIMIT 500';
    const sessions = await query(sql, params);
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/live-connections/summary', async (_req, res) => {
  try {
    const [typeRows, countryRows, streamRows, serverRows] = await Promise.all([
      query(`
        SELECT stream_type, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL
        GROUP BY stream_type`),
      query(`
        SELECT geoip_country_code, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL AND geoip_country_code != ''
        GROUP BY geoip_country_code
        ORDER BY cnt DESC
        LIMIT 20`),
      query(`
        SELECT stream_id, stream_type, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL
        GROUP BY stream_id, stream_type
        ORDER BY cnt DESC
        LIMIT 10`),
      query(`
        SELECT origin_server_id, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL AND origin_server_id IS NOT NULL
        GROUP BY origin_server_id`),
    ]);
    const byType = { live: 0, movie: 0, episode: 0 };
    for (const r of typeRows) byType[r.stream_type] = Number(r.cnt);
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    const servers = await Promise.all(serverRows.map(async (r) => {
      const srv = await queryOne('SELECT name, public_host FROM streaming_servers WHERE id = ?', [r.origin_server_id]);
      return { server_id: r.origin_server_id, name: srv ? srv.name : '#' + r.origin_server_id, host: srv ? srv.public_host : '', cnt: Number(r.cnt) };
    }));
    res.json({
      total,
      by_type: byType,
      countries: countryRows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })),
      top_streams: streamRows.map((r) => ({ stream_id: r.stream_id, stream_type: r.stream_type, cnt: Number(r.cnt) })),
      servers,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/channels/top-monitor', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT stream_id, COUNT(*) AS viewers, MAX(origin_server_id) AS origin_server_id, MAX(last_seen_at) AS last_seen_at
      FROM line_runtime_sessions
      WHERE date_end IS NULL AND stream_type = 'live'
      GROUP BY stream_id
      ORDER BY viewers DESC, last_seen_at DESC
      LIMIT 50
    `);

    const channelRows = [];
    const serverIds = new Set();
    for (const row of rows) {
      const streamId = String(row.stream_id || '');
      const ch = channels.get(streamId);
      if (!ch || ch.is_internal || ch.channelClass === 'movie') continue;
      const serverId = Number(row.origin_server_id) || Number(ch.stream_server_id) || 0;
      if (serverId > 0) serverIds.add(serverId);
      const uptimeSeconds = ch.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(ch.startedAt).getTime()) / 1000)) : 0;
      const bitrateKbps = ch.streamInfo && ch.streamInfo.bitrate ? Math.round(Number(ch.streamInfo.bitrate) / 1000) : null;
      channelRows.push({
        id: streamId,
        name: ch.name || `Channel ${streamId}`,
        viewers: Number(row.viewers || 0),
        server_id: serverId,
        uptime_seconds: uptimeSeconds,
        uptime_label: uptimeSeconds > 0
          ? `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
          : '—',
        bitrate_kbps: bitrateKbps,
        source: ch.mpdUrl || '',
      });
    }

    const serverMap = new Map();
    if (serverIds.size) {
      const ids = [...serverIds];
      const serverRows = await query(
        `SELECT id, name FROM streaming_servers WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      serverRows.forEach((server) => serverMap.set(Number(server.id), server.name || `Server ${server.id}`));
    }

    const payloadRows = channelRows.map((row) => ({
      ...row,
      server_name: row.server_id > 0 ? (serverMap.get(row.server_id) || `Server ${row.server_id}`) : 'Line / Default',
    }));

    res.json({
      totals: {
        total_viewers: payloadRows.reduce((sum, row) => sum + Number(row.viewers || 0), 0),
        active_channels: payloadRows.length,
        active_servers: new Set(payloadRows.map((row) => row.server_name)).size,
      },
      channels: payloadRows,
      refreshed_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/live-connections/geo', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT geoip_country_code, COUNT(*) AS cnt
      FROM line_runtime_sessions
      WHERE date_end IS NULL AND geoip_country_code != ''
      GROUP BY geoip_country_code
      ORDER BY cnt DESC`);
    res.json({
      total: rows.reduce((sum, r) => sum + Number(r.cnt), 0),
      countries: rows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

// ─── Server Relationships ────────────────────────────────────────────

/**
 * List all origin-proxy relationships with joined server details.
 * GET /api/admin/server-relationships?type=origin-proxy
 */
router.get('/server-relationships', async (req, res) => {
  const type = String(req.query.type || 'origin-proxy').trim();
  if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
    return res.status(400).json({ error: 'invalid relationship type' });
  }
  try {
    const rows = await query(
      `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
              r.created_at, r.updated_at,
              s_parent.name AS parent_name, s_parent.public_host AS parent_public_host,
              s_child.name AS child_name, s_child.public_host AS child_public_host
       FROM server_relationships r
       JOIN streaming_servers s_parent ON s_parent.id = r.parent_server_id
       JOIN streaming_servers s_child ON s_child.id = r.child_server_id
       WHERE r.relationship_type = ?
       ORDER BY r.priority ASC`,
      [type]
    );
    res.json({ relationships: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Get all relationships for a specific server.
 * GET /api/admin/server-relationships/:serverId
 */
router.get('/server-relationships/:serverId', async (req, res) => {
  const id = parseInt(req.params.serverId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid server id' });
  try {
    const rows = await dbApi.getServerRelationships(id);
    res.json({ relationships: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Create a server relationship.
 * POST /api/admin/server-relationships
 */
router.post('/server-relationships', async (req, res) => {
  const { parent_server_id, child_server_id, relationship_type, priority, enabled } = req.body || {};
  if (!Number.isFinite(parseInt(parent_server_id, 10)) || !Number.isFinite(parseInt(child_server_id, 10))) {
    return res.status(400).json({ error: 'parent_server_id and child_server_id are required' });
  }
  const type = String(relationship_type || 'origin-proxy').trim();
  if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
    return res.status(400).json({ error: 'invalid relationship_type' });
  }
  try {
    const id = await dbApi.addServerRelationship(
      parseInt(parent_server_id, 10),
      parseInt(child_server_id, 10),
      type
    );
    res.json({ id, ok: true });
  } catch (e) {
    if (String(e.message).includes('Duplicate')) {
      return res.status(409).json({ error: 'relationship already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * Delete a server relationship.
 * DELETE /api/admin/server-relationships?parentId=&childId=&type=
 */
router.delete('/server-relationships', async (req, res) => {
  const parentId = parseInt(req.query.parentId, 10);
  const childId = parseInt(req.query.childId, 10);
  const type = String(req.query.type || 'origin-proxy').trim();
  if (!Number.isFinite(parentId) || !Number.isFinite(childId)) {
    return res.status(400).json({ error: 'parentId, childId, and type are required' });
  }
  try {
    await dbApi.removeServerRelationship(parentId, childId, type);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Settings ───────────────────────────────────────────────────────

router.get('/settings', async (_req, res) => {
  res.json(await dbApi.getAllSettings());
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'object body required' });
  for (const [k, v] of Object.entries(body)) await dbApi.setSetting(k, v);
  await invalidateSettings();
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
  } catch (e) {
    console.error('[settings] refresh streaming:', e.message);
  }
  res.json(await dbApi.getAllSettings());
});

router.get('/settings/streaming-performance', async (_req, res) => {
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/settings/streaming-performance', async (req, res) => {
  try {
    const b = req.body || {};
    const K = streamingSettings.KEYS;
    const boolStr = (v) =>
      v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes' ? '1' : '0';
    if (b.prebuffer_enabled !== undefined) await dbApi.setSetting(K.prebuffer_enabled, boolStr(b.prebuffer_enabled));
    if (b.prebuffer_size_mb !== undefined) {
      const n = parseFloat(b.prebuffer_size_mb, 10);
      if (!Number.isFinite(n) || n < 1 || n > 16) {
        return res.status(400).json({ error: 'prebuffer_size_mb must be 1–16' });
      }
      await dbApi.setSetting(K.prebuffer_size_mb, String(n));
    }
    if (b.prebuffer_on_demand_min_bytes !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_min_bytes, 10);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'invalid prebuffer_on_demand_min_bytes' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_min_bytes, String(n));
    }
    if (b.prebuffer_on_demand_max_wait_ms !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_max_wait_ms, 10);
      if (!Number.isFinite(n) || n < 100 || n > 60000) {
        return res.status(400).json({ error: 'prebuffer_on_demand_max_wait_ms must be 100–60000' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_max_wait_ms, String(n));
    }
    if (b.ingest_style !== undefined) {
      const s = String(b.ingest_style || '').trim().toLowerCase();
      if (!['webapp', 'xc', 'safe'].includes(s)) {
        return res.status(400).json({ error: 'ingest_style must be webapp, xc, or safe' });
      }
      await dbApi.setSetting(K.ingest_style, s);
    }
    if (b.low_latency_enabled !== undefined) await dbApi.setSetting(K.low_latency_enabled, boolStr(b.low_latency_enabled));
    if (b.minimal_ingest_enabled !== undefined) {
      await dbApi.setSetting(K.minimal_ingest_enabled, boolStr(b.minimal_ingest_enabled));
    }
    if (b.prewarm_enabled !== undefined) await dbApi.setSetting(K.prewarm_enabled, boolStr(b.prewarm_enabled));
    if (b.streaming_provisioning_enabled !== undefined) {
      await dbApi.setSetting(
        provisionService.STREAMING_PROVISIONING_KEY,
        boolStr(b.streaming_provisioning_enabled)
      );
    }
    await streamingSettings.refreshStreamingSettings(dbApi);
    await invalidateSettings();
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

// ─── Resellers ──────────────────────────────────────────────────────

router.get('/resellers', async (_req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt((_req.query && _req.query.limit), 10) || 50));
  const offset = Math.max(0, parseInt((_req.query && _req.query.offset), 10) || 0);
  const search = String((_req.query && _req.query.search) || '').trim();
  const status = _req.query && _req.query.status !== undefined && _req.query.status !== '' ? parseInt(_req.query.status, 10) : null;
  const groupId = _req.query && _req.query.group_id !== undefined && _req.query.group_id !== '' ? parseInt(_req.query.group_id, 10) : null;
  const where = ['g.is_reseller = 1'];
  const params = [];
  if (search) {
    where.push('(u.username LIKE ? OR u.email LIKE ? OR u.reseller_dns LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (Number.isFinite(status)) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (Number.isFinite(groupId)) {
    where.push('u.member_group_id = ?');
    params.push(groupId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await queryOne(
    `SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id ${whereSql}`,
    params
  );
  const resellers = await query(
    `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
            u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
     FROM users u
     INNER JOIN user_groups g ON u.member_group_id = g.group_id
     LEFT JOIN \`lines\` l ON l.member_id = u.id
     ${whereSql}
     GROUP BY u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
              u.reseller_dns, u.owner_id, u.last_login, u.created_at
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ resellers, total: totalRow ? Number(totalRow.c) || 0 : resellers.length });
});

router.get('/resellers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const reseller = await getResellerPayload(id);
    if (!reseller) return res.status(404).json({ error: 'not found' });
    res.json(reseller);
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/resellers', async (req, res) => {
  const { username, password, email, credits, member_group_id, reseller_dns, notes, status, package_overrides } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const group = await resolveResellerGroup(member_group_id);
  if (!group || !Number.isFinite(group.group_id)) return res.status(500).json({ error: 'reseller group not configured' });
  try {
    const id = await dbApi.createUser(String(username), String(password));
    const patch = { member_group_id: group.group_id };
    if (email !== undefined) patch.email = String(email);
    if (credits !== undefined) patch.credits = Number(credits);
    if (reseller_dns !== undefined) patch.reseller_dns = String(reseller_dns || '');
    if (notes !== undefined) patch.notes = String(notes || '');
    if (status !== undefined) patch.status = parseBoolInt(status, 1);
    await dbApi.updateUser(id, patch);
    await dbApi.replaceResellerPackageOverrides(id, parsePackageOverrides(package_overrides));
    const row = await getResellerPayload(id);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/resellers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await getResellerPayload(id))) return res.status(404).json({ error: 'not found' });
  try {
    const patch = {};
    if (req.body && req.body.password) patch.password = String(req.body.password);
    if (req.body && req.body.email !== undefined) patch.email = String(req.body.email || '');
    if (req.body && req.body.notes !== undefined) patch.notes = String(req.body.notes || '');
    if (req.body && req.body.credits !== undefined) patch.credits = Number(req.body.credits) || 0;
    if (req.body && req.body.reseller_dns !== undefined) patch.reseller_dns = String(req.body.reseller_dns || '');
    if (req.body && req.body.status !== undefined) patch.status = parseBoolInt(req.body.status, 1);
    if (req.body && req.body.member_group_id !== undefined) {
      const group = await resolveResellerGroup(req.body.member_group_id);
      if (!group) return res.status(400).json({ error: 'invalid reseller group' });
      patch.member_group_id = group.group_id;
    }
    await dbApi.updateUser(id, patch);
    if (req.body && req.body.package_overrides !== undefined) {
      await dbApi.replaceResellerPackageOverrides(id, parsePackageOverrides(req.body.package_overrides));
    }
    const row = await getResellerPayload(id);
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/resellers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const reseller = await getResellerPayload(id);
  if (!reseller) return res.status(404).json({ error: 'not found' });
  if (Number(reseller.line_count) > 0) return res.status(400).json({ error: 'reseller still owns users lines' });
  await dbApi.replaceResellerPackageOverrides(id, []);
  const service = await dbApi.getResellerExpiryMediaServiceByUserId(id);
  if (service) await dbApi.deleteResellerExpiryMediaService(service.id);
  const ok = await dbApi.deleteUser(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.put('/resellers/:id/credits', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { credits, reason } = req.body || {};
  if (credits === undefined || credits === null) return res.status(400).json({ error: 'credits required' });
  const user = await dbApi.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not found' });
  const newBal = Number(credits);
  if (!Number.isFinite(newBal)) return res.status(400).json({ error: 'invalid credits' });
  const delta = newBal - (Number(user.credits) || 0);
  await dbApi.updateUser(id, { credits: newBal });
  await dbApi.addCreditLog(id, req.session.userId, delta, reason != null ? String(reason) : '');
  res.json({ id, credits: newBal });
});

// ─── Reseller Expiry Media ─────────────────────────────────────────

router.get('/expiry-media/services', async (req, res) => {
  try {
    const { limit, offset } = parseLimitOffset(req.query);
    const search = String(req.query.search || '').trim();
    const result = await dbApi.listResellerExpiryMediaServices(limit, offset, search);
    res.json({ services: result.rows || [], total: result.total || 0 });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/expiry-media/services', async (req, res) => {
  const userId = parseInt(req.body && req.body.user_id, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'user_id required' });
  try {
    const reseller = await getResellerPayload(userId);
    if (!reseller) return res.status(404).json({ error: 'reseller not found' });
    const existing = await dbApi.getResellerExpiryMediaServiceByUserId(userId);
    if (existing) return res.status(400).json({ error: 'expiry media service already exists' });
    const service = await dbApi.createResellerExpiryMediaService(userId, {
      active: 1,
      warning_window_days: 7,
      repeat_interval_hours: 6,
    });
    res.status(201).json({ ...service, items: [] });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.get('/expiry-media/services/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const service = await dbApi.getResellerExpiryMediaServiceById(id);
    if (!service) return res.status(404).json({ error: 'not found' });
    const items = await dbApi.listResellerExpiryMediaItems(id);
    res.json({ ...service, items });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.put('/expiry-media/services/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const service = await dbApi.getResellerExpiryMediaServiceById(id);
    if (!service) return res.status(404).json({ error: 'not found' });
    const items = parseExpiryMediaItems(req.body && req.body.items);
    await dbApi.updateResellerExpiryMediaService(id, {
      active: req.body && req.body.active !== undefined ? parseBoolInt(req.body.active, 1) : undefined,
      warning_window_days: req.body && req.body.warning_window_days !== undefined ? Math.max(1, parseInt(req.body.warning_window_days, 10) || 7) : undefined,
      repeat_interval_hours: req.body && req.body.repeat_interval_hours !== undefined ? Math.max(1, parseInt(req.body.repeat_interval_hours, 10) || 6) : undefined,
    });
    await dbApi.replaceResellerExpiryMediaItems(id, items);
    const next = await dbApi.getResellerExpiryMediaServiceById(id);
    const nextItems = await dbApi.listResellerExpiryMediaItems(id);
    res.json({ ...next, items: nextItems });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/expiry-media/services/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const service = await dbApi.getResellerExpiryMediaServiceById(id);
  if (!service) return res.status(404).json({ error: 'not found' });
  await dbApi.deleteResellerExpiryMediaService(id);
  res.json({ ok: true });
});

// ─── Logs / Activity / Channels ─────────────────────────────────────

router.get('/logs', async (req, res) => {
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
  res.json({ logs: await dbApi.getPanelLogs(limit) });
});

router.get('/activity', async (req, res) => {
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const rows = await query('SELECT * FROM lines_activity ORDER BY activity_id DESC LIMIT ?', [limit]);
  res.json({ activity: rows });
});

router.get('/channels', (_req, res) => {
  const list = [];
  channels.forEach((ch, id) => list.push({ id, name: ch.name, status: ch.status }));
  res.json(list);
});

// ─── Security ───────────────────────────────────────────────────────

router.get('/security/blocked-ips', async (_req, res) => { res.json({ items: await dbApi.listBlockedIps() }); });
router.post('/security/blocked-ips', async (req, res) => {
  const { ip, notes } = req.body || {};
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'ip required' });
  const rid = await dbApi.addBlockedIp(String(ip).trim(), notes != null ? String(notes) : '');
  res.status(201).json({ id: rid || undefined, ok: true });
});
router.delete('/security/blocked-ips/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.removeBlockedIp(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/security/blocked-uas', async (_req, res) => { res.json({ items: await dbApi.listBlockedUas() }); });
router.post('/security/blocked-uas', async (req, res) => {
  const { user_agent, notes } = req.body || {};
  if (!user_agent || typeof user_agent !== 'string') return res.status(400).json({ error: 'user_agent required' });
  const id = await dbApi.addBlockedUa(String(user_agent), notes != null ? String(notes) : '');
  res.status(201).json({ id });
});
router.delete('/security/blocked-uas/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.removeBlockedUa(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── TMDb Proxy ─────────────────────────────────────────────────────

router.post('/tmdb/search', async (req, res) => {
  const { query: q, type } = req.body || {};
  if (!q) return res.status(400).json({ error: 'query required' });
  try {
    const results = type === 'tv' ? await tmdbService.searchTvShows(String(q)) : await tmdbService.searchMovies(String(q));
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message || 'tmdb search failed' }); }
});

router.post('/tmdb/details', async (req, res) => {
  const { tmdb_id, type } = req.body || {};
  if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id required' });
  try {
    const data = type === 'tv' ? await tmdbService.getTvShow(Number(tmdb_id)) : await tmdbService.getMovie(Number(tmdb_id));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message || 'tmdb details failed' }); }
});

router.post('/tmdb/season', async (req, res) => {
  const { tmdb_id, season_number } = req.body || {};
  if (!tmdb_id || season_number === undefined) return res.status(400).json({ error: 'tmdb_id and season_number required' });
  try { res.json(await tmdbService.getSeason(Number(tmdb_id), Number(season_number))); }
  catch (e) { res.status(500).json({ error: e.message || 'tmdb season failed' }); }
});

// ─── M3U Import helpers ─────────────────────────────────────────────

function parseM3UEntries(text) {
  const lines = String(text).split('\n');
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown', group: groupMatch ? groupMatch[1] : '', logo: logoMatch ? logoMatch[1] : '' };
    } else if (current && line && !line.startsWith('#')) {
      current.url = line;
      entries.push(current);
      current = null;
    }
  }
  return entries;
}

router.post('/movies/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const entry of entries) {
      const movieData = {
        name: entry.name, stream_url: entry.url, stream_source: entry.url,
        category_id: category_id || '', stream_icon: entry.logo || '',
        container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchMovies(entry.name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getMovie(tmdbResults[0].id);
            Object.assign(movieData, {
              name: details.name || movieData.name, stream_icon: details.movie_image || movieData.stream_icon,
              backdrop_path: details.backdrop_path || '', plot: details.plot || '',
              movie_cast: details.cast || '', director: details.director || '', genre: details.genre || '',
              rating: String(details.rating || '0'), rating_5based: Math.round((details.rating || 0) / 2 * 10) / 10,
              year: details.year, tmdb_id: details.tmdb_id, duration: details.duration || '',
              duration_secs: details.duration_secs || 0, release_date: details.release_date || '',
              youtube_trailer: details.youtube_trailer || '', country: details.country || '',
              movie_properties: details,
            });
          }
        } catch {}
      }
      const id = await vodService.create(movieData);
      results.push({ id, name: movieData.name });
    }
    await invalidateVod();
    res.json({ imported: results.length, movies: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

router.post('/series/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const seriesMap = new Map();
    for (const entry of entries) {
      const seMatch = entry.name.match(/^(.+?)\s*[Ss](\d+)\s*[Ee](\d+)/);
      const seriesName = seMatch ? seMatch[1].trim() : entry.group || entry.name;
      const season = seMatch ? parseInt(seMatch[2]) : 1;
      const episode = seMatch ? parseInt(seMatch[3]) : 1;
      if (!seriesMap.has(seriesName)) seriesMap.set(seriesName, { name: seriesName, logo: entry.logo, episodes: [] });
      seriesMap.get(seriesName).episodes.push({
        season_num: season, episode_num: episode, title: entry.name,
        stream_url: entry.url, container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      });
    }
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const [name, data] of seriesMap) {
      const seriesData = { title: name, category_id: category_id || '', cover: data.logo || '' };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchTvShows(name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getTvShow(tmdbResults[0].id);
            Object.assign(seriesData, {
              title: details.title || seriesData.title, cover: details.cover || seriesData.cover,
              cover_big: details.cover_big || '', backdrop_path: details.backdrop_path || '',
              plot: details.plot || '', series_cast: details.cast || '', director: details.director || '',
              genre: details.genre || '', rating: String(details.rating || '0'),
              rating_5based: details.rating_5based || 0, year: details.year, tmdb_id: details.tmdb_id,
              youtube_trailer: details.youtube_trailer || '', episode_run_time: details.episode_run_time || 0,
              seasons: details.seasons || [],
            });
          }
        } catch {}
      }
      const seriesId = await seriesService.create(seriesData);
      for (const ep of data.episodes) await seriesService.addEpisode({ ...ep, series_id: seriesId });
      results.push({ id: seriesId, name: seriesData.title, episodes: data.episodes.length });
    }
    await invalidateSeries();
    res.json({ imported: results.length, series: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

// ─── Dashboard Stats ────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const si = require('systeminformation');
    const [cpu, mem, disk, net] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(),
    ]);
    const nowTs = Math.floor(Date.now() / 1000);
    const [activeRow, totalChRow, episodeRow, bouquetRow, packageRow, resellerRow] = await Promise.all([
      queryOne('SELECT COUNT(*) AS c FROM `lines` WHERE admin_enabled = 1 AND exp_date > ?', [nowTs]),
      queryOne('SELECT COUNT(*) AS c FROM `channels`'),
      queryOne('SELECT COUNT(*) AS c FROM `episodes`'),
      queryOne('SELECT COUNT(*) AS c FROM `bouquets`'),
      queryOne('SELECT COUNT(*) AS c FROM `packages`'),
      queryOne('SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE g.is_reseller = 1'),
    ]);
    const movieCountVal = await dbApi.movieCount();
    const seriesCountVal = await dbApi.seriesCount();
    const runningCount = channels ? [...channels.values()].filter(c => c.status === 'running').length : 0;
    const totalNetIn = net.reduce((a, n) => a + (n.rx_sec || 0), 0) / 1024;
    const totalNetOut = net.reduce((a, n) => a + (n.tx_sec || 0), 0) / 1024;
    res.json({
      activeLines: activeRow ? activeRow.c : 0,
      connections: processes ? processes.size : 0,
      liveStreams: runningCount,
      channelsCount: totalChRow ? totalChRow.c : (channels ? channels.size : 0),
      movieCount: movieCountVal,
      seriesCount: seriesCountVal,
      episodeCount: episodeRow ? Number(episodeRow.c) || 0 : 0,
      bouquetCount: bouquetRow ? Number(bouquetRow.c) || 0 : 0,
      packageCount: packageRow ? Number(packageRow.c) || 0 : 0,
      resellerCount: resellerRow ? Number(resellerRow.c) || 0 : 0,
      cpu: Math.round(cpu.currentLoad || 0),
      memUsed: mem.used, memTotal: mem.total, memPercent: Math.round((mem.used / mem.total) * 100),
      diskUsed: disk[0] ? disk[0].used : 0, diskTotal: disk[0] ? disk[0].size : 0,
      diskPercent: disk[0] ? Math.round(disk[0].use) : 0,
      diskUsedGB: disk[0] ? +((disk[0].used || 0) / (1024 * 1024 * 1024)).toFixed(1) : 0,
      diskTotalGB: disk[0] ? +((disk[0].size || 0) / (1024 * 1024 * 1024)).toFixed(1) : 0,
      netIn: parseFloat(totalNetIn.toFixed(1)),
      netOut: parseFloat(totalNetOut.toFixed(1)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Backup Management ──────────────────────────────────────────────

router.get('/backups', async (_req, res) => {
  try {
    const backupService = require('../services/backupService');
    await backupService.initBackupTable();
    const backups = await backupService.listBackups();
    const retentionLimit = await backupService.getLocalBackupRetentionLimit();
    res.json({ backups, retentionLimit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    await backupService.initBackupTable();
    const backup = await backupService.createBackup();
    res.json({ ok: true, backup });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backups/:id/download', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const filepath = await backupService.getBackupPath(rows[0].filename);
    if (!filepath) return res.status(404).json({ error: 'file not found' });
    res.download(filepath, rows[0].filename);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups/:id/restore', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename, type FROM backups WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    if (rows[0].type !== 'local') return res.status(400).json({ error: 'only local backups can be restored' });
    const confirmFilename = String(req.body && (req.body.confirmFilename || req.body.confirm_filename) || '').trim();
    if (!confirmFilename || confirmFilename !== rows[0].filename) {
      return res.status(400).json({ error: 'confirmFilename must exactly match the backup filename' });
    }
    const result = await backupService.restoreBackup(rows[0].filename);
    res.json({ ok: true, safetyBackup: result && result.safetyBackup ? result.safetyBackup : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/backups/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await backupService.deleteBackupFile(rows[0].filename);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backups/cloud', async (_req, res) => {
  try {
    const cloudBackup = require('../services/cloudBackup');
    const backups = await cloudBackup.getCloudBackups();
    const cfg = await cloudBackup.getCloudConfig();
    const capability = cloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
    res.json({ backups, configured: cfg ? { type: cfg.type } : null, capability });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups/cloud/upload/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const cloudBackup = require('../services/cloudBackup');
    const cfg = await cloudBackup.getCloudConfig();
    const capability = cloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
    if (!capability.supported) {
      return res.status(409).json({ error: capability.message, capability });
    }
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await cloudBackup.createEncryptedCloudBackup(rows[0].filename);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/cloud_backup', async (req, res) => {
  try {
    const { cloud_backup_type, gdrive_access_token, gdrive_folder_id, dropbox_access_token, s3_bucket, s3_region, s3_access_key, s3_secret_key, cloud_backup_key } = req.body;
    const dbApi = require('../lib/db');
    if (cloud_backup_type !== undefined) await dbApi.setSetting('cloud_backup_type', cloud_backup_type);
    if (gdrive_access_token !== undefined) await dbApi.setSetting('gdrive_access_token', gdrive_access_token);
    if (gdrive_folder_id !== undefined) await dbApi.setSetting('gdrive_folder_id', gdrive_folder_id);
    if (dropbox_access_token !== undefined) await dbApi.setSetting('dropbox_access_token', dropbox_access_token);
    if (s3_bucket !== undefined) await dbApi.setSetting('s3_bucket', s3_bucket);
    if (s3_region !== undefined) await dbApi.setSetting('s3_region', s3_region);
    if (s3_access_key !== undefined) await dbApi.setSetting('s3_access_key', s3_access_key);
    if (s3_secret_key !== undefined) await dbApi.setSetting('s3_secret_key', s3_secret_key);
    if (cloud_backup_key !== undefined) await dbApi.setSetting('cloud_backup_key', cloud_backup_key);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── RBAC ────────────────────────────────────────────────────────────

router.get('/permissions', async (_req, res) => {
  try {
    const roles = await query('SELECT id, name, description FROM roles ORDER BY id');
    const perms = await query('SELECT id, name, resource, action FROM permissions ORDER BY resource, action');
    const rolePerms = await query('SELECT role_id, permission_id FROM role_permissions');
    res.json({ roles, permissions: perms, rolePermissions: rolePerms });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/roles', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { insertId } = await execute('INSERT INTO roles (name, description) VALUES (?, ?)', [name, description || '']);
    res.json({ ok: true, id: insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/roles/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const { name, description } = req.body;
    await execute('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?', [name || null, description !== undefined ? description : null, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/roles/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    if (id === 1) return res.status(400).json({ error: 'cannot delete admin role' });
    await execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    await execute('DELETE FROM roles WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/roles/:id/permissions', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const { permission_ids } = req.body;
    if (!Array.isArray(permission_ids)) return res.status(400).json({ error: 'permission_ids must be array' });
    await execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    for (const pid of permission_ids) {
      await execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, pid]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ASN Blocking ─────────────────────────────────────────────────

router.get('/asn/blocked', async (_req, res) => {
  try {
    const asnBlocker = require('../services/asnBlocker');
    const blocked = await asnBlocker.getBlockedAsns();
    res.json({ blocked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/asn/block', async (req, res) => {
  try {
    const { asn, org, notes } = req.body;
    if (!asn) return res.status(400).json({ error: 'asn required' });
    const asnBlocker = require('../services/asnBlocker');
    await asnBlocker.blockAsn(asn, org || '', notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/asn/block/:asn', async (req, res) => {
  try {
    const asnBlocker = require('../services/asnBlocker');
    await asnBlocker.unblockAsn(req.params.asn);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── VPN Detection ────────────────────────────────────────────────

router.get('/vpn/settings', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const enabled = await dbApi.getSetting('enable_vpn_detection');
    const blockVpn = await dbApi.getSetting('block_vpn');
    res.json({ enabled: enabled === '1', blockVpn: blockVpn === '1' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/vpn/settings', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { enabled, blockVpn } = req.body;
    if (enabled !== undefined) await dbApi.setSetting('enable_vpn_detection', enabled ? '1' : '0');
    if (blockVpn !== undefined) await dbApi.setSetting('block_vpn', blockVpn ? '1' : '0');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/vpn/log', async (req, res) => {
  try {
    const rows = await query(
      `SELECT le.id, le.user_id, le.ip, le.event_type, le.is_vpn, le.created_at,
              l.username
       FROM login_events le
       LEFT JOIN \`lines\` l ON le.user_id = l.id
       WHERE le.is_vpn = 1
       ORDER BY le.created_at DESC LIMIT 100`
    );
    res.json({ events: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Multi-Login ───────────────────────────────────────────────────

router.get('/multilogin', async (_req, res) => {
  try {
    const multiLogin = require('../services/multiLoginDetector');
    const lines = await multiLogin.getMultiLoginLines();
    res.json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/multilogin/settings', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const maxConns = await dbApi.getSetting('max_connections_per_line');
    const enabled = await dbApi.getSetting('enable_multilogin_detection');
    res.json({ enabled: enabled === '1', maxConnections: parseInt(maxConns || '1', 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/multilogin/settings', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { enabled, maxConnections } = req.body;
    if (enabled !== undefined) await dbApi.setSetting('enable_multilogin_detection', enabled ? '1' : '0');
    if (maxConnections !== undefined) await dbApi.setSetting('max_connections_per_line', String(maxConnections));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/multilogin/:lineId/disconnect', async (req, res) => {
  try {
    const lineId = parseIdParam(req.params.lineId);
    if (isNaN(lineId)) return res.status(400).json({ error: 'invalid id' });
    const multiLogin = require('../services/multiLoginDetector');
    await multiLogin.disconnectLine(lineId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── VPN/ASN check middleware helper ──────────────────────────────

function buildVpnasnMiddleware() {
  return async (req, res, next) => {
    if (!req.session || !req.session.lineId) return next();
    try {
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').replace(/^::ffff:/, '');
      const vpnDetect = require('../services/vpnDetector');
      const asnBlocker = require('../services/asnBlocker');
      const dbApi = require('../lib/db');

      const vpnEnabled = await dbApi.getSetting('enable_vpn_detection');
      if (vpnEnabled === '1') {
        const isVpn = await vpnDetect.checkVpnIp(ip);
        await vpnDetect.recordVpnCheck(ip, req.session.lineId, isVpn);
        const blockVpn = await dbApi.getSetting('block_vpn');
        if (isVpn && blockVpn === '1') {
          return res.status(403).json({ error: 'VPN/proxy connections not allowed' });
        }
      }

      const asnData = await asnBlocker.lookupAsn(ip);
      if (asnData && asnData.blocked) {
        return res.status(403).json({ error: 'ASN blocked' });
      }
    } catch (_) {}
    next();
  };
}

// ─── TMDB Re-sync ─────────────────────────────────────────────────

router.post('/tmdb/resync-movie/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const dbApi = require('../lib/db');
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

    const [movie] = await query('SELECT id, tmdb_id FROM movies WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1', [id]);
    if (!movie) return res.status(404).json({ error: 'movie not found or no tmdb_id' });

    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbMovieMeta } = require('../lib/crons');
    const meta = await fetchTmdbMovieMeta(movie.tmdb_id, key, lang);
    await dbApi.updateMovie(id, meta);
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tmdb/resync-series/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const dbApi = require('../lib/db');
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

    const [series] = await query('SELECT id, tmdb_id FROM series WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1', [id]);
    if (!series) return res.status(404).json({ error: 'series not found or no tmdb_id' });

    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbTvMeta } = require('../lib/crons');
    const meta = await fetchTmdbTvMeta(series.tmdb_id, key, lang);
    await dbApi.updateSeriesRow(id, meta);
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tmdb/resync-all', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbMovieMeta, fetchTmdbTvMeta } = require('../lib/crons');

    const movies = await query(`SELECT id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
    const series = await query(`SELECT id, tmdb_id FROM series WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
    let ok = 0, fail = 0;

    for (const m of movies) {
      try {
        const meta = await fetchTmdbMovieMeta(m.tmdb_id, key, lang);
        await dbApi.updateMovie(m.id, meta);
        ok++;
      } catch { fail++; }
    }
    for (const s of series) {
      try {
        const meta = await fetchTmdbTvMeta(s.tmdb_id, key, lang);
        await dbApi.updateSeriesRow(s.id, meta);
        ok++;
      } catch { fail++; }
    }
    res.json({ ok, fail, total: ok + fail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Mass EPG Assignment ──────────────────────────────────────────

router.post('/epg/assign', async (req, res) => {
  return res.status(410).json({
    error: 'Mass EPG assignment is not available in the current admin UI.',
    code: 'EPG_MASS_ASSIGNMENT_REMOVED',
  });
});

router.post('/epg/auto-match', async (req, res) => {
  return res.status(410).json({
    error: 'EPG auto-match is not available in the current admin UI.',
    code: 'EPG_AUTO_MATCH_REMOVED',
  });
});

// ─── VOD Download Block ──────────────────────────────────────────

router.get('/settings/block_vod_download', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const val = await dbApi.getSetting('block_vod_download');
    res.json({ enabled: val === '1' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/block_vod_download', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { enabled } = req.body;
    await dbApi.setSetting('block_vod_download', enabled ? '1' : '0');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Plex Watch Status ────────────────────────────────────────────

router.get('/plex/servers', async (_req, res) => {
  try {
    const rows = await query('SELECT id, name, url, plex_token, last_seen FROM plex_servers ORDER BY last_seen DESC');
    res.json({ servers: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/plex/servers', async (req, res) => {
  try {
    const { name, url, plex_token } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const { insertId } = await execute(
      'INSERT INTO plex_servers (name, url, plex_token, last_seen) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), url=VALUES(url), plex_token=VALUES(plex_token)',
      [name, url, plex_token || '']
    );
    res.json({ ok: true, id: insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/plex/servers/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    await execute('DELETE FROM plex_servers WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/plex/servers/:id/libraries', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [id]);
    if (!server) return res.status(404).json({ error: 'server not found' });

    const headers = { 'Accept': 'application/json' };
    if (server.plex_token) headers['X-Plex-Token'] = server.plex_token;
    const res2 = await require('node-fetch')(`${server.url}/library/sections?X-Plex-Token=${server.plex_token || ''}`, { headers });
    if (!res2.ok) return res.status(502).json({ error: 'Plex server unreachable' });
    const xml = await res2.text();
    // Parse simple XML (Plex returns XML)
    const matches = [...xml.matchAll(/<Directory key="(\d+)" title="([^"]+)"/g)];
    const libs = matches.map(m => ({ key: m[1], title: m[2] }));
    res.json({ libraries: libs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/plex/servers/:id/watch-status', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [id]);
    if (!server) return res.status(404).json({ error: 'server not found' });

    // Get recently watched
    const res2 = await require('node-fetch')(
      `${server.url}/status/sessions?X-Plex-Token=${server.plex_token || ''}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res2.ok) return res.json({ watchers: [] });
    const j = await res2.json();
    const videos = j.MediaContainer?.Video || [];
    const watchers = (Array.isArray(videos) ? videos : [videos]).filter(Boolean).map(v => ({
      title: v.title || '',
      user: v.User?.title || '',
      viewOffset: v.viewOffset || 0,
      duration: v.duration || 0,
    }));
    res.json({ watchers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Telegram Bot Settings ────────────────────────────────────

router.get('/settings/telegram', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const token = await dbApi.getSetting('telegram_bot_token');
    const chatId = await dbApi.getSetting('telegram_admin_chat_id');
    const enabled = await dbApi.getSetting('telegram_alerts_enabled');
    res.json({
      bot_token_set: !!token,
      admin_chat_id: chatId || '',
      alerts_enabled: enabled !== '0',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/telegram', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { bot_token, admin_chat_id, alerts_enabled } = req.body;
    if (bot_token !== undefined) await dbApi.setSetting('telegram_bot_token', bot_token || '');
    if (admin_chat_id !== undefined) await dbApi.setSetting('telegram_admin_chat_id', admin_chat_id || '');
    if (alerts_enabled !== undefined) await dbApi.setSetting('telegram_alerts_enabled', alerts_enabled ? '1' : '0');
    const { stopBot, initBot } = require('../services/telegramBot');
    await stopBot();
    if (bot_token) {
      setTimeout(() => initBot().catch(e => console.error('[TELEGRAM]', e.message)), 2000);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Stream URL Signing (block_vod_download) ────────────────────
// Apply in playback middleware based on setting

module.exports = router;
