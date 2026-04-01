'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
  getLineById: jest.fn(),
  attachLinePassword: jest.fn((row) => row),
}));

jest.mock('../../../services/lineService', () => ({
  authenticateLine: jest.fn(),
  normalizeLineRow: jest.fn((row) => row),
  update: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../services/playlistService', () => ({
  generatePlaylist: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  resolvePlaylistBaseUrl: jest.fn(),
  selectServer: jest.fn(),
  resolvePublicStreamOrigin: jest.fn(),
}));

jest.mock('../../../services/epgService', () => ({
  xmltv: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const lineService = require('../../../services/lineService');
const mariadb = require('../../../lib/mariadb');
const playlistService = require('../../../services/playlistService');
const serverService = require('../../../services/serverService');
const epgService = require('../../../services/epgService');

function buildApp(session = { lineId: 7, lineUsername: 'alice', lineExpDate: 9999999999 }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { ...session };
    next();
  });
  app.use('/api/client', require('../../../routes/client'));
  return app;
}

describe('client routes cleanup regression coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mariadb.query.mockResolvedValue([]);
    mariadb.queryOne.mockResolvedValue(null);
    mariadb.execute.mockResolvedValue({ affectedRows: 1 });
    serverService.resolvePlaylistBaseUrl.mockResolvedValue('http://panel.example');
    serverService.selectServer.mockResolvedValue({ publicBaseUrl: 'http://edge.example' });
    serverService.resolvePublicStreamOrigin.mockResolvedValue('http://panel.example');
    playlistService.generatePlaylist.mockResolvedValue('#EXTM3U');
    epgService.xmltv.mockResolvedValue('<tv/>');
  });

  it('authenticates /me through bearer access_token and returns line status details', async () => {
    const app = buildApp({});
    mariadb.queryOne
      .mockResolvedValueOnce({ id: 7, username: 'alice', exp_date: Math.floor(Date.now() / 1000) + 3600, enabled: 1, admin_enabled: 1 })
      .mockResolvedValueOnce({
        id: 7,
        username: 'alice',
        exp_date: Math.floor(Date.now() / 1000) + 3600,
        enabled: 1,
        max_connections: 2,
        package_name: 'Gold',
      })
      .mockResolvedValueOnce({ c: 1 });

    const res = await request(app)
      .get('/api/client/me')
      .set('Authorization', 'Bearer token-123');

    expect(res.status).toBe(200);
    expect(mariadb.queryOne).toHaveBeenNthCalledWith(
      1,
      'SELECT id, username, exp_date, enabled, admin_enabled FROM `lines` WHERE access_token = ? LIMIT 1',
      ['token-123']
    );
    expect(res.body).toMatchObject({
      id: 7,
      username: 'alice',
      expired: false,
      enabled: true,
      max_connections: 2,
      active_connections: 1,
      package_name: 'Gold',
    });
  });

  it('rejects expired bearer tokens before exposing client data', async () => {
    const app = buildApp({});
    mariadb.queryOne.mockResolvedValueOnce({
      id: 7,
      username: 'alice',
      exp_date: Math.floor(Date.now() / 1000) - 10,
      enabled: 1,
      admin_enabled: 1,
    });

    const res = await request(app)
      .get('/api/client/me')
      .set('Authorization', 'Bearer expired-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('uses lineService authenticateLine result shape for client login', async () => {
    const app = buildApp({});
    lineService.authenticateLine.mockResolvedValue({
      ok: true,
      line: { id: 9, username: 'alice', exp_date: 9999999999 },
    });

    const res = await request(app).post('/api/client/login').send({ username: 'alice', password: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.line).toEqual({ id: 9, username: 'alice' });
  });

  it('updates client password through the hashed line auth flow', async () => {
    const app = buildApp();
    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 7, username: 'alice' } });
    lineService.update.mockResolvedValue({ id: 7, username: 'alice' });

    const res = await request(app)
      .put('/api/client/password')
      .send({ current_password: 'secret', new_password: 'new-secret' });

    expect(res.status).toBe(200);
    expect(lineService.authenticateLine).toHaveBeenCalledWith('alice', 'secret');
    expect(lineService.update).toHaveBeenCalledWith(7, { password: 'new-secret' });
  });

  it('rejects password changes when the current password is invalid', async () => {
    const app = buildApp();
    lineService.authenticateLine.mockResolvedValue({ ok: false, line: null, error_code: 'INVALID' });

    const res = await request(app)
      .put('/api/client/password')
      .send({ current_password: 'wrong-secret', new_password: 'new-secret' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('current password incorrect');
    expect(lineService.update).not.toHaveBeenCalled();
  });

  it('loads client connections from lines_activity.user_id and maps active rows', async () => {
    const app = buildApp();
    mariadb.query.mockResolvedValue([
      { ip: '1.2.3.4', user_agent: 'VLC', date_start: 100, date_end: null, active: 1 },
    ]);

    const res = await request(app).get('/api/client/connections');

    expect(res.status).toBe(200);
    expect(mariadb.query.mock.calls[0][0]).toContain('WHERE user_id = ?');
    expect(res.body.connections[0]).toMatchObject({ ip: '1.2.3.4', active: 1 });
  });

  it('generates client playlist through playlistService and canonical selector helpers', async () => {
    const app = buildApp();
    dbApi.getLineById.mockResolvedValue({ id: 7, username: 'alice', password: 'secret', bouquet: [] });
    lineService.normalizeLineRow.mockReturnValue({ id: 7, username: 'alice', password: 'secret', bouquet: [] });

    const res = await request(app).get('/api/client/playlist');

    expect(res.status).toBe(200);
    expect(playlistService.generatePlaylist).toHaveBeenCalled();
    expect(res.text).toBe('#EXTM3U');
    expect(res.headers['content-type']).toMatch(/mpegurl/);
  });

  it('exports EPG through epgService using the normalized bouquet list', async () => {
    const app = buildApp();
    dbApi.getLineById.mockResolvedValue({ id: 7, bouquet: '[1,2]' });
    lineService.normalizeLineRow.mockReturnValue({ id: 7, bouquet: [1, 2] });

    const res = await request(app).get('/api/client/epg');

    expect(res.status).toBe(200);
    expect(epgService.xmltv).toHaveBeenCalledWith([1, 2]);
    expect(res.text).toBe('<tv/>');
  });
});
