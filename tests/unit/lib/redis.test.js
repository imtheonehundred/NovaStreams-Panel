'use strict';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    sadd: jest.fn(),
    scard: jest.fn(),
    smembers: jest.fn(),
    srem: jest.fn(),
    expire: jest.fn(),
    scan: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
  }));
});

describe('Redis Module', () => {
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    redis = require('../../../lib/redis');
  });

  describe('getClient', () => {
    it('should return a redis client', () => {
      const client = redis.getClient();
      expect(client).toBeDefined();
    });

    it('should return same client on subsequent calls', () => {
      const client1 = redis.getClient();
      const client2 = redis.getClient();
      expect(client1).toBe(client2);
    });
  });

  describe('connect', () => {
    it('should connect to redis', async () => {
      const client = redis.getClient();
      client.connect.mockResolvedValue(undefined);

      const result = await redis.connect();

      expect(result).toBe(true);
    });

    it('should return true if already connected', async () => {
      const client = redis.getClient();
      const err = new Error('already');
      err.message = 'already connected';
      client.connect.mockRejectedValue(err);

      const result = await redis.connect();

      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      const client = redis.getClient();
      client.connect.mockRejectedValue(new Error('connection failed'));

      const result = await redis.connect();

      expect(result).toBe(false);
    });
  });

  describe('cacheGet', () => {
    it('should return parsed JSON from cache', async () => {
      const client = redis.getClient();
      client.get.mockResolvedValue('{"foo":"bar"}');

      const result = await redis.cacheGet('test-key');

      expect(result).toEqual({ foo: 'bar' });
      expect(client.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null for missing key', async () => {
      const client = redis.getClient();
      client.get.mockResolvedValue(null);

      const result = await redis.cacheGet('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      const client = redis.getClient();
      client.get.mockRejectedValue(new Error('redis error'));

      const result = await redis.cacheGet('test-key');

      expect(result).toBeNull();
    });
  });

  describe('cacheSet', () => {
    it('should set value with TTL', async () => {
      const client = redis.getClient();
      client.setex.mockResolvedValue('OK');

      await redis.cacheSet('test-key', { data: 'value' }, 60);

      expect(client.setex).toHaveBeenCalledWith('test-key', 60, '{"data":"value"}');
    });

    it('should use default TTL of 60', async () => {
      const client = redis.getClient();
      client.setex.mockResolvedValue('OK');

      await redis.cacheSet('test-key', { data: 'value' });

      expect(client.setex).toHaveBeenCalledWith('test-key', 60, '{"data":"value"}');
    });

    it('should handle errors gracefully', async () => {
      const client = redis.getClient();
      client.setex.mockRejectedValue(new Error('redis error'));

      await expect(redis.cacheSet('test-key', { data: 'value' })).resolves.toBeUndefined();
    });
  });

  describe('cacheDel', () => {
    it('should delete key', async () => {
      const client = redis.getClient();
      client.del.mockResolvedValue(1);

      await redis.cacheDel('test-key');

      expect(client.del).toHaveBeenCalledWith('test-key');
    });

    it('should handle errors gracefully', async () => {
      const client = redis.getClient();
      client.del.mockRejectedValue(new Error('redis error'));

      await expect(redis.cacheDel('test-key')).resolves.toBeUndefined();
    });
  });

  describe('cacheInvalidate', () => {
    it('should scan and delete keys matching prefix', async () => {
      const client = redis.getClient();
      client.scan
        .mockResolvedValueOnce(['1', ['key1', 'key2']])
        .mockResolvedValueOnce(['0', ['key3']]);
      client.del.mockResolvedValue(2);

      await redis.cacheInvalidate('vod:');

      expect(client.scan).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const client = redis.getClient();
      client.scan.mockRejectedValue(new Error('redis error'));

      await expect(redis.cacheInvalidate('vod:')).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('should quit and reset client', async () => {
      const client = redis.getClient();
      client.quit.mockResolvedValue('OK');

      await redis.disconnect();

      expect(client.quit).toHaveBeenCalled();
    });
  });
});
