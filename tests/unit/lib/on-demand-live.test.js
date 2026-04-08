'use strict';

const onDemandLive = require('../../../lib/on-demand-live');

describe('On Demand Live Library', () => {
  describe('exports', () => {
    it('should export object with functions', () => {
      expect(typeof onDemandLive).toBe('object');
    });
  });

  describe('onDemandLive functions', () => {
    it('should have createOnDemandSession if it exists', () => {
      if (onDemandLive.createOnDemandSession) {
        expect(typeof onDemandLive.createOnDemandSession).toBe('function');
      }
    });

    it('should have closeOnDemandSession if it exists', () => {
      if (onDemandLive.closeOnDemandSession) {
        expect(typeof onDemandLive.closeOnDemandSession).toBe('function');
      }
    });

    it('should have getOnDemandStatus if it exists', () => {
      if (onDemandLive.getOnDemandStatus) {
        expect(typeof onDemandLive.getOnDemandStatus).toBe('function');
      }
    });
  });
});
