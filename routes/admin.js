'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { cacheMiddleware, keys, TTL, invalidateVod, invalidateSeries, invalidateCategories, invalidateBouquets, invalidateSettings, invalidateLines, invalidateEpisodes } = require('../lib/cache');
const lineService = require('../services/lineService');
const serverService = require('../services/serverService');
const provisionService = require('../services/provisionService');
const categoryService = require('../services/categoryService');
const bouquetService = require('../services/bouquetService');
const packageService = require('../services/packageService');
const vodService = require('../services/vodService');
const seriesService = require('../services/seriesService');
const epgService = require('../services/epgService');
const tmdbService = require('../services/tmdbService');
const importService = require('../services/importService');
const dbService = require('../services/dbService');
const { XcApiClient } = require('../services/xcApiClient');
const importChannelBridge = require('../lib/importChannelBridge');
const { channels } = require('../lib/state');
const { query, queryOne, execute } = require('../lib/mariadb');
const streamingSettings = require('../lib/streaming-settings');

const router = express.Router();

async function adminAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  if (req.session.portalRole && req.session.portalRole !== 'admin') return res.status(403).json({ error: 'forbidden' });
  try {
    const isAdmin = await dbApi.isAdmin(req.session.userId);
    if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    return next();
  } catch (e) {
    return res.status(500).json({ error: e.message || 'auth failed' });
  }
}
router.use(adminAuth);

router.get('/features', async (_req, res) => {
  try {
    res.json({
      serverProvisioning: await provisionService.isProvisioningEnabled(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseLimitOffset(q) {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return { limit, offset };
}

// ─── Users ──────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try { res.json({ users: await dbApi.getAllUsers() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/user-groups', async (_req, res) => {
  try { res.json({ groups: await dbApi.listUserGroups() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/users', async (req, res) => {
  const { username, password, email, member_group_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const id = await dbApi.createUser(String(username), String(password));
    const patch = {};
    if (email !== undefined) patch.email = String(email);
    if (member_group_id !== undefined) patch.member_group_id = parseInt(member_group_id, 10);
    if (Object.keys(patch).length) await dbApi.updateUser(id, patch);
    res.status(201).json({ id, username: String(username) });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/users/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await dbApi.updateUser(id, req.body || {});
    const row = await dbApi.findUserById(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/users/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteUser(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── Access Codes ────────────────────────────────────────────────────

router.get('/access-codes', async (_req, res) => {
  try { res.json({ codes: await dbApi.listAccessCodes() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/access-codes', async (req, res) => {
  try {
    const id = await dbApi.createAccessCode(req.body || {});
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.put('/access-codes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getAccessCodeById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await dbApi.updateAccessCode(id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'update failed' });
  }
});

router.delete('/access-codes/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.deleteAccessCode(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── System / Database Manager ───────────────────────────────────────

router.get('/system/db-status', async (_req, res) => {
  try { res.json(await dbService.getDatabaseStatus()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/system/db-performance', async (_req, res) => {
  try { res.json(await dbService.getDatabasePerformance()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/system/db-live', async (_req, res) => {
  try { res.json(await dbService.getDatabaseLive()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/system/db-optimize', async (_req, res) => {
  try { res.json(await dbService.optimizeDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
});

router.post('/system/db-repair', async (_req, res) => {
  try { res.json(await dbService.repairDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'repair failed' }); }
});

// ─── Lines ──────────────────────────────────────────────────────────

router.get('/lines', async (req, res) => {
  const mid = req.query.member_id;
  let memberId;
  if (mid !== undefined && mid !== '' && mid !== 'null') {
    memberId = parseInt(mid, 10);
    if (!Number.isFinite(memberId)) return res.status(400).json({ error: 'invalid member_id' });
  }
  try {
    const { limit, offset } = parseLimitOffset(req.query);
    const result = await lineService.listAll(memberId, limit, offset);
    const lines = (result.lines || result).map(r => lineService.normalizeLineRow(r));
    res.json({ lines, total: result.total || lines.length });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/lines/:id/connections', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line) return res.status(404).json({ error: 'not found' });
  const connections = await lineService.getActiveConnections(id);
  res.json({ connections });
});

router.post('/lines/:id/ban', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  await lineService.update(id, { admin_enabled: 0 });
  await invalidateLines();
  res.json({ ok: true, id, admin_enabled: 0 });
});

router.post('/lines/:id/unban', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  await lineService.update(id, { admin_enabled: 1 });
  await invalidateLines();
  res.json({ ok: true, id, admin_enabled: 1 });
});

router.get('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const row = await dbApi.getLineById(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(lineService.normalizeLineRow(row));
});

router.post('/lines', async (req, res) => {
  try {
    const line = await lineService.createLine(req.body || {});
    await invalidateLines();
    res.status(201).json(lineService.normalizeLineRow(line));
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await dbApi.getLineById(id))) return res.status(404).json({ error: 'not found' });
  try {
    const line = await lineService.update(id, req.body || {});
    await invalidateLines();
    res.json(lineService.normalizeLineRow(line));
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await lineService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateLines();
  res.json({ ok: true });
});

// ─── Categories ─────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  try { res.json({ categories: await categoryService.listCategories(type) }); }
  catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/categories', async (req, res) => {
  try {
    const id = await categoryService.create(req.body || {});
    await invalidateCategories();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await categoryService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await categoryService.update(id, req.body || {});
    await invalidateCategories();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await categoryService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateCategories();
  res.json({ ok: true });
});

router.post('/categories/find-or-create', async (req, res) => {
  const { category_name, category_type } = req.body || {};
  if (!category_name || !category_type) return res.status(400).json({ error: 'category_name and category_type required' });
  try {
    const id = await importService.findOrCreateCategory(String(category_name), String(category_type), null);
    await invalidateCategories();
    res.json({ id, category_name: String(category_name) });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

// ─── Import providers & Xtream import ───────────────────────────────

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

router.get('/movies/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllMovieIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/ids', async (_req, res) => {
  try { res.json({ ids: await dbApi.listAllSeriesIds() }); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/series/lookup', async (_req, res) => {
  try {
    const rows = await query('SELECT id, title, category_id FROM series');
    const lookup = {};
    for (const r of rows) {
      lookup[`${r.title}||${String(r.category_id || '')}`] = r.id;
    }
    res.json(lookup);
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/channels/import-live', async (req, res) => {
  const body = req.body || {};
  const url = body.url || body.mpdUrl;
  if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
  try {
    const userId = await dbApi.getFirstAdminUserId();
    if (!userId) return res.status(500).json({ error: 'no admin user' });
    const { detectInputType } = require('../lib/input-detect');
    const inputType = body.inputType || detectInputType(url);
    const created = await importChannelBridge.importLiveChannel({
      name: body.name || 'Live',
      mpdUrl: url,
      inputType,
      category_id: body.category_id != null ? parseInt(body.category_id, 10) : undefined,
      logoUrl: body.logo || body.logoUrl || '',
      epgChannelId: body.epg_channel_id || body.epgChannelId || '',
    }, userId);
    res.status(201).json(created);
  } catch (e) { res.status(e.statusCode || 400).json({ error: e.message || 'failed' }); }
});

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

// ─── Bouquets ───────────────────────────────────────────────────────

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

// ─── Packages ───────────────────────────────────────────────────────

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

// ─── Movies ─────────────────────────────────────────────────────────

router.get('/movies', async (req, res) => {
  const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
  const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
  const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
  const { limit, offset } = parseLimitOffset(req.query);
  try {
    const result = await vodService.listItems(categoryId, limit, offset, search, sortOrder);
    res.json({ movies: result.movies, total: result.total, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const movie = await vodService.getById(id);
  if (!movie) return res.status(404).json({ error: 'not found' });
  res.json(movie);
});

router.post('/movies', async (req, res) => {
  try {
    const id = await vodService.create(req.body || {});
    await invalidateVod();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await vodService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await vodService.update(id, req.body || {});
    await invalidateVod();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/movies/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await vodService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateVod();
  res.json({ ok: true });
});

// ─── Series ─────────────────────────────────────────────────────────

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

// ─── Episodes ───────────────────────────────────────────────────────

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

// ─── EPG ────────────────────────────────────────────────────────────

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

// ─── Streaming servers / LB ─────────────────────────────────────────
// Static paths must be registered before `/servers/:id` (numeric id routes).

router.get('/servers', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers', async (req, res) => {
  try {
    const s = await serverService.createServer(req.body || {});
    res.status(201).json(s);
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.get('/servers/nginx-export', async (_req, res) => {
  try {
    const snippet = await serverService.buildNginxUpstreamSnippet();
    res.json({ snippet });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/provision', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const b = req.body || {};
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host') || '';
    const panelUrl = String(b.panel_url || process.env.PANEL_PUBLIC_URL || `${proto}://${host}`).replace(/\/+$/, '');
    const job = await provisionService.startProvisionJob({
      ...b,
      panel_url: panelUrl,
      userId: req.session && req.session.userId,
    });
    res.status(201).json(job);
  } catch (e) {
    res.status(400).json({ error: e.message || 'provision failed' });
  }
});

router.get('/servers/provision/:jobId', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const job = await provisionService.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({
      id: job.id,
      status: job.status,
      log: job.log || '',
      error: job.error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/servers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const s = await serverService.getServer(id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/servers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const s = await serverService.updateServer(id, req.body || {});
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: e.message || 'update failed' });
  }
});

router.delete('/servers/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const ok = await serverService.deleteServer(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

// ─── Settings ───────────────────────────────────────────────────────

router.get('/settings', async (_req, res) => {
  res.json(await dbApi.getAllSettings());
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'object body required' });
  for (const [k, v] of Object.entries(body)) await dbApi.setSetting(k, v);
  await invalidateSettings();
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
  } catch (e) {
    console.error('[settings] refresh streaming:', e.message);
  }
  res.json(await dbApi.getAllSettings());
});

router.get('/settings/streaming-performance', async (_req, res) => {
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/settings/streaming-performance', async (req, res) => {
  try {
    const b = req.body || {};
    const K = streamingSettings.KEYS;
    const boolStr = (v) =>
      v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes' ? '1' : '0';
    if (b.prebuffer_enabled !== undefined) await dbApi.setSetting(K.prebuffer_enabled, boolStr(b.prebuffer_enabled));
    if (b.prebuffer_size_mb !== undefined) {
      const n = parseFloat(b.prebuffer_size_mb, 10);
      if (!Number.isFinite(n) || n < 1 || n > 16) {
        return res.status(400).json({ error: 'prebuffer_size_mb must be 1–16' });
      }
      await dbApi.setSetting(K.prebuffer_size_mb, String(n));
    }
    if (b.prebuffer_on_demand_min_bytes !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_min_bytes, 10);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'invalid prebuffer_on_demand_min_bytes' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_min_bytes, String(n));
    }
    if (b.prebuffer_on_demand_max_wait_ms !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_max_wait_ms, 10);
      if (!Number.isFinite(n) || n < 100 || n > 60000) {
        return res.status(400).json({ error: 'prebuffer_on_demand_max_wait_ms must be 100–60000' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_max_wait_ms, String(n));
    }
    if (b.ingest_style !== undefined) {
      const s = String(b.ingest_style || '').trim().toLowerCase();
      if (!['webapp', 'xc', 'safe'].includes(s)) {
        return res.status(400).json({ error: 'ingest_style must be webapp, xc, or safe' });
      }
      await dbApi.setSetting(K.ingest_style, s);
    }
    if (b.low_latency_enabled !== undefined) await dbApi.setSetting(K.low_latency_enabled, boolStr(b.low_latency_enabled));
    if (b.minimal_ingest_enabled !== undefined) {
      await dbApi.setSetting(K.minimal_ingest_enabled, boolStr(b.minimal_ingest_enabled));
    }
    if (b.prewarm_enabled !== undefined) await dbApi.setSetting(K.prewarm_enabled, boolStr(b.prewarm_enabled));
    if (b.streaming_provisioning_enabled !== undefined) {
      await dbApi.setSetting(
        provisionService.STREAMING_PROVISIONING_KEY,
        boolStr(b.streaming_provisioning_enabled)
      );
    }
    await streamingSettings.refreshStreamingSettings(dbApi);
    await invalidateSettings();
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

// ─── Resellers ──────────────────────────────────────────────────────

router.get('/resellers', async (_req, res) => {
  const resellers = await query(
    `SELECT u.id, u.username, u.email, u.member_group_id, u.credits, u.status, u.owner_id, u.created_at
     FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE g.is_reseller = 1 ORDER BY u.id`
  );
  res.json({ resellers });
});

router.post('/resellers', async (req, res) => {
  const { username, password, email, credits, member_group_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const gidRow = member_group_id !== undefined ? { group_id: parseInt(member_group_id, 10) }
    : await queryOne('SELECT group_id FROM user_groups WHERE is_reseller = 1 ORDER BY group_id LIMIT 1');
  if (!gidRow || !Number.isFinite(gidRow.group_id)) return res.status(500).json({ error: 'reseller group not configured' });
  try {
    const id = await dbApi.createUser(String(username), String(password));
    const patch = { member_group_id: gidRow.group_id };
    if (email !== undefined) patch.email = String(email);
    if (credits !== undefined) patch.credits = Number(credits);
    await dbApi.updateUser(id, patch);
    const row = await dbApi.findUserById(id);
    res.status(201).json(row);
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/resellers/:id/credits', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const { credits, reason } = req.body || {};
  if (credits === undefined || credits === null) return res.status(400).json({ error: 'credits required' });
  const user = await dbApi.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not found' });
  const newBal = Number(credits);
  if (!Number.isFinite(newBal)) return res.status(400).json({ error: 'invalid credits' });
  const delta = newBal - (Number(user.credits) || 0);
  await dbApi.updateUser(id, { credits: newBal });
  await dbApi.addCreditLog(id, req.session.userId, delta, reason != null ? String(reason) : '');
  res.json({ id, credits: newBal });
});

// ─── Logs / Activity / Channels ─────────────────────────────────────

router.get('/logs', async (req, res) => {
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
  res.json({ logs: await dbApi.getPanelLogs(limit) });
});

router.get('/activity', async (req, res) => {
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const rows = await query('SELECT * FROM lines_activity ORDER BY activity_id DESC LIMIT ?', [limit]);
  res.json({ activity: rows });
});

router.get('/channels', (_req, res) => {
  const list = [];
  channels.forEach((ch, id) => list.push({ id, name: ch.name, status: ch.status }));
  res.json(list);
});

// ─── Security ───────────────────────────────────────────────────────

router.get('/security/blocked-ips', async (_req, res) => { res.json({ items: await dbApi.listBlockedIps() }); });
router.post('/security/blocked-ips', async (req, res) => {
  const { ip, notes } = req.body || {};
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'ip required' });
  const rid = await dbApi.addBlockedIp(String(ip).trim(), notes != null ? String(notes) : '');
  res.status(201).json({ id: rid || undefined, ok: true });
});
router.delete('/security/blocked-ips/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.removeBlockedIp(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/security/blocked-uas', async (_req, res) => { res.json({ items: await dbApi.listBlockedUas() }); });
router.post('/security/blocked-uas', async (req, res) => {
  const { user_agent, notes } = req.body || {};
  if (!user_agent || typeof user_agent !== 'string') return res.status(400).json({ error: 'user_agent required' });
  const id = await dbApi.addBlockedUa(String(user_agent), notes != null ? String(notes) : '');
  res.status(201).json({ id });
});
router.delete('/security/blocked-uas/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await dbApi.removeBlockedUa(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ─── TMDb Proxy ─────────────────────────────────────────────────────

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

// ─── M3U Import helpers ─────────────────────────────────────────────

function parseM3UEntries(text) {
  const lines = String(text).split('\n');
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown', group: groupMatch ? groupMatch[1] : '', logo: logoMatch ? logoMatch[1] : '' };
    } else if (current && line && !line.startsWith('#')) {
      current.url = line;
      entries.push(current);
      current = null;
    }
  }
  return entries;
}

router.post('/movies/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const entry of entries) {
      const movieData = {
        name: entry.name, stream_url: entry.url, stream_source: entry.url,
        category_id: category_id || '', stream_icon: entry.logo || '',
        container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchMovies(entry.name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getMovie(tmdbResults[0].id);
            Object.assign(movieData, {
              name: details.name || movieData.name, stream_icon: details.movie_image || movieData.stream_icon,
              backdrop_path: details.backdrop_path || '', plot: details.plot || '',
              movie_cast: details.cast || '', director: details.director || '', genre: details.genre || '',
              rating: String(details.rating || '0'), rating_5based: Math.round((details.rating || 0) / 2 * 10) / 10,
              year: details.year, tmdb_id: details.tmdb_id, duration: details.duration || '',
              duration_secs: details.duration_secs || 0, release_date: details.release_date || '',
              youtube_trailer: details.youtube_trailer || '', country: details.country || '',
              movie_properties: details,
            });
          }
        } catch {}
      }
      const id = await vodService.create(movieData);
      results.push({ id, name: movieData.name });
    }
    await invalidateVod();
    res.json({ imported: results.length, movies: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

router.post('/series/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const seriesMap = new Map();
    for (const entry of entries) {
      const seMatch = entry.name.match(/^(.+?)\s*[Ss](\d+)\s*[Ee](\d+)/);
      const seriesName = seMatch ? seMatch[1].trim() : entry.group || entry.name;
      const season = seMatch ? parseInt(seMatch[2]) : 1;
      const episode = seMatch ? parseInt(seMatch[3]) : 1;
      if (!seriesMap.has(seriesName)) seriesMap.set(seriesName, { name: seriesName, logo: entry.logo, episodes: [] });
      seriesMap.get(seriesName).episodes.push({
        season_num: season, episode_num: episode, title: entry.name,
        stream_url: entry.url, container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      });
    }
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const [name, data] of seriesMap) {
      const seriesData = { title: name, category_id: category_id || '', cover: data.logo || '' };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchTvShows(name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getTvShow(tmdbResults[0].id);
            Object.assign(seriesData, {
              title: details.title || seriesData.title, cover: details.cover || seriesData.cover,
              cover_big: details.cover_big || '', backdrop_path: details.backdrop_path || '',
              plot: details.plot || '', series_cast: details.cast || '', director: details.director || '',
              genre: details.genre || '', rating: String(details.rating || '0'),
              rating_5based: details.rating_5based || 0, year: details.year, tmdb_id: details.tmdb_id,
              youtube_trailer: details.youtube_trailer || '', episode_run_time: details.episode_run_time || 0,
              seasons: details.seasons || [],
            });
          }
        } catch {}
      }
      const seriesId = await seriesService.create(seriesData);
      for (const ep of data.episodes) await seriesService.addEpisode({ ...ep, series_id: seriesId });
      results.push({ id: seriesId, name: seriesData.title, episodes: data.episodes.length });
    }
    await invalidateSeries();
    res.json({ imported: results.length, series: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

// ─── Dashboard Stats ────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const si = require('systeminformation');
    const [cpu, mem, disk, net] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(),
    ]);
    const nowTs = Math.floor(Date.now() / 1000);
    const [activeRow, totalChRow] = await Promise.all([
      queryOne('SELECT COUNT(*) AS c FROM `lines` WHERE admin_enabled = 1 AND exp_date > ?', [nowTs]),
      queryOne('SELECT COUNT(*) AS c FROM `channels`'),
    ]);
    const movieCountVal = await dbApi.movieCount();
    const seriesCountVal = await dbApi.seriesCount();
    const runningCount = channels ? [...channels.values()].filter(c => c.status === 'running').length : 0;
    const totalNetIn = net.reduce((a, n) => a + (n.rx_sec || 0), 0) / 1024;
    const totalNetOut = net.reduce((a, n) => a + (n.tx_sec || 0), 0) / 1024;
    res.json({
      activeLines: activeRow ? activeRow.c : 0,
      connections: processes ? processes.size : 0,
      liveStreams: runningCount,
      channelsCount: totalChRow ? totalChRow.c : (channels ? channels.size : 0),
      movieCount: movieCountVal,
      seriesCount: seriesCountVal,
      cpu: Math.round(cpu.currentLoad || 0),
      memUsed: mem.used, memTotal: mem.total, memPercent: Math.round((mem.used / mem.total) * 100),
      diskUsed: disk[0] ? disk[0].used : 0, diskTotal: disk[0] ? disk[0].size : 0,
      diskPercent: disk[0] ? Math.round(disk[0].use) : 0,
      netIn: parseFloat(totalNetIn.toFixed(1)),
      netOut: parseFloat(totalNetOut.toFixed(1)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
