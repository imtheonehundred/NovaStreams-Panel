'use strict';
const express = require('express');
const router = express.Router();
const tmdbService = require('../services/tmdbService');

router.post('/tmdb/search', async (req, res) => {
  const { query: q, type } = req.body || {};
  if (!q) return res.status(400).json({ error: 'query required' });
  try {
    const results = type === 'tv' ? await tmdbService.searchTvShows(String(q)) : await tmdbService.searchMovies(String(q));
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message || 'tmdb search failed' }); }
});

router.post('/tmdb/details', async (req, res) => {
  const { tmdb_id, type } = req.body || {};
  if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id required' });
  try {
    const data = type === 'tv' ? await tmdbService.getTvShow(Number(tmdb_id)) : await tmdbService.getMovie(Number(tmdb_id));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message || 'tmdb details failed' }); }
});

router.post('/tmdb/season', async (req, res) => {
  const { tmdb_id, season_number } = req.body || {};
  if (!tmdb_id || season_number === undefined) return res.status(400).json({ error: 'tmdb_id and season_number required' });
  try { res.json(await tmdbService.getSeason(Number(tmdb_id), Number(season_number))); }
  catch (e) { res.status(500).json({ error: e.message || 'tmdb season failed' }); }
});

module.exports = router;
