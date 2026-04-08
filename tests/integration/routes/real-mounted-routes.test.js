'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
  getPackageById: jest.fn(),
  getFirstAdminUserId: jest.fn(),
  attachLinePassword: jest.fn((row) => row),
  getLineById: jest.fn(),
  deleteExpiredLines: jest.fn(),
  getAllUsers: jest.fn(),
  createUserGroup: jest.fn(),
  updateUserGroup: jest.fn(),
  getUserGroupById: jest.fn(),
  deleteUserGroup: jest.fn(),
  listActiveRuntimeSessionsByServer: jest.fn(),
  reconcilePlacementClients: jest.fn(),
  countActiveRuntimeSessionsByServer: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../lib/cache', () => ({
  invalidateLines: jest.fn().mockResolvedValue(true),
  invalidateVod: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../services/lineService', () => ({
  listAll: jest.fn(),
  normalizeLineRow: jest.fn((row) => row),
  getActiveConnections: jest.fn(),
  killConnections: jest.fn(),
  update: jest.fn(),
  createLine: jest.fn(),
  remove: jest.fn(),
  closeConnection: jest.fn().mockResolvedValue(true),
  closeRuntimeSession: jest.fn().mockResolvedValue(true),
  authenticateLine: jest.fn(),
}));

jest.mock('../../../services/vodService', () => ({
  listItems: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/importChannelBridge', () => ({
  importLiveChannel: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  listServers: jest.fn(),
  getServer: jest.fn(),
  createServer: jest.fn(),
  updateServer: jest.fn(),
  deleteServer: jest.fn(),
  reorderServers: jest.fn(),
  buildNginxUpstreamSnippet: jest.fn(),
  getRuntimePlacementsForServer: jest.fn(),
  getServerHealthStatus: jest.fn(),
  resolvePlaylistBaseUrl: jest.fn(),
  selectServer: jest.fn(),
  resolvePublicStreamOrigin: jest.fn(),
}));

jest.mock('../../../services/provisionService', () => ({
  isProvisioningEnabled: jest.fn(),
  startProvisionJob: jest.fn(),
  getJob: jest.fn(),
}));

jest.mock('../../../services/streamManager', () => ({
  issueRemoteCommand: jest.fn(),
}));

jest.mock('../../../services/playlistService', () => ({
  generatePlaylist: jest.fn(),
}));

jest.mock('../../../services/epgService', () => ({
  xmltv: jest.fn(),
}));

jest.mock('../../../services/importService', () => ({
  startMovieImport: jest.fn(),
  startSeriesImport: jest.fn(),
  startLiveImport: jest.fn(),
  startM3UImport: jest.fn(),
  getJob: jest.fn(),
  cancelJob: jest.fn(),
}));

jest.mock('../../../services/xcApiClient', () => ({
  XcApiClient: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const mariadb = require('../../../lib/mariadb');
const lineService = require('../../../services/lineService');
const vodService = require('../../../services/vodService');
const importChannelBridge = require('../../../lib/importChannelBridge');
const serverService = require('../../../services/serverService');
const streamManager = require('../../../services/streamManager');
const { XcApiClient } = require('../../../services/xcApiClient');

function buildApp(router, withSession = false) {
  const app = express();
  app.use(express.json());
  if (withSession) {
    app.use((req, _res, next) => {
      req.session = {
        lineId: 1,
        lineUsername: 'demo',
        lineExpDate: 4102444800,
        portalRole: 'user',
      };
      next();
    });
  }
  app.use('/api/admin', router);
  return app;
}

describe('Real mounted route coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('admin.lines router', () => {
    const router = require('../../../routes/admin.lines');

    it('passes bulk line options through the real router', async () => {
      const app = buildApp(router);
      dbApi.getPackageById.mockResolvedValue({ id: 1, name: 'Pkg' });
      mariadb.query.mockResolvedValue([]);
      lineService.createLine.mockResolvedValue({
        id: 10,
        username: 'bulk-user',
      });

      await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [
            { username: 'bulk-user', password: 'pass', exp_date: 1700000000 },
          ],
          package_id: 1,
          is_trial: true,
          bouquet: [1, 2, 3],
          max_connections: 5,
        })
        .expect(200);

      expect(lineService.createLine).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'bulk-user',
          package_id: 1,
          is_trial: 1,
          bouquet: [1, 2, 3],
          max_connections: 5,
          exp_date: 1700000000,
        })
      );
    });

    it('returns 500 from the real bulk router on query failure', async () => {
      const app = buildApp(router);
      dbApi.getPackageById.mockResolvedValue({ id: 1, name: 'Pkg' });
      mariadb.query.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'bulk-user', password: 'pass' }],
          package_id: 1,
        })
        .expect(500);

      expect(res.body).toHaveProperty('error', 'DB connection failed');
    });

    it('rejects invalid pagination query values with Joi validation', async () => {
      const app = buildApp(router);

      const res = await request(app)
        .get('/api/admin/lines?limit=abc')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(lineService.listAll).not.toHaveBeenCalled();
    });
  });

  describe('admin.movies router', () => {
    const router = require('../../../routes/admin.movies');

    it('rejects invalid movie create payloads with Joi validation', async () => {
      const app = buildApp(router);

      const res = await request(app)
        .post('/api/admin/movies')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(vodService.create).not.toHaveBeenCalled();
    });
  });

  describe('admin.channels router', () => {
    const router = require('../../../routes/admin.channels');

    it('rejects invalid live import payloads with Joi validation', async () => {
      const app = buildApp(router);
      dbApi.getFirstAdminUserId.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'https://example.com/stream.m3u8', category_id: 'bad' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(importChannelBridge.importLiveChannel).not.toHaveBeenCalled();
    });
  });

  describe('admin.users router', () => {
    const router = require('../../../routes/admin.users');

    it('uses current user-group defaults in the real router', async () => {
      const app = buildApp(router);
      dbApi.createUserGroup.mockResolvedValue(3);
      dbApi.updateUserGroup.mockResolvedValue(true);
      mariadb.query.mockResolvedValue([
        {
          group_id: 3,
          group_name: 'New Group',
          is_admin: 1,
          is_reseller: 0,
          member_count: 0,
        },
      ]);

      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: 'New Group', is_admin: true })
        .expect(201);

      expect(dbApi.createUserGroup).toHaveBeenCalledWith(
        expect.objectContaining({ is_admin: 1, is_reseller: 0 })
      );
      expect(res.body).toHaveProperty('group_name', 'New Group');
    });

    it('returns updated group data from the real router', async () => {
      const app = buildApp(router);
      dbApi.getUserGroupById.mockResolvedValue({
        group_id: 2,
        group_name: 'Old Name',
        is_admin: 0,
        is_reseller: 1,
      });
      dbApi.updateUserGroup.mockResolvedValue(true);
      mariadb.query.mockResolvedValue([
        {
          group_id: 2,
          group_name: 'Updated Name',
          is_admin: 0,
          is_reseller: 1,
          member_count: 0,
        },
      ]);

      const res = await request(app)
        .put('/api/admin/user-groups/2')
        .send({ group_name: 'Updated Name' })
        .expect(200);

      expect(res.body).toHaveProperty('group_name', 'Updated Name');
    });
  });

  describe('admin.servers router', () => {
    const router = require('../../../routes/admin.servers');

    it('keeps reorder separate from numeric id routes', async () => {
      const app = buildApp(router);
      serverService.reorderServers.mockResolvedValue(true);

      await request(app)
        .put('/api/admin/servers/reorder')
        .send([{ id: 1, sort_order: 1 }])
        .expect(200);

      expect(serverService.reorderServers).toHaveBeenCalledWith([
        { id: 1, sort_order: 1 },
      ]);
    });

    it('returns 404 for non-numeric server ids on real numeric routes', async () => {
      const app = buildApp(router);
      await request(app).get('/api/admin/servers/invalid').expect(404);
    });

    it('returns 500 for kill-connections dependency failures', async () => {
      const app = buildApp(router);
      serverService.getServer.mockResolvedValue({ id: 1, name: 'Server 1' });
      dbApi.listActiveRuntimeSessionsByServer.mockRejectedValue(
        new Error('query failed')
      );

      const res = await request(app)
        .post('/api/admin/servers/1/actions/kill-connections')
        .expect(500);

      expect(res.body).toHaveProperty('error', 'query failed');
    });
  });

  describe('admin.providers router', () => {
    const router = require('../../../routes/admin.providers');

    it('uses the real provider route with import provider DB helpers', async () => {
      const app = buildApp(router);
      dbApi.getImportProviderById = jest.fn().mockResolvedValue({
        id: 7,
        name: 'Provider 7',
        url: 'http://example.com/player_api.php?username=u&password=p',
      });

      const ping = jest.fn().mockResolvedValue(true);
      XcApiClient.mockImplementation(() => ({
        validate: () => true,
        ping,
      }));

      const res = await request(app)
        .post('/api/admin/providers/7/validate')
        .expect(200);

      expect(dbApi.getImportProviderById).toHaveBeenCalledWith(7);
      expect(ping).toHaveBeenCalled();
      expect(res.body).toEqual({ ok: true, message: 'Connection OK' });
    });
  });

  describe('client router', () => {
    const router = require('../../../routes/client');
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(() => {
      process.env.NODE_ENV = 'development';
    });

    afterAll(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    function buildClientApp() {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.session = {
          lineId: 1,
          lineUsername: 'demo',
          lineExpDate: 4102444800,
          portalRole: 'user',
        };
        next();
      });
      app.use('/api/client', router);
      return app;
    }

    it('enforces CSRF on the real client password route', async () => {
      const app = buildClientApp();
      lineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1 },
      });
      lineService.update.mockResolvedValue({ id: 1 });

      await request(app)
        .put('/api/client/password')
        .send({ current_password: 'old', new_password: 'new' })
        .expect(403);
    });
  });
});
