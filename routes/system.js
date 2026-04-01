'use strict';

/**
 * System routes: lightweight health and database helpers.
 * These routes stay smaller than `server.js` and are mounted under `/api`.
 */

const express = require('express');
const { getPool } = require('../lib/mariadb');

const router = express.Router();

/**
 * GET /api/health
 * Basic health check - no auth required.
 */
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/detailed
 * Detailed health check with DB and Redis status.
 * This route is currently mounted without separate auth middleware.
 */
router.get('/health/detailed', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT 1');
    const dbOk = Array.isArray(rows);

    const { getClient } = require('../lib/redis');
    let redisOk = false;
    try {
      const redis = getClient();
      await redis.ping();
      redisOk = true;
    } catch {}

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

/**
 * GET /api/db-status
 * Database connection status.
 */
router.get('/db-status', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, status: 'connected' });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'error', error: e.message });
  }
});

/**
 * GET /api/db-performance
 * Basic DB performance metrics.
 */
router.get('/db-performance', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SHOW GLOBAL STATUS LIKE "Threads_connected"');
    const [vars] = await pool.query('SHOW GLOBAL VARIABLES LIKE "max_connections"');
    res.json({
      threadsConnected: rows[0] ? parseInt(rows[0].Value, 10) : 0,
      maxConnections: vars[0] ? parseInt(vars[0].Value, 10) : 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/db-optimize
 * Run OPTIMIZE TABLE on all tables.
 */
router.post('/db-optimize', async (req, res) => {
  try {
    const pool = getPool();
    const tables = ['channels', 'lines', 'movies', 'series', 'episodes', 'settings'];
    const results = [];
    for (const t of tables) {
      try {
        await pool.query(`OPTIMIZE TABLE \`${t}\``);
        results.push({ table: t, status: 'ok' });
      } catch (e) {
        results.push({ table: t, status: 'error', error: e.message });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/db-repair
 * Run REPAIR TABLE on all tables.
 */
router.post('/db-repair', async (req, res) => {
  try {
    const pool = getPool();
    const tables = ['channels', 'lines', 'movies', 'series', 'episodes', 'settings'];
    const results = [];
    for (const t of tables) {
      try {
        await pool.query(`REPAIR TABLE \`${t}\``);
        results.push({ table: t, status: 'ok' });
      } catch (e) {
        results.push({ table: t, status: 'error', error: e.message });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
