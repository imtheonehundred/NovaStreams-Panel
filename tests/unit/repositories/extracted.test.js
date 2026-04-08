'use strict';

const {
  listPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
} = require('../../../repositories/packageRepository');

const {
  listEpgSources,
  createEpgSource,
  deleteEpgSource,
  updateEpgSourceTimestamp,
  clearEpgData,
  insertEpgProgram,
  insertEpgBatch,
  getEpgForChannel,
  getShortEpg,
  getAllEpgData,
} = require('../../../repositories/epgRepository');

const {
  listBlockedIps,
  addBlockedIp,
  removeBlockedIp,
  isIpBlocked,
  listBlockedUas,
  addBlockedUa,
  removeBlockedUa,
  isUaBlocked,
  listBlockedIsps,
  addBlockedIsp,
  removeBlockedIsp,
  recordAuthAttempt,
  getAuthAttempts,
  cleanOldAuthFlood,
} = require('../../../repositories/securityRepository');

const {
  addPanelLog,
  getPanelLogs,
} = require('../../../repositories/panelLogRepository');

const {
  listOutputFormats,
  listStreamArguments,
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
} = require('../../../repositories/streamRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
  getPool: jest.fn(() => ({
    getConnection: jest.fn(),
  })),
}));

jest.mock('../../../lib/mysql-datetime', () => ({
  sanitizeSqlParams: jest.fn((arr) => arr),
}));

const { query, queryOne, insert, execute, remove, getPool } = require('../../../lib/mariadb');

describe('Package Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPackages', () => {
    it('should return all packages', async () => {
      const mockPackages = [{ id: 1, package_name: 'Package 1' }, { id: 2, package_name: 'Package 2' }];
      query.mockResolvedValue(mockPackages);
      const result = await listPackages();
      expect(result).toEqual(mockPackages);
      expect(query).toHaveBeenCalledWith('SELECT * FROM packages ORDER BY id');
    });
  });

  describe('getPackageById', () => {
    it('should return package by id', async () => {
      const mockPackage = { id: 1, package_name: 'Package 1' };
      queryOne.mockResolvedValue(mockPackage);
      const result = await getPackageById(1);
      expect(result).toEqual(mockPackage);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM packages WHERE id = ?', [1]);
    });
  });

  describe('createPackage', () => {
    it('should create package with defaults', async () => {
      insert.mockResolvedValue(1);
      const data = { package_name: 'Test Package' };
      await createPackage(data);
      expect(insert).toHaveBeenCalled();
      const callArgs = insert.mock.calls[0][1];
      expect(callArgs[0]).toBe('Test Package');
      expect(callArgs[1]).toBe(0);
      expect(callArgs[2]).toBe(1);
    });
  });

  describe('updatePackage', () => {
    it('should update package fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updatePackage(1, { package_name: 'Updated' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][0]).toContain('UPDATE packages SET');
      expect(execute.mock.calls[0][1]).toContain('Updated');
    });
  });

  describe('deletePackage', () => {
    it('should delete package', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deletePackage(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM packages WHERE id = ?', [1]);
    });
  });
});

describe('EPG Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listEpgSources', () => {
    it('should return all EPG sources', async () => {
      const mockSources = [{ id: 1, name: 'Source 1', url: 'http://example.com/epg.xml' }];
      query.mockResolvedValue(mockSources);
      const result = await listEpgSources();
      expect(result).toEqual(mockSources);
      expect(query).toHaveBeenCalledWith('SELECT * FROM epg_sources ORDER BY id');
    });
  });

  describe('createEpgSource', () => {
    it('should create EPG source', async () => {
      insert.mockResolvedValue(1);
      await createEpgSource('Test Source', 'http://example.com/epg.xml');
      expect(insert).toHaveBeenCalledWith('INSERT INTO epg_sources (name, url) VALUES (?, ?)', ['Test Source', 'http://example.com/epg.xml']);
    });
  });

  describe('deleteEpgSource', () => {
    it('should delete EPG source', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteEpgSource(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM epg_sources WHERE id = ?', [1]);
    });
  });

  describe('updateEpgSourceTimestamp', () => {
    it('should update timestamp', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateEpgSourceTimestamp(1);
      expect(execute).toHaveBeenCalledWith('UPDATE epg_sources SET last_updated = NOW() WHERE id = ?', [1]);
    });
  });

  describe('clearEpgData', () => {
    it('should clear all EPG data', async () => {
      execute.mockResolvedValue({ affectedRows: 100 });
      await clearEpgData();
      expect(execute).toHaveBeenCalledWith('DELETE FROM epg_data');
    });
  });

  describe('getEpgForChannel', () => {
    it('should return EPG for channel', async () => {
      const mockEpg = [{ id: 1, channel_id: 1, title: 'Test Show' }];
      query.mockResolvedValue(mockEpg);
      const result = await getEpgForChannel(1, 0, 9999999999);
      expect(result).toEqual(mockEpg);
      expect(query).toHaveBeenCalled();
    });
  });

  describe('getShortEpg', () => {
    it('should return short EPG', async () => {
      const mockEpg = [{ id: 1, channel_id: 1, title: 'Test Show' }];
      query.mockResolvedValue(mockEpg);
      const result = await getShortEpg(1, 4);
      expect(result).toEqual(mockEpg);
      expect(query).toHaveBeenCalled();
    });
  });

  describe('getAllEpgData', () => {
    it('should return all EPG data', async () => {
      const mockEpg = [{ id: 1, channel_id: 1, title: 'Test Show' }];
      query.mockResolvedValue(mockEpg);
      const result = await getAllEpgData();
      expect(result).toEqual(mockEpg);
      expect(query).toHaveBeenCalledWith('SELECT id, channel_id, title, description, start, stop, lang FROM epg_data ORDER BY start');
    });
  });
});

describe('Security Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listBlockedIps', () => {
    it('should return blocked IPs', async () => {
      query.mockResolvedValue([{ id: 1, ip: '192.168.1.1' }]);
      const result = await listBlockedIps();
      expect(result).toEqual([{ id: 1, ip: '192.168.1.1' }]);
      expect(query).toHaveBeenCalledWith('SELECT * FROM blocked_ips ORDER BY id');
    });
  });

  describe('addBlockedIp', () => {
    it('should add blocked IP', async () => {
      insert.mockResolvedValue(1);
      await addBlockedIp('192.168.1.1', 'test note');
      expect(insert).toHaveBeenCalledWith('INSERT IGNORE INTO blocked_ips (ip, notes) VALUES (?, ?)', ['192.168.1.1', 'test note']);
    });
  });

  describe('removeBlockedIp', () => {
    it('should remove blocked IP', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await removeBlockedIp(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM blocked_ips WHERE id = ?', [1]);
    });
  });

  describe('isIpBlocked', () => {
    it('should return true when IP is blocked', async () => {
      queryOne.mockResolvedValue({ ok: 1 });
      const result = await isIpBlocked('192.168.1.1');
      expect(result).toBe(true);
    });

    it('should return false when IP is not blocked', async () => {
      queryOne.mockResolvedValue(null);
      const result = await isIpBlocked('192.168.1.1');
      expect(result).toBe(false);
    });
  });

  describe('listBlockedUas', () => {
    it('should return blocked user agents', async () => {
      query.mockResolvedValue([{ id: 1, user_agent: 'BadBot' }]);
      const result = await listBlockedUas();
      expect(result).toEqual([{ id: 1, user_agent: 'BadBot' }]);
    });
  });

  describe('isUaBlocked', () => {
    it('should return true for matching regex UA', async () => {
      query.mockResolvedValue([{ user_agent: 'BadBot.*' }]);
      const result = await isUaBlocked('BadBot/1.0');
      expect(result).toBe(true);
    });

    it('should return false for non-matching UA', async () => {
      query.mockResolvedValue([{ user_agent: 'GoodBot' }]);
      const result = await isUaBlocked('BadBot/1.0');
      expect(result).toBe(false);
    });
  });

  describe('recordAuthAttempt', () => {
    it('should insert new auth attempt', async () => {
      queryOne.mockResolvedValue(null);
      execute.mockResolvedValue({ affectedRows: 1 });
      await recordAuthAttempt('192.168.1.1', 'testuser');
      expect(execute).toHaveBeenCalled();
    });

    it('should update existing auth attempt', async () => {
      queryOne.mockResolvedValue({ id: 1 });
      execute.mockResolvedValue({ affectedRows: 1 });
      await recordAuthAttempt('192.168.1.1', 'testuser');
      expect(execute).toHaveBeenCalled();
    });
  });

  describe('getAuthAttempts', () => {
    it('should return total attempts within window', async () => {
      queryOne.mockResolvedValue({ total: 5 });
      const result = await getAuthAttempts('192.168.1.1', 300);
      expect(result).toBe(5);
    });

    it('should return 0 when no attempts', async () => {
      queryOne.mockResolvedValue({ total: null });
      const result = await getAuthAttempts('192.168.1.1', 300);
      expect(result).toBe(0);
    });
  });

  describe('cleanOldAuthFlood', () => {
    it('should clean old auth flood records', async () => {
      execute.mockResolvedValue({ affectedRows: 10 });
      await cleanOldAuthFlood(600);
      expect(execute).toHaveBeenCalled();
    });
  });
});

describe('Panel Log Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('addPanelLog', () => {
    it('should insert panel log', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await addPanelLog(1, 'login', 'user', 1, 'User logged in');
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO panel_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [1, 'login', 'user', '1', 'User logged in']
      );
    });

    it('should handle null values', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await addPanelLog(null, null, null, null, null);
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO panel_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [0, '', '', '', '']
      );
    });
  });

  describe('getPanelLogs', () => {
    it('should return panel logs', async () => {
      const mockLogs = [{ id: 1, user_id: 1, action: 'login' }];
      query.mockResolvedValue(mockLogs);
      const result = await getPanelLogs(100);
      expect(result).toEqual(mockLogs);
      expect(query).toHaveBeenCalledWith('SELECT id, user_id, action, target_type, target_id, details, created_at FROM panel_logs ORDER BY id DESC LIMIT ?', [100]);
    });
  });
});

describe('Stream Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listOutputFormats', () => {
    it('should return output formats', async () => {
      query.mockResolvedValue([{ id: 1, name: 'hls' }]);
      const result = await listOutputFormats();
      expect(result).toEqual([{ id: 1, name: 'hls' }]);
      expect(query).toHaveBeenCalledWith('SELECT * FROM output_formats ORDER BY id');
    });
  });

  describe('listStreamArguments', () => {
    it('should return all stream arguments without filter', async () => {
      query.mockResolvedValue([{ id: 1, argument_cat: 'video' }]);
      await listStreamArguments();
      expect(query).toHaveBeenCalledWith('SELECT * FROM stream_arguments ORDER BY id');
    });

    it('should filter by category', async () => {
      query.mockResolvedValue([{ id: 1, argument_cat: 'video' }]);
      await listStreamArguments('video');
      expect(query).toHaveBeenCalledWith('SELECT * FROM stream_arguments WHERE argument_cat = ? ORDER BY id', ['video']);
    });
  });

  describe('listProfiles', () => {
    it('should return profiles', async () => {
      query.mockResolvedValue([{ id: 1, profile_name: 'Default' }]);
      const result = await listProfiles();
      expect(result).toEqual([{ id: 1, profile_name: 'Default' }]);
      expect(query).toHaveBeenCalledWith('SELECT * FROM profiles ORDER BY id');
    });
  });

  describe('getProfileById', () => {
    it('should return profile by id', async () => {
      queryOne.mockResolvedValue({ id: 1, profile_name: 'Default' });
      const result = await getProfileById(1);
      expect(result).toEqual({ id: 1, profile_name: 'Default' });
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM profiles WHERE id = ?', [1]);
    });
  });

  describe('createProfile', () => {
    it('should create profile', async () => {
      insert.mockResolvedValue(1);
      await createProfile('Test Profile', { transcoding: true });
      expect(insert).toHaveBeenCalledWith('INSERT INTO profiles (profile_name, profile_options) VALUES (?, ?)', ['Test Profile', '{"transcoding":true}']);
    });
  });

  describe('updateProfile', () => {
    it('should update profile name', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateProfile(1, 'Updated Profile', undefined);
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain('Updated Profile');
    });

    it('should update profile options', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateProfile(1, undefined, { transcoding: false });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain('{"transcoding":false}');
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteProfile(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM profiles WHERE id = ?', [1]);
    });
  });
});
