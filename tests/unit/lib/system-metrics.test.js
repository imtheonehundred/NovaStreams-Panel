'use strict';

const systemMetrics = require('../../../lib/system-metrics');

describe('System Metrics Library', () => {
  describe('exports', () => {
    it('should export collectSystemMetrics', () => {
      expect(typeof systemMetrics.collectSystemMetrics).toBe('function');
    });
  });

  describe('collectSystemMetrics', () => {
    it('should be a function', () => {
      expect(typeof systemMetrics.collectSystemMetrics).toBe('function');
    });

    it('should return an object', () => {
      const metrics = systemMetrics.collectSystemMetrics();
      expect(typeof metrics).toBe('object');
    });
  });
});
