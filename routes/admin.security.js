'use strict';

const express = require('express');
const dbApi = require('../lib/db');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
