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
const { getRedisStore } = require('./rateLimiterStores/redisStore');

const useRedisStore = !!(
  process.env.REDIS_HOST && process.env.USE_REDIS_RATE_LIMITER !== 'false'
);

function isDevAuthLimitDisabled() {
  return (
    process.env.NODE_ENV !== 'production' &&
    String(process.env.DEV_DISABLE_AUTH_LIMIT || 'false').toLowerCase() ===
      'true'
  );
}

/**
 * Rate limiting middleware for IPTV Panel endpoints.
 * Uses in-memory store by default; configure Redis store for distributed deployments.
 */

/** Normalize IPv6 addresses to prevent bypass */
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function buildPanelSessionKey(req) {
  const ip = normalizeIp(req.ip) || 'unknown';
  if (!req.session) return ip;
  const userId = req.session.userId ? `u:${req.session.userId}` : null;
  const role = req.session.portalRole ? `r:${req.session.portalRole}` : null;
  const accessCodeId = req.session.accessCodeId
    ? `a:${req.session.accessCodeId}`
    : null;
  const parts = [userId, role, accessCodeId].filter(Boolean);
  return parts.length ? parts.join('|') : ip;
}

function getApiKeyFromRequest(req) {
  return (
    req.headers['x-api-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  );
}

function isLocalhost(req) {
  const ip = normalizeIp(req.ip) || '';
  return ip === '127.0.0.1' || ip === '::1';
}

const baseLimiterConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ipv6SubnetOrKeyGenerator: false, keyGeneratorIpFallback: false },
};

const API_KEY_RATE_WINDOW_MS = 60000;
const API_KEY_RATE_MAX = 100;

const apiKeyLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: API_KEY_RATE_WINDOW_MS,
  max: API_KEY_RATE_MAX,
  keyGenerator: (req) => {
    const k = getApiKeyFromRequest(req);
    if (k && k.length >= 8) return `ak:${k.substring(0, 16)}`;
    return `ak:unknown`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: `API key rate limit exceeded. Try again in ${Math.ceil(API_KEY_RATE_WINDOW_MS / 1000)} seconds.`,
      retryAfter: Math.ceil(API_KEY_RATE_WINDOW_MS / 1000),
    });
  },
  skip: (req) => {
    if (isDevAuthLimitDisabled()) return true;
    return !getApiKeyFromRequest(req);
  },
  store: useRedisStore ? getRedisStore() : undefined,
});

/** Stream endpoints: /live/*, /streams/* /movie/* /series/* - 100 req/min per IP */
const streamLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: STREAM_RATE_WINDOW_MS,
  max: STREAM_RATE_MAX,
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
    return isLocalhost(req);
  },
  store: useRedisStore ? getRedisStore() : undefined,
});

/** Auth endpoints: /api/auth/* - 10 req/5min per IP (anti-brute-force) */
const authLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: AUTH_RATE_WINDOW_MS,
  max: AUTH_RATE_MAX,
  keyGenerator: (req) => {
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
  skip: () => isDevAuthLimitDisabled(),
  store: useRedisStore ? getRedisStore() : undefined,
});

/** Panel API: authenticated panel/admin requests - 200 req/min per session context */
const adminLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: ADMIN_RATE_WINDOW_MS,
  max: ADMIN_RATE_MAX,
  keyGenerator: buildPanelSessionKey,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Panel API rate limit exceeded.',
      retryAfter: Math.ceil(ADMIN_RATE_WINDOW_MS / 1000),
    });
  },
  skip: (req) => {
    return isLocalhost(req) && process.env.ALLOW_LOCAL_NO_RATELIMIT === '1';
  },
  store: useRedisStore ? getRedisStore() : undefined,
});

module.exports = {
  streamLimiter,
  authLimiter,
  adminLimiter,
  apiKeyLimiter,
};
