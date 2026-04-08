'use strict';

jest.mock('../../../lib/db', () => ({
  getPackageById: jest.fn(),
  createLine: jest.fn(),
  getLineById: jest.fn(),
  getLineByUsername: jest.fn(),
  verifyLinePassword: jest.fn(),
  updateLine: jest.fn(),
  deleteLine: jest.fn(),
  listLines: jest.fn(),
  updateLineActivity: jest.fn(),
  writeActivityHistory: jest.fn(),
  getBouquetsByIds: jest.fn(),
  openRuntimeSession: jest.fn(),
  touchRuntimeSession: jest.fn(),
  closeRuntimeSession: jest.fn(),
}));

const mockRedisClient = {
  setex: jest.fn().mockResolvedValue('OK'),
  sadd: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  scard: jest.fn().mockResolvedValue(0),
  smembers: jest.fn().mockResolvedValue([]),
  srem: jest.fn().mockResolvedValue(1),
};

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
}));

const dbApi = require('../../../lib/db');
const lineService = require('../../../services/lineService');

describe('LineService - Additional Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.smembers.mockResolvedValue([]);
    mockRedisClient.expire.mockResolvedValue(1);
  });

  describe('durationToSeconds', () => {
    it('should convert days to seconds', () => {
      const result = lineService.durationToSeconds(1, 'day');
      expect(result).toBe(86400);
    });

    it('should convert hours to seconds', () => {
      const result = lineService.durationToSeconds(2, 'hour');
      expect(result).toBe(7200);
    });

    it('should convert minutes to seconds', () => {
      const result = lineService.durationToSeconds(30, 'minute');
      expect(result).toBe(1800);
    });

    it('should convert weeks to seconds', () => {
      const result = lineService.durationToSeconds(1, 'week');
      expect(result).toBe(604800);
    });

    it('should convert months to seconds', () => {
      const result = lineService.durationToSeconds(1, 'month');
      expect(result).toBe(2592000);
    });

    it('should convert years to seconds', () => {
      const result = lineService.durationToSeconds(1, 'year');
      expect(result).toBe(31536000);
    });

    it('should default to days for unknown unit', () => {
      const result = lineService.durationToSeconds(5, 'unknown');
      expect(result).toBe(432000);
    });

    it('should handle case-insensitive units', () => {
      expect(lineService.durationToSeconds(1, 'DAY')).toBe(86400);
      expect(lineService.durationToSeconds(1, 'Hour')).toBe(3600);
    });

    it('should return 0 for non-numeric amount', () => {
      expect(lineService.durationToSeconds('abc', 'day')).toBe(0);
      expect(lineService.durationToSeconds(null, 'day')).toBe(0);
      expect(lineService.durationToSeconds(undefined, 'day')).toBe(0);
    });

    it('should default to day unit when not provided', () => {
      const result = lineService.durationToSeconds(3);
      expect(result).toBe(259200);
    });
  });

  describe('computeExpDateFromPackage', () => {
    it('should compute exp date using official duration for non-trial', () => {
      const pkg = {
        is_trial: 0,
        official_duration: 30,
        official_duration_in: 'day',
      };
      const now = Math.floor(Date.now() / 1000);
      const result = lineService.computeExpDateFromPackage(pkg);
      expect(result).toBeGreaterThanOrEqual(now + 30 * 86400 - 5);
      expect(result).toBeLessThanOrEqual(now + 30 * 86400 + 5);
    });

    it('should compute exp date using trial duration for trial package', () => {
      const pkg = {
        is_trial: 1,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      const now = Math.floor(Date.now() / 1000);
      const result = lineService.computeExpDateFromPackage(pkg);
      expect(result).toBeGreaterThanOrEqual(now + 7 * 86400 - 5);
      expect(result).toBeLessThanOrEqual(now + 7 * 86400 + 5);
    });

    it('should override trial status with explicit parameter', () => {
      const pkg = {
        is_trial: 1,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      const now = Math.floor(Date.now() / 1000);
      const result = lineService.computeExpDateFromPackage(pkg, 0);
      expect(result).toBeGreaterThanOrEqual(now + 30 * 86400 - 5);
    });
  });

  describe('applyPackageDefaults', () => {
    it('should apply bouquet from package', () => {
      const draft = {};
      const pkg = {
        bouquets_json: '["1","2","3"]',
        output_formats_json: '["ts"]',
        max_connections: 5,
        forced_country: 'US',
        is_trial: 0,
        is_mag: 1,
        is_e2: 0,
        is_restreamer: 0,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      lineService.applyPackageDefaults(draft, pkg);
      expect(draft.bouquet).toEqual(['1', '2', '3']);
    });

    it('should not override existing values', () => {
      const draft = { bouquet: ['custom'], max_connections: 10 };
      const pkg = {
        bouquets_json: '["1","2"]',
        output_formats_json: '["ts"]',
        max_connections: 5,
        forced_country: 'US',
        is_trial: 0,
        is_mag: 0,
        is_e2: 0,
        is_restreamer: 0,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      lineService.applyPackageDefaults(draft, pkg);
      expect(draft.bouquet).toEqual(['custom']);
      expect(draft.max_connections).toBe(10);
    });

    it('should handle null/undefined package values', () => {
      const draft = {};
      const pkg = {
        bouquets_json: null,
        output_formats_json: undefined,
        max_connections: null,
        forced_country: '',
        is_trial: null,
        is_mag: null,
        is_e2: null,
        is_restreamer: null,
        trial_duration: null,
        trial_duration_in: null,
        official_duration: null,
        official_duration_in: null,
      };
      expect(() => lineService.applyPackageDefaults(draft, pkg)).not.toThrow();
    });
  });

  describe('createLine', () => {
    it('should throw if username missing', async () => {
      await expect(lineService.createLine({ password: 'pass', package_id: 1 }))
        .rejects.toThrow('username and password required');
    });

    it('should throw if password missing', async () => {
      await expect(lineService.createLine({ username: 'user', package_id: 1 }))
        .rejects.toThrow('username and password required');
    });

    it('should throw if package_id missing', async () => {
      await expect(lineService.createLine({ username: 'user', password: 'pass' }))
        .rejects.toThrow('package_id is required');
    });

    it('should throw if package not found', async () => {
      dbApi.getPackageById.mockResolvedValue(null);
      await expect(lineService.createLine({ username: 'user', password: 'pass', package_id: 999 }))
        .rejects.toThrow('Package not found');
    });

    it('should create line with generated access token', async () => {
      const pkg = {
        bouquets_json: '[]',
        output_formats_json: '[]',
        max_connections: 1,
        forced_country: '',
        is_trial: 0,
        is_mag: 0,
        is_e2: 0,
        is_restreamer: 0,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      dbApi.getPackageById.mockResolvedValue(pkg);
      dbApi.createLine.mockResolvedValue(1);
      dbApi.getLineById.mockResolvedValue({ id: 1, username: 'testuser' });

      const result = await lineService.createLine({ username: 'testuser', password: 'pass', package_id: 1 });

      expect(dbApi.createLine).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
          password: 'pass',
          package_id: 1,
          access_token: expect.any(String),
        })
      );
    });

    it('should set member_id when provided', async () => {
      const pkg = {
        bouquets_json: '[]',
        output_formats_json: '[]',
        max_connections: 1,
        forced_country: '',
        is_trial: 0,
        is_mag: 0,
        is_e2: 0,
        is_restreamer: 0,
        trial_duration: 7,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'day',
      };
      dbApi.getPackageById.mockResolvedValue(pkg);
      dbApi.createLine.mockResolvedValue(1);
      dbApi.getLineById.mockResolvedValue({ id: 1, username: 'testuser' });

      await lineService.createLine({ username: 'testuser', password: 'pass', package_id: 1 }, 5);

      expect(dbApi.createLine).toHaveBeenCalledWith(
        expect.objectContaining({ member_id: 5 })
      );
    });
  });

  describe('bouquetFieldForStreamType', () => {
    it('should return correct field for live', () => {
      expect(lineService.bouquetFieldForStreamType('live')).toBe('bouquet_channels');
    });

    it('should return correct field for movie', () => {
      expect(lineService.bouquetFieldForStreamType('movie')).toBe('bouquet_movies');
    });

    it('should return correct field for series', () => {
      expect(lineService.bouquetFieldForStreamType('series')).toBe('bouquet_series');
    });

    it('should return correct field for radio', () => {
      expect(lineService.bouquetFieldForStreamType('radio')).toBe('bouquet_radios');
    });

    it('should return null for unknown stream type', () => {
      expect(lineService.bouquetFieldForStreamType('unknown')).toBeNull();
      expect(lineService.bouquetFieldForStreamType('')).toBeNull();
      expect(lineService.bouquetFieldForStreamType(null)).toBeNull();
    });

    it('should be case insensitive', () => {
      expect(lineService.bouquetFieldForStreamType('LIVE')).toBe('bouquet_channels');
      expect(lineService.bouquetFieldForStreamType('Movie')).toBe('bouquet_movies');
    });
  });

  describe('isStreamInBouquet', () => {
    it('should return false for unknown stream type', async () => {
      const line = { bouquet: ['1'] };
      const result = await lineService.isStreamInBouquet(line, 1, 'unknown');
      expect(result).toBe(false);
    });

    it('should return false for empty bouquet', async () => {
      const line = { bouquet: [] };
      const result = await lineService.isStreamInBouquet(line, 1, 'live');
      expect(result).toBe(false);
    });

    it('should return true when stream is in bouquet', async () => {
      const line = { bouquet: [1] };
      dbApi.getBouquetsByIds.mockResolvedValue([
        { bouquet_channels: '["1","2","3"]' },
      ]);
      const result = await lineService.isStreamInBouquet(line, 1, 'live');
      expect(result).toBe(true);
    });

    it('should return false when stream is not in bouquet', async () => {
      const line = { bouquet: [1] };
      dbApi.getBouquetsByIds.mockResolvedValue([
        { bouquet_channels: '["4","5","6"]' },
      ]);
      const result = await lineService.isStreamInBouquet(line, 1, 'live');
      expect(result).toBe(false);
    });
  });

  describe('getUserInfo', () => {
    it('should return formatted user info', async () => {
      const line = {
        id: 1,
        username: 'testuser',
        password: 'testpass',
        exp_date: 1744056000,
        is_trial: 0,
        max_connections: 5,
        allowed_outputs: '["ts","m3u8"]',
        created_at: 1640000000,
        is_mag: 1,
        is_e2: 0,
        is_restreamer: 0,
        forced_country: 'US',
        is_isplock: 0,
      };

      const result = await lineService.getUserInfo(line);

      expect(result.username).toBe('testuser');
      expect(result.password).toBe('testpass');
      expect(result.auth).toBe(1);
      expect(result.status).toBe('Active');
      expect(result.exp_date).toBe('1744056000');
      expect(result.is_trial).toBe('0');
      expect(result.active_cons).toBe('0');
      expect(result.max_connections).toBe('5');
      expect(result.allowed_output_formats).toEqual(['ts', 'm3u8']);
      expect(result.is_mag).toBe('1');
      expect(result.is_e2).toBe('0');
      expect(result.is_restreamer).toBe('0');
      expect(result.forced_country).toBe('US');
      expect(result.is_isplock).toBe('0');
    });

    it('should handle null exp_date', async () => {
      const line = {
        id: 1,
        username: 'test',
        password: 'pass',
        exp_date: null,
        is_trial: 0,
        max_connections: 1,
        allowed_outputs: '[]',
        created_at: null,
        is_mag: 0,
        is_e2: 0,
        is_restreamer: 0,
        forced_country: '',
        is_isplock: 0,
      };

      const result = await lineService.getUserInfo(line);

      expect(result.exp_date).toBe('0');
      expect(result.created_at).toBe('0');
    });
  });

  describe('update', () => {
    it('should throw if password is empty string', async () => {
      await expect(lineService.update(1, { password: '' }))
        .rejects.toThrow('password required');
    });

    it('should call dbApi.updateLine and return updated line', async () => {
      dbApi.updateLine.mockResolvedValue(undefined);
      dbApi.getLineById.mockResolvedValue({ id: 1, username: 'updated' });

      const result = await lineService.update(1, { username: 'updated' });

      expect(dbApi.updateLine).toHaveBeenCalledWith(1, { username: 'updated' });
      expect(result.username).toBe('updated');
    });
  });

  describe('remove', () => {
    it('should call dbApi.deleteLine', async () => {
      dbApi.deleteLine.mockResolvedValue(1);

      const result = await lineService.remove(1);

      expect(dbApi.deleteLine).toHaveBeenCalledWith(1);
      expect(result).toBe(1);
    });
  });

  describe('openConnection', () => {
    it('should generate uuid if not provided', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      client.get.mockResolvedValue(null);

      const result = await lineService.openConnection(1, { stream_id: 100 });

      expect(result).toHaveLength(32);
    });

    it('should use provided uuid', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      client.get.mockResolvedValue(null);

      const result = await lineService.openConnection(1, { uuid: 'custom-uuid', stream_id: 100 });

      expect(result).toBe('custom-uuid');
    });
  });

  describe('closeConnection', () => {
    it('should return true even when no connection data', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      client.get.mockResolvedValue(null);

      const result = await lineService.closeConnection(1, 'uuid');

      expect(result).toBe(true);
    });

    it('should write activity history when connection data exists', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      const connData = {
        user_id: 1,
        stream_id: 100,
        user_agent: 'TestAgent',
        user_ip: '127.0.0.1',
        container: 'ts',
        date_start: Math.floor(Date.now() / 1000) - 60,
        geoip_country_code: 'US',
      };
      client.get.mockResolvedValue(JSON.stringify(connData));

      await lineService.closeConnection(1, 'uuid');

      expect(dbApi.writeActivityHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 1,
          stream_id: 100,
        })
      );
    });
  });

  describe('killConnections', () => {
    it('should close all active connections', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      client.smembers.mockResolvedValue(['uuid1', 'uuid2']);
      client.get
        .mockResolvedValueOnce(JSON.stringify({ user_id: 1, stream_id: 100, date_start: 1 }))
        .mockResolvedValueOnce(JSON.stringify({ user_id: 1, stream_id: 101, date_start: 1 }));

      const result = await lineService.killConnections(1);

      expect(result).toBe(2);
    });
  });

  describe('refreshConnection', () => {
    it('should refresh TTL on connection', async () => {
      const redis = require('../../../lib/redis');
      const client = redis.getClient();
      client.get.mockResolvedValue(null);

      await lineService.refreshConnection(1, 'uuid');

      expect(client.expire).toHaveBeenCalledTimes(2);
    });
  });

  describe('listAll', () => {
    it('should call dbApi.listLines with parameters', async () => {
      dbApi.listLines.mockResolvedValue([]);

      await lineService.listAll(1, 10, 0);

      expect(dbApi.listLines).toHaveBeenCalledWith(1, 10, 0);
    });
  });
});
