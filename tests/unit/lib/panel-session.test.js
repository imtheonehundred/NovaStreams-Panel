'use strict';

const {
  AUTH_BRUTE_FORCE_PATHS,
  SESSION_COOKIE_NAME,
  buildSessionOptions,
  regenerateSession,
} = require('../../../lib/panel-session');

describe('Panel Session Library', () => {
  describe('AUTH_BRUTE_FORCE_PATHS', () => {
    it('should include login path', () => {
      expect(AUTH_BRUTE_FORCE_PATHS).toContain('/api/auth/login');
    });

    it('should include register path', () => {
      expect(AUTH_BRUTE_FORCE_PATHS).toContain('/api/auth/register');
    });
  });

  describe('buildSessionOptions', () => {
    it('should return correct options for development', () => {
      const options = buildSessionOptions({
        sessionSecret: 'dev-secret',
        isProduction: false,
      });

      expect(options.name).toBe(SESSION_COOKIE_NAME);
      expect(options.secret).toBe('dev-secret');
      expect(options.resave).toBe(false);
      expect(options.saveUninitialized).toBe(false);
      expect(options.cookie.maxAge).toBe(7 * 24 * 3600 * 1000);
      expect(options.cookie.sameSite).toBe('lax');
      expect(options.cookie.httpOnly).toBe(true);
      expect(options.cookie.secure).toBe(false);
      expect(options.cookie.path).toBe('/');
    });

    it('should return correct options for production', () => {
      const options = buildSessionOptions({
        sessionSecret: 'prod-secret',
        isProduction: true,
      });

      expect(options.name).toBe(SESSION_COOKIE_NAME);
      expect(options.cookie.maxAge).toBe(7 * 24 * 3600 * 1000);
      expect(options.cookie.sameSite).toBe('lax');
      expect(options.cookie.httpOnly).toBe(true);
      expect(options.cookie.secure).toBe(true);
      expect(options.cookie.path).toBe('/');
    });

    it('should throw error without session secret in any environment', () => {
      expect(() => {
        buildSessionOptions({
          sessionSecret: '',
          isProduction: true,
        });
      }).toThrow('SESSION_SECRET environment variable is required');
    });

    it('should throw error without session secret in development', () => {
      expect(() => {
        buildSessionOptions({
          sessionSecret: undefined,
          isProduction: false,
        });
      }).toThrow('SESSION_SECRET environment variable is required');
    });

    it('should use provided secret when available', () => {
      const options = buildSessionOptions({
        sessionSecret: 'my-secret-key',
        isProduction: false,
      });

      expect(options.secret).toBe('my-secret-key');
    });
  });

  describe('regenerateSession', () => {
    it('regenerates and preserves selected session values', async () => {
      const req = {
        session: {
          portalRole: 'admin',
          accessCodeId: 5,
          csrfSecret: 'csrf-1',
          regenerate(callback) {
            req.session = {
              regenerate: this.regenerate,
            };
            callback(null);
          },
        },
      };

      await regenerateSession(req, {
        preserveKeys: ['portalRole', 'accessCodeId', 'csrfSecret'],
        values: { userId: 42 },
      });

      expect(req.session.portalRole).toBe('admin');
      expect(req.session.accessCodeId).toBe(5);
      expect(req.session.csrfSecret).toBe('csrf-1');
      expect(req.session.userId).toBe(42);
    });

    it('falls back to in-place assignment without regenerate()', async () => {
      const req = { session: { existing: true } };

      await regenerateSession(req, {
        preserveKeys: ['existing'],
        values: { userId: 7 },
      });

      expect(req.session.existing).toBe(true);
      expect(req.session.userId).toBe(7);
    });
  });
});
