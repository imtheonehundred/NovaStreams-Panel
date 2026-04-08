'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

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

module.exports = router;
