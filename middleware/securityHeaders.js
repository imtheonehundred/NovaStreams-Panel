'use strict';

const helmet = require('helmet');

/**
 * Security headers middleware.
 * Applies helmet() with strict but compatible settings.
 */
function securityHeaders(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // Additional headers not covered by helmet defaults
  app.use((req, res, next) => {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Force HTTPS (only if behind HTTPS proxy - trust proxy must be set)
    // Disabled by default since most IPTV panels run on internal networks
    // if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    //   res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // }

    // Referrer policy
    res.setHeader('Referrer-Policy', 'same-origin');

    // Permissions policy (disable unnecessary browser features)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // Remove server version header
    res.removeHeader('X-Powered-By');

    next();
  });
}

module.exports = { securityHeaders };
