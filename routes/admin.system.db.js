'use strict';
const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');

router.get('/db-status', async (_req, res) => {
  try { res.json(await dbService.getDatabaseStatus()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/db-performance', async (_req, res) => {
  try { res.json(await dbService.getDatabasePerformance()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.get('/db-live', async (_req, res) => {
  try { res.json(await dbService.getDatabaseLive()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

router.post('/db-optimize', async (_req, res) => {
  try { res.json(await dbService.optimizeDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
});

router.post('/db-repair', async (_req, res) => {
  try { res.json(await dbService.repairDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'repair failed' }); }
});

module.exports = router;
