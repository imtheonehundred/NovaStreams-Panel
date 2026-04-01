'use strict';

const request = require('supertest');
const express = require('express');

function buildApp(dbApi, session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  const router = require('../../../routes/auth')(dbApi, (_req, _res, next) => next());
  app.use('/api/auth', router);
  return app;
}

describe('auth reseller/admin status enforcement', () => {
  let dbApi;

  beforeEach(() => {
    jest.resetModules();
    dbApi = {
      userCount: jest.fn().mockResolvedValue(1),
      findUserById: jest.fn(),
      findUserByUsername: jest.fn(),
      verifyPassword: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(false),
      isReseller: jest.fn().mockResolvedValue(true),
      touchUserLastLogin: jest.fn().mockResolvedValue(undefined),
      touchAccessCodeUsage: jest.fn().mockResolvedValue(undefined),
      getAccessCodeById: jest.fn(),
      createUser: jest.fn(),
      listApiKeys: jest.fn(),
      createApiKey: jest.fn(),
      deleteApiKey: jest.fn(),
    };
  });

  it('rejects disabled accounts on login before creating a session', async () => {
    dbApi.getAccessCodeById.mockResolvedValue({ id: 11, role: 'reseller', code: 'R11', enabled: 1 });
    const app = buildApp(dbApi, { portalRole: 'reseller', accessCodeId: 11 });
    dbApi.findUserByUsername.mockResolvedValue({ id: 7, username: 'reseller1', status: 0, password_hash: 'x' });

    const res = await request(app).post('/api/auth/login').send({ username: 'reseller1', password: 'secret' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Account disabled');
    expect(dbApi.touchUserLastLogin).not.toHaveBeenCalled();
  });

  it('updates last_login on successful reseller login', async () => {
    dbApi.getAccessCodeById.mockResolvedValue({ id: 22, role: 'reseller', code: 'R22', enabled: 1 });
    const app = buildApp(dbApi, { portalRole: 'reseller', accessCodeId: 22 });
    dbApi.findUserByUsername.mockResolvedValue({ id: 8, username: 'reseller2', status: 1, password_hash: 'x' });

    const res = await request(app).post('/api/auth/login').send({ username: 'reseller2', password: 'secret' });

    expect(res.status).toBe(200);
    expect(dbApi.touchUserLastLogin).toHaveBeenCalledWith(8);
    expect(dbApi.touchAccessCodeUsage).toHaveBeenCalledWith(22);
  });

  it('clears disabled users from /me session state', async () => {
    const app = buildApp(dbApi, { userId: 9, portalRole: 'admin' });
    dbApi.findUserById.mockResolvedValue({ id: 9, username: 'admin1', status: 0 });

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('requires an access-code gateway session before login', async () => {
    const app = buildApp(dbApi, {});

    const res = await request(app).post('/api/auth/login').send({ username: 'admin1', password: 'secret' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access code required in URL before login');
    expect(dbApi.findUserByUsername).not.toHaveBeenCalled();
  });

  it('clears the gateway session when the access code is no longer active on /me', async () => {
    const session = { userId: 9, portalRole: 'admin', accessCodeId: 31, accessCode: 'A31' };
    const app = buildApp(dbApi, session);
    dbApi.getAccessCodeById.mockResolvedValue({ id: 31, role: 'admin', code: 'A31', enabled: 0 });

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
    expect(session.userId).toBeNull();
    expect(session.portalRole).toBeNull();
    expect(session.accessCodeId).toBeNull();
    expect(session.accessCode).toBeNull();
  });
});
