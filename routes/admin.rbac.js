'use strict';
const express = require('express');
const router = express.Router();
const { query, execute } = require('../lib/mariadb');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
