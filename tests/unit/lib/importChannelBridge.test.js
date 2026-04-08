'use strict';

const importChannelBridge = require('../../../lib/importChannelBridge');

describe('Import Channel Bridge Library', () => {
  describe('exports', () => {
    it('should export setChannelImportHandler', () => {
      expect(typeof importChannelBridge.setChannelImportHandler).toBe('function');
    });

    it('should export importLiveChannel', () => {
      expect(typeof importChannelBridge.importLiveChannel).toBe('function');
    });
  });

  describe('setChannelImportHandler', () => {
    it('should be a function', () => {
      expect(typeof importChannelBridge.setChannelImportHandler).toBe('function');
    });
  });

  describe('importLiveChannel', () => {
    it('should be a function', () => {
      expect(typeof importChannelBridge.importLiveChannel).toBe('function');
    });
  });
});
