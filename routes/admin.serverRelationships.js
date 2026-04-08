'use strict';

const express = require('express');
const { query } = require('../lib/mariadb');
const dbApi = require('../lib/db');

const router = express.Router();

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

module.exports = router;
