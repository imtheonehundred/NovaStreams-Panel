'use strict';

const rateLimit = require('express-rate-limit');
const {
  STREAM_RATE_WINDOW_MS,
  STREAM_RATE_MAX,
  AUTH_RATE_WINDOW_MS,
  AUTH_RATE_MAX,
  ADMIN_RATE_WINDOW_MS,
  ADMIN_RATE_MAX,
} = require('../config/constants');

/**
 * Rate limiting middleware for IPTV Panel endpoints.
 * Uses in-memory store by default; configure Redis store for distributed deployments.
 */

/** Normalize IPv6 addresses to prevent bypass */
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  // Normalize IPv6-mapped IPv4 (::ffff:192.168.1.1 -> 192.168.1.1)
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function buildPanelSessionKey(req) {
  const ip = normalizeIp(req.ip) || 'unknown';
  if (!req.session) return ip;
  const userId = req.session.userId ? `u:${req.session.userId}` : null;
  const role = req.session.portalRole ? `r:${req.session.portalRole}` : null;
  const accessCodeId = req.session.accessCodeId ? `a:${req.session.accessCodeId}` : null;
  const parts = [userId, role, accessCodeId].filter(Boolean);
  return parts.length ? parts.join('|') : ip;
}

/** Stream endpoints: /live/*, /streams/*, /movie/*, /series/* - 100 req/min per IP */
const streamLimiter = rateLimit({
  windowMs: STREAM_RATE_WINDOW_MS,
  max: STREAM_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return normalizeIp(req.ip) || 'unknown';
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: `Stream rate limit exceeded. Try again in ${Math.ceil(STREAM_RATE_WINDOW_MS / 1000)} seconds.`,
      retryAfter: Math.ceil(STREAM_RATE_WINDOW_MS / 1000),
    });
  },
  skip: (req) => {
    const ip = normalizeIp(req.ip) || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
  // Disable IPv6 validation since we normalize IPs ourselves
  validate: { ipv6SubnetOrKeyGenerator: false, keyGeneratorIpFallback: false },
});

/** Auth endpoints: /api/auth/* - 10 req/5min per IP (anti-brute-force) */
const authLimiter = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  max: AUTH_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combine IP + username to prevent credential stuffing
    const ip = normalizeIp(req.ip) || 'unknown';
    const user = req.body && (req.body.username || req.body.email || '');
    return `${ip}:${user}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Auth rate limit exceeded. Try again later.',
      retryAfter: Math.ceil(AUTH_RATE_WINDOW_MS / 1000),
    });
  },
  validate: { ipv6SubnetOrKeyGenerator: false, keyGeneratorIpFallback: false },
});

/** Panel API: authenticated panel/admin requests - 200 req/min per session context */
const adminLimiter = rateLimit({
  windowMs: ADMIN_RATE_WINDOW_MS,
  max: ADMIN_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: buildPanelSessionKey,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Panel API rate limit exceeded.',
      retryAfter: Math.ceil(ADMIN_RATE_WINDOW_MS / 1000),
    });
  },
  skip: (req) => {
    return !req.session || !req.session.userId;
  },
  validate: { ipv6SubnetOrKeyGenerator: false, keyGeneratorIpFallback: false },
});

module.exports = {
  streamLimiter,
  authLimiter,
  adminLimiter,
};
