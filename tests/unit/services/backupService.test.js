'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 1024 }),
}));

jest.mock('path', () => {
  const path = jest.requireActual('path');
  return {
    ...path,
    join: jest.fn((...args) => args.join('/')),
  };
});

const { exec } = require('child_process');
const fs = require('fs');
const dbApi = require('../../../lib/db');
const { execute, query } = require('../../../lib/mariadb');
const backupService = require('../../../services/backupService');

describe('BackupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
  });

  describe('normalizeBackupFilename', () => {
    it('should return valid .sql filename', () => {
      const result = backupService.normalizeBackupFilename('backup-2024.sql');
      expect(result).toBe('backup-2024.sql');
    });

    it('should return valid .sql.gz filename', () => {
      const result = backupService.normalizeBackupFilename('backup-2024.sql.gz');
      expect(result).toBe('backup-2024.sql.gz');
    });

    it('should throw for empty filename', () => {
      expect(() => backupService.normalizeBackupFilename('')).toThrow('Backup filename required');
    });

    it('should throw for invalid extension', () => {
      expect(() => backupService.normalizeBackupFilename('backup.txt')).toThrow('Unsupported backup filename');
    });

    it('should throw for path traversal', () => {
      expect(() => backupService.normalizeBackupFilename('../etc/passwd')).toThrow('Invalid backup filename');
    });
  });

  describe('getLocalBackupRetentionLimit', () => {
    it('should return setting value if valid', async () => {
      dbApi.getSetting.mockResolvedValue('25');

      const result = await backupService.getLocalBackupRetentionLimit();

      expect(result).toBe(25);
    });

    it('should cap at MAX_CONFIGURED_LOCAL_BACKUPS', async () => {
      dbApi.getSetting.mockResolvedValue('500');

      const result = await backupService.getLocalBackupRetentionLimit();

      expect(result).toBe(200);
    });

    it('should return MAX_LOCAL_BACKUPS if no setting', async () => {
      dbApi.getSetting.mockResolvedValue(null);

      const result = await backupService.getLocalBackupRetentionLimit();

      expect(result).toBe(50);
    });

    it('should return MAX_LOCAL_BACKUPS for invalid setting', async () => {
      dbApi.getSetting.mockResolvedValue('invalid');

      const result = await backupService.getLocalBackupRetentionLimit();

      expect(result).toBe(50);
    });
  });

  describe('createBackup', () => {
    it('should create backup file', async () => {
      exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));
      query.mockResolvedValue([]);

      const result = await backupService.createBackup();

      expect(result).toHaveProperty('filename');
      expect(result.filename).toMatch(/\.sql\.gz$/);
      expect(result).toHaveProperty('size_bytes');
    }, 10000);

    it('should skip prune if option set', async () => {
      exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

      await backupService.createBackup({ skipPrune: true });

      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('listBackups', () => {
    it('should return backups with computed fields', async () => {
      query.mockResolvedValue([
        { id: 1, filename: 'backup1.sql.gz', size_bytes: 1024, type: 'local' },
      ]);

      const result = await backupService.listBackups();

      expect(result[0]).toHaveProperty('size_mb');
      expect(result[0]).toHaveProperty('file_present');
      expect(result[0]).toHaveProperty('is_restorable');
    });
  });

  describe('getBackupPath', () => {
    it('should return filepath for existing backup', async () => {
      const result = await backupService.getBackupPath('backup.sql.gz');
      expect(result).toBeTruthy();
    });

    it('should return null for non-existing backup', async () => {
      fs.existsSync.mockReturnValue(false);

      const result = await backupService.getBackupPath('nonexistent.sql.gz');

      expect(result).toBeNull();
    });
  });

  describe('deleteBackupFile', () => {
    it('should delete backup file and database record', async () => {
      fs.existsSync.mockReturnValue(true);

      await backupService.deleteBackupFile('backup.sql.gz');

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(execute).toHaveBeenCalled();
    });
  });

  describe('restoreBackup', () => {
    it('should restore backup from file', async () => {
      exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''));

      const result = await backupService.restoreBackup('backup.sql.gz');

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('safetyBackup');
    }, 10000);

    it('should throw if backup file not found', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(backupService.restoreBackup('nonexistent.sql.gz')).rejects.toThrow('Backup file not found');
    });
  });

  describe('pruneOldBackups', () => {
    it('should delete old backups over retention limit', async () => {
      dbApi.getSetting.mockResolvedValue('5');
      query.mockResolvedValue([
        { id: 1, filename: 'backup1.sql.gz' },
        { id: 2, filename: 'backup2.sql.gz' },
        { id: 3, filename: 'backup3.sql.gz' },
        { id: 4, filename: 'backup4.sql.gz' },
        { id: 5, filename: 'backup5.sql.gz' },
        { id: 6, filename: 'backup6.sql.gz' },
        { id: 7, filename: 'backup7.sql.gz' },
      ]);

      await backupService.pruneOldBackups();

      expect(execute).toHaveBeenCalled();
    });
  });

  describe('initBackupTable', () => {
    it('should create backups table', async () => {
      execute.mockResolvedValue(undefined);

      await backupService.initBackupTable();

      expect(execute).toHaveBeenCalled();
    });
  });
});
