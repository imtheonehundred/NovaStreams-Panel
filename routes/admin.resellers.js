'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { query, queryOne } = require('../lib/mariadb');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseBoolInt(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1' || value === 1) return 1;
  return 0;
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

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

module.exports = router;
