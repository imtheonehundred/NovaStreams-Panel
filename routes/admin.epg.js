'use strict';
const express = require('express');
const router = express.Router();
const epgService = require('../services/epgService');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/epg/sources', async (_req, res) => {
  res.json({ sources: await epgService.listSources() });
});

router.post('/epg/sources', async (req, res) => {
  const { name, url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  try {
    const id = await epgService.addSource(name != null ? String(name) : '', String(url));
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.delete('/epg/sources/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await epgService.removeSource(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/epg/refresh', async (req, res) => {
  try { res.json(await epgService.refreshAllSources()); }
  catch (e) { res.status(500).json({ error: e.message || 'refresh failed' }); }
});

module.exports = router;
