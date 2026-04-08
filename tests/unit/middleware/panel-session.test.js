'use strict';

describe('Panel Session Middleware', () => {
  let buildSessionOptions;
  let SESSION_COOKIE_NAME;

  beforeAll(() => {
    jest.resetModules();
    ({
      buildSessionOptions,
      SESSION_COOKIE_NAME,
    } = require('../../../lib/panel-session'));
  });

  describe('buildSessionOptions', () => {
    it('should create session options with provided secret', () => {
      const opts = buildSessionOptions({
        sessionSecret: 'my-secret-key',
        isProduction: false,
      });

      expect(opts.name).toBe(SESSION_COOKIE_NAME);
      expect(opts.secret).toBe('my-secret-key');
      expect(opts.cookie.maxAge).toBe(7 * 24 * 3600 * 1000);
      expect(opts.cookie.sameSite).toBe('lax');
      expect(opts.cookie.httpOnly).toBe(true);
      expect(opts.cookie.secure).toBe(false);
      expect(opts.cookie.path).toBe('/');
    });

    it('should set secure flag in production', () => {
      const opts = buildSessionOptions({
        sessionSecret: 'prod-secret',
        isProduction: true,
      });

      expect(opts.cookie.secure).toBe(true);
    });

    it('should throw error when no session secret provided', () => {
      expect(() => {
        buildSessionOptions({
          sessionSecret: '',
          isProduction: false,
        });
      }).toThrow('SESSION_SECRET environment variable is required');
    });
  });
});

describe('AUTH_BRUTE_FORCE_PATHS', () => {
  it('should include login and register paths', () => {
    const { AUTH_BRUTE_FORCE_PATHS } = require('../../../lib/panel-session');

    expect(AUTH_BRUTE_FORCE_PATHS).toContain('/api/auth/login');
    expect(AUTH_BRUTE_FORCE_PATHS).toContain('/api/auth/register');
  });
});
