'use strict';

jest.mock('../../../services/logger', () => ({
  error: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

describe('auth routes session fixation protection', () => {
  function buildApp(dbApi, sessionRef) {
    const router = require('../../../routes/auth')(dbApi, (_req, _res, next) =>
      next()
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = {
        portalRole: 'admin',
        accessCode: 'portal-code',
        accessCodeId: 5,
        csrfSecret: 'csrf-1',
        regenerate(callback) {
          req.session = {
            regenerate: this.regenerate,
          };
          sessionRef.current = req.session;
          callback(null);
        },
      };
      sessionRef.current = req.session;
      next();
    });
    app.use('/api/auth', router);
    return app;
  }

  it('regenerates the session and preserves gateway context on login', async () => {
    const sessionRef = { current: null };
    const dbApi = {
      getAccessCodeById: jest.fn().mockResolvedValue({
        id: 5,
        role: 'admin',
        enabled: 1,
        code: 'portal-code',
      }),
      findUserByUsername: jest.fn().mockResolvedValue({
        id: 9,
        username: 'alice',
        status: 1,
      }),
      verifyPassword: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
      isReseller: jest.fn().mockResolvedValue(false),
      touchUserLastLogin: jest.fn().mockResolvedValue(),
      touchAccessCodeUsage: jest.fn().mockResolvedValue(),
    };
    const app = buildApp(dbApi, sessionRef);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'password123' });

    expect(res.status).toBe(200);
    expect(sessionRef.current.userId).toBe(9);
    expect(sessionRef.current.portalRole).toBe('admin');
    expect(sessionRef.current.accessCode).toBe('portal-code');
    expect(sessionRef.current.accessCodeId).toBe(5);
    expect(sessionRef.current.csrfSecret).toBe('csrf-1');
  });

  it('does not leak internal login errors to the client', async () => {
    const sessionRef = { current: null };
    const dbApi = {
      getAccessCodeById: jest.fn().mockResolvedValue({
        id: 5,
        role: 'admin',
        enabled: 1,
        code: 'portal-code',
      }),
      findUserByUsername: jest.fn().mockRejectedValue(new Error('db down')),
      verifyPassword: jest.fn(),
      isAdmin: jest.fn(),
      isReseller: jest.fn(),
      touchUserLastLogin: jest.fn(),
      touchAccessCodeUsage: jest.fn(),
    };
    const app = buildApp(dbApi, sessionRef);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Login failed' });
  });
});
