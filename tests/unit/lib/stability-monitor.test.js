'use strict';

const stabilityMonitor = require('../../../lib/stability-monitor');

describe('Stability Monitor Library', () => {
  describe('exports', () => {
    it('should export createStabilityMonitor', () => {
      expect(typeof stabilityMonitor.createStabilityMonitor).toBe('function');
    });
  });

  describe('createStabilityMonitor', () => {
    it('should be a function', () => {
      expect(typeof stabilityMonitor.createStabilityMonitor).toBe('function');
    });

    it('should require options parameter', () => {
      expect(() => stabilityMonitor.createStabilityMonitor()).toThrow();
    });
  });
});
