'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
  getLineById: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../services/lineService', () => ({
  authenticateLine: jest.fn(),
  update: jest.fn(),
  normalizeLineRow: jest.fn((row) => row),
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

const lineService = require('../../../services/lineService');

describe('client routes CSRF protections', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildApp(session) {
    const router = require('../../../routes/client');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = session;
      next();
    });
    app.use('/api/client', router);
    return app;
  }

  it('requires a CSRF token for password changes', async () => {
    const session = { lineId: 1, lineUsername: 'demo', lineExpDate: 4102444800 };
    const app = buildApp(session);

    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1 } });
    lineService.update.mockResolvedValue({ id: 1 });

    await request(app)
      .put('/api/client/password')
      .send({ current_password: 'oldpass', new_password: 'newpass' })
      .expect(403);
  });

  it('accepts password changes with a valid CSRF token', async () => {
    const session = { lineId: 1, lineUsername: 'demo', lineExpDate: 4102444800 };
    const app = buildApp(session);

    const csrf = await request(app)
      .get('/api/client/csrf-token')
      .expect(200);

    lineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1 } });
    lineService.update.mockResolvedValue({ id: 1 });

    await request(app)
      .put('/api/client/password')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ current_password: 'oldpass', new_password: 'newpass' })
      .expect(200);

    expect(lineService.update).toHaveBeenCalledWith(1, { password: 'newpass' });
  });

  it('clears the client session on CSRF-protected logout', async () => {
    const session = {
      lineId: 9,
      lineUsername: 'logout-user',
      lineExpDate: 4102444800,
      portalRole: 'user',
    };
    const app = buildApp(session);

    const csrf = await request(app)
      .get('/api/client/csrf-token')
      .expect(200);

    await request(app)
      .post('/api/client/logout')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({})
      .expect(200);

    expect(session.lineId).toBeNull();
    expect(session.lineUsername).toBeNull();
    expect(session.portalRole).toBeNull();
  });
});
