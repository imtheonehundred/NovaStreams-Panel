'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const lineService = require('../services/lineService');
const { csrfProtection } = require('../middleware/csrf');

const router = express.Router();

function clearPanelUserSession(req, { preserveGateway = true } = {}) {
  if (!req.session) return;
  req.session.userId = null;
  if (!preserveGateway) {
    req.session.portalRole = null;
    req.session.accessCode = null;
    req.session.accessCodeId = null;
  }
}

async function validateResellerAccessCodeSession(req) {
  const session = req.session || null;
  if (typeof dbApi.getAccessCodeById !== 'function') {
    return session && session.portalRole === 'reseller' ? { id: session.accessCodeId || null, role: 'reseller', enabled: 1 } : null;
  }
  if (!session || !session.accessCodeId || !session.portalRole) {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  const row = await dbApi.getAccessCodeById(session.accessCodeId);
  const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
  if (!row || !enabled || row.role !== 'reseller' || session.portalRole !== 'reseller') {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  if (session.accessCode !== row.code) session.accessCode = row.code;
  return row;
}

async function resellerAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  const accessCode = await validateResellerAccessCodeSession(req);
  if (!accessCode) return res.status(403).json({ error: 'access code invalid' });
  const user = await dbApi.findUserById(req.session.userId);
  if (!user || Number(user.status) !== 1) return res.status(403).json({ error: 'account disabled' });
  const isRes = await dbApi.isReseller(req.session.userId);
  if (!isRes) return res.status(403).json({ error: 'forbidden' });
  req.userId = req.session.userId;
  next();
}
router.use(resellerAuth);
// CSRF protection for state-changing requests (POST/PUT/DELETE/PATCH)
router.use(csrfProtection);

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
  const user = await dbApi.findUserById(userId);
  if (!user) { const err = new Error('user_not_found'); err.code = 'user_not_found'; throw err; }
  const bal = Number(user.credits) || 0;
  if (cost > bal) { const err = new Error('insufficient_credits'); err.code = 'insufficient_credits'; err.required = cost; err.balance = bal; throw err; }
  if (cost > 0) {
    await dbApi.updateUser(userId, { credits: bal - cost });
    await dbApi.addCreditLog(userId, userId, -cost, 'Line created');
  }
  return await lineService.createLine({ ...(body || {}), member_id: userId }, userId);
}

router.get('/lines', async (req, res) => {
  try {
    const result = await lineService.listAll(req.userId);
    const lines = (result.lines || result).map(r => lineService.normalizeLineRow(dbApi.attachLinePassword(r)));
    res.json({ lines });
  } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/lines', async (req, res) => {
  try {
    const line = await createResellerLine(req.userId, req.body || {});
    res.status(201).json(lineService.normalizeLineRow(dbApi.attachLinePassword(line)));
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
    res.json(lineService.normalizeLineRow(dbApi.attachLinePassword(updated)));
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
