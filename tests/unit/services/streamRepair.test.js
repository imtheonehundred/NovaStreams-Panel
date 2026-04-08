'use strict';

const mockRedisClient = {
  get: jest.fn(),
  setex: jest.fn(),
};

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
}));

const redis = require('../../../lib/redis');

const streamRepair = require('../../../services/streamRepair');

describe('Stream Repair Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.get.mockResolvedValue(null);
  });

  describe('assessHealth', () => {
    it('should return broken for failed result', () => {
      expect(streamRepair.assessHealth({ ok: false, error: 'timeout' })).toBe('broken');
      expect(streamRepair.assessHealth({ ok: false, error: 'connection refused' })).toBe('broken');
    });

    it('should return broken when no video streams', () => {
      expect(streamRepair.assessHealth({ ok: true, videoStreams: 0 })).toBe('broken');
    });

    it('should return slow for low bitrate', () => {
      expect(streamRepair.assessHealth({ 
        ok: true, 
        videoStreams: 1, 
        bitrate: 30 * 1000,
      })).toBe('slow');
    });

    it('should return slow for very low fps', () => {
      expect(streamRepair.assessHealth({ 
        ok: true, 
        videoStreams: 1, 
        bitrate: 1000 * 1000,
        fps: 3,
      })).toBe('slow');
    });

    it('should return ok for healthy stream', () => {
      expect(streamRepair.assessHealth({ 
        ok: true, 
        videoStreams: 1, 
        bitrate: 5000 * 1000,
        fps: 30,
      })).toBe('ok');
    });
  });

  describe('getChannelHealth', () => {
    it('should return null when no cache exists', async () => {
      const mockClient = redis.getClient();
      mockClient.get.mockResolvedValue(null);
      
      const result = await streamRepair.getChannelHealth('channel123');
      expect(result).toBeNull();
    });

    it('should return cached data when fresh', async () => {
      const cachedData = {
        status: 'ok',
        checkedAt: Date.now(),
        info: { duration: 100 },
      };
      const mockClient = redis.getClient();
      mockClient.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const result = await streamRepair.getChannelHealth('channel123');
      expect(result).toEqual(cachedData);
    });
  });

  describe('getAllChannelHealth', () => {
    it('should return empty object for empty array', async () => {
      const result = await streamRepair.getAllChannelHealth([]);
      expect(result).toEqual({});
    });

    it('should return health for multiple channels', async () => {
      const mockClient = redis.getClient();
      mockClient.get.mockResolvedValue(null);
      
      const result = await streamRepair.getAllChannelHealth(['ch1', 'ch2', 'ch3']);
      expect(Object.keys(result)).toHaveLength(3);
    });
  });

  describe('checkAllChannels', () => {
    it('should count broken channels without URL', async () => {
      const channels = [
        { id: 'ch1', name: 'Channel 1' },
        { id: 'ch2', name: 'Channel 2', mpdUrl: null },
      ];

      const result = await streamRepair.checkAllChannels(channels);
      expect(result.total).toBe(2);
      expect(result.broken).toBe(2);
    });

    it('should handle channels as plain list', async () => {
      const channels = [
        { id: 'ch1' },
        { id: 'ch2', mpdUrl: null },
      ];

      const result = await streamRepair.checkAllChannels(channels);
      expect(result.total).toBe(2);
    });
  });

  describe('runFfprobe', () => {
    it('should be a function', () => {
      expect(typeof streamRepair.runFfprobe).toBe('function');
    });

    it('should return result object structure when ffprobe not available', (done) => {
      const originalSpawn = require('child_process').spawn;
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => ({
        on: (event, cb) => {
          if (event === 'error') cb(new Error('ENOENT'));
        },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
      }));

      streamRepair.runFfprobe('http://example.com/stream.m3u8').then(result => {
        expect(result).toHaveProperty('ok');
        expect(result).toHaveProperty('error');
        expect(result).toHaveProperty('duration');
        expect(result).toHaveProperty('videoStreams');
        expect(result).toHaveProperty('audioStreams');
        done();
      });

      jest.restoreAllMocks();
    });
  });
});
