'use strict';
const express = require('express');
const router = express.Router();
const packageService = require('../services/packageService');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
