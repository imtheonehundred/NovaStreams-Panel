'use strict';

const express = require('express');
const { csrfProtection, getCsrfToken } = require('../middleware/csrf');
const { regenerateSession } = require('../lib/panel-session');
const auditService = require('../services/auditService');
const { error: logError } = require('../services/logger');

module.exports = function (dbApi, requireAuth) {
  const router = express.Router();

  // CSRF token endpoint - provides token to authenticated users
  router.get('/csrf-token', (req, res) => {
    // Require at least a session from access-code gateway
    if (!req.session || !req.session.portalRole || !req.session.accessCodeId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return getCsrfToken(req, res);
  });

  function clearPanelUserSession(req, { preserveGateway = true } = {}) {
    if (!req.session) return;
    req.session.userId = null;
    if (!preserveGateway) {
      req.session.portalRole = null;
      req.session.accessCode = null;
      req.session.accessCodeId = null;
    }
  }

  async function getActivePortalAccessCode(req) {
    const session = req.session || null;
    if (!session || !session.portalRole || !session.accessCodeId) return null;
    if (typeof dbApi.getAccessCodeById !== 'function') {
      return { id: session.accessCodeId, role: session.portalRole, enabled: 1 };
    }
    const row = await dbApi.getAccessCodeById(session.accessCodeId);
    const enabled =
      row &&
      (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
    if (!row || !enabled || row.role !== session.portalRole) {
      clearPanelUserSession(req, { preserveGateway: false });
      return null;
    }
    return row;
  }

  async function resolveRole(userId) {
    const [isAdmin, isReseller] = await Promise.all([
      dbApi.isAdmin(userId),
      dbApi.isReseller(userId),
    ]);
    if (isAdmin) return 'admin';
    if (isReseller) return 'reseller';
    return 'user';
  }

  async function establishAuthenticatedSession(req, userId) {
    await regenerateSession(req, {
      preserveKeys: ['portalRole', 'accessCode', 'accessCodeId', 'csrfSecret'],
      values: { userId },
    });
  }

  router.get('/me', async (req, res) => {
    const allowRegister =
      (await dbApi.userCount()) === 0 || process.env.ALLOW_REGISTER === 'true';
    if (!req.session || !req.session.userId)
      return res.json({ user: null, allowRegister });
    const accessCode = await getActivePortalAccessCode(req);
    if (!accessCode) return res.json({ user: null, allowRegister });
    const u = await dbApi.findUserById(req.session.userId);
    if (!u) {
      clearPanelUserSession(req);
      return res.json({ user: null, allowRegister });
    }
    if (Number(u.status) !== 1) {
      clearPanelUserSession(req);
      return res.json({ user: null, allowRegister });
    }
    const role = await resolveRole(u.id);
    if (role !== accessCode.role) {
      clearPanelUserSession(req);
      return res.json({ user: null, allowRegister });
    }
    const portalRole = req.session.portalRole || null;
    res.json({
      user: { id: u.id, username: u.username, role },
      role,
      portalRole,
      allowRegister: false,
    });
  });

  router.post('/register', csrfProtection, async (req, res) => {
    const allow =
      (await dbApi.userCount()) === 0 || process.env.ALLOW_REGISTER === 'true';
    if (!allow)
      return res.status(403).json({ error: 'Registration is disabled.' });
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    if (!u || !password || String(password).length < 8)
      return res
        .status(400)
        .json({ error: 'username and password (min 8 characters) required' });
    try {
      const id = await dbApi.createUser(u, String(password));
      await establishAuthenticatedSession(req, id);
      res.json({ id, username: u });
    } catch (e) {
      if (
        String(e.message || '').includes('Duplicate') ||
        String(e.message || '').includes('UNIQUE')
      )
        return res.status(400).json({ error: 'Username already taken' });
      console.error(e);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.post('/login', csrfProtection, async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const u = String(username || '').trim();
      if (!u || !password)
        return res
          .status(400)
          .json({ error: 'username and password required' });
      const accessCode = await getActivePortalAccessCode(req);
      if (!accessCode)
        return res
          .status(403)
          .json({ error: 'Access code required in URL before login' });
      const user = await dbApi.findUserByUsername(u);
      if (!user || !(await dbApi.verifyPassword(user, password)))
        return res.status(401).json({ error: 'Invalid username or password' });
      if (Number(user.status) !== 1)
        return res.status(403).json({ error: 'Account disabled' });
      const role = await resolveRole(user.id);
      if (accessCode.role !== role)
        return res.status(403).json({
          error: `This account cannot login from ${accessCode.role} portal`,
        });

      await establishAuthenticatedSession(req, user.id);
      await dbApi.touchUserLastLogin(user.id);
      if (accessCode.id && typeof dbApi.touchAccessCodeUsage === 'function') {
        await dbApi.touchAccessCodeUsage(accessCode.id);
      }
      await auditService.log(
        user.id,
        'auth.login',
        'user',
        user.id,
        { username: user.username, portalRole: accessCode.role },
        req
      );
      res.json({
        id: user.id,
        username: user.username,
        role,
        portalRole: accessCode.role,
      });
    } catch (e) {
      logError('auth_login_failed', {
        error: e.message,
        username: req.body?.username,
      });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/logout', csrfProtection, (req, res) => {
    const userId =
      req.session && req.session.userId ? req.session.userId : null;
    auditService
      .log(userId, 'auth.logout', 'user', userId, {}, req)
      .catch(() => {});
    clearPanelUserSession(req, { preserveGateway: true });
    res.json({
      ok: true,
      portalRole:
        req.session && req.session.portalRole ? req.session.portalRole : null,
    });
  });

  router.get('/api-keys', requireAuth, async (req, res) => {
    res.json({ keys: await dbApi.listApiKeys(req.userId) });
  });

  router.post('/api-keys', requireAuth, csrfProtection, async (req, res) => {
    const label = (req.body && req.body.label) || 'Extension';
    const { id, plain, keyPrefix } = await dbApi.createApiKey(
      req.userId,
      String(label)
    );
    res.json({
      id,
      key: plain,
      keyPrefix,
      message: 'Copy this key now; it cannot be shown again.',
    });
  });

  router.delete(
    '/api-keys/:keyId',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const ok = await dbApi.deleteApiKey(
        parseInt(req.params.keyId, 10),
        req.userId
      );
      if (!ok) return res.status(404).json({ error: 'API key not found' });
      res.json({ ok: true });
    }
  );

  return router;
};
