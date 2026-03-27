'use strict';

/**
 * Rate limiter tests are integration-level tests.
 * These tests verify the middleware is properly exported and configured.
 * Full rate limit behavior should be tested with supertest + a running Express app.
 */

const { streamLimiter, authLimiter, adminLimiter } = require('../../../middleware/rateLimiter');

describe('rateLimiter middleware', () => {
  describe('streamLimiter', () => {
    it('is a function (express middleware)', () => {
      expect(typeof streamLimiter).toBe('function');
    });

    it('has length >= 3 (standard middleware arity)', () => {
      // Express middleware should accept (req, res, next)
      expect(streamLimiter.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('authLimiter', () => {
    it('is a function (express middleware)', () => {
      expect(typeof authLimiter).toBe('function');
    });

    it('has length >= 3 (standard middleware arity)', () => {
      expect(authLimiter.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('adminLimiter', () => {
    it('is a function (express middleware)', () => {
      expect(typeof adminLimiter).toBe('function');
    });

    it('has length >= 3 (standard middleware arity)', () => {
      expect(adminLimiter.length).toBeGreaterThanOrEqual(3);
    });
  });
});
