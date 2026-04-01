'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../services/lineService', () => ({
  authenticateLine: jest.fn(),
  normalizeLineRow: jest.fn((line) => line),
}));

jest.mock('../../../services/playlistService', () => ({
  generatePlaylist: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  resolvePlaylistBaseUrl: jest.fn(),
  selectServer: jest.fn(),
  resolvePublicStreamOrigin: jest.fn(),
}));

const lineService = require('../../../services/lineService');
const playlistService = require('../../../services/playlistService');
const serverService = require('../../../services/serverService');

function buildApp() {
  const app = express();
  const router = require('../../../routes/playlist');
  app.use(router);
  return app;
}

describe('playlist route LB behavior', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'alice', password: 'secret' } });
    serverService.resolvePlaylistBaseUrl.mockResolvedValue('http://panel.example');
    serverService.resolvePublicStreamOrigin.mockResolvedValue('http://panel-origin.example');
  });

  it('uses selector publicBaseUrl for playlist asset URLs', async () => {
    let resolvedUrl = null;
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: 'http://lb.example' });
    playlistService.generatePlaylist.mockImplementation(async (_line, opt) => {
      resolvedUrl = await opt.resolveAssetBaseUrl('live', '100');
      return resolvedUrl;
    });

    const res = await request(app).get('/get.php?username=alice&password=secret');

    expect(res.status).toBe(200);
    expect(resolvedUrl).toBe('http://lb.example');
    expect(serverService.selectServer).toHaveBeenCalledWith({
      assetType: 'live',
      assetId: '100',
      line: { id: 1, username: 'alice', password: 'secret' },
    });
  });

  it('falls back to panel/request origin when selector base is empty', async () => {
    let resolvedUrl = null;
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: '' });
    playlistService.generatePlaylist.mockImplementation(async (_line, opt) => {
      resolvedUrl = await opt.resolveAssetBaseUrl('live', '100');
      return resolvedUrl;
    });

    const res = await request(app).get('/get.php?username=alice&password=secret');

    expect(res.status).toBe(200);
    expect(resolvedUrl).toBe('http://panel-origin.example');
    expect(serverService.resolvePublicStreamOrigin).toHaveBeenCalled();
  });
});
