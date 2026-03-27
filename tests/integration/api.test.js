'use strict';

/**
 * Integration tests for IPTV Panel API endpoints.
 * Uses supertest to make HTTP requests against an Express app.
 * These tests verify the middleware and route integration.
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before importing modules
jest.mock('../../lib/mariadb', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn().mockResolvedValue([[{ '1': 1 }]]),
    getConnection: jest.fn(),
  })),
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../lib/redis', () => ({
  getClient: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    scan: jest.fn().mockResolvedValue(['0', []]),
    connect: jest.fn(),
    quit: jest.fn(),
    zadd: jest.fn().mockResolvedValue(1),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zrange: jest.fn().mockResolvedValue([]),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
  })),
  connect: jest.fn().mockResolvedValue(true),
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  cacheDel: jest.fn(),
  cacheInvalidate: jest.fn(),
  disconnect: jest.fn(),
}));

// Build a minimal app for testing routes
function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Mount system routes
  const systemRoutes = require('../../routes/system');
  app.use('/api', systemRoutes);

  return app;
}

describe('API Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = buildTestApp();
  });

  describe('GET /api/health', () => {
    it('returns 200 with ok=true and uptime', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.uptime).toBeGreaterThan(0);
    });

    it('returns JSON content type', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });

  describe('GET /api/db-status', () => {
    it('returns 200 when database is connected', async () => {
      const res = await request(app).get('/api/db-status');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/db-performance', () => {
    it('returns performance metrics', async () => {
      const res = await request(app).get('/api/db-performance');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('threadsConnected');
      expect(res.body).toHaveProperty('maxConnections');
    });
  });

  describe('Rate Limiting', () => {
    const { authLimiter, adminLimiter } = require('../../middleware/rateLimiter');

    it('authLimiter is a function', () => {
      expect(typeof authLimiter).toBe('function');
    });

    it('adminLimiter is a function', () => {
      expect(typeof adminLimiter).toBe('function');
    });
  });

  describe('Validation Middleware', () => {
    const { schemas } = require('../../middleware/validation');

    it('channelId schema accepts valid 8-char hex', () => {
      const { error } = schemas.channelId.validate('a1b2c3d4');
      expect(error).toBeUndefined();
    });

    it('channelId schema rejects invalid IDs', () => {
      const { error } = schemas.channelId.validate('invalid');
      expect(error).toBeDefined();
    });

    it('pagination schema applies defaults', () => {
      const { value } = schemas.pagination.validate({});
      expect(value.limit).toBe(50);
      expect(value.offset).toBe(0);
    });
  });

  describe('Constants', () => {
    const C = require('../../config/constants');

    it('contains all expected keys', () => {
      expect(C).toHaveProperty('DEFAULT_PORT');
      expect(C).toHaveProperty('SESSION_MAX_AGE_MS');
      expect(C).toHaveProperty('CHANNEL_ID_REGEX');
      expect(C).toHaveProperty('DB_CONNECTION_LIMIT');
      expect(C).toHaveProperty('FFMPEG_MAX_RETRY_LIMIT');
    });

    it('rate limiting constants are sensible', () => {
      expect(C.STREAM_RATE_WINDOW_MS).toBe(60000);
      expect(C.STREAM_RATE_MAX).toBe(100);
      expect(C.AUTH_RATE_MAX).toBe(10);
    });

    it('FFmpeg constants are sensible', () => {
      expect(C.FFMPEG_MAX_RETRY_LIMIT).toBe(5);
      expect(C.FFMPEG_COOLDOWN_DELAY_MS).toBe(3000);
    });
  });

  describe('Sharing Detector', () => {
    const sharingDetector = require('../../services/sharingDetector');

    it('recordAndCheck returns flagged and uniqueIps', async () => {
      const result = await sharingDetector.recordAndCheck('user123', '192.168.1.1');
      expect(result).toHaveProperty('flagged');
      expect(result).toHaveProperty('uniqueIps');
    });

    it('getSharingHistory returns array', async () => {
      const history = await sharingDetector.getSharingHistory('user123');
      expect(Array.isArray(history)).toBe(true);
    });

    it('clearHistory does not throw', async () => {
      await expect(sharingDetector.clearHistory('user123')).resolves.not.toThrow();
    });
  });

  describe('Logger', () => {
    const logger = require('../../services/logger');

    it('logger exports required methods', () => {
      expect(typeof logger.logger).toBe('object');
      expect(typeof logger.logStreamEvent).toBe('function');
      expect(typeof logger.withContext).toBe('function');
    });

    it('logStreamEvent does not throw', () => {
      expect(() => logger.logStreamEvent('TEST', 'channel123', { msg: 'test' })).not.toThrow();
    });

    it('withContext returns a logger', () => {
      const child = logger.withContext({ channelId: 'test123' });
      expect(typeof child.info).toBe('function');
    });
  });
});
