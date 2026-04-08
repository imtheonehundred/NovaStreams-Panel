'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');
const { query } = require('../lib/mariadb');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.post('/resync-movie/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

    const [movie] = await query('SELECT id, tmdb_id FROM movies WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1', [id]);
    if (!movie) return res.status(404).json({ error: 'movie not found or no tmdb_id' });

    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbMovieMeta } = require('../lib/crons');
    const meta = await fetchTmdbMovieMeta(movie.tmdb_id, key, lang);
    await dbApi.updateMovie(id, meta);
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/resync-series/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

    const [series] = await query('SELECT id, tmdb_id FROM series WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1', [id]);
    if (!series) return res.status(404).json({ error: 'series not found or no tmdb_id' });

    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbTvMeta } = require('../lib/crons');
    const meta = await fetchTmdbTvMeta(series.tmdb_id, key, lang);
    await dbApi.updateSeriesRow(id, meta);
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/resync-all', async (req, res) => {
  try {
    const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
    if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
    const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
    const { fetchTmdbMovieMeta, fetchTmdbTvMeta } = require('../lib/crons');

    const movies = await query(`SELECT id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
    const series = await query(`SELECT id, tmdb_id FROM series WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
    let ok = 0, fail = 0;

    for (const m of movies) {
      try {
        const meta = await fetchTmdbMovieMeta(m.tmdb_id, key, lang);
        await dbApi.updateMovie(m.id, meta);
        ok++;
      } catch { fail++; }
    }
    for (const s of series) {
      try {
        const meta = await fetchTmdbTvMeta(s.tmdb_id, key, lang);
        await dbApi.updateSeriesRow(s.id, meta);
        ok++;
      } catch { fail++; }
    }
    res.json({ ok, fail, total: ok + fail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
