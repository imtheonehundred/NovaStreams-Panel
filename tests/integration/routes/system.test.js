'use strict';

const request = require('supertest');
const express = require('express');

describe('System Routes Security', () => {
  let app;
  let systemRoutes;

  beforeAll(() => {
    jest.resetModules();
    systemRoutes = require('../../../routes/system');
    app = express();
    app.use('/api', systemRoutes);
  });

  describe('GET /api/health', () => {
    it('should return basic health status without auth', async () => {
      const res = await request(app)
        .get('/api/health')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health/detailed', () => {
    it('should require authentication for detailed health', async () => {
      const res = await request(app)
        .get('/api/health/detailed')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/db-status', () => {
    it('should require authentication for db-status', async () => {
      const res = await request(app)
        .get('/api/db-status')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/db-performance', () => {
    it('should require authentication for db-performance', async () => {
      const res = await request(app)
        .get('/api/db-performance')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/db-optimize', () => {
    it('should require authentication for db-optimize', async () => {
      const res = await request(app)
        .post('/api/db-optimize')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/db-repair', () => {
    it('should require authentication for db-repair', async () => {
      const res = await request(app)
        .post('/api/db-repair')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });
});
