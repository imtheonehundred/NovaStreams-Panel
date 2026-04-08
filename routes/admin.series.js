'use strict';
const express = require('express');
const router = express.Router();
const seriesService = require('../services/seriesService');
const dbApi = require('../lib/db');
const { invalidateSeries } = require('../lib/cache');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseLimitOffset(q) {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return { limit, offset };
}

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

module.exports = router;
