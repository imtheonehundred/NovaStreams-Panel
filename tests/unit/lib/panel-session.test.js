'use strict';

const { AUTH_BRUTE_FORCE_PATHS, buildSessionCookieOptions } = require('../../../lib/panel-session');

describe('panel session security helpers', () => {
  it('limits brute-force protection to login-related auth paths', () => {
    expect(AUTH_BRUTE_FORCE_PATHS).toEqual(['/api/auth/login', '/api/auth/register']);
  });

  it('sets secure cookies in production', () => {
    const options = buildSessionCookieOptions({ sessionSecret: 'prod-secret', isProduction: true });

    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.keys).toEqual(['prod-secret']);
  });

  it('keeps non-production cookies non-secure for local development', () => {
    const options = buildSessionCookieOptions({ sessionSecret: '', isProduction: false });

    expect(options.secure).toBe(false);
    expect(options.keys).toEqual(['dev-insecure-session-secret']);
  });
});
