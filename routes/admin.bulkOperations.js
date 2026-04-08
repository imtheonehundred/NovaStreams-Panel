'use strict';

const express = require('express');
const { execute } = require('../lib/mariadb');
const { invalidateVod, invalidateSeries, invalidateEpisodes } = require('../lib/cache');
const vodService = require('../services/vodService');
const seriesService = require('../services/seriesService');

const router = express.Router();

router.post('/movies/purge-all', async (_req, res) => {
  try {
    await execute('DELETE FROM movies');
    await invalidateVod();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/series/purge-all', async (_req, res) => {
  try {
    await execute('DELETE FROM episodes');
    await execute('DELETE FROM series');
    await invalidateSeries();
    await invalidateEpisodes();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/movies/bulk', async (req, res) => {
  const { movies } = req.body || {};
  if (!Array.isArray(movies)) return res.status(400).json({ error: 'movies array required' });
  let imported = 0;
  let errors = 0;
  for (const row of movies) {
    try {
      await vodService.create(row);
      imported += 1;
    } catch { errors += 1; }
  }
  await invalidateVod();
  res.json({ imported, errors });
});

router.post('/series/bulk', async (req, res) => {
  const { series } = req.body || {};
  if (!Array.isArray(series)) return res.status(400).json({ error: 'series array required' });
  const ids = [];
  let errors = 0;
  for (const row of series) {
    try {
      const id = await seriesService.create(row);
      ids.push(id);
    } catch { errors += 1; }
  }
  await invalidateSeries();
  res.json({ imported: ids.length, ids, errors });
});

router.post('/episodes/bulk', async (req, res) => {
  const { episodes } = req.body || {};
  if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes array required' });
  let imported = 0;
  let errors = 0;
  for (const row of episodes) {
    try {
      await seriesService.addEpisode(row);
      imported += 1;
    } catch { errors += 1; }
  }
  await invalidateEpisodes();
  res.json({ imported, errors });
});

module.exports = router;
