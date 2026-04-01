'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'uuid-1'),
}));

jest.mock('../../../services/lineService', () => ({
  authenticateLine: jest.fn(),
  normalizeLineRow: jest.fn((line) => line),
  checkIpAllowed: jest.fn(() => true),
  checkUaAllowed: jest.fn(() => true),
  checkOutputAllowed: jest.fn(() => true),
  canConnect: jest.fn(async () => true),
  getLineBouquetIds: jest.fn(() => []),
  openConnection: jest.fn(async () => undefined),
  openRuntimeSession: jest.fn(async () => undefined),
}));

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
  reconcilePlacementClients: jest.fn(),
}));

jest.mock('../../../services/securityService', () => ({
  checkGeoIp: jest.fn(async () => ({ ok: true, country: 'US' })),
  generateStreamToken: jest.fn(async () => 'tok'),
  signStreamUrl: jest.fn(async () => 'sig'),
}));

jest.mock('../../../services/streamManager', () => ({
  getChannelStatus: jest.fn(() => ({ activeProcess: true })),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
}));

jest.mock('../../../lib/hlsIdle', () => ({
  touch: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  selectServer: jest.fn(),
  resolvePublicStreamOrigin: jest.fn(),
  isRuntimeReady: jest.fn(),
  getRuntimePlacementsForAsset: jest.fn(),
  selectFailoverServer: jest.fn(),
  selectProxyServer: jest.fn(),
  buildServerPublicBaseUrl: jest.fn(),
}));

jest.mock('../../../lib/on-demand-live', () => ({
  ensureOnDemandStreamIfNeeded: jest.fn(async () => undefined),
}));

const lineService = require('../../../services/lineService');
const serverService = require('../../../services/serverService');
const { channels } = require('../../../lib/state');

function buildApp() {
  const app = express();
  const router = require('../../../routes/stream');
  app.use(router);
  return app;
}

describe('stream route LB live redirect behavior', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
    channels.set('100', {
      status: 'running',
      outputFormat: 'ts',
      nginxStreaming: false,
      renditions: ['1080p'],
      renditionMode: 'single',
      on_demand: false,
      name: 'Channel 100',
    });
    // Re-apply persistent mock implementations after clearAllMocks
    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 7, username: 'alice', password: 'secret' } });
    lineService.openConnection.mockResolvedValue(undefined);
    lineService.openRuntimeSession.mockResolvedValue(undefined);
    serverService.resolvePublicStreamOrigin.mockResolvedValue('http://panel-origin.example');
    // Build app AFTER clearAllMocks so route module picks up fresh mock bindings
    app = buildApp();
  });

  it('redirects live playback through selector publicBaseUrl', async () => {
    // Use mockResolvedValue so both handleLive (first check) and redirectToLiveStream
    // (second check when runtime is ready) see the same ok result
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: 'http://edge.example', serverId: 3 });
    serverService.isRuntimeReady.mockResolvedValue({ ready: true, placement: { id: 7 } });
    serverService.getRuntimePlacementsForAsset.mockResolvedValue([{ id: 7, server_id: 3 }]);

    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('http://edge.example/streams/100/stream.ts');
    expect(serverService.selectServer).toHaveBeenCalledWith({
      assetType: 'live',
      assetId: '100',
      line: { id: 7, username: 'alice', password: 'secret' },
    });
  });

  it('falls back to panel/request origin when selector base is empty', async () => {
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: '' });

    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('http://panel-origin.example/streams/100/stream.ts');
    expect(serverService.resolvePublicStreamOrigin).toHaveBeenCalled();
  });
});
