'use strict';

const express = require('express');
const { query } = require('../lib/mariadb');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/asn/blocked', async (_req, res) => {
  try {
    const asnBlocker = require('../services/asnBlocker');
    const blocked = await asnBlocker.getBlockedAsns();
    res.json({ blocked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/asn/block', async (req, res) => {
  try {
    const { asn, org, notes } = req.body;
    if (!asn) return res.status(400).json({ error: 'asn required' });
    const asnBlocker = require('../services/asnBlocker');
    await asnBlocker.blockAsn(asn, org || '', notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/asn/block/:asn', async (req, res) => {
  try {
    const asnBlocker = require('../services/asnBlocker');
    await asnBlocker.unblockAsn(req.params.asn);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/vpn/settings', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const enabled = await dbApi.getSetting('enable_vpn_detection');
    const blockVpn = await dbApi.getSetting('block_vpn');
    res.json({ enabled: enabled === '1', blockVpn: blockVpn === '1' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/vpn/settings', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { enabled, blockVpn } = req.body;
    if (enabled !== undefined) await dbApi.setSetting('enable_vpn_detection', enabled ? '1' : '0');
    if (blockVpn !== undefined) await dbApi.setSetting('block_vpn', blockVpn ? '1' : '0');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/vpn/log', async (req, res) => {
  try {
    const rows = await query(
      `SELECT le.id, le.user_id, le.ip, le.event_type, le.is_vpn, le.created_at,
              l.username
       FROM login_events le
       LEFT JOIN \`lines\` l ON le.user_id = l.id
       WHERE le.is_vpn = 1
       ORDER BY le.created_at DESC LIMIT 100`
    );
    res.json({ events: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/multilogin', async (_req, res) => {
  try {
    const multiLogin = require('../services/multiLoginDetector');
    const lines = await multiLogin.getMultiLoginLines();
    res.json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/multilogin/settings', async (_req, res) => {
  try {
    const dbApi = require('../lib/db');
    const maxConns = await dbApi.getSetting('max_connections_per_line');
    const enabled = await dbApi.getSetting('enable_multilogin_detection');
    res.json({ enabled: enabled === '1', maxConnections: parseInt(maxConns || '1', 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/multilogin/settings', async (req, res) => {
  try {
    const dbApi = require('../lib/db');
    const { enabled, maxConnections } = req.body;
    if (enabled !== undefined) await dbApi.setSetting('enable_multilogin_detection', enabled ? '1' : '0');
    if (maxConnections !== undefined) await dbApi.setSetting('max_connections_per_line', String(maxConnections));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/multilogin/:lineId/disconnect', async (req, res) => {
  try {
    const lineId = parseIdParam(req.params.lineId);
    if (isNaN(lineId)) return res.status(400).json({ error: 'invalid id' });
    const multiLogin = require('../services/multiLoginDetector');
    await multiLogin.disconnectLine(lineId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function buildVpnasnMiddleware() {
  return async (req, res, next) => {
    if (!req.session || !req.session.lineId) return next();
    try {
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').replace(/^::ffff:/, '');
      const vpnDetect = require('../services/vpnDetector');
      const asnBlocker = require('../services/asnBlocker');
      const dbApi = require('../lib/db');

      const vpnEnabled = await dbApi.getSetting('enable_vpn_detection');
      if (vpnEnabled === '1') {
        const isVpn = await vpnDetect.checkVpnIp(ip);
        await vpnDetect.recordVpnCheck(ip, req.session.lineId, isVpn);
        const blockVpn = await dbApi.getSetting('block_vpn');
        if (isVpn && blockVpn === '1') {
          return res.status(403).json({ error: 'VPN/proxy connections not allowed' });
        }
      }

      const asnData = await asnBlocker.lookupAsn(ip);
      if (asnData && asnData.blocked) {
        return res.status(403).json({ error: 'ASN blocked' });
      }
    } catch (_) {}
    next();
  };
}

module.exports = router;
