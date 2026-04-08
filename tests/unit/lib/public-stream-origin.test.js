'use strict';

const publicStreamOrigin = require('../../../lib/public-stream-origin');

describe('Public Stream Origin Library', () => {
  describe('exports', () => {
    it('should export publicStreamOrigin function', () => {
      expect(typeof publicStreamOrigin.publicStreamOrigin).toBe('function');
    });
  });

  describe('publicStreamOrigin', () => {
    it('should be a function', () => {
      expect(typeof publicStreamOrigin.publicStreamOrigin).toBe('function');
    });

    it('should return a string when called with mock request', () => {
      const mockReq = {
        get: jest.fn((header) => {
          if (header === 'host') return 'localhost:3000';
          if (header === 'x-forwarded-proto') return 'http';
          return '';
        }),
        protocol: 'http'
      };
      const result = publicStreamOrigin.publicStreamOrigin(mockReq);
      expect(typeof result).toBe('string');
      expect(result).toContain('localhost');
    });
  });
});
