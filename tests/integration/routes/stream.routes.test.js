'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

describe('Stream Routes - Route Contract Tests', () => {
  let app;
  let streamRouter;
  let mockLineService;
  let mockDbApi;
  let mockSecurityService;
  let mockStreamManager;
  let mockServerService;
  let mockOnDemandLive;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      authenticateLine: jest.fn(),
      normalizeLineRow: jest.fn((r) => r),
      checkIpAllowed: jest.fn(() => true),
      checkUaAllowed: jest.fn(() => true),
      checkOutputAllowed: jest.fn(() => true),
      canConnect: jest.fn(() => Promise.resolve(true)),
      getLineBouquetIds: jest.fn(() => []),
      isStreamInBouquet: jest.fn(() => Promise.resolve(true)),
    };

    mockDbApi = {
      getAllSettings: jest.fn(() => Promise.resolve({})),
      getSetting: jest.fn(),
      getMovieById: jest.fn(),
      getEpisodeById: jest.fn(),
    };

    mockSecurityService = {
      checkGeoIp: jest.fn(() => Promise.resolve({ ok: true })),
    };

    mockStreamManager = {
      getChannelStatus: jest.fn(() => ({ activeProcess: false })),
    };

    mockServerService = {
      selectServer: jest.fn(() => Promise.resolve({ serverId: 0 })),
    };

    mockOnDemandLive = {
      ensureOnDemandStreamIfNeeded: jest.fn(),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/db', () => mockDbApi);
    jest.mock('../../../services/securityService', () => mockSecurityService);
    jest.mock('../../../services/streamManager', () => mockStreamManager);
    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../lib/on-demand-live', () => mockOnDemandLive);
    jest.mock('../../../lib/state', () => ({
      channels: new Map(),
      processes: new Map(),
    }));

    streamRouter = require('../../../routes/stream');
    app = express();
    app.use('/', streamRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /live/:username/:password/:file', () => {
    it('should reject invalid credentials with 403', async () => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: false, line: null });

      const res = await request(app)
        .get('/live/invaliduser/invalidpass/1.ts')
        .expect(403);

      expect(res.text).toMatch(/Forbidden|Invalid credentials/i);
    });

    it('should reject when line is banned/disabled', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: false,
        line: { id: 1, username: 'test' },
        error_code: 'BANNED',
      });

      const res = await request(app)
        .get('/live/banneduser/testpass/1.ts')
        .expect(403);

      expect(res.text).toMatch(/banned|disabled/i);
    });

    it('should reject when max connections exceeded', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser', max_connections: 1 },
      });
      mockLineService.checkOutputAllowed.mockReturnValue(true);
      mockLineService.canConnect.mockResolvedValue(false);

      const res = await request(app)
        .get('/live/testuser/testpass/1.ts')
        .expect(429);

      expect(res.text).toMatch(/too many connections/i);
    });

    it('should return 400 for invalid stream file format', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });

      const res = await request(app)
        .get('/live/testuser/testpass/invalid')
        .expect(400);
    });
  });

  describe('GET /movie/:username/:password/:file', () => {
    it('should reject invalid credentials with 403', async () => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: false, line: null });

      const res = await request(app)
        .get('/movie/invaliduser/invalidpass/1.mp4')
        .expect(403);

      expect(res.text).toMatch(/Forbidden|Invalid credentials/i);
    });

    it('should return 400 for invalid movie id', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });
      mockLineService.canConnect.mockResolvedValue(true);

      const res = await request(app)
        .get('/movie/testuser/testpass/abc.mp4')
        .expect(400);

      expect(res.text).toMatch(/invalid/i);
    });

    it('should return 404 when movie not found', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });
      mockLineService.canConnect.mockResolvedValue(true);
      mockDbApi.getMovieById.mockResolvedValue(null);

      const res = await request(app)
        .get('/movie/testuser/testpass/99999.mp4')
        .expect(404);

      expect(res.text).toMatch(/not found/i);
    });

    it('should reject when max connections exceeded', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });
      mockLineService.canConnect.mockResolvedValue(false);

      const res = await request(app)
        .get('/movie/testuser/testpass/1.mp4')
        .expect(429);

      expect(res.text).toMatch(/too many connections/i);
    });
  });

  describe('GET /series/:username/:password/:file', () => {
    it('should reject invalid credentials with 403', async () => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: false, line: null });

      const res = await request(app)
        .get('/series/invaliduser/invalidpass/1.mp4')
        .expect(403);

      expect(res.text).toMatch(/Forbidden|Invalid credentials/i);
    });

    it('should return 404 when episode not found', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });
      mockLineService.canConnect.mockResolvedValue(true);
      mockDbApi.getEpisodeById.mockResolvedValue(null);

      const res = await request(app)
        .get('/series/testuser/testpass/99999.mp4')
        .expect(404);

      expect(res.text).toMatch(/not found/i);
    });

    it('should reject when max connections exceeded', async () => {
      mockLineService.authenticateLine.mockResolvedValue({
        ok: true,
        line: { id: 1, username: 'testuser' },
      });
      mockDbApi.getEpisodeById.mockResolvedValue({ id: 1, series_id: 1, stream_source: 'http://test.com' });
      mockLineService.canConnect.mockResolvedValue(false);

      const res = await request(app)
        .get('/series/testuser/testpass/1.mp4')
        .expect(429);

      expect(res.text).toMatch(/too many connections/i);
    });
  });

  describe('Route sanitization', () => {
    it('should treat reserved words as route segments, not credentials', async () => {
      const res = await request(app)
        .get('/api/testuser/testpass/1.ts')
        .expect(404);

      expect(res.status).toBe(404);
    });
  });
});
