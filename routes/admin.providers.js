'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');
const importService = require('../services/importService');
const { XcApiClient } = require('../services/xcApiClient');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/providers', async (_req, res) => {
  try { res.json({ providers: await dbApi.listImportProviders() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/providers', async (req, res) => {
  try {
    const id = await dbApi.createImportProvider(req.body || {});
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/providers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getImportProviderById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await dbApi.updateImportProvider(id, req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/providers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteImportProvider(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/providers/:id/validate', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const p = await dbApi.getImportProviderById(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const xc = new XcApiClient(p.url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
    await xc.ping();
    res.json({ ok: true, message: 'Connection OK' });
  } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
});

router.post('/providers/validate-preview', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  try {
    const xc = new XcApiClient(url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
    await xc.ping();
    res.json({ ok: true, message: 'Connection OK' });
  } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
});

router.post('/providers/:id/categories', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { type } = req.body || {};
  const p = await dbApi.getImportProviderById(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const xc = new XcApiClient(p.url);
    if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
    let categories = [];
    if (type === 'movies') categories = await xc.getVodCategories();
    else if (type === 'series') categories = await xc.getSeriesCategories();
    else if (type === 'live') categories = await xc.getLiveCategories();
    else return res.status(400).json({ error: 'type must be movies, series, or live' });
    res.json({ categories });
  } catch (e) { res.status(400).json({ error: e.message || 'fetch failed' }); }
});

router.post('/import/movies', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startMovieImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/series', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startSeriesImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/live', async (req, res) => {
  const { provider_id, category_ids } = req.body || {};
  const pid = parseInt(provider_id, 10);
  if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
  try {
    const jobId = importService.startLiveImport(pid, category_ids);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/import/m3u', async (req, res) => {
  const { m3u_text, bouquet_id } = req.body || {};
  if (!m3u_text || typeof m3u_text !== 'string') return res.status(400).json({ error: 'm3u_text required' });
  try {
    const jobId = importService.startM3UImport(m3u_text, bouquet_id || 0);
    res.status(202).json({ job_id: jobId });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.get('/import/jobs/:id', (req, res) => {
  const j = importService.getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'not found' });
  res.json(j);
});

router.post('/import/jobs/:id/cancel', (req, res) => {
  importService.cancelJob(req.params.id);
  res.json({ ok: true });
});

router.get('/movies/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllMovieStreamUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/titles', async (_req, res) => {
  try { res.json({ titles: await dbApi.listAllSeriesTitles() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/episodes/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllEpisodeStreamUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/channels/sources', async (_req, res) => {
  try { res.json({ sources: await dbApi.listAllChannelMpdUrls() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/channels/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllLiveChannelIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

module.exports = router;
