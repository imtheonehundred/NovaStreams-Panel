'use strict';

const {
  createLine,
  getLineById,
  getLineByUsername,
  listLines,
  lineCount,
  updateLine,
  ensureLinePasswordSecurityColumns,
  migrateLegacyLinePasswords,
  dropLegacyLinePasswordColumnIfSafe,
  deleteLine,
  deleteExpiredLines,
  updateLineActivity,
  getActiveConnections,
  addLiveConnection,
  removeLiveConnection,
  clearStaleLiveConnections,
  countLiveConnections,
  writeActivityHistory,
} = require('../../../repositories/lineRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/crypto', () => ({
  hashLinePassword: jest.fn(),
  verifyLinePasswordHash: jest.fn(),
  encryptLinePassword: jest.fn(),
  decryptLinePassword: jest.fn(),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
}));

const {
  query,
  queryOne,
  insert,
  execute,
  remove,
} = require('../../../lib/mariadb');
const crypto = require('crypto');
const {
  hashLinePassword,
  verifyLinePasswordHash,
  encryptLinePassword,
  decryptLinePassword,
} = require('../../../lib/crypto');

describe('Line Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createLine', () => {
    it('should hash password and insert line', async () => {
      hashLinePassword.mockResolvedValue('hashed_password');
      encryptLinePassword.mockReturnValue('encrypted_password');
      crypto.randomBytes.mockReturnValue(
        Buffer.from('1234567890abcdef', 'hex')
      );
      insert.mockResolvedValue(1);

      const data = {
        username: 'testuser',
        password: 'testpass',
        member_id: 1,
        exp_date: 1234567890,
        admin_enabled: 1,
        enabled: 1,
        bouquet: [],
        allowed_outputs: [],
        max_connections: 1,
        is_trial: 0,
        is_mag: 0,
        is_e2: 0,
        is_restreamer: 0,
        allowed_ips: [],
        allowed_ua: [],
        forced_country: '',
        is_isplock: 0,
        package_id: null,
        contact: '',
        force_server_id: 0,
        bypass_ua: 0,
        admin_notes: '',
        reseller_notes: '',
        is_stalker: 0,
      };

      const result = await createLine(data);

      expect(hashLinePassword).toHaveBeenCalledWith('testpass');
      expect(encryptLinePassword).toHaveBeenCalledWith('testpass');
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(1);
    });
  });

  describe('getLineById', () => {
    it('should query line by id', async () => {
      const mockLine = { id: 1, username: 'testuser' };
      queryOne.mockResolvedValue(mockLine);

      const result = await getLineById(1);

      expect(queryOne).toHaveBeenCalledWith(
        'SELECT * FROM `lines` WHERE id = ?',
        [1]
      );
      expect(result).toEqual({
        ...mockLine,
        exp_date: null,
        created_at: null,
        last_expiration_video: null,
        last_activity: null,
      });
    });
  });

  describe('getLineByUsername', () => {
    it('should query line by username', async () => {
      const mockLine = { id: 1, username: 'testuser' };
      queryOne.mockResolvedValue(mockLine);

      const result = await getLineByUsername('testuser');

      expect(queryOne).toHaveBeenCalledWith(
        'SELECT * FROM `lines` WHERE username = ?',
        ['testuser']
      );
      expect(result).toEqual({
        ...mockLine,
        exp_date: null,
        created_at: null,
        last_expiration_video: null,
        last_activity: null,
      });
    });
  });

  describe('listLines', () => {
    it('should list all lines with pagination', async () => {
      queryOne.mockResolvedValue({ c: 2 });
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const result = await listLines(undefined, 50, 0);

      expect(result).toEqual({
        lines: [
          {
            id: 1,
            exp_date: null,
            created_at: null,
            last_expiration_video: null,
            last_activity: null,
          },
          {
            id: 2,
            exp_date: null,
            created_at: null,
            last_expiration_video: null,
            last_activity: null,
          },
        ],
        total: 2,
      });
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS c FROM `lines`'
      );
    });

    it('should filter by member_id when provided', async () => {
      queryOne.mockResolvedValue({ c: 1 });
      query.mockResolvedValue([{ id: 1, member_id: 5 }]);

      const result = await listLines(5, 50, 0);

      expect(result.lines[0].member_id).toBe(5);
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS c FROM `lines` WHERE member_id = ?',
        [5]
      );
    });
  });

  describe('lineCount', () => {
    it('should return count of lines', async () => {
      queryOne.mockResolvedValue({ c: 42 });

      const result = await lineCount();

      expect(result).toBe(42);
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS c FROM `lines`'
      );
    });
  });

  describe('updateLine', () => {
    it('should update line fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await updateLine(1, { enabled: 0, exp_date: 1234567890 });

      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE');
    });

    it('should hash new password when provided', async () => {
      hashLinePassword.mockResolvedValue('new_hash');
      encryptLinePassword.mockReturnValue('new_enc');
      execute.mockResolvedValue({ affectedRows: 1 });

      await updateLine(1, { password: 'newpass' });

      expect(hashLinePassword).toHaveBeenCalledWith('newpass');
      expect(encryptLinePassword).toHaveBeenCalledWith('newpass');
    });
  });

  describe('ensureLinePasswordSecurityColumns', () => {
    it('should add columns if they do not exist', async () => {
      query.mockResolvedValue([{ COLUMN_NAME: 'password_hash' }]);
      execute.mockResolvedValue({ affectedRows: 0 });

      await ensureLinePasswordSecurityColumns();

      expect(execute).toHaveBeenCalledWith(
        'ALTER TABLE `lines` ADD COLUMN `password_enc` TEXT NULL AFTER `password_hash`'
      );
    });

    it('should not add columns if they already exist', async () => {
      query.mockResolvedValue([
        { COLUMN_NAME: 'password_hash' },
        { COLUMN_NAME: 'password_enc' },
      ]);

      await ensureLinePasswordSecurityColumns();

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('migrateLegacyLinePasswords', () => {
    it('should migrate legacy passwords', async () => {
      queryOne.mockResolvedValue({ c: 1 });
      query.mockResolvedValue([
        { id: 1, password: 'legacy', password_hash: '', password_enc: '' },
      ]);
      decryptLinePassword.mockReturnValue('decrypted');
      hashLinePassword.mockResolvedValue('new_hash');
      encryptLinePassword.mockReturnValue('new_enc');
      verifyLinePasswordHash.mockResolvedValue(false);
      execute.mockResolvedValue({ affectedRows: 1 });

      await migrateLegacyLinePasswords();

      expect(execute).toHaveBeenCalledWith(
        'UPDATE `lines` SET password = ?, password_hash = ?, password_enc = ? WHERE id = ?',
        ['', 'new_hash', 'new_enc', 1]
      );
    });

    it('updates only secure columns when plaintext password column is absent', async () => {
      queryOne.mockResolvedValue({ c: 0 });
      query.mockResolvedValue([
        { id: 1, password_hash: '', password_enc: 'enc' },
      ]);
      decryptLinePassword.mockReturnValue('decrypted');
      hashLinePassword.mockResolvedValue('new_hash');
      encryptLinePassword.mockReturnValue('new_enc');
      verifyLinePasswordHash.mockResolvedValue(false);

      await migrateLegacyLinePasswords();

      expect(execute).toHaveBeenCalledWith(
        'UPDATE `lines` SET password_hash = ?, password_enc = ? WHERE id = ?',
        ['new_hash', 'enc', 1]
      );
    });
  });

  describe('dropLegacyLinePasswordColumnIfSafe', () => {
    it('drops the legacy plaintext password column when all rows are migrated', async () => {
      queryOne.mockResolvedValueOnce({ c: 1 }).mockResolvedValueOnce({ c: 0 });

      const result = await dropLegacyLinePasswordColumnIfSafe();

      expect(result).toBe(true);
      expect(execute).toHaveBeenCalledWith(
        'ALTER TABLE `lines` DROP COLUMN `password`'
      );
    });

    it('throws if secure password fields are still missing', async () => {
      queryOne.mockResolvedValueOnce({ c: 1 }).mockResolvedValueOnce({ c: 2 });

      await expect(dropLegacyLinePasswordColumnIfSafe()).rejects.toThrow(
        'Cannot drop legacy lines.password column while 2 rows are missing password_hash/password_enc'
      );
    });
  });

  describe('deleteLine', () => {
    it('should remove line by id', async () => {
      remove.mockResolvedValue(1);

      const result = await deleteLine(1);

      expect(remove).toHaveBeenCalledWith(
        'DELETE FROM `lines` WHERE id = ?',
        [1]
      );
      expect(result).toBe(1);
    });
  });

  describe('deleteExpiredLines', () => {
    it('should delete expired lines and return count', async () => {
      execute.mockResolvedValue({ affectedRows: 5 });

      const result = await deleteExpiredLines(1234567890);

      expect(execute).toHaveBeenCalledWith(
        'DELETE FROM `lines` WHERE exp_date IS NOT NULL AND exp_date < ?',
        [expect.any(String)]
      );
      expect(result).toBe(5);
    });
  });

  describe('updateLineActivity', () => {
    it('should update last_ip and last_activity', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await updateLineActivity(1, '192.168.1.1');

      expect(execute).toHaveBeenCalled();
      const [sql, params] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE `lines` SET last_ip');
      expect(params[0]).toBe('192.168.1.1');
    });
  });

  describe('getActiveConnections', () => {
    it('should return empty array (stub)', async () => {
      const result = await getActiveConnections(1);
      expect(result).toEqual([]);
    });
  });

  describe('addLiveConnection', () => {
    it('should return 0 (stub)', async () => {
      const result = await addLiveConnection({});
      expect(result).toBe(0);
    });
  });

  describe('removeLiveConnection', () => {
    it('should return false (stub)', async () => {
      const result = await removeLiveConnection('activity123');
      expect(result).toBe(false);
    });
  });

  describe('clearStaleLiveConnections', () => {
    it('should return 0 (stub)', async () => {
      const result = await clearStaleLiveConnections();
      expect(result).toBe(0);
    });
  });

  describe('countLiveConnections', () => {
    it('should return 0 (stub)', async () => {
      const result = await countLiveConnections(1);
      expect(result).toBe(0);
    });
  });

  describe('writeActivityHistory', () => {
    it('should insert activity record', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      const data = {
        user_id: 1,
        stream_id: 10,
        server_id: 2,
        user_agent: 'TestAgent',
        user_ip: '192.168.1.1',
        container: 'mp4',
        date_start: 1000,
        date_end: 2000,
        geoip_country_code: 'US',
        isp: 'Comcast',
      };

      await writeActivityHistory(data);

      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO lines_activity (user_id, stream_id, server_id, user_agent, user_ip, container, date_start, date_end, geoip_country_code, isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          1,
          10,
          2,
          'TestAgent',
          '192.168.1.1',
          'mp4',
          '1970-01-01 00:16:40',
          '1970-01-01 00:33:20',
          'US',
          'Comcast',
        ]
      );
    });
  });
});
