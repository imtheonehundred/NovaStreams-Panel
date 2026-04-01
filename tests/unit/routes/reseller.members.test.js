'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/db', () => ({
  findUserById: jest.fn(),
  isReseller: jest.fn(),
  getAccessCodeById: jest.fn(),
  listPackages: jest.fn(),
  getPackageById: jest.fn(),
  addCreditLog: jest.fn(),
  getLineById: jest.fn(),
  attachLinePassword: jest.fn((row) => row),
}));

jest.mock('../../../lib/mariadb', () => ({
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../services/lineService', () => ({
  listAll: jest.fn(),
  normalizeLineRow: jest.fn((row) => row),
  createLine: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const mariadb = require('../../../lib/mariadb');
const lineService = require('../../../services/lineService');

function buildApp(session = { userId: 7, portalRole: 'reseller', accessCodeId: 4, accessCode: 'RES4' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/reseller', require('../../../routes/reseller'));
  return app;
}

describe('reseller routes current contract coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbApi.getAccessCodeById.mockResolvedValue({ id: 4, role: 'reseller', code: 'RES4', enabled: 1 });
    dbApi.findUserById.mockResolvedValue({ id: 7, status: 1, credits: 10, username: 'reseller-a' });
    dbApi.isReseller.mockResolvedValue(true);
    dbApi.listPackages.mockResolvedValue([]);
    dbApi.getPackageById.mockResolvedValue(null);
    dbApi.addCreditLog.mockResolvedValue(undefined);
    dbApi.getLineById.mockResolvedValue({ id: 44, member_id: 7 });
    mariadb.queryOne.mockResolvedValue({ credits: 10 });
    mariadb.execute.mockResolvedValue({ affectedRows: 1 });
    lineService.createLine.mockResolvedValue({ id: 99, username: 'demo', member_id: 7 });
    lineService.remove.mockResolvedValue(true);
  });

  it('returns reseller-visible packages from dbApi.listPackages', async () => {
    const app = buildApp();
    dbApi.listPackages.mockResolvedValue([
      { id: 1, package_name: 'Starter' },
      { id: 2, package_name: 'Pro' },
    ]);

    const res = await request(app).get('/api/reseller/packages');

    expect(res.status).toBe(200);
    expect(dbApi.listPackages).toHaveBeenCalled();
    expect(res.body.packages).toEqual([
      { id: 1, package_name: 'Starter' },
      { id: 2, package_name: 'Pro' },
    ]);
  });

  it('creates reseller lines by debiting package cost from the reseller credit balance', async () => {
    const app = buildApp();
    dbApi.getPackageById.mockResolvedValue({ id: 1, is_trial: 0, trial_credits: 1, official_credits: 4 });

    const res = await request(app)
      .post('/api/reseller/lines')
      .send({ username: 'line-a', password: 'secret', package_id: 1, is_trial: 0 });

    expect(res.status).toBe(201);
    expect(mariadb.execute).toHaveBeenCalledWith('UPDATE users SET credits = ? WHERE id = ?', [6, 7]);
    expect(dbApi.addCreditLog).toHaveBeenCalledWith(7, 7, -4, 'Line created');
    expect(lineService.createLine).toHaveBeenCalledWith(expect.objectContaining({ member_id: 7, package_id: 1 }), 7);
  });

  it('rejects reseller line creation when credits are insufficient for the selected package', async () => {
    const app = buildApp();
    dbApi.getPackageById.mockResolvedValue({ id: 1, is_trial: 0, trial_credits: 1, official_credits: 25 });

    const res = await request(app)
      .post('/api/reseller/lines')
      .send({ username: 'line-b', password: 'secret', package_id: 1, is_trial: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'insufficient_credits', required: 25, balance: 10 });
    expect(lineService.createLine).not.toHaveBeenCalled();
  });

  it('deletes only reseller-owned lines', async () => {
    const app = buildApp();

    const res = await request(app).delete('/api/reseller/lines/44');

    expect(res.status).toBe(200);
    expect(lineService.remove).toHaveBeenCalledWith(44);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects reseller requests when the access-code session is no longer valid', async () => {
    const session = { userId: 7, portalRole: 'reseller', accessCodeId: 4, accessCode: 'RES4' };
    const app = buildApp(session);
    dbApi.getAccessCodeById.mockResolvedValue(null);

    const res = await request(app).get('/api/reseller/packages');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access code invalid');
    expect(session.userId).toBeNull();
    expect(session.portalRole).toBeNull();
    expect(session.accessCodeId).toBeNull();
    expect(session.accessCode).toBeNull();
  });
});
