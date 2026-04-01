'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const lineService = require('../services/lineService');
const { query, queryOne, execute } = require('../lib/mariadb');
const playlistService = require('../services/playlistService');
const serverService = require('../services/serverService');
const epgService = require('../services/epgService');

const router = express.Router();

// Client auth middleware — authenticate via line username+password or access token
async function clientAuth(req, res, next) {
  // Check Bearer token first
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const line = await queryOne(
        'SELECT id, username, exp_date, enabled, admin_enabled FROM `lines` WHERE access_token = ? LIMIT 1',
        [token]
      );
      if (line && line.enabled === 1 && line.admin_enabled !== 0 && checkExpiry(line.exp_date)) {
        req.session = req.session || {};
        req.session.lineId = line.id;
        req.session.lineUsername = line.username;
        req.session.lineExpDate = line.exp_date;
        return next();
      }
    } catch (_) {}
  }
  // Fall back to session
  if (req.session && req.session.lineId) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function checkExpiry(lineExpDate) {
  if (!lineExpDate || lineExpDate <= 0) return true;
  return lineExpDate > Math.floor(Date.now() / 1000);
}

// GET /client/me
router.get('/me', clientAuth, async (req, res) => {
  try {
    const lineId = req.session.lineId;
    const line = await queryOne(
      `SELECT l.id, l.username, l.exp_date, l.enabled, l.max_connections,
              p.package_name, p.plan_id
       FROM \`lines\` l
       LEFT JOIN packages p ON l.package_id = p.id
       WHERE l.id = ? LIMIT 1`,
      [lineId]
    );
    if (!line) return res.status(404).json({ error: 'line not found' });
    const expired = !checkExpiry(line.exp_date);
    const connCount = await queryOne(
      'SELECT COUNT(DISTINCT user_ip) AS c FROM lines_activity WHERE user_id = ? AND date_end IS NULL',
      [lineId]
    ).catch(() => ({ c: 0 }));

    res.json({
      id: line.id,
      username: line.username,
      exp_date: line.exp_date,
      expired,
      enabled: !!line.enabled,
      max_connections: line.max_connections || 1,
      active_connections: connCount?.c || 0,
      package_name: line.package_name || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /client/password
router.put('/password', clientAuth, async (req, res) => {
  try {
    const lineId = req.session.lineId;
    const lineUsername = req.session.lineUsername;
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'both passwords required' });
    const auth = await lineService.authenticateLine(lineUsername, current_password);
    if (!auth.ok || !auth.line || Number(auth.line.id) !== Number(lineId)) {
      return res.status(403).json({ error: 'current password incorrect' });
    }

    await lineService.update(lineId, { password: new_password });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /client/connections
router.get('/connections', clientAuth, async (req, res) => {
  try {
    const lineId = req.session.lineId;
    const rows = await query(
      `SELECT user_ip AS ip, user_agent, date_start, date_end,
              CASE WHEN date_end IS NULL THEN 1 ELSE 0 END AS active
       FROM lines_activity
       WHERE user_id = ?
       ORDER BY date_start DESC LIMIT 50`,
      [lineId]
    );
    res.json({ connections: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /client/playlist
router.get('/playlist', clientAuth, async (req, res) => {
  try {
    const lineId = req.session.lineId;
    const rawLine = await dbApi.getLineById(lineId);
    if (!rawLine) return res.status(404).json({ error: 'line not found' });
    const line = lineService.normalizeLineRow(dbApi.attachLinePassword(rawLine));

    const requestBase = `${req.protocol || 'http'}://${req.get('host') || 'localhost'}`;
    const defaultBase = await serverService.resolvePlaylistBaseUrl(line, requestBase);
    const m3u = await playlistService.generatePlaylist(line, {
      type: 'm3u_plus',
      output: 'ts',
      baseUrl: defaultBase,
      resolveBaseUrl: (assetSid) => serverService.resolvePlaylistBaseUrl(line, requestBase, assetSid),
      resolveAssetBaseUrl: async (assetType, assetId) => {
        const selected = await serverService.selectServer({ assetType, assetId, line });
        return selected && selected.publicBaseUrl
          ? selected.publicBaseUrl
          : await serverService.resolvePublicStreamOrigin(req, line);
      },
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Content-Disposition', `attachment; filename="${line.username}.m3u"`);
    res.send(m3u);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /client/epg
router.get('/epg', clientAuth, async (req, res) => {
  try {
    const lineId = req.session.lineId;
    const rawLine = await dbApi.getLineById(lineId);
    if (!rawLine) return res.status(404).json({ error: 'line not found' });
    const line = lineService.normalizeLineRow(rawLine);
    const bouquetIds = Array.isArray(line.bouquet) ? line.bouquet : [];
    const xml = await epgService.xmltv(bouquetIds);
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /client/login (access code based)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const auth = await lineService.authenticateLine(username, password);
    if (!auth.ok || !auth.line) return res.status(401).json({ error: 'invalid credentials' });
    const line = auth.line;

    req.session = req.session || {};
    req.session.lineId = line.id;
    req.session.lineUsername = line.username;
    req.session.lineExpDate = line.exp_date;
    req.session.portalRole = 'user';

    const expired = !checkExpiry(line.exp_date);
    res.json({ ok: true, expired, line: { id: line.id, username: line.username } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
