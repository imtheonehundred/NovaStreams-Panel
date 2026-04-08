'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { query } = require('../lib/mariadb');
const { channels } = require('../lib/state');

const router = express.Router();

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

module.exports = router;
