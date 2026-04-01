'use strict';

const request = require('supertest');
const express = require('express');

const { authLimiter } = require('../../middleware/rateLimiter');
const { AUTH_BRUTE_FORCE_PATHS } = require('../../lib/panel-session');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(AUTH_BRUTE_FORCE_PATHS, authLimiter);
  app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/me', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Phase 02 auth limiter scope', () => {
  it('rate-limits login attempts on brute-force protected endpoints', async () => {
    const app = buildApp();

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ username: 'admin', password: 'wrong-pass' });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ username: 'admin', password: 'wrong-pass' });

    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('Too many requests');
  });

  it('does not apply the auth limiter bucket to /me', async () => {
    const app = buildApp();

    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .get('/api/auth/me')
        .set('X-Forwarded-For', '203.0.113.11');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }
  });

  it('does not apply the auth limiter bucket to logout', async () => {
    const app = buildApp();

    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('X-Forwarded-For', '203.0.113.12');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }
  });
});
