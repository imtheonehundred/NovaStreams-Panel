'use strict';

const express = require('express');
const request = require('supertest');
const dashboardRoutes = require('../../../routes/dashboard');

describe('dashboard routes', () => {
  it('reads maxFFmpegProcesses dynamically per request', async () => {
    let max = 3;
    const app = express();
    app.use((req, _res, next) => {
      req.userId = 7;
      next();
    });
    app.use(
      '/api/dashboard',
      dashboardRoutes({
        channels: new Map([
          ['a', { id: 'a', userId: 7, status: 'running', viewers: 2 }],
        ]),
        processes: new Map([['a', { pid: 1 }]]),
        userActivity: new Map([[7, Date.now()]]),
        collectSystemMetrics: jest.fn(async () => ({
          mem: { total: 1024, available: 512, swapused: 0, swaptotal: 0 },
          diskMain: { use: 1, used: 1, size: 2 },
          net: { rxSec: 0, txSec: 0 },
          loadAvg: [0, 0, 0],
          cores: 4,
          cpuPct: 10,
          ramPct: 20,
          swapPct: 0,
          warnings: [],
          source: 'test',
        })),
        dbApi: { userCount: jest.fn(async () => 1) },
        maxFFmpegProcesses: () => max,
        formatDuration: (seconds) => `${Math.floor(seconds)}s`,
        channelRuntimeInfo: () => 'ok',
      })
    );

    const first = await request(app).get('/api/dashboard/metrics').expect(200);
    expect(first.body.cards.maxProcesses).toBe(3);

    max = 9;
    const second = await request(app).get('/api/dashboard/metrics').expect(200);
    expect(second.body.cards.maxProcesses).toBe(9);
  });
});
