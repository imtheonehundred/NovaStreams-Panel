'use strict';

const csrf = require('csrf');
const { isProduction } = require('../config/constants');

// Create CSRF token generator/validator
const tokens = new csrf();

/**
 * CSRF protection middleware for panel routes.
 *
 * - Skips GET/HEAD/OPTIONS requests (safe methods)
 * - Skips CSRF in test environment (NODE_ENV=test)
 * - Validates CSRF token for state-changing methods (POST/PUT/DELETE/PATCH)
 * - Generates per-session secret on first request and stores token derived from that secret
 * - Provides token to frontend via /api/auth/csrf-token endpoint
 */
function csrfProtection(req, res, next) {
  // Skip CSRF in test environment
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  // Skip safe HTTP methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get the per-session secret, not the token itself
  const csrfSecret = req.session?.csrfSecret;

  if (!csrfSecret) {
    return res.status(403).json({ error: 'CSRF token missing. Refresh the page.' });
  }

  // Get token from header or body
  const providedToken = req.get('X-CSRF-Token') || req.body?._csrf || req.body?.csrfToken;

  if (!providedToken) {
    return res.status(403).json({ error: 'CSRF token required.' });
  }

  // Verify the provided token against the stored secret
  if (!tokens.verify(csrfSecret, providedToken)) {
    return res.status(403).json({ error: 'CSRF token invalid. Refresh the page.' });
  }

  next();
}

/**
 * Endpoint handler to provide CSRF token to frontend.
 * Should be mounted at /api/admin/csrf-token or /api/auth/csrf-token
 */
function getCsrfToken(req, res) {
  // Generate per-session secret if not present
  if (!req.session?.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }

  // Generate a token from the secret
  const csrfToken = tokens.create(req.session.csrfSecret);
  res.json({ csrfToken });
}

module.exports = {
  csrfProtection,
  getCsrfToken,
};
