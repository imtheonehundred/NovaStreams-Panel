'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'uuid-expiry'),
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
  isStreamInBouquet: jest.fn(async () => true),
}));

jest.mock('../../../lib/db', () => ({
  getMatchingResellerExpiryMedia: jest.fn(),
  touchLineExpirationMedia: jest.fn(),
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
const serverService = require('../../../services/serverService');

function buildApp() {
  const app = express();
  app.use(require('../../../routes/stream'));
  return app;
}

describe('stream expiry media redirects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: 'http://edge.example', serverId: 2 });
    serverService.resolvePublicStreamOrigin.mockResolvedValue('http://panel.example');
    serverService.isRuntimeReady.mockResolvedValue({ ready: true, placement: { id: 5 } });
    serverService.getRuntimePlacementsForAsset.mockResolvedValue([{ id: 5, server_id: 2 }]);
  });

  it('redirects expired users to their owner reseller expiry media', async () => {
    const app = buildApp();
    lineService.authenticateLine.mockResolvedValue({
      ok: false,
      error_code: 'EXPIRED',
      line: { id: 7, username: 'alice', password: 'secret', member_id: 12, exp_date: 1 },
    });
    dbApi.getMatchingResellerExpiryMedia.mockResolvedValue({ media_url: 'https://reseller-a.example/expired.m3u8' });

    const res = await request(app).get('/live/alice/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://reseller-a.example/expired.m3u8');
  });

  it('redirects expiring-soon users to reseller warning media and throttles the reminder state', async () => {
    const app = buildApp();
    lineService.authenticateLine.mockResolvedValue({
      ok: true,
      error_code: null,
      line: { id: 8, username: 'bob', password: 'secret', member_id: 33, exp_date: Math.floor(Date.now() / 1000) + 3600, last_expiration_video: 0 },
    });
    dbApi.getMatchingResellerExpiryMedia.mockResolvedValue({
      media_url: 'https://reseller-b.example/warn.m3u8',
      warning_window_days: 7,
      repeat_interval_hours: 6,
    });

    const res = await request(app).get('/live/bob/secret/100.ts');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://reseller-b.example/warn.m3u8');
    expect(dbApi.touchLineExpirationMedia).toHaveBeenCalledWith(8, expect.any(Number));
    expect(serverService.selectServer).not.toHaveBeenCalled();
  });
});
