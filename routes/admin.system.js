'use strict';
const express = require('express');
const router = express.Router();
const { channels } = require('../lib/state');
const { query } = require('../lib/mariadb');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function isMovieChannel(ch) {
  return String((ch && ch.channelClass) || 'normal') === 'movie';
}

function isInternalChannel(ch) {
  return !!(ch && ch.is_internal);
}

router.get('/health', async (req, res) => {
  try {
    const {
      isPanelUp,
      hasPanelHealthSample,
      getLastCheckAt,
      getLastResponseMs,
      getLastError,
      getConsecutiveFails,
      getDayStats,
      getUptimeHistory,
    } = require('../services/healthMonitor');
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    const today = await getDayStats();
    const history = await getUptimeHistory(days);
    const hasSample = hasPanelHealthSample();
    res.json({
      status: hasSample ? (isPanelUp() ? 'up' : 'down') : 'unknown',
      lastCheckAt: getLastCheckAt(),
      lastCheckMs: getLastCheckAt(),
      lastResponseMs: getLastResponseMs(),
      lastError: getLastError(),
      consecutiveFails: getConsecutiveFails(),
      today,
      history,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/system-metrics', async (req, res) => {
  try {
    const { collectSystemMetrics } = require('../lib/system-metrics');
    const m = await collectSystemMetrics();
    res.json(m);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/streams/:id/health', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing channel id' });
    const channel = channels.get(id);
    if (!channel) return res.status(404).json({ error: 'channel not found' });
    const {
      checkChannel,
      getChannelHealth,
    } = require('../services/streamRepair');
    const cached = await getChannelHealth(id);
    if (cached && Date.now() - cached.checkedAt < 900000) {
      return res.json({ id, ...cached, source: 'cache' });
    }
    const result = await checkChannel(id, channel);
    return res.json({ id, ...result, source: 'live' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/streams/:id/repair', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing channel id' });
    const channel = channels.get(id);
    if (!channel) return res.status(404).json({ error: 'channel not found' });
    const { checkChannel } = require('../services/streamRepair');
    const result = await checkChannel(id, channel);
    res.json({ id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/streams/repair-all', async (req, res) => {
  try {
    const allChannels = [...channels.values()].filter(
      (c) => !isMovieChannel(c) && !isInternalChannel(c)
    );
    const { checkAllChannels } = require('../services/streamRepair');
    const result = await checkAllChannels(allChannels, channels);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/streams/health-all', async (req, res) => {
  try {
    const allChannels = [...channels.values()].filter(
      (c) => !isMovieChannel(c) && !isInternalChannel(c)
    );
    const { getAllChannelHealth } = require('../services/streamRepair');
    const healthMap = await getAllChannelHealth(allChannels.map((c) => c.id));
    const result = {};
    for (const ch of allChannels) {
      result[ch.id] = healthMap[ch.id] || { status: null, checkedAt: null };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sharing', async (req, res) => {
  try {
    const { getSharingHistory } = require('../services/sharingDetector');
    const { SHARING_UNIQUE_IP_THRESHOLD } = require('../config/constants');
    const now = Math.floor(Date.now() / 1000);
    const rows = await query(
      'SELECT id, username, enabled, UNIX_TIMESTAMP(exp_date) AS exp_date FROM `lines` WHERE admin_enabled = 1'
    );
    const results = [];
    for (const row of rows) {
      const ips = await getSharingHistory(row.id);
      const status =
        Number(row.enabled) !== 1
          ? 'Disabled'
          : row.exp_date && Number(row.exp_date) < now
            ? 'Expired'
            : 'Active';
      results.push({
        userId: row.id,
        username: row.username,
        status,
        uniqueIps: ips.length,
        ips,
        flagged: ips.length >= SHARING_UNIQUE_IP_THRESHOLD,
      });
    }
    results.sort(
      (a, b) =>
        (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || b.uniqueIps - a.uniqueIps
    );
    res.json({ users: results, threshold: SHARING_UNIQUE_IP_THRESHOLD });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sharing/:userId/clear', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId))
      return res.status(400).json({ error: 'invalid user id' });
    const { clearHistory } = require('../services/sharingDetector');
    await clearHistory(userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sharing/scan', async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, username FROM `lines` WHERE admin_enabled = 1'
    );
    const results = [];
    for (const row of rows) {
      const { getSharingHistory } = require('../services/sharingDetector');
      const ips = await getSharingHistory(row.id);
      results.push({
        userId: row.id,
        username: row.username,
        uniqueIps: ips.length,
        flagged: ips.length >= 3,
      });
    }
    results.sort((a, b) => b.uniqueIps - a.uniqueIps);
    res.json({ users: results, scanned: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
