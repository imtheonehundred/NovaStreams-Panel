'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { invalidateBouquets } = require('../lib/cache');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.post('/bouquets/:id/sync', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { type, ids } = req.body || {};
  const b = await dbApi.getBouquetById(id);
  if (!b) return res.status(404).json({ error: 'not found' });
  const field = type === 'movies' ? 'bouquet_movies' : type === 'series' ? 'bouquet_series' : 'bouquet_channels';
  if (!['bouquet_movies', 'bouquet_series', 'bouquet_channels'].includes(field)) {
    return res.status(400).json({ error: 'type must be movies, series, or channels' });
  }
  const parseField = (raw) => {
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(v) ? v.map((x) => String(x)) : [];
    } catch { return []; }
  };
  const cur = parseField(b[field]);
  const set = new Set(cur);
  for (const x of ids || []) set.add(String(x));
  const merged = [...set].map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : x;
  });
  try {
    await dbApi.updateBouquet(id, { [field]: merged });
    await invalidateBouquets();
    res.json({ ok: true, count: merged.length });
  } catch (e) { res.status(400).json({ error: e.message || 'sync failed' }); }
});

module.exports = router;
