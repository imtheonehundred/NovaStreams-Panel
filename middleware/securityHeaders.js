'use strict';

const helmet = require('helmet');

/**
 * Security headers middleware.
 * Applies helmet() with panel-compatible settings.
 */
function securityHeaders(app) {
  app.disable('x-powered-by');

  app.use(helmet({
    // The admin SPA still relies on inline handlers and websocket upgrades,
    // so Phase 02 mounts compatible hardening instead of a breaking CSP.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: false,
  }));

  // Additional headers not covered by helmet defaults
  app.use((req, res, next) => {
    // Referrer policy
    res.setHeader('Referrer-Policy', 'same-origin');

    // Permissions policy (disable unnecessary browser features)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    const shouldSetHsts = process.env.ENABLE_HSTS === 'true' && (req.secure || req.headers['x-forwarded-proto'] === 'https');
    if (shouldSetHsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  });
}

module.exports = { securityHeaders };
