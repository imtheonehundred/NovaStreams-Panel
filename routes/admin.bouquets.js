'use strict';
const express = require('express');
const router = express.Router();
const bouquetService = require('../services/bouquetService');
const { invalidateBouquets } = require('../lib/cache');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
