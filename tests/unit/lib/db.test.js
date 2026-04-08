'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../repositories/settingsRepository', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  getAllSettings: jest.fn(),
}));

jest.mock('../../../repositories/userRepository', () => {
  const actual = jest.requireActual('../../../repositories/userRepository');
  return {
    ...actual,
    createUser: jest.fn(),
    findUserByUsername: jest.fn(),
    findUserById: jest.fn(),
    getAllUsers: jest.fn(),
    userCount: jest.fn(),
    verifyPassword: jest.fn(),
    updateUser: jest.fn(),
    touchUserLastLogin: jest.fn(),
    deleteUser: jest.fn(),
    getUserGroup: jest.fn(),
    isAdmin: jest.fn(),
    isReseller: jest.fn(),
    // getFirstAdminUserId uses actual impl so it respects queryOne mocks
  };
});

jest.mock('../../../repositories/lineRepository', () => ({
  createLine: jest.fn(),
  getLineById: jest.fn(),
  getLineByUsername: jest.fn(),
  listLines: jest.fn(),
  lineCount: jest.fn(),
  updateLine: jest.fn(),
  deleteLine: jest.fn(),
  updateLineActivity: jest.fn(),
}));

jest.mock('../../../lib/crypto', () => ({
  hashApiKey: jest.fn(),
  verifyApiKey: jest.fn(),
  hashLinePassword: jest.fn(),
  verifyLinePasswordHash: jest.fn(),
  encryptLinePassword: jest.fn(),
  decryptLinePassword: jest.fn(),
}));

const { query, queryOne, insert, execute } = require('../../../lib/mariadb');
const crypto = require('../../../lib/crypto');

describe('DB API Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyLinePassword', () => {
    it('should call verifyLinePasswordHash with correct args', async () => {
      const db = require('../../../lib/db');
      crypto.verifyLinePasswordHash.mockResolvedValue(true);

      const lineRow = { id: 1, password_hash: 'hashed_password' };
      const result = await db.verifyLinePassword(lineRow, 'plain_password');

      expect(crypto.verifyLinePasswordHash).toHaveBeenCalledWith('plain_password', 'hashed_password');
      expect(result).toBe(true);
    });

    it('should return false for null lineRow', async () => {
      const db = require('../../../lib/db');
      crypto.verifyLinePasswordHash.mockResolvedValue(false);

      const result = await db.verifyLinePassword(null, 'password');

      expect(result).toBe(false);
    });
  });

  describe('attachLinePassword', () => {
    it('should decrypt password for row', () => {
      const db = require('../../../lib/db');
      crypto.decryptLinePassword.mockReturnValue('decrypted_password');

      const row = { id: 1, password_enc: 'encrypted_value' };
      const result = db.attachLinePassword(row);

      expect(crypto.decryptLinePassword).toHaveBeenCalledWith('encrypted_value');
      expect(result.password).toBe('decrypted_password');
    });

    it('should return null for null row', () => {
      const db = require('../../../lib/db');
      expect(db.attachLinePassword(null)).toBeNull();
    });

    it('should not modify original row', () => {
      const db = require('../../../lib/db');
      crypto.decryptLinePassword.mockReturnValue('decrypted');

      const row = { id: 1, password_enc: 'enc' };
      db.attachLinePassword(row);

      expect(row.password).toBeUndefined();
    });
  });

  describe('listResellerPackageOverrides', () => {
    it('should query with user_id', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([]);

      await db.listResellerPackageOverrides(1);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [1]
      );
    });
  });

  describe('getResellerPackageOverride', () => {
    it('should query with user_id and package_id', async () => {
      const db = require('../../../lib/db');
      queryOne.mockResolvedValue(null);

      await db.getResellerPackageOverride(1, 2);

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('user_id = ? AND package_id = ?'),
        [1, 2]
      );
    });
  });

  describe('replaceResellerPackageOverrides', () => {
    it('should delete and insert rows', async () => {
      const db = require('../../../lib/db');
      execute.mockResolvedValue(undefined);

      await db.replaceResellerPackageOverrides(1, [
        { package_id: 1, trial_credits_override: 5, official_credits_override: 10, enabled: 1 },
      ]);

      expect(execute).toHaveBeenCalledWith(
        'DELETE FROM reseller_package_overrides WHERE user_id = ?',
        [1]
      );
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO reseller_package_overrides'),
        expect.any(Array)
      );
    });

    it('should handle empty rows', async () => {
      const db = require('../../../lib/db');
      execute.mockResolvedValue(undefined);

      await db.replaceResellerPackageOverrides(1, []);

      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveApiKey', () => {
    it('should return null for invalid input', async () => {
      const db = require('../../../lib/db');

      expect(await db.resolveApiKey(null)).toBeNull();
      expect(await db.resolveApiKey('')).toBeNull();
      expect(await db.resolveApiKey(123)).toBeNull();
    });

    it('should resolve valid API key', async () => {
      const db = require('../../../lib/db');
      crypto.verifyApiKey.mockResolvedValue(true);
      query.mockResolvedValue([{ id: 1, user_id: 1, key_hash: 'hashed_value' }]);
      execute.mockResolvedValue(undefined);

      const result = await db.resolveApiKey('valid_key');

      expect(result).toEqual({ id: 1, user_id: 1, key_hash: 'hashed_value' });
    });

    it('should return null for unknown key', async () => {
      const db = require('../../../lib/db');
      crypto.verifyApiKey.mockResolvedValue(false);
      query.mockResolvedValue([{ id: 1, user_id: 1, key_hash: 'hashed_value' }]);

      const result = await db.resolveApiKey('unknown_key');

      expect(result).toBeNull();
    });
  });

  describe('addCreditLog', () => {
    it('should insert credit log', async () => {
      const db = require('../../../lib/db');
      execute.mockResolvedValue(undefined);

      await db.addCreditLog(1, 2, 100, 'Test credit');

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credits_logs'),
        expect.any(Array)
      );
    });
  });

  describe('import provider exports', () => {
    it('should expose import provider CRUD helpers', () => {
      const db = require('../../../lib/db');

      expect(typeof db.listImportProviders).toBe('function');
      expect(typeof db.getImportProviderById).toBe('function');
      expect(typeof db.createImportProvider).toBe('function');
      expect(typeof db.updateImportProvider).toBe('function');
      expect(typeof db.deleteImportProvider).toBe('function');
    });
  });

  describe('getCreditLogs', () => {
    it('should query credit logs', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([]);

      await db.getCreditLogs(1);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [1, 100]
      );
    });
  });

  describe('touchLineExpirationMedia', () => {
    it('should update line expiration', async () => {
      const db = require('../../../lib/db');
      execute.mockResolvedValue(undefined);

      await db.touchLineExpirationMedia(1);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE `lines`'),
        expect.any(Array)
      );
    });
  });

  describe('listResellerExpiryMediaItems', () => {
    it('should query media items', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([]);

      await db.listResellerExpiryMediaItems(1);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('service_id'),
        [1]
      );
    });
  });

  describe('replaceResellerExpiryMediaItems', () => {
    it('should replace media items', async () => {
      const db = require('../../../lib/db');
      execute.mockResolvedValue(undefined);

      await db.replaceResellerExpiryMediaItems(1, [
        { scenario: 'expiring', country_code: 'US', media_type: 'video', media_url: 'http://test.com', sort_order: 0 },
      ]);

      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('listAllMovieStreamUrls', () => {
    it('should return stream URLs', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([{ stream_url: 'http://test.com/stream' }]);

      const result = await db.listAllMovieStreamUrls();

      expect(result).toEqual(['http://test.com/stream']);
    });
  });

  describe('listAllSeriesTitles', () => {
    it('should return titles', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([{ title: 'Series 1' }, { title: 'Series 2' }]);

      const result = await db.listAllSeriesTitles();

      expect(result).toEqual(['Series 1', 'Series 2']);
    });
  });

  describe('listAllMovieIds', () => {
    it('should return movie ids', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const result = await db.listAllMovieIds();

      expect(result).toEqual([1, 2]);
    });
  });

  describe('listAllSeriesIds', () => {
    it('should return series ids', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([{ id: 10 }, { id: 20 }]);

      const result = await db.listAllSeriesIds();

      expect(result).toEqual([10, 20]);
    });
  });

  describe('listAllLiveChannelIds', () => {
    it('should return channel ids', async () => {
      const db = require('../../../lib/db');
      query.mockResolvedValue([{ id: 100 }]);

      const result = await db.listAllLiveChannelIds();

      expect(result).toEqual([100]);
    });
  });

  describe('getFirstAdminUserId', () => {
    it('should return admin user id', async () => {
      const db = require('../../../lib/db');
      queryOne
        .mockResolvedValueOnce({ id: 5 });

      const result = await db.getFirstAdminUserId();

      expect(result).toBe(5);
    });

    it('should return first user if no admin', async () => {
      const db = require('../../../lib/db');
      queryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 3 });

      const result = await db.getFirstAdminUserId();

      expect(result).toBe(3);
    });

    it('should return null if no users', async () => {
      const db = require('../../../lib/db');
      queryOne.mockResolvedValue(null);

      const result = await db.getFirstAdminUserId();

      expect(result).toBeNull();
    });
  });
});
