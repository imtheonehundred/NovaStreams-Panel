'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { query: dbQuery, queryOne: dbQueryOne, execute: dbExec } = require('../lib/mariadb');
const lineService = require('../services/lineService');

const router = express.Router();

async function resellerAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  if (req.session.portalRole && req.session.portalRole !== 'reseller') return res.status(403).json({ error: 'forbidden' });
  const isRes = await dbApi.isReseller(req.session.userId);
  if (!isRes) return res.status(403).json({ error: 'forbidden' });
  req.userId = req.session.userId;
  next();
}
router.use(resellerAuth);

function parseIdParam(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : NaN; }

function packageLineCost(pkg, body) {
  if (!pkg) return 0;
  const explicit = body && body.is_trial !== undefined && body.is_trial !== null;
  const trial = explicit ? !(body.is_trial === 0 || body.is_trial === false || body.is_trial === '0') : pkg.is_trial === 1;
  return trial ? Number(pkg.trial_credits) || 0 : Number(pkg.official_credits) || 0;
}

async function createResellerLine(userId, body) {
  const pkg = body.package_id ? await dbApi.getPackageById(body.package_id) : null;
  const cost = packageLineCost(pkg, body);
  const row = await dbQueryOne('SELECT credits FROM users WHERE id = ?', [userId]);
  if (!row) { const err = new Error('user_not_found'); err.code = 'user_not_found'; throw err; }
  const bal = Number(row.credits) || 0;
  if (cost > bal) { const err = new Error('insufficient_credits'); err.code = 'insufficient_credits'; err.required = cost; err.balance = bal; throw err; }
  if (cost > 0) {
    await dbExec('UPDATE users SET credits = ? WHERE id = ?', [bal - cost, userId]);
    await dbApi.addCreditLog(userId, userId, -cost, 'Line created');
  }
  return await lineService.createLine({ ...(body || {}), member_id: userId }, userId);
}

router.get('/lines', async (req, res) => {
  try {
    const result = await lineService.listAll(req.userId);
    const lines = (result.lines || result).map(r => lineService.normalizeLineRow(r));
    res.json({ lines });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/lines', async (req, res) => {
  try {
    const line = await createResellerLine(req.userId, req.body || {});
    res.status(201).json(lineService.normalizeLineRow(line));
  } catch (e) {
    if (e.code === 'insufficient_credits') return res.status(400).json({ error: 'insufficient_credits', required: e.required, balance: e.balance });
    if (e.code === 'user_not_found') return res.status(404).json({ error: 'not found' });
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.put('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line || line.member_id !== req.userId) return res.status(404).json({ error: 'not found' });
  try {
    const updated = await lineService.update(id, req.body || {});
    res.json(lineService.normalizeLineRow(updated));
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/lines/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const line = await dbApi.getLineById(id);
  if (!line || line.member_id !== req.userId) return res.status(404).json({ error: 'not found' });
  const ok = await lineService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/profile', async (req, res) => {
  const row = await dbApi.findUserById(req.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.get('/credits', async (req, res) => {
  const row = await dbApi.findUserById(req.userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const logs = await dbApi.getCreditLogs(req.userId, limit);
  res.json({ credits: row.credits, username: row.username, logs });
});

router.get('/packages', async (_req, res) => {
  try {
    const packages = await dbApi.listPackages();
    res.json({ packages });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/bouquets', async (_req, res) => {
  try {
    const bouquets = await dbApi.listBouquets();
    res.json({ bouquets: bouquets || [] });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

module.exports = router;
