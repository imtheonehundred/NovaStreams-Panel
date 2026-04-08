'use strict';

/**
 * System routes: lightweight health and database helpers.
 * These routes stay smaller than `server.js` and are mounted under `/api`.
 *
 * SECURITY: All routes except basic /health require admin authentication.
 */

const express = require('express');
const dbApi = require('../lib/db');
const { getPool } = require('../lib/mariadb');
const { csrfProtection } = require('../middleware/csrf');
const { createPanelAccess } = require('../lib/panel-access');
const dbService = require('../services/dbService');

const router = express.Router();
const { requireAdminAuth } = createPanelAccess({ dbApi, userActivity: null });

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/detailed', requireAdminAuth, async (req, res) => {
  try {
    const { getClient } = require('../lib/redis');
    let redisOk = false;
    try {
      const redis = getClient();
      await redis.ping();
      redisOk = true;
    } catch {}

    const dbStatus = await dbService.getDatabasePerformance();
    const dbOk = dbStatus && dbStatus.Threads_connected !== undefined;

    const memory = process.memoryUsage();

    res.json({
      ok: dbOk && redisOk,
      uptime: process.uptime(),
      memory: {
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
      },
      db: dbOk ? 'connected' : 'error',
      redis: redisOk ? 'connected' : 'error',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get('/db-status', requireAdminAuth, async (req, res) => {
  try {
    const perf = await dbService.getDatabasePerformance();
    res.json({ ok: true, status: perf ? 'connected' : 'error' });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'error', error: e.message });
  }
});

router.get('/db-performance', requireAdminAuth, async (req, res) => {
  try {
    const perf = await dbService.getDatabasePerformance();
    res.json({
      threadsConnected: perf.Threads_connected || 0,
      maxConnections: 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get(['/db-live', '/system/db-live'], requireAdminAuth, async (_req, res) => {
  try {
    res.json(await dbService.getDatabaseLive());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/db-optimize', requireAdminAuth, csrfProtection, async (req, res) => {
  try {
    const result = await dbService.optimizeDatabase({ source: 'manual' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/db-repair', requireAdminAuth, csrfProtection, async (req, res) => {
  try {
    const result = await dbService.repairDatabase({ source: 'manual' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
