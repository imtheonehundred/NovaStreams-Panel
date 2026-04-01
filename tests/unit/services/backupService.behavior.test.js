'use strict';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const mariadb = require('../../../lib/mariadb');
const dbApi = require('../../../lib/db');
const backupService = require('../../../services/backupService');

describe('backupService behavior coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbApi.getSetting.mockResolvedValue('2');
    fs.existsSync.mockImplementation((target) => String(target).endsWith('.sql.gz') || String(target).endsWith(path.join('data', 'backups')));
    fs.statSync.mockReturnValue({ size: 4096 });
    exec.mockImplementation((cmd, _options, callback) => callback(null, 'ok', ''));
    mariadb.query.mockResolvedValue([]);
    mariadb.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('prunes only backups beyond the configured retention limit', async () => {
    mariadb.query.mockResolvedValue([
      { id: 4, filename: 'backup-4.sql.gz' },
      { id: 3, filename: 'backup-3.sql.gz' },
      { id: 2, filename: 'backup-2.sql.gz' },
      { id: 1, filename: 'backup-1.sql.gz' },
    ]);

    await backupService.pruneOldBackups();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync.mock.calls.map((call) => path.basename(call[0]))).toEqual(['backup-2.sql.gz', 'backup-1.sql.gz']);
    expect(mariadb.execute).toHaveBeenCalledWith('DELETE FROM backups WHERE filename = ?', ['backup-2.sql.gz']);
    expect(mariadb.execute).toHaveBeenCalledWith('DELETE FROM backups WHERE filename = ?', ['backup-1.sql.gz']);
  });

  it('creates a safety backup before restore and prunes only after the restore command succeeds', async () => {
    mariadb.query.mockResolvedValue([]);

    const result = await backupService.restoreBackup('restore-point.sql.gz');

    expect(result).toEqual({
      ok: true,
      safetyBackup: expect.objectContaining({ filename: expect.stringMatching(/^backup-.*\.sql\.gz$/) }),
    });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][0]).toContain('mysqldump');
    expect(exec.mock.calls[0][0]).toContain('gzip >');
    expect(exec.mock.calls[1][0]).toContain('gunzip <');
    expect(exec.mock.calls[1][0]).toContain('mysql -h');
    expect(mariadb.execute).toHaveBeenCalledWith(
      'INSERT INTO backups (filename, size_bytes, created_at, type) VALUES (?, ?, NOW(), ?)',
      [expect.stringMatching(/^backup-.*\.sql\.gz$/), 4096, 'local']
    );
    expect(mariadb.query).toHaveBeenCalledWith(
      'SELECT id, filename FROM backups WHERE type = ? ORDER BY created_at DESC, id DESC',
      ['local']
    );
  });
});
