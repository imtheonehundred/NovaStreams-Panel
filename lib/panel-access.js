'use strict';

const redis = require('./redis');

const ACCESS_CODE_CACHE_TTL_SECONDS = 60;

function createPanelAccess({ dbApi, userActivity, apiKeyLimiter }) {
  function accessCodeCacheKey(accessCodeId) {
    return `panel:access-code:${accessCodeId}`;
  }

  async function loadAccessCodeRow(accessCodeId) {
    const cacheKey = accessCodeCacheKey(accessCodeId);
    const cached = await redis.cacheGet(cacheKey);
    if (cached && cached.__missing === true) {
      return null;
    }
    if (cached && typeof cached === 'object') {
      return cached;
    }

    const row = await dbApi.getAccessCodeById(accessCodeId);
    if (!row) {
      await redis.cacheSet(
        cacheKey,
        { __missing: true },
        ACCESS_CODE_CACHE_TTL_SECONDS
      );
      return null;
    }

    await redis.cacheSet(cacheKey, row, ACCESS_CODE_CACHE_TTL_SECONDS);
    return row;
  }

  function syncAccessCodeSession(req, row) {
    if (
      req.session &&
      ((req.session.accessCodeId && req.session.accessCodeId !== row.id) ||
        (req.session.portalRole && req.session.portalRole !== row.role))
    ) {
      req.session.userId = null;
    }
    req.session.portalRole = row.role;
    req.session.accessCode = row.code;
    req.session.accessCodeId = row.id;
    req._accessCodeValidated = { accessCodeId: row.id, row };
  }

  function clearPanelUserSession(req, { preserveGateway = true } = {}) {
    if (!req.session) return;
    req._accessCodeValidated = null;
    req.session.userId = null;
    if (!preserveGateway) {
      req.session.portalRole = null;
      req.session.accessCode = null;
      req.session.accessCodeId = null;
    }
  }

  async function validatePanelAccessCodeSession(req, expectedRole = null) {
    const session = req.session || null;
    if (!session || !session.accessCodeId || !session.portalRole) {
      clearPanelUserSession(req, { preserveGateway: false });
      return null;
    }

    let row = null;
    if (
      req._accessCodeValidated &&
      req._accessCodeValidated.accessCodeId === session.accessCodeId
    ) {
      row = req._accessCodeValidated.row;
    } else {
      row = await loadAccessCodeRow(session.accessCodeId);
      req._accessCodeValidated = {
        accessCodeId: session.accessCodeId,
        row,
      };
    }

    const enabled =
      row &&
      (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
    if (
      !row ||
      !enabled ||
      row.role !== session.portalRole ||
      (expectedRole && row.role !== expectedRole)
    ) {
      clearPanelUserSession(req, { preserveGateway: false });
      return null;
    }
    if (session.accessCode !== row.code) session.accessCode = row.code;
    return row;
  }

  function requireAuth(req, res, next) {
    const uid = req.session && req.session.userId;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    validatePanelAccessCodeSession(req)
      .then((accessCode) => {
        if (!accessCode) {
          return res.status(403).json({ error: 'Access code invalid' });
        }
        req.userId = uid;
        if (userActivity && typeof userActivity.set === 'function') {
          userActivity.set(uid, Date.now());
        }
        next();
      })
      .catch(next);
  }

  async function requireAdminAuth(req, res, next) {
    try {
      const uid = req.session && req.session.userId;
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });
      const accessCode = await validatePanelAccessCodeSession(req, 'admin');
      if (!accessCode)
        return res.status(403).json({ error: 'Access code invalid' });
      const isAdmin = await dbApi.isAdmin(uid);
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
      req.userId = uid;
      next();
    } catch (err) {
      next(err);
    }
  }

  async function requireApiKey(req, res, next) {
    try {
      const h = req.headers.authorization || '';
      const k =
        req.headers['x-api-key'] ||
        (typeof h === 'string' && h.startsWith('Bearer ')
          ? h.slice(7).trim()
          : null);
      if (!k) {
        return res.status(401).json({
          error: 'API key required (X-API-Key or Authorization: Bearer)',
        });
      }
      const row = await dbApi.resolveApiKey(k);
      if (!row) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      req.userId = row.user_id;
      next();
    } catch (err) {
      next(err);
    }
  }

  // Compose rate limiting with API key auth: limiter runs first, then auth
  const apiKeyMiddleware = apiKeyLimiter
    ? (req, res, next) => {
        // express-rate-limit calls next() when not rate-limited, or sends 429 directly
        apiKeyLimiter(req, res, () => {
          requireApiKey(req, res, next);
        });
      }
    : requireApiKey;

  return {
    syncAccessCodeSession,
    clearPanelUserSession,
    validatePanelAccessCodeSession,
    requireAuth,
    requireAdminAuth,
    requireApiKey: apiKeyMiddleware,
  };
}

module.exports = {
  createPanelAccess,
};
