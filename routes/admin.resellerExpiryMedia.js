'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { queryOne } = require('../lib/mariadb');

const router = express.Router();

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

module.exports = router;
