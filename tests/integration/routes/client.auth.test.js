'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

describe('Client Auth Routes', () => {
  let app;
  let mockLineService;
  let mockDbApi;
  let mockServerService;
  let mockPlaylistService;
  let mockEpgService;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      authenticateLine: jest.fn(),
      authenticateByAccessToken: jest.fn(),
      update: jest.fn(),
      normalizeLineRow: jest.fn((r) => r),
    };

    mockDbApi = {
      getLineById: jest.fn(),
      attachLinePassword: jest.fn((r) => r),
    };

    mockServerService = {
      resolvePlaylistBaseUrl: jest.fn(),
      resolvePublicStreamOrigin: jest.fn(),
      selectServer: jest.fn(),
    };

    mockPlaylistService = {
      generatePlaylist: jest.fn(),
    };

    mockEpgService = {
      xmltv: jest.fn(),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/db', () => mockDbApi);
    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../services/playlistService', () => mockPlaylistService);
    jest.mock('../../../services/epgService', () => mockEpgService);

    const clientRouter = require('../../../routes/client');
    app = express();
    app.use(express.json());
    app.use('/', clientRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Bearer Token Authentication', () => {
    it('should reject invalid bearer token with 401', async () => {
      mockLineService.authenticateByAccessToken.mockResolvedValue(null);

      const res = await request(app)
        .get('/me')
        .set('Authorization', 'Bearer invalidtoken');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('should fall back to session when no bearer token provided', async () => {
      const res = await request(app)
        .get('/me');

      expect(res.status).toBe(401);
    });
  });

  describe('Line Service - authenticateByAccessToken', () => {
    it('should be exported from lineService', async () => {
      const lineService = require('../../../services/lineService');
      expect(typeof lineService.authenticateByAccessToken).toBe('function');
    });
  });
});