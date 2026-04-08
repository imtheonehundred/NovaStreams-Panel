'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, execute } = require('../../../lib/mariadb');

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

const db = require('../../../lib/db');

const mockRedisClient = {
  rpush: jest.fn(),
  expire: jest.fn(),
  ltrim: jest.fn(),
  lrange: jest.fn(),
};

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
}));

const healthMonitor = require('../../../services/healthMonitor');

describe('Health Monitor Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.lrange.mockResolvedValue([]);
    healthMonitor.stop();
  });

  afterEach(() => {
    healthMonitor.stop();
  });

  describe('status functions', () => {
    it('should report panel is not up initially', () => {
      expect(healthMonitor.isPanelUp()).toBe(false);
    });

    it('should report no health sample initially', () => {
      expect(healthMonitor.hasPanelHealthSample()).toBe(false);
    });

    it('should return 0 for last check time initially', () => {
      expect(healthMonitor.getLastCheckAt()).toBe(0);
    });

    it('should return null for last response time initially', () => {
      expect(healthMonitor.getLastResponseMs()).toBeNull();
    });

    it('should return empty string for last error initially', () => {
      expect(healthMonitor.getLastError()).toBe('');
    });

    it('should return 0 for consecutive fails initially', () => {
      expect(healthMonitor.getConsecutiveFails()).toBe(0);
    });
  });

  describe('start and stop', () => {
    it('should start without throwing', () => {
      expect(() => healthMonitor.start()).not.toThrow();
    });

    it('should stop without throwing', () => {
      healthMonitor.start();
      expect(() => healthMonitor.stop()).not.toThrow();
    });

    it('should be idempotent on stop', () => {
      healthMonitor.start();
      healthMonitor.stop();
      expect(() => healthMonitor.stop()).not.toThrow();
    });
  });

  describe('getDayStats', () => {
    it('should return stats for valid date with data', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([
        JSON.stringify({ up: 1, responseMs: 100, ts: Date.now(), error: '' }),
        JSON.stringify({ up: 1, responseMs: 150, ts: Date.now(), error: '' }),
        JSON.stringify({ up: 0, responseMs: 200, ts: Date.now(), error: 'timeout' }),
      ]);

      const result = await healthMonitor.getDayStats('2024-01-01');
      expect(result.date).toBe('2024-01-01');
      expect(result.upCount).toBe(2);
      expect(result.downCount).toBe(1);
      expect(result.totalChecks).toBe(3);
      expect(result.uptimePct).toBeCloseTo(66.67, 1);
    });

    it('should handle empty data', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([]);

      const result = await healthMonitor.getDayStats('2024-01-01');
      expect(result.totalChecks).toBe(0);
      expect(result.uptimePct).toBeNull();
    });

    it('should handle malformed JSON in data', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([
        JSON.stringify({ up: 1, responseMs: 100 }),
        'not valid json',
        JSON.stringify({ up: 0, responseMs: 200 }),
      ]);

      const result = await healthMonitor.getDayStats('2024-01-01');
      expect(result.totalChecks).toBe(2);
    });

    it('should default to today if no date provided', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([]);

      const result = await healthMonitor.getDayStats();
      const today = new Date();
      const expected = `${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,'0')}-${String(today.getUTCDate()).padStart(2,'0')}`;
      expect(result.date).toBe(expected);
    });
  });

  describe('getUptimeHistory', () => {
    it('should return history for specified days', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([]);

      const results = await healthMonitor.getUptimeHistory(3);
      expect(results).toHaveLength(3);
    });

    it('should return history for default 7 days', async () => {
      const redis = require('../../../lib/redis');
      const mockClient = redis.getClient();
      mockClient.lrange.mockResolvedValue([]);

      const results = await healthMonitor.getUptimeHistory();
      expect(results).toHaveLength(7);
    });
  });
});
