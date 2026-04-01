'use strict';

const AUTH_BRUTE_FORCE_PATHS = ['/api/auth/login', '/api/auth/register'];

function buildSessionCookieOptions({ sessionSecret, isProduction }) {
  return {
    name: 'session',
    keys: [sessionSecret || 'dev-insecure-session-secret'],
    maxAge: 7 * 24 * 3600 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: Boolean(isProduction),
    path: '/',
  };
}

module.exports = {
  AUTH_BRUTE_FORCE_PATHS,
  buildSessionCookieOptions,
};
