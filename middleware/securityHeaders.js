'use strict';

const helmet = require('helmet');

/**
 * Security headers middleware.
 * Applies helmet() with panel-compatible settings.
 */
function securityHeaders(app) {
  app.disable('x-powered-by');
  const isProduction = process.env.NODE_ENV === 'production';

  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'wss:', 'ws:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  };

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: cspDirectives,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isProduction
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    })
  );

  // Additional headers not covered by helmet defaults
  app.use((req, res, next) => {
    // Referrer policy
    res.setHeader('Referrer-Policy', 'same-origin');

    // Permissions policy (disable unnecessary browser features)
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );

    next();
  });
}

module.exports = { securityHeaders };
