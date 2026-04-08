'use strict';

const express = require('express');
const request = require('supertest');
const { registerHealthRoutes } = require('../../../lib/boot/routes');

describe('boot routes health handlers', () => {
  function buildApp({ dbOk = true, redisOk = true } = {}) {
    const app = express();
    registerHealthRoutes({
      app,
      mariadb: {
        queryOne: jest.fn(async () => {
          if (!dbOk) throw new Error('db down');
          return { ok: 1 };
        }),
      },
      redis: {
        getClient: () => ({
          ping: jest.fn(async () => {
            if (!redisOk) throw new Error('redis down');
            return 'PONG';
          }),
        }),
      },
    });
    return app;
  }

  it('returns ok for /health when MariaDB and Redis are available', async () => {
    const res = await request(buildApp()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('returns 503 for /health when Redis is unavailable', async () => {
    const res = await request(buildApp({ redisOk: false }))
      .get('/health')
      .expect(503);
    expect(res.body).toMatchObject({
      status: 'error',
      db: 'ok',
      redis: 'unreachable',
    });
  });

  it('returns ok for /readyz when MariaDB and Redis are available', async () => {
    const res = await request(buildApp()).get('/readyz').expect(200);
    expect(res.body).toEqual({ ok: true, db: true, redis: true });
  });

  it('returns 503 for /readyz when MariaDB is unavailable', async () => {
    const res = await request(buildApp({ dbOk: false }))
      .get('/readyz')
      .expect(503);
    expect(res.body).toMatchObject({
      ok: false,
      db: false,
      redis: false,
      error: 'db down',
    });
  });
});
