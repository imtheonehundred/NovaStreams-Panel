'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'uuid-signing'),
}));

jest.mock('../../../services/lineService', () => ({
  authenticateLine: jest.fn(),
  normalizeLineRow: jest.fn((line) => line),
  checkIpAllowed: jest.fn(() => true),
  checkUaAllowed: jest.fn(() => true),
  checkOutputAllowed: jest.fn(() => true),
  canConnect: jest.fn(async () => true),
  getLineBouquetIds: jest.fn(() => []),
  isStreamInBouquet: jest.fn(async () => true),
  openConnection: jest.fn(async () => undefined),
  openRuntimeSession: jest.fn(async () => undefined),
}));

jest.mock('../../../lib/db', () => ({
  reconcilePlacementClients: jest.fn(),
  getMatchingResellerExpiryMedia: jest.fn(),
  touchLineExpirationMedia: jest.fn(),
}));

jest.mock('../../../services/securityService', () => ({
  checkGeoIp: jest.fn(async () => ({ ok: true, country: 'US' })),
  generateStreamToken: jest.fn(),
  signStreamUrl: jest.fn(),
}));

jest.mock('../../../services/streamManager', () => ({
  getChannelStatus: jest.fn(() => ({ activeProcess: true })),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
}));

jest.mock('../../../lib/hlsIdle', () => ({ touch: jest.fn() }));

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
const dbApi = require('../../../lib/db');
const securityService = require('../../../services/securityService');
const serverService = require('../../../services/serverService');
const { channels } = require('../../../lib/state');

function buildApp() {
  const app = express();
  app.use(require('../../../routes/stream'));
  return app;
}

describe('stream signing-sensitive redirect flows', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
    channels.set('100', {
      id: '100',
      status: 'running',
      outputFormat: 'ts',
      nginxStreaming: false,
      renditions: ['1080p'],
      renditionMode: 'single',
      on_demand: false,
      name: 'Channel 100',
    });
    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 7, username: 'alice', password: 'secret' } });
    securityService.generateStreamToken.mockImplementation(async (lineId) => (lineId === null ? 'proxy-token' : 'panel-token'));
    securityService.signStreamUrl.mockImplementation(async (token) => (token === 'proxy-token' ? 'proxy-sig' : 'panel-sig'));
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: 'http://edge.example', serverId: 2 });
    serverService.resolvePublicStreamOrigin.mockResolvedValue('http://panel.example');
    serverService.isRuntimeReady.mockResolvedValue({ ready: true, placement: { id: 5 } });
    serverService.getRuntimePlacementsForAsset.mockResolvedValue([{ id: 5, server_id: 2 }]);
    serverService.selectFailoverServer.mockResolvedValue(null);
    serverService.selectProxyServer.mockResolvedValue(null);
    serverService.buildServerPublicBaseUrl.mockReturnValue('http://proxy.example');
    app = buildApp();
  });

  it('redirects direct live playback with a signed token query on the selected origin', async () => {
    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/edge\.example\/streams\/100\/stream\.ts\?token=panel-token&expires=\d+&sig=panel-sig$/);
    expect(securityService.generateStreamToken).toHaveBeenCalledWith(7, '100', 'ts', 3600);
    expect(securityService.signStreamUrl).toHaveBeenCalledWith('panel-token', expect.any(Number), '100');
    expect(lineService.openRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      lineId: 7,
      streamType: 'live',
      streamId: '100',
      originServerId: 2,
      proxyServerId: null,
      sessionUuid: 'uuid-signing',
    }));
  });

  it('keeps live playback on the origin URL shape even when a proxy server exists', async () => {
    serverService.selectProxyServer.mockResolvedValue({
      serverId: 9,
      server: { public_host: 'proxy.example' },
      health: { fresh: true },
    });

    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/edge\.example\/streams\/100\/stream\.ts\?token=panel-token&expires=\d+&sig=panel-sig$/);
    expect(securityService.generateStreamToken).toHaveBeenCalledTimes(1);
    expect(securityService.generateStreamToken).toHaveBeenCalledWith(7, '100', 'ts', 3600);
    expect(lineService.openRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      originServerId: 2,
      proxyServerId: null,
    }));
  });

  it('does not open a remote runtime session when live playback falls back panel-local', async () => {
    serverService.isRuntimeReady.mockResolvedValue({ ready: false });
    serverService.selectFailoverServer.mockResolvedValue(null);

    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/panel\.example\/streams\/100\/stream\.ts\?token=panel-token&expires=\d+&sig=panel-sig$/);
    expect(lineService.openConnection).toHaveBeenCalled();
    expect(lineService.openRuntimeSession).not.toHaveBeenCalled();
    expect(dbApi.reconcilePlacementClients).not.toHaveBeenCalled();
  });
});
