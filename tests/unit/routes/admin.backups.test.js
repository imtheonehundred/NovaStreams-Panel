'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
  getAccessCodeById: jest.fn(),
  findUserById: jest.fn(),
  isAdmin: jest.fn(),
}));

jest.mock('../../../lib/cache', () => ({
  cacheMiddleware: jest.fn(() => (_req, _res, next) => next()),
  keys: new Proxy({}, { get: (_target, prop) => String(prop) }),
  TTL: new Proxy({}, { get: () => 0 }),
  invalidateVod: jest.fn(),
  invalidateSeries: jest.fn(),
  invalidateCategories: jest.fn(),
  invalidateBouquets: jest.fn(),
  invalidateSettings: jest.fn(),
  invalidateLines: jest.fn(),
  invalidateEpisodes: jest.fn(),
}));

jest.mock('../../../services/lineService', () => ({}));
jest.mock('../../../services/serverService', () => ({}));
jest.mock('../../../services/provisionService', () => ({
  isProvisioningEnabled: jest.fn(),
}));
jest.mock('../../../services/streamManager', () => ({}));
jest.mock('../../../services/categoryService', () => ({}));
jest.mock('../../../services/bouquetService', () => ({}));
jest.mock('../../../services/packageService', () => ({}));
jest.mock('../../../services/vodService', () => ({}));
jest.mock('../../../services/seriesService', () => ({}));
jest.mock('../../../services/epgService', () => ({}));
jest.mock('../../../services/tmdbService', () => ({}));
jest.mock('../../../services/importService', () => ({}));
jest.mock('../../../services/dbService', () => ({}));
jest.mock('../../../services/xcApiClient', () => ({ XcApiClient: jest.fn() }));
jest.mock('../../../lib/importChannelBridge', () => ({}));
jest.mock('../../../lib/state', () => ({ channels: new Map() }));
jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../../../lib/streaming-settings', () => ({}));
jest.mock('../../../services/backupService', () => ({
  initBackupTable: jest.fn(),
  listBackups: jest.fn(),
  getLocalBackupRetentionLimit: jest.fn(),
  createBackup: jest.fn(),
  getBackupPath: jest.fn(),
  restoreBackup: jest.fn(),
  deleteBackupFile: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const mariadb = require('../../../lib/mariadb');
const backupService = require('../../../services/backupService');
const provisionService = require('../../../services/provisionService');

function buildApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/admin', require('../../../routes/admin'));
  return app;
}

describe('admin backup contracts', () => {
  let session;
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    session = { userId: 9, portalRole: 'admin', accessCodeId: 77, accessCode: 'ADMIN77' };
    dbApi.getAccessCodeById.mockResolvedValue({ id: 77, code: 'ADMIN77', role: 'admin', enabled: 1 });
    dbApi.findUserById.mockResolvedValue({ id: 9, username: 'root', status: 1 });
    dbApi.isAdmin.mockResolvedValue(true);
    provisionService.isProvisioningEnabled.mockResolvedValue(true);
    backupService.initBackupTable.mockResolvedValue(undefined);
    backupService.listBackups.mockResolvedValue([{ id: 1, filename: 'backup-a.sql.gz', is_restorable: true }]);
    backupService.getLocalBackupRetentionLimit.mockResolvedValue(12);
    backupService.createBackup.mockResolvedValue({ filename: 'backup-new.sql.gz' });
    backupService.getBackupPath.mockResolvedValue('/tmp/backup-a.sql.gz');
    backupService.restoreBackup.mockResolvedValue({ ok: true, safetyBackup: { filename: 'backup-safety.sql.gz' } });
    backupService.deleteBackupFile.mockResolvedValue(undefined);
    mariadb.query.mockResolvedValue([]);
    app = buildApp(session);
  });

  it('returns backup inventory together with the retention limit', async () => {
    const res = await request(app).get('/api/admin/backups');

    expect(res.status).toBe(200);
    expect(backupService.initBackupTable).toHaveBeenCalled();
    expect(res.body).toEqual({
      backups: [{ id: 1, filename: 'backup-a.sql.gz', is_restorable: true }],
      retentionLimit: 12,
    });
  });

  it('rejects restore requests whose confirmFilename does not exactly match the backup filename', async () => {
    mariadb.query.mockResolvedValue([{ filename: 'backup-a.sql.gz', type: 'local' }]);

    const res = await request(app)
      .post('/api/admin/backups/1/restore')
      .send({ confirmFilename: 'backup-b.sql.gz' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('confirmFilename must exactly match the backup filename');
    expect(backupService.restoreBackup).not.toHaveBeenCalled();
  });

  it('restores only local backups and returns the safety backup metadata', async () => {
    mariadb.query.mockResolvedValue([{ filename: 'backup-a.sql.gz', type: 'local' }]);

    const res = await request(app)
      .post('/api/admin/backups/1/restore')
      .send({ confirmFilename: 'backup-a.sql.gz' });

    expect(res.status).toBe(200);
    expect(backupService.restoreBackup).toHaveBeenCalledWith('backup-a.sql.gz');
    expect(res.body).toEqual({ ok: true, safetyBackup: { filename: 'backup-safety.sql.gz' } });
  });

  it('rejects restore attempts for non-local backups before invoking backupService', async () => {
    mariadb.query.mockResolvedValue([{ filename: 'backup-cloud.sql.gz', type: 's3' }]);

    const res = await request(app)
      .post('/api/admin/backups/5/restore')
      .send({ confirmFilename: 'backup-cloud.sql.gz' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('only local backups can be restored');
    expect(backupService.restoreBackup).not.toHaveBeenCalled();
  });

  it('rejects admin requests when the access-code session is no longer valid', async () => {
    dbApi.getAccessCodeById.mockResolvedValue(null);

    const res = await request(app).get('/api/admin/features');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access code invalid');
    expect(session.userId).toBeNull();
    expect(session.portalRole).toBeNull();
    expect(session.accessCode).toBeNull();
    expect(session.accessCodeId).toBeNull();
  });
});
