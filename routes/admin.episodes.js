'use strict';
const express = require('express');
const router = express.Router();
const seriesService = require('../services/seriesService');
const dbApi = require('../lib/db');
const { invalidateEpisodes } = require('../lib/cache');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
