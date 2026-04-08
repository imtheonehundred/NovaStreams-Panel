'use strict';

const asnBlocker = require('../../../services/asnBlocker');

describe('ASN Blocker Service', () => {
  describe('exports', () => {
    it('should export asnBlocker object', () => {
      expect(typeof asnBlocker).toBe('object');
    });
  });

  describe('asnBlocker', () => {
    it('should have blockAsn function', () => {
      expect(typeof asnBlocker.blockAsn).toBe('function');
    });

    it('should have unblockAsn function', () => {
      expect(typeof asnBlocker.unblockAsn).toBe('function');
    });

    it('should have isAsnBlocked function', () => {
      expect(typeof asnBlocker.isAsnBlocked).toBe('function');
    });

    it('should have getBlockedAsns function', () => {
      expect(typeof asnBlocker.getBlockedAsns).toBe('function');
    });
  });
});
