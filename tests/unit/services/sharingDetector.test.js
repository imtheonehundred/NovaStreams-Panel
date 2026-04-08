'use strict';

const mockRedis = {
  zadd: jest.fn().mockResolvedValue(1),
  zremrangebyscore: jest.fn().mockResolvedValue(0),
  expire: jest.fn().mockResolvedValue(1),
  zrange: jest.fn().mockResolvedValue([]),
  zrangebyscore: jest.fn().mockResolvedValue([]),
  del: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
};

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => mockRedis),
}));

const sharingDetector = require('../../../services/sharingDetector');
const { getClient } = require('../../../lib/redis');

describe('Sharing Detector Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordAndCheck', () => {
    it('should be a function', () => {
      expect(typeof sharingDetector.recordAndCheck).toBe('function');
    });

    it('should add IP to sorted set with timestamp', async () => {
      mockRedis.zrange.mockResolvedValue(['192.168.1.1:1234567890']);
      const result = await sharingDetector.recordAndCheck(123, '192.168.1.1');
      expect(mockRedis.zadd).toHaveBeenCalledWith('sharing:123', expect.any(Number), expect.stringContaining('192.168.1.1:'));
      expect(result).toHaveProperty('flagged');
      expect(result).toHaveProperty('uniqueIps');
    });

    it('should remove old entries outside sharing window', async () => {
      mockRedis.zrange.mockResolvedValue(['192.168.1.1:1234567890']);
      await sharingDetector.recordAndCheck(123, '192.168.1.1');
      expect(mockRedis.zremrangebyscore).toHaveBeenCalled();
    });

    it('should set expiry on the key', async () => {
      mockRedis.zrange.mockResolvedValue(['192.168.1.1:1234567890']);
      await sharingDetector.recordAndCheck(123, '192.168.1.1');
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it('should flag when unique IPs exceed threshold', async () => {
      mockRedis.zrange.mockResolvedValue([
        '192.168.1.1:1234567890',
        '192.168.1.2:1234567891',
        '192.168.1.3:1234567892',
        '192.168.1.4:1234567893',
      ]);
      const result = await sharingDetector.recordAndCheck(123, '192.168.1.4');
      expect(result.uniqueIps).toBe(4);
      expect(result.flagged).toBe(true);
    });

    it('should not flag when unique IPs below threshold', async () => {
      mockRedis.zrange.mockResolvedValue(['192.168.1.1:1234567890']);
      const result = await sharingDetector.recordAndCheck(123, '192.168.1.1');
      expect(result.uniqueIps).toBe(1);
      expect(result.flagged).toBe(false);
    });
  });

  describe('getSharingHistory', () => {
    it('should be a function', () => {
      expect(typeof sharingDetector.getSharingHistory).toBe('function');
    });

    it('should return unique IPs in sharing window', async () => {
      mockRedis.zrangebyscore.mockResolvedValue([
        '192.168.1.1:1234567890',
        '192.168.1.2:1234567891',
        '192.168.1.1:1234567892',
      ]);
      const result = await sharingDetector.getSharingHistory(123);
      expect(result).toEqual(['192.168.1.1', '192.168.1.2']);
    });

    it('should return empty array when no history', async () => {
      mockRedis.zrangebyscore.mockResolvedValue([]);
      const result = await sharingDetector.getSharingHistory(123);
      expect(result).toEqual([]);
    });
  });

  describe('clearHistory', () => {
    it('should be a function', () => {
      expect(typeof sharingDetector.clearHistory).toBe('function');
    });

    it('should delete the user sharing key', async () => {
      await sharingDetector.clearHistory(123);
      expect(mockRedis.del).toHaveBeenCalledWith('sharing:123');
    });
  });

  describe('publishAlert', () => {
    it('should be a function', () => {
      expect(typeof sharingDetector.publishAlert).toBe('function');
    });

    it('should publish sharing alert to Redis', async () => {
      await sharingDetector.publishAlert(123, 4);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'sharing:alerts',
        expect.stringContaining('"userId":"123"')
      );
    });

    it('should include unique IP count in alert', async () => {
      await sharingDetector.publishAlert(123, 4);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'sharing:alerts',
        expect.stringContaining('"uniqueIps":4')
      );
    });
  });

  describe('subscribeToAlerts', () => {
    it('should be a function', () => {
      expect(typeof sharingDetector.subscribeToAlerts).toBe('function');
    });
  });
});
