'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

const { spawn } = require('child_process');
const { promises: dns } = require('dns');

describe('channel probe-source hardening', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  function buildRouter(dbApi) {
    const channelRoutes = require('../../../routes/channels');
    return channelRoutes({
      requireAuth: (req, _res, next) => {
        req.userId = 77;
        next();
      },
      createImportedChannel: jest.fn(),
      parseExtractionDump: jest.fn(),
      channels: new Map(),
      processes: new Map(),
      tsBroadcasts: new Map(),
      bouquetService: { getBouquetIdsMapForChannels: jest.fn().mockResolvedValue(new Map()) },
      dbApi,
      isMovieChannel: jest.fn(() => false),
      isInternalChannel: jest.fn(() => false),
      serverService: {},
      STREAMING_MODE: 'node',
      hlsIdle: {},
      securityService: {},
      ALLOW_ADMIN_PREVIEW_UNSIGNED_TS: false,
      ALLOW_LOCAL_UNSIGNED_TS: false,
      restartWithSeamlessIfPossible: jest.fn(),
      applyStabilityFix: jest.fn(),
      persistChannel: jest.fn(),
      qoeRate: jest.fn(),
      clamp: jest.fn(),
      computeQoeScore: jest.fn(),
      computeFinalScore: jest.fn(),
      startChannel: jest.fn(),
      stopChannel: jest.fn(),
      mergeChannelOptions: jest.fn(),
      normalizeSourceQueue: jest.fn(),
      resolveEffectiveInputType: jest.fn(),
      normalizeHex32: jest.fn(),
      WATERMARKS_DIR: '/tmp',
      mpegtsMultiConflict: jest.fn(),
      rootDir: '/tmp',
      path: require('path'),
      fs: require('fs'),
      uuidv4: () => 'test-id',
    });
  }

  function buildApp(dbApi) {
    const app = express();
    app.use(express.json());
    app.use('/api', buildRouter(dbApi));
    return app;
  }

  it('requires admin access for probe-source', async () => {
    const dbApi = { isAdmin: jest.fn().mockResolvedValue(false) };
    const app = buildApp(dbApi);

    await request(app)
      .post('/api/channels/probe-source')
      .send({ url: 'http://example.com/stream.m3u8' })
      .expect(403);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects user-supplied HTTP proxies', async () => {
    const dbApi = { isAdmin: jest.fn().mockResolvedValue(true) };
    const app = buildApp(dbApi);

    await request(app)
      .post('/api/channels/probe-source')
      .send({ url: 'http://example.com/stream.m3u8', http_proxy: 'http://1.2.3.4:8080' })
      .expect(400);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects loopback and private hosts before spawning ffprobe', async () => {
    const dbApi = { isAdmin: jest.fn().mockResolvedValue(true) };
    const app = buildApp(dbApi);

    await request(app)
      .post('/api/channels/probe-source')
      .send({ url: 'http://127.0.0.1/internal.m3u8' })
      .expect(400);

    expect(spawn).not.toHaveBeenCalled();
  });
});
