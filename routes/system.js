'use strict';

/**
 * System routes: health check, database status, agent endpoints.
 * These routes are lightweight and don't depend on server.js state.
 */

const express = require('express');
const crypto = require('crypto');
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
 * Requires admin auth.
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
 * GET /api/system/db-status
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
 * GET /api/system/db-performance
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
 * POST /api/system/db-optimize
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
 * POST /api/system/db-repair
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

// ─── Agent routes ─────────────────────────────────────────────────────────

/** In-memory rate limiter for agent heartbeats (can be replaced with Redis) */
const _agentRate = new Map();
const AGENT_RATE_WINDOW_MS = 60000;
const AGENT_RATE_MAX = 60;

function agentRateOk(ip) {
  const now = Date.now();
  let arr = _agentRate.get(ip) || [];
  arr = arr.filter((t) => now - t < AGENT_RATE_WINDOW_MS);
  if (arr.length >= AGENT_RATE_MAX) return false;
  arr.push(now);
  _agentRate.set(ip, arr);
  return true;
}

/**
 * POST /api/agent/heartbeat
 * Remote node agent heartbeat with HMAC-SHA256 signature verification.
 */
router.post('/agent/heartbeat', async (req, res) => {
  const secret = String(process.env.AGENT_SECRET || '').trim();
  if (!secret) return res.status(503).json({ error: 'agent disabled' });

  const sig = String(req.get('x-agent-signature') || '');
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

  const payload = JSON.stringify({
    server_id: body.server_id,
    ts: body.ts,
    cpu: body.cpu,
    mem: body.mem,
    net_mbps: body.net_mbps,
    ping_ms: body.ping_ms,
    version: body.version,
  });

  const expect = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  let sigOk = false;
  try {
    const a = Buffer.from(expect, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length === b.length && a.length > 0) sigOk = crypto.timingSafeEqual(a, b);
  } catch {}

  if (!sigOk) return res.status(401).json({ error: 'invalid signature' });

  const ip = req.ip || req.socket.remoteAddress || '';
  if (!agentRateOk(ip)) {
    return res.status(429).json({ error: 'rate limited' });
  }

  res.json({ ok: true, ts: Date.now() });
});

module.exports = router;
