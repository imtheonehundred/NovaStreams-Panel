'use strict';

const path = require('path');
const pageRegistry = require('../lib/pageRegistry');

const RESERVED_GATEWAY_SEGMENTS = new Set(pageRegistry.RESERVED_GATEWAY_SEGMENTS || []);
const ADMIN_PORTAL_PAGE_SEGMENTS = new Set(pageRegistry.ADMIN_PORTAL_PAGE_SEGMENTS || []);
const RESELLER_PORTAL_PAGE_SEGMENTS = new Set(pageRegistry.RESELLER_PORTAL_PAGE_SEGMENTS || []);

module.exports = function registerPortalRoutes({ app, dbApi, publicDir, syncAccessCodeSession }) {
  function sendPortalShell(res, role) {
    if (role === 'reseller') {
      return res.sendFile(path.join(publicDir, 'reseller.html'));
    }
    if (role === 'user') {
      return res.sendFile(path.join(publicDir, 'client.html'));
    }
    return res.sendFile(path.join(publicDir, 'index.html'));
  }

  async function resolveAccessCodeGatewayRow(req, res, next) {
    const raw = String((req.params && req.params.accessCode) || '').replace(/\/+$/, '').trim();
    const code = raw;
    if (!code || RESERVED_GATEWAY_SEGMENTS.has(code)) {
      if (typeof next === 'function') next();
      return null;
    }
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(code)) {
      res.status(404).end();
      return null;
    }
    try {
      const row = await dbApi.getAccessCodeByCode(code);
      const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
      if (!row || !enabled) {
        res.status(403).type('text/plain').send('Invalid access code.');
        return null;
      }
      syncAccessCodeSession(req, row);
      return row;
    } catch (e) {
      res.status(500).type('text/plain').send(e.message || 'gateway error');
      return null;
    }
  }

  async function serveAccessCodeGateway(req, res, next) {
    const row = await resolveAccessCodeGatewayRow(req, res, next);
    if (!row) return;
    return sendPortalShell(res, row.role);
  }

  async function serveAccessCodePortalSubpage(req, res, next) {
    const page = String((req.params && req.params.page) || '').replace(/\/+$/, '').trim();
    const mayBePortalPage = ADMIN_PORTAL_PAGE_SEGMENTS.has(page) || RESELLER_PORTAL_PAGE_SEGMENTS.has(page);
    if (!mayBePortalPage) return next();

    const row = await resolveAccessCodeGatewayRow(req, res, next);
    if (!row) return;

    if (row.role === 'reseller') {
      if (!RESELLER_PORTAL_PAGE_SEGMENTS.has(page)) return next();
      return sendPortalShell(res, row.role);
    }

    if (!ADMIN_PORTAL_PAGE_SEGMENTS.has(page)) return next();
    return sendPortalShell(res, row.role);
  }

  async function resolveAdminAlias(req, res) {
    const row = await dbApi.getAccessCodeByCode('admin');
    const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
    if (row && enabled && row.role === 'admin') {
      syncAccessCodeSession(req, row);
      return row;
    }
    const allCodes = await dbApi.listAccessCodes();
    const fallback = allCodes.find((code) => {
      const ok = code && (code.enabled === true || code.enabled === 1 || Number(code.enabled) === 1);
      return ok && code.role === 'admin';
    });
    if (fallback) {
      syncAccessCodeSession(req, fallback);
      return fallback;
    }
    res.status(403).type('text/plain').send('Admin access code required. Create one in Access Codes settings.');
    return null;
  }

  async function serveAdminAliasGateway(req, res) {
    const row = await resolveAdminAlias(req, res);
    if (!row) return;
    return sendPortalShell(res, row.role);
  }

  async function serveAdminAliasSubpage(req, res, next) {
    const page = String((req.params && req.params.page) || '').replace(/\/+$/, '').trim();
    if (!ADMIN_PORTAL_PAGE_SEGMENTS.has(page)) return next();
    const row = await resolveAdminAlias(req, res);
    if (!row) return;
    return sendPortalShell(res, row.role);
  }

  app.get('/admin/:page', serveAdminAliasSubpage);
  app.get('/admin', serveAdminAliasGateway);
  app.get('/:accessCode/:page', serveAccessCodePortalSubpage);
  app.get('/:accessCode', serveAccessCodeGateway);
};
