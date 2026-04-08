'use strict';

const mockRedisClient = {
  rpush: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  lrange: jest.fn().mockResolvedValue([]),
};

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
}));

const bandwidthMonitor = require('../../../services/bandwidthMonitor');

describe('Bandwidth Monitor Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.lrange.mockResolvedValue([]);
  });

  describe('exports', () => {
    it('should export recordSample', () => {
      expect(typeof bandwidthMonitor.recordSample).toBe('function');
    });

    it('should export getBandwidthHistory', () => {
      expect(typeof bandwidthMonitor.getBandwidthHistory).toBe('function');
    });

    it('should export getLatestSample', () => {
      expect(typeof bandwidthMonitor.getLatestSample).toBe('function');
    });
  });

  describe('recordSample', () => {
    it('should be a function', () => {
      expect(typeof bandwidthMonitor.recordSample).toBe('function');
    });
  });

  describe('getBandwidthHistory', () => {
    it('should be a function', () => {
      expect(typeof bandwidthMonitor.getBandwidthHistory).toBe('function');
    });

    it('should return a Promise', () => {
      const result = bandwidthMonitor.getBandwidthHistory(6);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('getLatestSample', () => {
    it('should be a function', () => {
      expect(typeof bandwidthMonitor.getLatestSample).toBe('function');
    });

    it('should return an object with bandwidth values', () => {
      const sample = bandwidthMonitor.getLatestSample();
      expect(sample).toHaveProperty('rxMbps');
      expect(sample).toHaveProperty('txMbps');
    });
  });
});
