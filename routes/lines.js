'use strict';

const express = require('express');
const lineService = require('../services/lineService');
const dbApi = require('../lib/db');

const router = express.Router();

function adminAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function parseLineIdParam(param) { const id = parseInt(param, 10); return Number.isNaN(id) ? null : id; }

router.get('/', adminAuth, async (req, res) => {
  const mid = req.query.member_id;
  let memberId;
  if (mid !== undefined && mid !== null && mid !== '') memberId = parseInt(mid, 10);
  const result = await lineService.listAll(memberId);
  const lines = (result.lines || result).map(row => lineService.normalizeLineRow(row));
  res.json({ lines });
});

router.get('/:id', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line) return res.status(404).json({ error: 'not found' });
  res.json({ line: lineService.normalizeLineRow(line) });
});

router.post('/', adminAuth, async (req, res) => {
  const body = req.body || {};
  if (!body.username || !body.password) return res.status(400).json({ error: 'username and password required' });
  try {
    const line = await lineService.createLine(body, body.member_id);
    res.status(201).json({ line: lineService.normalizeLineRow(line) });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/:id', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  try {
    const line = await lineService.update(id, req.body || {});
    res.json({ line: lineService.normalizeLineRow(line) });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/:id', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const ok = await lineService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/:id/connections', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line) return res.status(404).json({ error: 'not found' });
  const connections = await lineService.getActiveConnections(id);
  res.json({ connections });
});

router.post('/:id/ban', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  const line = await lineService.update(id, { admin_enabled: 0 });
  res.json({ line: lineService.normalizeLineRow(line) });
});

router.post('/:id/unban', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  const line = await lineService.update(id, { admin_enabled: 1 });
  res.json({ line: lineService.normalizeLineRow(line) });
});

router.post('/:id/enable', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  const line = await lineService.update(id, { enabled: 1 });
  res.json({ line: lineService.normalizeLineRow(line) });
});

router.post('/:id/disable', adminAuth, async (req, res) => {
  const id = parseLineIdParam(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  const line = await lineService.update(id, { enabled: 0 });
  res.json({ line: lineService.normalizeLineRow(line) });
});

module.exports = router;
