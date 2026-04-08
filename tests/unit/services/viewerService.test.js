'use strict';

const viewerService = require('../../../services/viewerService');

describe('Viewer Service', () => {
  beforeEach(() => {
    viewerService._resetForTests();
  });

  describe('increment', () => {
    it('should increment viewer count for channel', () => {
      expect(viewerService.increment('channel1')).toBe(1);
      expect(viewerService.increment('channel1')).toBe(2);
      expect(viewerService.increment('channel1')).toBe(3);
    });

    it('should start at 1 for new channel', () => {
      expect(viewerService.increment('newChannel')).toBe(1);
    });

    it('should handle different channels independently', () => {
      viewerService.increment('channel1');
      viewerService.increment('channel1');
      viewerService.increment('channel2');
      expect(viewerService.getCount('channel1')).toBe(2);
      expect(viewerService.getCount('channel2')).toBe(1);
    });
  });

  describe('decrement', () => {
    it('should decrement viewer count', () => {
      viewerService.increment('channel1');
      viewerService.increment('channel1');
      expect(viewerService.decrement('channel1')).toBe(1);
    });

    it('should not go below zero', () => {
      viewerService.increment('channel1');
      viewerService.decrement('channel1');
      viewerService.decrement('channel1');
      expect(viewerService.getCount('channel1')).toBe(0);
    });

    it('should return 0 for non-existent channel', () => {
      expect(viewerService.decrement('nonexistent')).toBe(0);
    });
  });

  describe('getCount', () => {
    it('should return 0 for non-existent channel', () => {
      expect(viewerService.getCount('nonexistent')).toBe(0);
    });

    it('should return current count', () => {
      viewerService.increment('channel1');
      viewerService.increment('channel1');
      viewerService.increment('channel1');
      expect(viewerService.getCount('channel1')).toBe(3);
    });
  });

  describe('getAll', () => {
    it('should return empty object initially', () => {
      expect(viewerService.getAll()).toEqual({});
    });

    it('should return all channel viewer counts', () => {
      viewerService.increment('channel1');
      viewerService.increment('channel1');
      viewerService.increment('channel2');
      const result = viewerService.getAll();
      expect(result.channel1).toBe(2);
      expect(result.channel2).toBe(1);
    });
  });
});
