'use strict';

const express = require('express');

module.exports = function(dbApi, requireAuth) {
  const router = express.Router();

  async function resolveRole(userId) {
    const [isAdmin, isReseller] = await Promise.all([
      dbApi.isAdmin(userId),
      dbApi.isReseller(userId),
    ]);
    if (isAdmin) return 'admin';
    if (isReseller) return 'reseller';
    return 'user';
  }

  router.get('/me', async (req, res) => {
    const allowRegister = (await dbApi.userCount()) === 0 || process.env.ALLOW_REGISTER === 'true';
    if (!req.session || !req.session.userId) return res.json({ user: null, allowRegister });
    const u = await dbApi.findUserById(req.session.userId);
    if (!u) { req.session = null; return res.json({ user: null, allowRegister }); }
    const role = await resolveRole(u.id);
    const portalRole = req.session.portalRole || null;
    res.json({ user: { id: u.id, username: u.username, role }, role, portalRole, allowRegister: false });
  });

  router.post('/register', async (req, res) => {
    const allow = (await dbApi.userCount()) === 0 || process.env.ALLOW_REGISTER === 'true';
    if (!allow) return res.status(403).json({ error: 'Registration is disabled.' });
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    if (!u || !password || String(password).length < 8) return res.status(400).json({ error: 'username and password (min 8 characters) required' });
    try {
      const id = await dbApi.createUser(u, String(password));
      req.session.userId = id;
      res.json({ id, username: u });
    } catch (e) {
      if (String(e.message || '').includes('Duplicate') || String(e.message || '').includes('UNIQUE')) return res.status(400).json({ error: 'Username already taken' });
      console.error(e);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    if (!u || !password) return res.status(400).json({ error: 'username and password required' });
    if (!req.session || !req.session.portalRole) return res.status(403).json({ error: 'Access code required in URL before login' });
    const user = await dbApi.findUserByUsername(u);
    if (!user || !(await dbApi.verifyPassword(user, password))) return res.status(401).json({ error: 'Invalid username or password' });
    const role = await resolveRole(user.id);
    if (req.session.portalRole !== role) return res.status(403).json({ error: `This account cannot login from ${req.session.portalRole} portal` });
    req.session.userId = user.id;
    if (req.session.accessCodeId) {
      await dbApi.touchAccessCodeUsage(req.session.accessCodeId);
    }
    res.json({ id: user.id, username: user.username, role, portalRole: req.session.portalRole });
  });

  router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

  router.get('/api-keys', requireAuth, async (req, res) => {
    res.json({ keys: await dbApi.listApiKeys(req.userId) });
  });

  router.post('/api-keys', requireAuth, async (req, res) => {
    const label = (req.body && req.body.label) || 'Extension';
    const { id, plain, keyPrefix } = await dbApi.createApiKey(req.userId, String(label));
    res.json({ id, key: plain, keyPrefix, message: 'Copy this key now; it cannot be shown again.' });
  });

  router.delete('/api-keys/:keyId', requireAuth, async (req, res) => {
    const ok = await dbApi.deleteApiKey(parseInt(req.params.keyId, 10), req.userId);
    if (!ok) return res.status(404).json({ error: 'API key not found' });
    res.json({ ok: true });
  });

  return router;
};
