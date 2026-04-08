'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { query } = require('../lib/mariadb');

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

async function getUserGroupPayload(id) {
  const rows = await query(
    `SELECT g.*, COUNT(u.id) AS member_count
     FROM user_groups g
     LEFT JOIN users u ON u.member_group_id = g.group_id
     WHERE g.group_id = ?
     GROUP BY g.group_id`,
    [id]
  );
  return rows[0] || null;
}

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
      is_reseller: parseBoolInt(body.is_reseller, 0),
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

module.exports = router;
