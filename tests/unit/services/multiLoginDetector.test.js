'use strict';

const multiLoginDetector = require('../../../services/multiLoginDetector');

describe('Multi Login Detector Service', () => {
  describe('exports', () => {
    it('should export recordConnection', () => {
      expect(typeof multiLoginDetector.recordConnection).toBe('function');
    });

    it('should export getConnections', () => {
      expect(typeof multiLoginDetector.getConnections).toBe('function');
    });

    it('should export isMultiLogin', () => {
      expect(typeof multiLoginDetector.isMultiLogin).toBe('function');
    });

    it('should export getMultiLoginLines', () => {
      expect(typeof multiLoginDetector.getMultiLoginLines).toBe('function');
    });

    it('should export disconnectLine', () => {
      expect(typeof multiLoginDetector.disconnectLine).toBe('function');
    });

    it('should export cleanup', () => {
      expect(typeof multiLoginDetector.cleanup).toBe('function');
    });
  });

  describe('recordConnection', () => {
    it('should be a function', () => {
      expect(typeof multiLoginDetector.recordConnection).toBe('function');
    });
  });

  describe('getConnections', () => {
    it('should be a function', () => {
      expect(typeof multiLoginDetector.getConnections).toBe('function');
    });
  });

  describe('isMultiLogin', () => {
    it('should be a function', () => {
      expect(typeof multiLoginDetector.isMultiLogin).toBe('function');
    });
  });

  describe('getMultiLoginLines', () => {
    it('should be a function', () => {
      expect(typeof multiLoginDetector.getMultiLoginLines).toBe('function');
    });
  });

  describe('disconnectLine', () => {
    it('should be a function', () => {
      expect(typeof multiLoginDetector.disconnectLine).toBe('function');
    });
  });
});
