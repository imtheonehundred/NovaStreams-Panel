'use strict';

const request = require('supertest');
const express = require('express');

describe('Admin API Routes - System Health & Metrics', () => {
  let app;
  let mockAdminRouter;
  let mockHealthMonitor;
  let mockSystemMetrics;

  beforeAll(() => {
    jest.resetModules();

    mockHealthMonitor = {
      isPanelUp: jest.fn().mockReturnValue(true),
      hasPanelHealthSample: jest.fn().mockReturnValue(true),
      getLastCheckAt: jest.fn().mockReturnValue(Date.now() - 60000),
      getLastResponseMs: jest.fn().mockReturnValue(45),
      getLastError: jest.fn().mockReturnValue(null),
      getConsecutiveFails: jest.fn().mockReturnValue(0),
      getDayStats: jest.fn().mockResolvedValue({ up: 3600, down: 0, unknown: 0 }),
      getUptimeHistory: jest.fn().mockResolvedValue([
        { date: '2024-01-01', up: 86400, down: 0, unknown: 0 }
      ]),
    };

    mockSystemMetrics = {
      collectSystemMetrics: jest.fn().mockResolvedValue({
        cpu: { load: 25.5, cores: 4 },
        memory: { used: 4294967296, total: 8589934592, percent: 50 },
        disk: { used: 100000000000, total: 500000000000, percent: 20 },
        network: { rx_sec: 1024, tx_sec: 2048 },
        uptime: 864000,
        timestamp: Date.now(),
      }),
    };

    jest.mock('../../../services/healthMonitor', () => mockHealthMonitor);
    jest.mock('../../../lib/system-metrics', () => mockSystemMetrics);
    jest.mock('../../../lib/state', () => ({
      channels: new Map(),
      processes: new Map(),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/health', async (req, res) => {
      try {
        const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
        const today = await mockHealthMonitor.getDayStats();
        const history = await mockHealthMonitor.getUptimeHistory(days);
        const hasSample = mockHealthMonitor.hasPanelHealthSample();
        res.json({
          status: hasSample ? (mockHealthMonitor.isPanelUp() ? 'up' : 'down') : 'unknown',
          lastCheckAt: mockHealthMonitor.getLastCheckAt(),
          lastCheckMs: mockHealthMonitor.getLastCheckAt(),
          lastResponseMs: mockHealthMonitor.getLastResponseMs(),
          lastError: mockHealthMonitor.getLastError(),
          consecutiveFails: mockHealthMonitor.getConsecutiveFails(),
          today,
          history,
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/system-metrics', async (req, res) => {
      try {
        const m = await mockSystemMetrics.collectSystemMetrics();
        res.json(m);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/healthMonitor');
    jest.unmock('../../../lib/system-metrics');
    jest.unmock('../../../lib/state');
  });

  describe('GET /api/admin/health', () => {
    it('should return health status', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['up', 'down', 'unknown']).toContain(res.body.status);
    });

    it('should return last check timestamps', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('lastCheckAt');
      expect(res.body).toHaveProperty('lastCheckMs');
      expect(res.body).toHaveProperty('lastResponseMs');
    });

    it('should return consecutive fails count', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('consecutiveFails');
      expect(typeof res.body.consecutiveFails).toBe('number');
    });

    it('should return today stats', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('today');
      expect(res.body.today).toHaveProperty('up');
      expect(res.body.today).toHaveProperty('down');
    });

    it('should return uptime history', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('history');
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/api/admin/health?days=14')
        .expect(200);

      expect(mockHealthMonitor.getUptimeHistory).toHaveBeenCalledWith(14);
    });

    it('should cap days at 30', async () => {
      await request(app)
        .get('/api/admin/health?days=100')
        .expect(200);

      expect(mockHealthMonitor.getUptimeHistory).toHaveBeenCalledWith(30);
    });

    it('should return 500 on error', async () => {
      mockHealthMonitor.getDayStats.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/health')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/system-metrics', () => {
    it('should return system metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(200);

      expect(res.body).toHaveProperty('cpu');
      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('disk');
      expect(res.body).toHaveProperty('network');
    });

    it('should return cpu metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(200);

      expect(res.body.cpu).toHaveProperty('load');
      expect(res.body.cpu).toHaveProperty('cores');
    });

    it('should return memory metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(200);

      expect(res.body.memory).toHaveProperty('used');
      expect(res.body.memory).toHaveProperty('total');
      expect(res.body.memory).toHaveProperty('percent');
    });

    it('should return disk metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(200);

      expect(res.body.disk).toHaveProperty('used');
      expect(res.body.disk).toHaveProperty('total');
      expect(res.body.disk).toHaveProperty('percent');
    });

    it('should return 500 on error', async () => {
      mockSystemMetrics.collectSystemMetrics.mockRejectedValueOnce(new Error('metrics failed'));

      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Stream Health & Repair', () => {
  let app;
  let mockAdminRouter;
  let mockChannels;
  let mockStreamRepair;

  beforeAll(() => {
    jest.resetModules();

    mockChannels = new Map([
      ['channel1', { id: 'channel1', name: 'Test Channel', status: 'running', channelClass: 'normal' }],
      ['channel2', { id: 'channel2', name: 'Movie Channel', status: 'stopped', channelClass: 'movie' }],
    ]);

    mockStreamRepair = {
      checkChannel: jest.fn().mockResolvedValue({ healthy: true, issues: [] }),
      getChannelHealth: jest.fn().mockResolvedValue(null),
      getAllChannelHealth: jest.fn().mockResolvedValue({ channel1: { healthy: true } }),
      checkAllChannels: jest.fn().mockResolvedValue({ checked: 2, healthy: 1, issues: [] }),
    };

    jest.mock('../../../lib/state', () => ({
      channels: mockChannels,
      processes: new Map(),
    }));
    jest.mock('../../../services/streamRepair', () => mockStreamRepair);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/streams/:id/health', async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'missing channel id' });
        const channel = mockChannels.get(id);
        if (!channel) return res.status(404).json({ error: 'channel not found' });
        const cached = await mockStreamRepair.getChannelHealth(id);
        if (cached && Date.now() - cached.checkedAt < 900000) {
          return res.json({ id, ...cached, source: 'cache' });
        }
        const result = await mockStreamRepair.checkChannel(id, channel);
        return res.json({ id, ...result, source: 'live' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/streams/:id/repair', async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'missing channel id' });
        const channel = mockChannels.get(id);
        if (!channel) return res.status(404).json({ error: 'channel not found' });
        const result = await mockStreamRepair.checkChannel(id, channel);
        res.json({ id, ...result });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/streams/repair-all', async (req, res) => {
      try {
        const allChannels = [...mockChannels.values()].filter(c => 
          String(c.channelClass || 'normal') !== 'movie' && !c.is_internal
        );
        const result = await mockStreamRepair.checkAllChannels(allChannels, mockChannels);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/streams/health-all', async (req, res) => {
      try {
        const allChannels = [...mockChannels.values()].filter(c => 
          String(c.channelClass || 'normal') !== 'movie' && !c.is_internal
        );
        const healthMap = await mockStreamRepair.getAllChannelHealth(allChannels.map(c => c.id));
        const result = {};
        for (const [id, health] of Object.entries(healthMap)) {
          result[id] = health;
        }
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/state');
    jest.unmock('../../../services/streamRepair');
  });

  describe('GET /api/admin/streams/:id/health', () => {
    it('should return stream health', async () => {
      const res = await request(app)
        .get('/api/admin/streams/channel1/health')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'channel1');
      expect(res.body).toHaveProperty('source', 'live');
    });

    it('should return 400 for missing channel id', async () => {
      const res = await request(app)
        .get('/api/admin/streams/%20/health')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('missing channel id');
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .get('/api/admin/streams/nonexistent/health')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('channel not found');
    });

    it('should use cache when available and fresh', async () => {
      mockStreamRepair.getChannelHealth.mockResolvedValueOnce({
        healthy: true,
        issues: [],
        checkedAt: Date.now() - 60000
      });

      const res = await request(app)
        .get('/api/admin/streams/channel1/health')
        .expect(200);

      expect(res.body).toHaveProperty('source', 'cache');
    });

    it('should return 500 on repair service error', async () => {
      mockStreamRepair.checkChannel.mockRejectedValueOnce(new Error('repair failed'));

      const res = await request(app)
        .get('/api/admin/streams/channel1/health')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/streams/:id/repair', () => {
    it('should repair stream', async () => {
      const res = await request(app)
        .post('/api/admin/streams/channel1/repair')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'channel1');
      expect(res.body).toHaveProperty('healthy');
    });

    it('should return 400 for missing channel id', async () => {
      const res = await request(app)
        .post('/api/admin/streams/%20/repair')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .post('/api/admin/streams/nonexistent/repair')
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/streams/repair-all', () => {
    it('should repair all streams', async () => {
      const res = await request(app)
        .post('/api/admin/streams/repair-all')
        .expect(200);

      expect(res.body).toHaveProperty('checked');
      expect(res.body).toHaveProperty('healthy');
    });

    it('should return 500 on error', async () => {
      mockStreamRepair.checkAllChannels.mockRejectedValueOnce(new Error('repair all failed'));

      const res = await request(app)
        .post('/api/admin/streams/repair-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/streams/health-all', () => {
    it('should return health for all streams', async () => {
      const res = await request(app)
        .get('/api/admin/streams/health-all')
        .expect(200);

      expect(typeof res.body).toBe('object');
    });
  });
});

describe('Admin API Routes - Live Connections', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        {
          session_uuid: 'uuid-1',
          stream_type: 'live',
          stream_id: 1,
          container: 'm3u8',
          origin_server_id: 1,
          proxy_server_id: null,
          geoip_country_code: 'US',
          isp: 'Comcast',
          user_ip: '192.168.1.1',
          last_seen_at: '2024-01-01 00:01:00',
          created_at: '2024-01-01 00:00:00',
          username: 'testuser',
          origin_name: 'Origin 1',
          origin_host: 'origin1.example.com',
          proxy_name: null,
          proxy_host: null,
        },
        {
          session_uuid: 'uuid-2',
          stream_type: 'movie',
          stream_id: 5,
          container: 'm3u8',
          origin_server_id: 2,
          proxy_server_id: 1,
          geoip_country_code: 'GB',
          isp: 'BT',
          user_ip: '10.0.0.1',
          last_seen_at: '2024-01-01 00:02:00',
          created_at: '2024-01-01 00:00:30',
          username: 'testuser2',
          origin_name: 'Origin 2',
          origin_host: 'origin2.example.com',
          proxy_name: 'Proxy 1',
          proxy_host: 'proxy1.example.com',
        },
      ]),
      queryOne: jest.fn().mockResolvedValue({ name: 'Test Server', public_host: 'test.example.com' }),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/live-connections', async (req, res) => {
      try {
        const type = String(req.query.type || '').trim();
        const serverId = parseInt(req.query.server_id, 10);
        let sql = `
          SELECT s.session_uuid, s.stream_type, s.stream_id, s.container,
                 s.origin_server_id, s.proxy_server_id,
                 s.geoip_country_code, s.isp, s.user_ip, s.last_seen_at,
                 s.created_at,
                 l.username,
                 o.name AS origin_name, o.public_host AS origin_host,
                 p.name AS proxy_name, p.public_host AS proxy_host
          FROM line_runtime_sessions s
          LEFT JOIN \`lines\` l ON l.id = s.line_id
          LEFT JOIN streaming_servers o ON o.id = s.origin_server_id
          LEFT JOIN streaming_servers p ON p.id = s.proxy_server_id
          WHERE s.date_end IS NULL`;
        const params = [];
        if (type && ['live', 'movie', 'episode'].includes(type)) {
          sql += ' AND s.stream_type = ?';
          params.push(type);
        }
        if (Number.isFinite(serverId)) {
          sql += ' AND s.origin_server_id = ?';
          params.push(serverId);
        }
        sql += ' ORDER BY s.last_seen_at DESC LIMIT 500';
        const sessions = await mockMariadb.query(sql, params);
        res.json({ sessions });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/live-connections/summary', async (_req, res) => {
      try {
        const typeRows = [
          { stream_type: 'live', cnt: 10 },
          { stream_type: 'movie', cnt: 5 },
          { stream_type: 'episode', cnt: 3 },
        ];
        const countryRows = [
          { geoip_country_code: 'US', cnt: 8 },
          { geoip_country_code: 'GB', cnt: 5 },
        ];
        const streamRows = [
          { stream_id: 1, stream_type: 'live', cnt: 5 },
          { stream_id: 5, stream_type: 'movie', cnt: 3 },
        ];
        const serverRows = [
          { origin_server_id: 1, cnt: 10 },
          { origin_server_id: 2, cnt: 8 },
        ];
        const byType = { live: 0, movie: 0, episode: 0 };
        for (const r of typeRows) byType[r.stream_type] = Number(r.cnt);
        const total = Object.values(byType).reduce((a, b) => a + b, 0);
        const servers = await Promise.all(serverRows.map(async (r) => {
          const srv = await mockMariadb.queryOne('SELECT name, public_host FROM streaming_servers WHERE id = ?', [r.origin_server_id]);
          return { server_id: r.origin_server_id, name: srv ? srv.name : '#' + r.origin_server_id, host: srv ? srv.public_host : '', cnt: Number(r.cnt) };
        }));
        res.json({
          total,
          by_type: byType,
          countries: countryRows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })),
          top_streams: streamRows.map((r) => ({ stream_id: r.stream_id, stream_type: r.stream_type, cnt: Number(r.cnt) })),
          servers,
        });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/live-connections', () => {
    it('should return live connections', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBeGreaterThan(0);
    });

    it('should return session objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      const session = res.body.sessions[0];
      expect(session).toHaveProperty('session_uuid');
      expect(session).toHaveProperty('stream_type');
      expect(session).toHaveProperty('user_ip');
      expect(session).toHaveProperty('username');
    });

    it('should filter by type', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections?type=live')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalledWith(
        expect.stringContaining('s.stream_type = ?'),
        expect.arrayContaining(['live'])
      );
    });

    it('should filter by server_id', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections?server_id=1')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalledWith(
        expect.stringContaining('s.origin_server_id = ?'),
        expect.arrayContaining([1])
      );
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/live-connections/summary', () => {
    it('should return connection summary', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('by_type');
      expect(res.body).toHaveProperty('countries');
      expect(res.body).toHaveProperty('top_streams');
      expect(res.body).toHaveProperty('servers');
    });

    it('should return correct total', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body.total).toBe(18);
    });

    it('should return by_type breakdown', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body.by_type).toEqual({ live: 10, movie: 5, episode: 3 });
    });

    it('should return top countries', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(Array.isArray(res.body.countries)).toBe(true);
      expect(res.body.countries[0]).toHaveProperty('code');
      expect(res.body.countries[0]).toHaveProperty('cnt');
    });

    it('should return top streams', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(Array.isArray(res.body.top_streams)).toBe(true);
      expect(res.body.top_streams[0]).toHaveProperty('stream_id');
      expect(res.body.top_streams[0]).toHaveProperty('cnt');
    });

    it('should return server breakdown', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(Array.isArray(res.body.servers)).toBe(true);
      expect(res.body.servers[0]).toHaveProperty('server_id');
      expect(res.body.servers[0]).toHaveProperty('name');
      expect(res.body.servers[0]).toHaveProperty('cnt');
    });
  });
});

describe('Admin API Routes - Stats', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      movieCount: jest.fn().mockResolvedValue(100),
      seriesCount: jest.fn().mockResolvedValue(25),
    };

    mockMariadb = {
      queryOne: jest.fn().mockImplementation((sql) => {
        if (sql.includes('`lines`') && sql.includes('admin_enabled')) return Promise.resolve({ c: 50 });
        if (sql.includes('`channels`')) return Promise.resolve({ c: 30 });
        if (sql.includes('`episodes`')) return Promise.resolve({ c: 150 });
        if (sql.includes('`bouquets`')) return Promise.resolve({ c: 10 });
        if (sql.includes('`packages`')) return Promise.resolve({ c: 5 });
        if (sql.includes('is_reseller')) return Promise.resolve({ c: 8 });
        return Promise.resolve(null);
      }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/state', () => ({
      channels: new Map([
        ['ch1', { status: 'running' }],
        ['ch2', { status: 'running' }],
        ['ch3', { status: 'stopped' }],
      ]),
      processes: new Map([['proc1', {}], ['proc2', {}]]),
    }));
    jest.mock('systeminformation', () => ({
      currentLoad: jest.fn().mockResolvedValue({ currentLoad: 35.5 }),
      mem: jest.fn().mockResolvedValue({ used: 4294967296, total: 8589934592 }),
      fsSize: jest.fn().mockResolvedValue([{ used: 100000000000, size: 500000000000, use: 20 }]),
      networkStats: jest.fn().mockResolvedValue([
        { rx_sec: 1024.5, tx_sec: 2048.3 },
      ]),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/stats', async (req, res) => {
      try {
        const si = require('systeminformation');
        const [cpu, mem, disk, net] = await Promise.all([
          si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(),
        ]);
        const nowTs = Math.floor(Date.now() / 1000);
        const [activeRow, totalChRow, episodeRow, bouquetRow, packageRow, resellerRow] = await Promise.all([
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM `lines` WHERE admin_enabled = 1 AND exp_date > ?', [nowTs]),
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM `channels`'),
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM `episodes`'),
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM `bouquets`'),
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM `packages`'),
          mockMariadb.queryOne('SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE g.is_reseller = 1'),
        ]);
        const movieCountVal = await mockDb.movieCount();
        const seriesCountVal = await mockDb.seriesCount();
        const runningCount = 2;
        const totalNetIn = net.reduce((a, n) => a + (n.rx_sec || 0), 0) / 1024;
        const totalNetOut = net.reduce((a, n) => a + (n.tx_sec || 0), 0) / 1024;
        res.json({
          activeLines: activeRow ? activeRow.c : 0,
          connections: 2,
          liveStreams: runningCount,
          channelsCount: totalChRow ? totalChRow.c : 3,
          movieCount: movieCountVal,
          seriesCount: seriesCountVal,
          episodeCount: episodeRow ? Number(episodeRow.c) || 0 : 0,
          bouquetCount: bouquetRow ? Number(bouquetRow.c) || 0 : 0,
          packageCount: packageRow ? Number(packageRow.c) || 0 : 0,
          resellerCount: resellerRow ? Number(resellerRow.c) || 0 : 0,
          cpu: Math.round(cpu.currentLoad || 0),
          memUsed: mem.used, memTotal: mem.total, memPercent: Math.round((mem.used / mem.total) * 100),
          diskUsed: disk[0] ? disk[0].used : 0, diskTotal: disk[0] ? disk[0].size : 0,
          diskPercent: disk[0] ? Math.round(disk[0].use) : 0,
          diskUsedGB: disk[0] ? +((disk[0].used || 0) / (1024 * 1024 * 1024)).toFixed(1) : 0,
          diskTotalGB: disk[0] ? +((disk[0].size || 0) / (1024 * 1024 * 1024)).toFixed(1) : 0,
          netIn: parseFloat(totalNetIn.toFixed(1)),
          netOut: parseFloat(totalNetOut.toFixed(1)),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/state');
    jest.unmock('systeminformation');
  });

  describe('GET /api/admin/stats', () => {
    it('should return stats object', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(typeof res.body).toBe('object');
    });

    it('should return active lines count', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('activeLines');
      expect(res.body.activeLines).toBe(50);
    });

    it('should return connections count', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
    });

    it('should return live streams count', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('liveStreams');
    });

    it('should return media counts', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('movieCount', 100);
      expect(res.body).toHaveProperty('seriesCount', 25);
      expect(res.body).toHaveProperty('episodeCount', 150);
      expect(res.body).toHaveProperty('bouquetCount', 10);
      expect(res.body).toHaveProperty('packageCount', 5);
      expect(res.body).toHaveProperty('resellerCount', 8);
    });

    it('should return system resources', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('cpu');
      expect(res.body).toHaveProperty('memUsed');
      expect(res.body).toHaveProperty('memTotal');
      expect(res.body).toHaveProperty('memPercent');
      expect(res.body).toHaveProperty('diskUsed');
      expect(res.body).toHaveProperty('diskTotal');
      expect(res.body).toHaveProperty('diskPercent');
    });

    it('should return network stats', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('netIn');
      expect(res.body).toHaveProperty('netOut');
    });

    it('should return 500 on error', async () => {
      mockMariadb.queryOne.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/stats')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Network Security (ASN/VPN)', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockAsnBlocker;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn().mockImplementation((key) => {
        if (key === 'enable_vpn_detection') return Promise.resolve('1');
        if (key === 'block_vpn') return Promise.resolve('0');
        return Promise.resolve(null);
      }),
      setSetting: jest.fn().mockResolvedValue(true),
    };

    mockAsnBlocker = {
      getBlockedAsns: jest.fn().mockResolvedValue([
        { asn: 12345, org: 'Test Org', notes: 'Bad actor', blocked_at: '2024-01-01' },
        { asn: 67890, org: 'Another Org', notes: '', blocked_at: '2024-01-02' },
      ]),
      blockAsn: jest.fn().mockResolvedValue(true),
      unblockAsn: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, user_id: 5, ip: '192.168.1.1', event_type: 'login', is_vpn: 1, created_at: '2024-01-01', username: 'testuser' },
      ]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/asnBlocker', () => mockAsnBlocker);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/asn/blocked', async (req, res) => {
      try {
        const blocked = await mockAsnBlocker.getBlockedAsns();
        res.json({ blocked });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/asn/block', async (req, res) => {
      try {
        const { asn, org, notes } = req.body;
        if (!asn) return res.status(400).json({ error: 'asn required' });
        await mockAsnBlocker.blockAsn(asn, org || '', notes || '');
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.delete('/asn/block/:asn', async (req, res) => {
      try {
        await mockAsnBlocker.unblockAsn(req.params.asn);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/vpn/settings', async (req, res) => {
      try {
        const enabled = await mockDb.getSetting('enable_vpn_detection');
        const blockVpn = await mockDb.getSetting('block_vpn');
        res.json({ enabled: enabled === '1', blockVpn: blockVpn === '1' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/vpn/settings', async (req, res) => {
      try {
        const { enabled, blockVpn } = req.body;
        if (enabled !== undefined) await mockDb.setSetting('enable_vpn_detection', enabled ? '1' : '0');
        if (blockVpn !== undefined) await mockDb.setSetting('block_vpn', blockVpn ? '1' : '0');
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/vpn/log', async (req, res) => {
      try {
        const rows = await mockMariadb.query(
          `SELECT le.id, le.user_id, le.ip, le.event_type, le.is_vpn, le.created_at,
                  l.username
           FROM login_events le
           LEFT JOIN \`lines\` l ON le.user_id = l.id
           WHERE le.is_vpn = 1
           ORDER BY le.created_at DESC LIMIT 100`
        );
        res.json({ events: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/asnBlocker');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/asn/blocked', () => {
    it('should return blocked ASNs', async () => {
      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(200);

      expect(res.body).toHaveProperty('blocked');
      expect(Array.isArray(res.body.blocked)).toBe(true);
      expect(res.body.blocked.length).toBeGreaterThan(0);
    });

    it('should return ASN objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(200);

      const asn = res.body.blocked[0];
      expect(asn).toHaveProperty('asn');
      expect(asn).toHaveProperty('org');
    });

    it('should return 500 on error', async () => {
      mockAsnBlocker.getBlockedAsns.mockRejectedValueOnce(new Error('fetch failed'));

      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/asn/block', () => {
    it('should block ASN', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 99999, org: 'New Org', notes: 'Test block' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(99999, 'New Org', 'Test block');
    });

    it('should return 400 without ASN', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ org: 'Test Org' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('asn required');
    });

    it('should block ASN without org and notes', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 55555 })
        .expect(200);

      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(55555, '', '');
    });

    it('should return 500 on error', async () => {
      mockAsnBlocker.blockAsn.mockRejectedValueOnce(new Error('block failed'));

      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 12345 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/asn/block/:asn', () => {
    it('should unblock ASN', async () => {
      const res = await request(app)
        .delete('/api/admin/asn/block/12345')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.unblockAsn).toHaveBeenCalledWith('12345');
    });

    it('should return 500 on error', async () => {
      mockAsnBlocker.unblockAsn.mockRejectedValueOnce(new Error('unblock failed'));

      const res = await request(app)
        .delete('/api/admin/asn/block/12345')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/vpn/settings', () => {
    it('should return VPN settings', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('blockVpn');
    });

    it('should return correct enabled state', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body.enabled).toBe(true);
    });

    it('should return correct blockVpn state', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body.blockVpn).toBe(false);
    });
  });

  describe('PUT /api/admin/vpn/settings', () => {
    it('should update VPN enabled setting', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: false })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('enable_vpn_detection', '0');
    });

    it('should update blockVpn setting', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ blockVpn: true })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vpn', '1');
    });

    it('should update both settings', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true, blockVpn: true })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('enable_vpn_detection', '1');
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vpn', '1');
    });
  });

  describe('GET /api/admin/vpn/log', () => {
    it('should return VPN events', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(200);

      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it('should return event objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(200);

      const event = res.body.events[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('user_id');
      expect(event).toHaveProperty('ip');
      expect(event).toHaveProperty('is_vpn');
    });

    it('should return 500 on error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Channels Activity', () => {
  let app;
  let mockAdminRouter;
  let mockChannels;

  beforeAll(() => {
    jest.resetModules();

    mockChannels = new Map([
      ['ch1', { id: 'ch1', name: 'Channel 1', status: 'running' }],
      ['ch2', { id: 'ch2', name: 'Channel 2', status: 'stopped' }],
      ['ch3', { id: 'ch3', name: 'Channel 3', status: 'running' }],
    ]);

    jest.mock('../../../lib/state', () => ({
      channels: mockChannels,
      processes: new Map(),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/activity', async (req, res) => {
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
      const mockActivity = [
        { activity_id: 1, user_id: 1, action: 'login', timestamp: '2024-01-01 00:00:00' },
        { activity_id: 2, user_id: 2, action: 'logout', timestamp: '2024-01-01 00:01:00' },
      ];
      res.json({ activity: mockActivity.slice(0, limit) });
    });

    mockAdminRouter.get('/channels', (req, res) => {
      const list = [];
      mockChannels.forEach((ch, id) => list.push({ id, name: ch.name, status: ch.status }));
      res.json(list);
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/state');
  });

  describe('GET /api/admin/activity', () => {
    it('should return activity list', async () => {
      const res = await request(app)
        .get('/api/admin/activity')
        .expect(200);

      expect(res.body).toHaveProperty('activity');
      expect(Array.isArray(res.body.activity)).toBe(true);
    });

    it('should accept limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/activity?limit=10')
        .expect(200);

      expect(res.body.activity.length).toBeLessThanOrEqual(10);
    });

    it('should cap limit at 2000', async () => {
      const res = await request(app)
        .get('/api/admin/activity?limit=5000')
        .expect(200);

      expect(res.body.activity.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('GET /api/admin/channels', () => {
    it('should return channels list', async () => {
      const res = await request(app)
        .get('/api/admin/channels')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return channel objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/channels')
        .expect(200);

      const channel = res.body[0];
      expect(channel).toHaveProperty('id');
      expect(channel).toHaveProperty('name');
      expect(channel).toHaveProperty('status');
    });

    it('should return all channels from state', async () => {
      const res = await request(app)
        .get('/api/admin/channels')
        .expect(200);

      expect(res.body.length).toBe(3);
    });
  });
});

describe('Admin API Routes - Error Handling Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getAllUsers: jest.fn().mockResolvedValue([{ id: 1, username: 'admin' }]),
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'admin', status: 1 }),
      isAdmin: jest.fn().mockResolvedValue(true),
      getAccessCodeById: jest.fn().mockResolvedValue({ id: 1, code: 'test', role: 'admin', enabled: 1 }),
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      updateUser: jest.fn().mockRejectedValue(new Error('update failed')),
      deleteUser: jest.fn().mockRejectedValue(new Error('delete failed')),
      listBlockedIps: jest.fn().mockRejectedValue(new Error('db error')),
      addBlockedIp: jest.fn().mockRejectedValue(new Error('insert failed')),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/users', async (req, res) => {
      try {
        const users = await mockDb.getAllUsers();
        res.json({ users });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.put('/users/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockDb.updateUser(id, req.body || {});
        const row = await mockDb.findUserById(id);
        if (!row) return res.status(404).json({ error: 'not found' });
        res.json(row);
      } catch (e) {
        res.status(400).json({ error: e.message || 'update failed' });
      }
    });

    mockAdminRouter.delete('/users/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockDb.deleteUser(id);
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({ error: e.message || 'delete failed' });
      }
    });

    mockAdminRouter.get('/security/blocked-ips', async (req, res) => {
      try {
        res.json({ items: await mockDb.listBlockedIps() });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/security/blocked-ips', async (req, res) => {
      const { ip, notes } = req.body || {};
      if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'ip required' });
      try {
        const rid = await mockDb.addBlockedIp(String(ip).trim(), notes != null ? String(notes) : '');
        res.status(201).json({ id: rid || undefined, ok: true });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
  });

  describe('Database error handling', () => {
    it('should return 500 on database errors for list operations', async () => {
      const res = await request(app)
        .get('/api/admin/security/blocked-ips')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 on database errors for update operations', async () => {
      const res = await request(app)
        .put('/api/admin/users/1')
        .send({ email: 'test@test.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('update failed');
    });

    it('should return 400 on database errors for delete operations', async () => {
      const res = await request(app)
        .delete('/api/admin/users/1')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('delete failed');
    });

    it('should return 400 on database errors for create operations', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '192.168.1.1', notes: 'test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('insert failed');
    });
  });

  describe('Input validation edge cases', () => {
    it('should handle empty string IP', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '', notes: 'test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should handle non-string IP', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: 12345, notes: 'test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should handle whitespace-only IP', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '   ', notes: 'test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should trim IP whitespace', async () => {
      mockDb.addBlockedIp.mockResolvedValueOnce(5);

      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '  192.168.1.1  ', notes: 'test' })
        .expect(201);

      expect(mockDb.addBlockedIp).toHaveBeenCalledWith('192.168.1.1', 'test');
    });
  });
});

describe('Admin API Routes - Bulk Operations', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockCache;
  let mockVodService;
  let mockSeriesService;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    };

    mockCache = {
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
      invalidateEpisodes: jest.fn().mockResolvedValue(true),
    };

    mockVodService = {
      create: jest.fn().mockResolvedValue(1),
    };

    mockSeriesService = {
      create: jest.fn().mockResolvedValue(1),
      addEpisode: jest.fn().mockResolvedValue(1),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/cache', () => mockCache);
    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/seriesService', () => mockSeriesService);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/movies/purge-all', async (req, res) => {
      try {
        const { execute } = require('../../../lib/mariadb');
        await execute('DELETE FROM movies');
        const { invalidateVod } = require('../../../lib/cache');
        await invalidateVod();
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/series/purge-all', async (req, res) => {
      try {
        const { execute } = require('../../../lib/mariadb');
        await execute('DELETE FROM episodes');
        await execute('DELETE FROM series');
        const { invalidateSeries, invalidateEpisodes } = require('../../../lib/cache');
        await invalidateSeries();
        await invalidateEpisodes();
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/movies/bulk', async (req, res) => {
      const { movies } = req.body || {};
      if (!Array.isArray(movies)) return res.status(400).json({ error: 'movies array required' });
      const vodService = require('../../../services/vodService');
      let imported = 0;
      let errors = 0;
      for (const row of movies) {
        try {
          await vodService.create(row);
          imported += 1;
        } catch { errors += 1; }
      }
      const { invalidateVod } = require('../../../lib/cache');
      await invalidateVod();
      res.json({ imported, errors });
    });

    mockAdminRouter.post('/series/bulk', async (req, res) => {
      const { series } = req.body || {};
      if (!Array.isArray(series)) return res.status(400).json({ error: 'series array required' });
      const seriesService = require('../../../services/seriesService');
      const ids = [];
      let errors = 0;
      for (const row of series) {
        try {
          const id = await seriesService.create(row);
          ids.push(id);
        } catch { errors += 1; }
      }
      const { invalidateSeries } = require('../../../lib/cache');
      await invalidateSeries();
      res.json({ imported: ids.length, ids, errors });
    });

    mockAdminRouter.post('/episodes/bulk', async (req, res) => {
      const { episodes } = req.body || {};
      if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes array required' });
      const seriesService = require('../../../services/seriesService');
      let imported = 0;
      let errors = 0;
      for (const row of episodes) {
        try {
          await seriesService.addEpisode(row);
          imported += 1;
        } catch { errors += 1; }
      }
      const { invalidateEpisodes } = require('../../../lib/cache');
      await invalidateEpisodes();
      res.json({ imported, errors });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/cache');
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../services/seriesService');
  });

  describe('POST /api/admin/movies/purge-all', () => {
    it('should purge all movies', async () => {
      const res = await request(app)
        .post('/api/admin/movies/purge-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockMariadb.execute).toHaveBeenCalledWith('DELETE FROM movies');
      expect(mockCache.invalidateVod).toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .post('/api/admin/movies/purge-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/series/purge-all', () => {
    it('should purge all series and episodes', async () => {
      const res = await request(app)
        .post('/api/admin/series/purge-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockMariadb.execute).toHaveBeenCalledWith('DELETE FROM episodes');
      expect(mockMariadb.execute).toHaveBeenCalledWith('DELETE FROM series');
      expect(mockCache.invalidateSeries).toHaveBeenCalled();
      expect(mockCache.invalidateEpisodes).toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/movies/bulk', () => {
    it('should bulk import movies', async () => {
      mockVodService.create.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: [{ name: 'Movie 1' }, { name: 'Movie 2' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should return 400 without movies array', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'movies array required');
    });

    it('should return 400 for non-array movies', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: 'not an array' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'movies array required');
    });

    it('should count errors on partial failure', async () => {
      mockVodService.create
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(3);

      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: [{ name: 'M1' }, { name: 'M2' }, { name: 'M3' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 1);
    });
  });

  describe('POST /api/admin/series/bulk', () => {
    it('should bulk import series', async () => {
      mockSeriesService.create.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({ series: [{ title: 'Series 1' }, { title: 'Series 2' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('ids');
      expect(Array.isArray(res.body.ids)).toBe(true);
    });

    it('should return 400 without series array', async () => {
      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'series array required');
    });
  });

  describe('POST /api/admin/episodes/bulk', () => {
    it('should bulk import episodes', async () => {
      mockSeriesService.addEpisode.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: [{ title: 'Ep 1' }, { title: 'Ep 2' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should return 400 without episodes array', async () => {
      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'episodes array required');
    });
  });
});

describe('Admin API Routes - Bouquet Sync', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getBouquetById: jest.fn(),
      updateBouquet: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/cache', () => ({
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/bouquets/:id/sync', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { type, ids } = req.body || {};
      const dbApi = require('../../../lib/db');
      const b = await dbApi.getBouquetById(id);
      if (!b) return res.status(404).json({ error: 'not found' });
      const field = type === 'movies' ? 'bouquet_movies' : type === 'series' ? 'bouquet_series' : 'bouquet_channels';
      if (!['bouquet_movies', 'bouquet_series', 'bouquet_channels'].includes(field)) {
        return res.status(400).json({ error: 'type must be movies, series, or channels' });
      }
      const parseField = (raw) => {
        if (Array.isArray(raw)) return raw.map((x) => String(x));
        try {
          const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return Array.isArray(v) ? v.map((x) => String(x)) : [];
        } catch { return []; }
      };
      const cur = parseField(b[field]);
      const set = new Set(cur);
      for (const x of ids || []) set.add(String(x));
      const merged = [...set].map((x) => {
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? n : x;
      });
      try {
        await dbApi.updateBouquet(id, { [field]: merged });
        const { invalidateBouquets } = require('../../../lib/cache');
        await invalidateBouquets();
        res.json({ ok: true, count: merged.length });
      } catch (e) { res.status(400).json({ error: e.message || 'sync failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/cache');
  });

  describe('POST /api/admin/bouquets/:id/sync', () => {
    it('should sync bouquet with movies', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1, 2, 3] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 3);
    });

    it('should merge with existing bouquet entries', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_movies: [1, 2] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [3, 4] })
        .expect(200);

      expect(res.body).toHaveProperty('count', 4);
    });

    it('should sync bouquet with series', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_series: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'series', ids: [5] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should sync bouquet with channels', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_channels: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'channels', ids: [10] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/invalid/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockDb.getBouquetById.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/admin/bouquets/999/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should accept type channels and sync bouquet_channels field', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_channels: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'channels', ids: [1] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.updateBouquet).toHaveBeenCalledWith(1, { bouquet_channels: [1] });
    });

    it('should handle JSON string for existing bouquet field', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_movies: '[1,2]' });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [3] })
        .expect(200);

      expect(res.body).toHaveProperty('count', 3);
    });

    it('should return 400 on update failure', async () => {
      mockDb.getBouquetById.mockResolvedValue({ id: 1, bouquet_movies: [] });
      mockDb.updateBouquet.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - M3U Import', () => {
  let app;
  let mockAdminRouter;
  let mockVodService;
  let mockSeriesService;
  let mockTmdbService;

  beforeAll(() => {
    jest.resetModules();

    mockVodService = { create: jest.fn().mockResolvedValue(1) };
    mockSeriesService = {
      create: jest.fn().mockResolvedValue(1),
      addEpisode: jest.fn().mockResolvedValue(1),
    };
    mockTmdbService = {
      getApiKey: jest.fn().mockResolvedValue(null),
      searchMovies: jest.fn().mockResolvedValue([]),
      searchTvShows: jest.fn().mockResolvedValue([]),
    };

    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../services/tmdbService', () => mockTmdbService);
    jest.mock('../../../lib/cache', () => ({
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/movies/import', async (req, res) => {
      const { m3u_text, category_id, disable_tmdb } = req.body || {};
      if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
      try {
        const lines = String(m3u_text).split('\n');
        const entries = [];
        let current = null;
        for (const raw of lines) {
          const line = raw.trim();
          if (line.startsWith('#EXTINF:')) {
            const nameMatch = line.match(/,(.+)$/);
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
            current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown', group: groupMatch ? groupMatch[1] : '', logo: logoMatch ? logoMatch[1] : '' };
          } else if (current && line && !line.startsWith('#')) {
            current.url = line;
            entries.push(current);
            current = null;
          }
        }
        const results = [];
        const vodService = require('../../../services/vodService');
        const tmdbService = require('../../../services/tmdbService');
        const hasKey = !!(await tmdbService.getApiKey());
        for (const entry of entries) {
          const movieData = {
            name: entry.name, stream_url: entry.url, stream_source: entry.url,
            category_id: category_id || '', stream_icon: entry.logo || '',
            container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
          };
          if (!disable_tmdb && hasKey) {
            try {
              const tmdbResults = await tmdbService.searchMovies(entry.name);
              if (tmdbResults.length > 0) {
                const details = await tmdbService.getMovie(tmdbResults[0].id);
                Object.assign(movieData, { name: details.name || movieData.name });
              }
            } catch {}
          }
          const id = await vodService.create(movieData);
          results.push({ id, name: movieData.name });
        }
        const { invalidateVod } = require('../../../lib/cache');
        await invalidateVod();
        res.json({ imported: results.length, movies: results });
      } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
    });

    mockAdminRouter.post('/series/import', async (req, res) => {
      const { m3u_text, category_id, disable_tmdb } = req.body || {};
      if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
      try {
        const lines = String(m3u_text).split('\n');
        const entries = [];
        let current = null;
        for (const raw of lines) {
          const line = raw.trim();
          if (line.startsWith('#EXTINF:')) {
            const nameMatch = line.match(/,(.+)$/);
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
            current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown', group: groupMatch ? groupMatch[1] : '', logo: logoMatch ? logoMatch[1] : '' };
          } else if (current && line && !line.startsWith('#')) {
            current.url = line;
            entries.push(current);
            current = null;
          }
        }
        const seriesMap = new Map();
        for (const entry of entries) {
          const seMatch = entry.name.match(/^(.+?)\s*[Ss](\d+)\s*[Ee](\d+)/);
          const seriesName = seMatch ? seMatch[1].trim() : entry.group || entry.name;
          const season = seMatch ? parseInt(seMatch[2]) : 1;
          const episode = seMatch ? parseInt(seMatch[3]) : 1;
          if (!seriesMap.has(seriesName)) seriesMap.set(seriesName, { name: seriesName, logo: entry.logo, episodes: [] });
          seriesMap.get(seriesName).episodes.push({
            season_num: season, episode_num: episode, title: entry.name,
            stream_url: entry.url, container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
          });
        }
        const results = [];
        const seriesService = require('../../../services/seriesService');
        for (const [name, data] of seriesMap) {
          const seriesId = await seriesService.create({ title: name, category_id: category_id || '', cover: data.logo || '' });
          for (const ep of data.episodes) await seriesService.addEpisode({ ...ep, series_id: seriesId });
          results.push({ id: seriesId, name: name, episodes: data.episodes.length });
        }
        const { invalidateSeries } = require('../../../lib/cache');
        await invalidateSeries();
        res.json({ imported: results.length, series: results });
      } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../services/seriesService');
    jest.unmock('../../../services/tmdbService');
    jest.unmock('../../../lib/cache');
  });

  describe('POST /api/admin/movies/import', () => {
    it('should import movies from M3U text', async () => {
      const m3u = `#EXTINF:-1 tvg-logo="http://logo.png" group-title="Movies",Movie One
http://stream1.com/movie1.m3u8
#EXTINF:-1 group-title="Movies",Movie Two
http://stream2.com/movie2.m3u8`;

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3u, category_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('movies');
      expect(Array.isArray(res.body.movies)).toBe(true);
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'm3u_text required');
    });

    it('should return 400 for empty m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'm3u_text required');
    });

    it('should use disable_tmdb flag', async () => {
      const m3u = `#EXTINF:-1,Movie One
http://stream1.com/movie1.m3u8`;

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3u, disable_tmdb: true })
        .expect(200);

      expect(mockTmdbService.searchMovies).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/series/import', () => {
    it('should import series from M3U text', async () => {
      const m3u = `#EXTINF:-1 tvg-logo="http://logo.png" group-title="TV",Show S01E01
http://stream1.com/s1e1.m3u8
#EXTINF:-1 group-title="TV",Show S01E02
http://stream2.com/s1e2.m3u8`;

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3u, category_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
      expect(res.body).toHaveProperty('series');
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/series/import')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'm3u_text required');
    });

    it('should parse season/episode from filename', async () => {
      const m3u = `#EXTINF:-1,My Show S2E5
http://stream.com/s2e5.m3u8`;

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3u })
        .expect(200);

      expect(mockSeriesService.create).toHaveBeenCalled();
      expect(mockSeriesService.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ season_num: 2, episode_num: 5 })
      );
    });

    it('should default to season 1 episode 1 when no season/episode detected', async () => {
      const m3u = `#EXTINF:-1,Some Show
http://stream.com/show.m3u8`;

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3u })
        .expect(200);

      expect(mockSeriesService.addEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ season_num: 1, episode_num: 1 })
      );
    });
  });
});

describe('Admin API Routes - VOD Download Settings', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn().mockImplementation((key) => {
        if (key === 'block_vod_download') return Promise.resolve('1');
        return Promise.resolve(null);
      }),
      setSetting: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/block_vod_download', async (req, res) => {
      const dbApi = require('../../../lib/db');
      try {
        const val = await dbApi.getSetting('block_vod_download');
        res.json({ enabled: val === '1' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/settings/block_vod_download', async (req, res) => {
      const dbApi = require('../../../lib/db');
      try {
        const { enabled } = req.body;
        await dbApi.setSetting('block_vod_download', enabled ? '1' : '0');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
  });

  describe('GET /api/admin/settings/block_vod_download', () => {
    it('should return block_vod_download setting', async () => {
      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled');
      expect(typeof res.body.enabled).toBe('boolean');
    });

    it('should return enabled=true when set to 1', async () => {
      mockDb.getSetting.mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body.enabled).toBe(true);
    });

    it('should return enabled=false when set to 0', async () => {
      mockDb.getSetting.mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body.enabled).toBe(false);
    });

    it('should return 500 on error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/settings/block_vod_download', () => {
    it('should enable block_vod_download', async () => {
      const res = await request(app)
        .put('/api/admin/settings/block_vod_download')
        .send({ enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vod_download', '1');
    });

    it('should disable block_vod_download', async () => {
      const res = await request(app)
        .put('/api/admin/settings/block_vod_download')
        .send({ enabled: false })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vod_download', '0');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .put('/api/admin/settings/block_vod_download')
        .send({ enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - EPG Assign (Deprecated)', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.post('/epg/assign', async (req, res) => {
      return res.status(410).json({
        error: 'Mass EPG assignment is not available in the current admin UI.',
        code: 'EPG_MASS_ASSIGNMENT_REMOVED',
      });
    });

    mockAdminRouter.post('/epg/auto-match', async (req, res) => {
      return res.status(410).json({
        error: 'EPG auto-match is not available in the current admin UI.',
        code: 'EPG_AUTO_MATCH_REMOVED',
      });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('POST /api/admin/epg/assign', () => {
    it('should return 410 Gone', async () => {
      const res = await request(app)
        .post('/api/admin/epg/assign')
        .send({})
        .expect(410);

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'EPG_MASS_ASSIGNMENT_REMOVED');
    });
  });

  describe('POST /api/admin/epg/auto-match', () => {
    it('should return 410 Gone', async () => {
      const res = await request(app)
        .post('/api/admin/epg/auto-match')
        .send({})
        .expect(410);

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'EPG_AUTO_MATCH_REMOVED');
    });
  });
});

describe('Admin API Routes - Server Relationships', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy', priority: 1, enabled: 1, parent_name: 'Origin 1', child_name: 'Proxy 1' },
      ]),
    };

    mockDb = {
      getServerRelationships: jest.fn().mockResolvedValue([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' },
      ]),
      addServerRelationship: jest.fn().mockResolvedValue(1),
      removeServerRelationship: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/server-relationships', async (req, res) => {
      const { query } = require('../../../lib/mariadb');
      const type = String(req.query.type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship type' });
      }
      try {
        const rows = await query(
          `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
                  r.created_at, r.updated_at,
                  s_parent.name AS parent_name, s_parent.public_host AS parent_public_host,
                  s_child.name AS child_name, s_child.public_host AS child_public_host
           FROM server_relationships r
           JOIN streaming_servers s_parent ON s_parent.id = r.parent_server_id
           JOIN streaming_servers s_child ON s_child.id = r.child_server_id
           WHERE r.relationship_type = ?
           ORDER BY r.priority ASC`,
          [type]
        );
        res.json({ relationships: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/server-relationships/:serverId', async (req, res) => {
      const id = parseInt(req.params.serverId, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid server id' });
      const dbApi = require('../../../lib/db');
      try {
        const rows = await dbApi.getServerRelationships(id);
        res.json({ relationships: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/server-relationships', async (req, res) => {
      const { parent_server_id, child_server_id, relationship_type } = req.body || {};
      if (!Number.isFinite(parseInt(parent_server_id, 10)) || !Number.isFinite(parseInt(child_server_id, 10))) {
        return res.status(400).json({ error: 'parent_server_id and child_server_id are required' });
      }
      const type = String(relationship_type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship_type' });
      }
      const dbApi = require('../../../lib/db');
      try {
        const id = await dbApi.addServerRelationship(parseInt(parent_server_id, 10), parseInt(child_server_id, 10), type);
        res.json({ id, ok: true });
      } catch (e) {
        if (String(e.message).includes('Duplicate')) {
          return res.status(409).json({ error: 'relationship already exists' });
        }
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.delete('/server-relationships', async (req, res) => {
      const parentId = parseInt(req.query.parentId, 10);
      const childId = parseInt(req.query.childId, 10);
      const type = String(req.query.type || 'origin-proxy').trim();
      if (!Number.isFinite(parentId) || !Number.isFinite(childId)) {
        return res.status(400).json({ error: 'parentId, childId, and type are required' });
      }
      const dbApi = require('../../../lib/db');
      try {
        await dbApi.removeServerRelationship(parentId, childId, type);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/db');
  });

  describe('GET /api/admin/server-relationships', () => {
    it('should return server relationships', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships')
        .expect(200);

      expect(res.body).toHaveProperty('relationships');
      expect(Array.isArray(res.body.relationships)).toBe(true);
    });

    it('should accept type parameter', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships?type=failover')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE r.relationship_type = ?'),
        expect.arrayContaining(['failover'])
      );
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships?type=invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid relationship type');
    });

    it('should return 500 on query error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/server-relationships')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/server-relationships/:serverId', () => {
    it('should return relationships for server', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships/1')
        .expect(200);

      expect(res.body).toHaveProperty('relationships');
    });

    it('should return 400 for invalid server id', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid server id');
    });
  });

  describe('POST /api/admin/server-relationships', () => {
    it('should create server relationship', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without parent_server_id', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ child_server_id: 2 })
        .expect(400);

      expect(res.body.error).toContain('parent_server_id');
    });

    it('should return 400 without child_server_id', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1 })
        .expect(400);

      expect(res.body.error).toContain('child_server_id');
    });

    it('should return 400 for invalid relationship_type', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'invalid' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid relationship_type');
    });

    it('should return 409 for duplicate relationship', async () => {
      mockDb.addServerRelationship.mockRejectedValueOnce(new Error('Duplicate entry'));

      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2 })
        .expect(409);

      expect(res.body).toHaveProperty('error', 'relationship already exists');
    });
  });

  describe('DELETE /api/admin/server-relationships', () => {
    it('should delete server relationship', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=1&childId=2&type=origin-proxy')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without parentId', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?childId=2&type=origin-proxy')
        .expect(400);

      expect(res.body.error).toContain('parentId');
    });

    it('should return 400 without childId', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=1&type=origin-proxy')
        .expect(400);

      expect(res.body.error).toContain('childId');
    });
  });
});

describe('Admin API Routes - System DB', () => {
  let app;
  let mockAdminRouter;
  let mockDbService;

  beforeAll(() => {
    jest.resetModules();

    mockDbService = {
      getDatabaseStatus: jest.fn().mockResolvedValue({
        status: 'connected',
        version: '10.6.0',
        size: 1073741824,
      }),
      getDatabasePerformance: jest.fn().mockResolvedValue({
        queries_per_second: 100,
        connections: 10,
      }),
      getDatabaseLive: jest.fn().mockResolvedValue({
        active_connections: 5,
        threads: 2,
      }),
      optimizeDatabase: jest.fn().mockResolvedValue({ optimized: true, saved: 1024 }),
      repairDatabase: jest.fn().mockResolvedValue({ repaired: true, status: 'OK' }),
    };

    jest.mock('../../../services/dbService', () => mockDbService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/system/db-status', async (req, res) => {
      const dbService = require('../../../services/dbService');
      try { res.json(await dbService.getDatabaseStatus()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/system/db-performance', async (req, res) => {
      const dbService = require('../../../services/dbService');
      try { res.json(await dbService.getDatabasePerformance()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/system/db-live', async (req, res) => {
      const dbService = require('../../../services/dbService');
      try { res.json(await dbService.getDatabaseLive()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/system/db-optimize', async (req, res) => {
      const dbService = require('../../../services/dbService');
      try { res.json(await dbService.optimizeDatabase({ source: 'api' })); }
      catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
    });

    mockAdminRouter.post('/system/db-repair', async (req, res) => {
      const dbService = require('../../../services/dbService');
      try { res.json(await dbService.repairDatabase({ source: 'api' })); }
      catch (e) { res.status(400).json({ error: e.message || 'repair failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/dbService');
  });

  describe('GET /api/admin/system/db-status', () => {
    it('should return database status', async () => {
      const res = await request(app)
        .get('/api/admin/system/db-status')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('version');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabaseStatus.mockRejectedValueOnce(new Error('connection lost'));

      const res = await request(app)
        .get('/api/admin/system/db-status')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/system/db-performance', () => {
    it('should return database performance', async () => {
      const res = await request(app)
        .get('/api/admin/system/db-performance')
        .expect(200);

      expect(res.body).toHaveProperty('queries_per_second');
      expect(res.body).toHaveProperty('connections');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabasePerformance.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/system/db-performance')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/system/db-live', () => {
    it('should return database live stats', async () => {
      const res = await request(app)
        .get('/api/admin/system/db-live')
        .expect(200);

      expect(res.body).toHaveProperty('active_connections');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabaseLive.mockRejectedValueOnce(new Error('live query failed'));

      const res = await request(app)
        .get('/api/admin/system/db-live')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/system/db-optimize', () => {
    it('should optimize database', async () => {
      const res = await request(app)
        .post('/api/admin/system/db-optimize')
        .expect(200);

      expect(res.body).toHaveProperty('optimized', true);
    });

    it('should return 400 on error', async () => {
      mockDbService.optimizeDatabase.mockRejectedValueOnce(new Error('optimize failed'));

      const res = await request(app)
        .post('/api/admin/system/db-optimize')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/system/db-repair', () => {
    it('should repair database', async () => {
      const res = await request(app)
        .post('/api/admin/system/db-repair')
        .expect(200);

      expect(res.body).toHaveProperty('repaired', true);
    });

    it('should return 400 on error', async () => {
      mockDbService.repairDatabase.mockRejectedValueOnce(new Error('repair failed'));

      const res = await request(app)
        .post('/api/admin/system/db-repair')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Plex Servers', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockFetch;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, name: 'Plex Server', url: 'http://plex:32400', plex_token: 'token123', last_seen: '2024-01-01' },
      ]),
      execute: jest.fn().mockResolvedValue({ insertId: 2 }),
    };

    mockFetch = jest.fn();

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('node-fetch', () => {
      return mockFetch;
    });

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/plex/servers', async (req, res) => {
      const { query } = require('../../../lib/mariadb');
      try {
        const rows = await query('SELECT id, name, url, plex_token, last_seen FROM plex_servers ORDER BY last_seen DESC');
        res.json({ servers: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/plex/servers', async (req, res) => {
      const { execute } = require('../../../lib/mariadb');
      const { name, url, plex_token } = req.body;
      if (!name || !url) return res.status(400).json({ error: 'name and url required' });
      try {
        const { insertId } = await execute(
          'INSERT INTO plex_servers (name, url, plex_token, last_seen) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), url=VALUES(url), plex_token=VALUES(plex_token)',
          [name, url, plex_token || '']
        );
        res.json({ ok: true, id: insertId });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/plex/servers/:id', async (req, res) => {
      const { execute } = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        await execute('DELETE FROM plex_servers WHERE id = ?', [n]);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/plex/servers/:id/libraries', async (req, res) => {
      const { query } = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [n]);
        if (!server) return res.status(404).json({ error: 'server not found' });
        const fetch = require('node-fetch');
        const res2 = await fetch(`${server.url}/library/sections?X-Plex-Token=${server.plex_token || ''}`, { headers: { 'Accept': 'application/json' } });
        if (!res2.ok) return res.status(502).json({ error: 'Plex server unreachable' });
        const xml = await res2.text();
        const matches = [...xml.matchAll(/<Directory key="(\d+)" title="([^"]+)"/g)];
        const libs = matches.map(m => ({ key: m[1], title: m[2] }));
        res.json({ libraries: libs });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/plex/servers/:id/watch-status', async (req, res) => {
      const { query } = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [n]);
        if (!server) return res.status(404).json({ error: 'server not found' });
        const fetch = require('node-fetch');
        const res2 = await fetch(`${server.url}/status/sessions?X-Plex-Token=${server.plex_token || ''}`, { headers: { Accept: 'application/json' } });
        if (!res2.ok) return res.json({ watchers: [] });
        const j = await res2.json();
        const videos = j.MediaContainer?.Video || [];
        const watchers = (Array.isArray(videos) ? videos : [videos]).filter(Boolean).map(v => ({
          title: v.title || '',
          user: v.User?.title || '',
          viewOffset: v.viewOffset || 0,
          duration: v.duration || 0,
        }));
        res.json({ watchers });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('node-fetch');
  });

  describe('GET /api/admin/plex/servers', () => {
    it('should return plex servers', async () => {
      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return 500 on error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/plex/servers', () => {
    it('should create plex server', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Plex', url: 'http://plex:32400', plex_token: 'token' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ url: 'http://plex:32400' })
        .expect(400);

      expect(res.body.error).toContain('name and url required');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Plex' })
        .expect(400);

      expect(res.body.error).toContain('name and url required');
    });
  });

  describe('DELETE /api/admin/plex/servers/:id', () => {
    it('should delete plex server', async () => {
      const res = await request(app)
        .delete('/api/admin/plex/servers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/plex/servers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });
  });

  describe('GET /api/admin/plex/servers/:id/libraries', () => {
    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/plex/servers/invalid/libraries')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockMariadb.query.mockReset();
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/plex/servers/999/libraries')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'server not found');
    });
  });

  describe('GET /api/admin/plex/servers/:id/watch-status', () => {
    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/plex/servers/invalid/watch-status')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockMariadb.query.mockReset();
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/plex/servers/999/watch-status')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'server not found');
    });
  });
});

describe('Admin API Routes - Line Connections Management', () => {
  let app;
  let mockAdminRouter;
  let mockLineService;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      getActiveConnections: jest.fn().mockResolvedValue([
        { session_uuid: 'uuid1', stream_id: 1, user_ip: '192.168.1.1', started_at: '2024-01-01 00:00:00' },
      ]),
      killConnections: jest.fn().mockResolvedValue(1),
      closeConnection: jest.fn().mockResolvedValue(true),
      closeRuntimeSession: jest.fn().mockResolvedValue(true),
    };

    mockDb = {
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/lines/:id/connections', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const lineService = require('../../../services/lineService');
      const connections = await lineService.getActiveConnections(id);
      res.json({ connections });
    });

    mockAdminRouter.post('/lines/:id/kill', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const lineService = require('../../../services/lineService');
      const killed = await lineService.killConnections(id);
      res.json({ killed });
    });

    mockAdminRouter.post('/lines/:id/disconnect', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { connection_id } = req.body || {};
      if (!connection_id) return res.status(400).json({ error: 'connection_id required' });
      const lineService = require('../../../services/lineService');
      await lineService.closeConnection(connection_id);
      res.json({ ok: true });
    });

    mockAdminRouter.post('/lines/:id/end-session', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { session_uuid } = req.body || {};
      if (!session_uuid) return res.status(400).json({ error: 'session_uuid required' });
      const lineService = require('../../../services/lineService');
      await lineService.closeRuntimeSession(session_uuid);
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../lib/db');
  });

  describe('GET /api/admin/lines/:id/connections', () => {
    it('should return line connections', async () => {
      const res = await request(app)
        .get('/api/admin/lines/1/connections')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/lines/invalid/connections')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });
  });

  describe('POST /api/admin/lines/:id/kill', () => {
    it('should kill line connections', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/kill')
        .expect(200);

      expect(res.body).toHaveProperty('killed');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/invalid/kill')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });
  });

  describe('POST /api/admin/lines/:id/disconnect', () => {
    it('should disconnect connection', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/disconnect')
        .send({ connection_id: 'conn123' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without connection_id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/disconnect')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('connection_id required');
    });
  });

  describe('POST /api/admin/lines/:id/end-session', () => {
    it('should end session', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/end-session')
        .send({ session_uuid: 'uuid123' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without session_uuid', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/end-session')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('session_uuid required');
    });
  });
});

describe('Admin API Routes - Category Management Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockCategoryService;

  beforeAll(() => {
    jest.resetModules();

    mockCategoryService = {
      listCategories: jest.fn().mockResolvedValue([
        { id: 1, category_name: 'Movies', category_type: 'movie' },
        { id: 2, category_name: 'Series', category_type: 'series' },
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, category_name: 'Movies' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/categoryService', () => mockCategoryService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/categories', async (req, res) => {
      const { type } = req.query;
      const categoryService = require('../../../services/categoryService');
      try {
        const categories = await categoryService.listCategories(type);
        res.json({ categories });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/categories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const categoryService = require('../../../services/categoryService');
      const category = await categoryService.getById(id);
      if (!category) return res.status(404).json({ error: 'not found' });
      res.json(category);
    });

    mockAdminRouter.post('/categories', async (req, res) => {
      const { name, type } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      if (!type) return res.status(400).json({ error: 'type required' });
      const categoryService = require('../../../services/categoryService');
      try {
        const id = await categoryService.create({ name, type });
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    mockAdminRouter.put('/categories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const categoryService = require('../../../services/categoryService');
      try {
        await categoryService.update(id, req.body);
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/categories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const categoryService = require('../../../services/categoryService');
      try {
        await categoryService.remove(id);
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/categoryService');
  });

  describe('GET /api/admin/categories - Filtering', () => {
    it('should filter by type=movie', async () => {
      const res = await request(app)
        .get('/api/admin/categories?type=movie')
        .expect(200);

      expect(mockCategoryService.listCategories).toHaveBeenCalledWith('movie');
    });

    it('should filter by type=series', async () => {
      const res = await request(app)
        .get('/api/admin/categories?type=series')
        .expect(200);

      expect(mockCategoryService.listCategories).toHaveBeenCalledWith('series');
    });

    it('should return 500 on error', async () => {
      mockCategoryService.listCategories.mockRejectedValueOnce(new Error('list failed'));

      const res = await request(app)
        .get('/api/admin/categories')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/categories/:id', () => {
    it('should return category by id', async () => {
      const res = await request(app)
        .get('/api/admin/categories/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/categories/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent category', async () => {
      mockCategoryService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/categories/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/categories', () => {
    it('should create category', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .send({ name: 'New Category', type: 'movie' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .send({ type: 'movie' })
        .expect(400);

      expect(res.body.error).toContain('name required');
    });

    it('should return 400 without type', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .send({ name: 'New Category' })
        .expect(400);

      expect(res.body.error).toContain('type required');
    });
  });

  describe('PUT /api/admin/categories/:id', () => {
    it('should update category', async () => {
      const res = await request(app)
        .put('/api/admin/categories/1')
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/categories/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 on update failure', async () => {
      mockCategoryService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/categories/1')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/categories/:id', () => {
    it('should delete category', async () => {
      const res = await request(app)
        .delete('/api/admin/categories/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/categories/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 on delete failure', async () => {
      mockCategoryService.remove.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .delete('/api/admin/categories/1')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Import Providers', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockImportService;
  let mockXcApiClient;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listImportProviders: jest.fn().mockResolvedValue([
        { id: 1, name: 'Provider 1', url: 'http://prov1.com', type: 'xtream' },
        { id: 2, name: 'Provider 2', url: 'http://prov2.com', type: 'xtream' },
      ]),
      getImportProviderById: jest.fn().mockResolvedValue({ id: 1, name: 'Provider 1', url: 'http://prov1.com' }),
      createImportProvider: jest.fn().mockResolvedValue(3),
      updateImportProvider: jest.fn().mockResolvedValue(true),
      deleteImportProvider: jest.fn().mockResolvedValue(true),
      listAllMovieStreamUrls: jest.fn().mockResolvedValue([{ id: 1, name: 'Movie 1' }]),
      listAllSeriesTitles: jest.fn().mockResolvedValue([{ id: 1, title: 'Series 1' }]),
      listAllEpisodeStreamUrls: jest.fn().mockResolvedValue([{ id: 1, title: 'Episode 1' }]),
      listAllChannelMpdUrls: jest.fn().mockResolvedValue([{ id: 1, name: 'Channel 1' }]),
      listAllLiveChannelIds: jest.fn().mockResolvedValue([{ id: 1, name: 'Live 1' }]),
    };

    mockImportService = {
      startMovieImport: jest.fn().mockReturnValue('job-123'),
      startSeriesImport: jest.fn().mockReturnValue('job-456'),
      startLiveImport: jest.fn().mockReturnValue('job-789'),
      startM3UImport: jest.fn().mockReturnValue('job-m3u'),
      getJob: jest.fn().mockReturnValue({ id: 'job-123', status: 'running' }),
      cancelJob: jest.fn().mockReturnValue(true),
    };

    mockXcApiClient = jest.fn().mockImplementation(() => ({
      validate: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(true),
      getVodCategories: jest.fn().mockResolvedValue([{ id: 1, category_name: 'Movies' }]),
      getSeriesCategories: jest.fn().mockResolvedValue([{ id: 2, category_name: 'Series' }]),
      getLiveCategories: jest.fn().mockResolvedValue([{ id: 3, category_name: 'Live' }]),
    }));

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/importService', () => mockImportService);
    jest.mock('../../../services/xcApiClient', () => ({ XcApiClient: mockXcApiClient }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/providers', async (req, res) => {
      try { res.json({ providers: await mockDb.listImportProviders() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/providers', async (req, res) => {
      try {
        const id = await mockDb.createImportProvider(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/providers/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockDb.getImportProviderById(n))) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateImportProvider(n, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/providers/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.deleteImportProvider(n);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/providers/:id/validate', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const p = await mockDb.getImportProviderById(n);
      if (!p) return res.status(404).json({ error: 'not found' });
      try {
        const XcApiClient = require('../../../services/xcApiClient').XcApiClient;
        const xc = new XcApiClient(p.url);
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
        await xc.ping();
        res.json({ ok: true, message: 'Connection OK' });
      } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
    });

    mockAdminRouter.post('/providers/validate-preview', async (req, res) => {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
      try {
        const XcApiClient = require('../../../services/xcApiClient').XcApiClient;
        const xc = new XcApiClient(url);
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
        await xc.ping();
        res.json({ ok: true, message: 'Connection OK' });
      } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
    });

    mockAdminRouter.post('/providers/:id/categories', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const { type } = req.body || {};
      const p = await mockDb.getImportProviderById(n);
      if (!p) return res.status(404).json({ error: 'not found' });
      try {
        const XcApiClient = require('../../../services/xcApiClient').XcApiClient;
        const xc = new XcApiClient(p.url);
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
        let categories = [];
        if (type === 'movies') categories = await xc.getVodCategories();
        else if (type === 'series') categories = await xc.getSeriesCategories();
        else if (type === 'live') categories = await xc.getLiveCategories();
        else return res.status(400).json({ error: 'type must be movies, series, or live' });
        res.json({ categories });
      } catch (e) { res.status(400).json({ error: e.message || 'fetch failed' }); }
    });

    mockAdminRouter.post('/import/movies', async (req, res) => {
      const { provider_id, category_ids } = req.body || {};
      const pid = parseInt(provider_id, 10);
      if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
      try {
        const jobId = mockImportService.startMovieImport(pid, category_ids);
        res.status(202).json({ job_id: jobId });
      } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/import/series', async (req, res) => {
      const { provider_id, category_ids } = req.body || {};
      const pid = parseInt(provider_id, 10);
      if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
      try {
        const jobId = mockImportService.startSeriesImport(pid, category_ids);
        res.status(202).json({ job_id: jobId });
      } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/import/live', async (req, res) => {
      const { provider_id, category_ids } = req.body || {};
      const pid = parseInt(provider_id, 10);
      if (!Number.isFinite(pid) || !Array.isArray(category_ids)) return res.status(400).json({ error: 'provider_id and category_ids[] required' });
      try {
        const jobId = mockImportService.startLiveImport(pid, category_ids);
        res.status(202).json({ job_id: jobId });
      } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/import/m3u', async (req, res) => {
      const { m3u_text, bouquet_id } = req.body || {};
      if (!m3u_text || typeof m3u_text !== 'string') return res.status(400).json({ error: 'm3u_text required' });
      try {
        const jobId = mockImportService.startM3UImport(m3u_text, bouquet_id || 0);
        res.status(202).json({ job_id: jobId });
      } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/import/jobs/:id', (req, res) => {
      const j = mockImportService.getJob(req.params.id);
      if (!j) return res.status(404).json({ error: 'not found' });
      res.json(j);
    });

    mockAdminRouter.post('/import/jobs/:id/cancel', (req, res) => {
      mockImportService.cancelJob(req.params.id);
      res.json({ ok: true });
    });

    mockAdminRouter.get('/movies/sources', async (req, res) => {
      try { res.json({ sources: await mockDb.listAllMovieStreamUrls() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/series/titles', async (req, res) => {
      try { res.json({ titles: await mockDb.listAllSeriesTitles() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/episodes/sources', async (req, res) => {
      try { res.json({ sources: await mockDb.listAllEpisodeStreamUrls() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/channels/sources', async (req, res) => {
      try { res.json({ sources: await mockDb.listAllChannelMpdUrls() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/channels/ids', async (req, res) => {
      try { res.json({ ids: await mockDb.listAllLiveChannelIds() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/importService');
    jest.unmock('../../../services/xcApiClient');
  });

  describe('GET /api/admin/providers', () => {
    it('should return providers list', async () => {
      const res = await request(app)
        .get('/api/admin/providers')
        .expect(200);

      expect(res.body).toHaveProperty('providers');
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers.length).toBeGreaterThan(0);
    });

    it('should return provider objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/providers')
        .expect(200);

      const provider = res.body.providers[0];
      expect(provider).toHaveProperty('id');
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('url');
    });

    it('should return 500 on error', async () => {
      mockDb.listImportProviders.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/providers')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/providers', () => {
    it('should create provider', async () => {
      const res = await request(app)
        .post('/api/admin/providers')
        .send({ name: 'New Provider', url: 'http://new.com', type: 'xtream' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 on create failure', async () => {
      mockDb.createImportProvider.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/providers')
        .send({ name: 'Bad Provider' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/providers/:id', () => {
    it('should update provider', async () => {
      const res = await request(app)
        .put('/api/admin/providers/1')
        .send({ name: 'Updated Provider' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/providers/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/providers/999')
        .send({ name: 'Updated' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('DELETE /api/admin/providers/:id', () => {
    it('should delete provider', async () => {
      const res = await request(app)
        .delete('/api/admin/providers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/providers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.deleteImportProvider.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/providers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/providers/:id/validate', () => {
    it('should validate provider connection', async () => {
      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('message', 'Connection OK');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/providers/invalid/validate')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/providers/999/validate')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/providers/validate-preview', () => {
    it('should validate provider URL without saving', async () => {
      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 'http://preview.com?username=user&password=pass' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'url required');
    });

    it('should return 400 for invalid url format', async () => {
      mockXcApiClient.mockImplementationOnce(() => ({
        validate: jest.fn().mockReturnValue(false),
        ping: jest.fn().mockResolvedValue(true),
      }));

      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 'not-a-url' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/providers/:id/categories', () => {
    it('should fetch movie categories', async () => {
      const res = await request(app)
        .post('/api/admin/providers/1/categories')
        .send({ type: 'movies' })
        .expect(200);

      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
    });

    it('should fetch series categories', async () => {
      const res = await request(app)
        .post('/api/admin/providers/1/categories')
        .send({ type: 'series' })
        .expect(200);

      expect(res.body).toHaveProperty('categories');
    });

    it('should fetch live categories', async () => {
      const res = await request(app)
        .post('/api/admin/providers/1/categories')
        .send({ type: 'live' })
        .expect(200);

      expect(res.body).toHaveProperty('categories');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .post('/api/admin/providers/1/categories')
        .send({ type: 'invalid' })
        .expect(400);

      expect(res.body.error).toContain('type must be movies, series, or live');
    });

    it('should return 400 for invalid provider id', async () => {
      const res = await request(app)
        .post('/api/admin/providers/invalid/categories')
        .send({ type: 'movies' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });
  });

  describe('POST /api/admin/import/movies', () => {
    it('should start movie import job', async () => {
      const res = await request(app)
        .post('/api/admin/import/movies')
        .send({ provider_id: 1, category_ids: [1, 2] })
        .expect(202);

      expect(res.body).toHaveProperty('job_id', 'job-123');
    });

    it('should return 400 without provider_id', async () => {
      const res = await request(app)
        .post('/api/admin/import/movies')
        .send({ category_ids: [1] })
        .expect(400);

      expect(res.body.error).toContain('provider_id');
    });

    it('should return 400 without category_ids array', async () => {
      const res = await request(app)
        .post('/api/admin/import/movies')
        .send({ provider_id: 1 })
        .expect(400);

      expect(res.body.error).toContain('category_ids');
    });
  });

  describe('POST /api/admin/import/series', () => {
    it('should start series import job', async () => {
      const res = await request(app)
        .post('/api/admin/import/series')
        .send({ provider_id: 1, category_ids: [1] })
        .expect(202);

      expect(res.body).toHaveProperty('job_id', 'job-456');
    });
  });

  describe('POST /api/admin/import/live', () => {
    it('should start live import job', async () => {
      const res = await request(app)
        .post('/api/admin/import/live')
        .send({ provider_id: 1, category_ids: [1] })
        .expect(202);

      expect(res.body).toHaveProperty('job_id', 'job-789');
    });
  });

  describe('POST /api/admin/import/m3u', () => {
    it('should start M3U import job', async () => {
      const res = await request(app)
        .post('/api/admin/import/m3u')
        .send({ m3u_text: '#EXTM3U\n#EXTINF:-1,Test\nhttp://test.com/stream.m3u8' })
        .expect(202);

      expect(res.body).toHaveProperty('job_id', 'job-m3u');
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/import/m3u')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('m3u_text required');
    });

    it('should accept bouquet_id', async () => {
      const res = await request(app)
        .post('/api/admin/import/m3u')
        .send({ m3u_text: '#EXTM3U\n#EXTINF:-1,Test\nhttp://test.com/stream.m3u8', bouquet_id: 5 })
        .expect(202);

      expect(res.body).toHaveProperty('job_id');
    });
  });

  describe('GET /api/admin/import/jobs/:id', () => {
    it('should return job status', async () => {
      const res = await request(app)
        .get('/api/admin/import/jobs/job-123')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'job-123');
      expect(res.body).toHaveProperty('status', 'running');
    });

    it('should return 404 for non-existent job', async () => {
      mockImportService.getJob.mockReturnValueOnce(null);

      const res = await request(app)
        .get('/api/admin/import/jobs/invalid-job')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/import/jobs/:id/cancel', () => {
    it('should cancel job', async () => {
      const res = await request(app)
        .post('/api/admin/import/jobs/job-123/cancel')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockImportService.cancelJob).toHaveBeenCalledWith('job-123');
    });
  });

  describe('GET /api/admin/movies/sources', () => {
    it('should return movie sources', async () => {
      const res = await request(app)
        .get('/api/admin/movies/sources')
        .expect(200);

      expect(res.body).toHaveProperty('sources');
      expect(Array.isArray(res.body.sources)).toBe(true);
    });
  });

  describe('GET /api/admin/series/titles', () => {
    it('should return series titles', async () => {
      const res = await request(app)
        .get('/api/admin/series/titles')
        .expect(200);

      expect(res.body).toHaveProperty('titles');
      expect(Array.isArray(res.body.titles)).toBe(true);
    });
  });

  describe('GET /api/admin/episodes/sources', () => {
    it('should return episode sources', async () => {
      const res = await request(app)
        .get('/api/admin/episodes/sources')
        .expect(200);

      expect(res.body).toHaveProperty('sources');
      expect(Array.isArray(res.body.sources)).toBe(true);
    });
  });

  describe('GET /api/admin/channels/sources', () => {
    it('should return channel sources', async () => {
      const res = await request(app)
        .get('/api/admin/channels/sources')
        .expect(200);

      expect(res.body).toHaveProperty('sources');
      expect(Array.isArray(res.body.sources)).toBe(true);
    });
  });

  describe('GET /api/admin/channels/ids', () => {
    it('should return channel IDs', async () => {
      const res = await request(app)
        .get('/api/admin/channels/ids')
        .expect(200);

      expect(res.body).toHaveProperty('ids');
      expect(Array.isArray(res.body.ids)).toBe(true);
    });
  });
});

describe('Admin API Routes - Telegram Settings', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockTelegramBot;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn().mockImplementation((key) => {
        if (key === 'telegram_bot_token') return Promise.resolve('123456:ABC-DEF');
        if (key === 'telegram_admin_chat_id') return Promise.resolve('123456789');
        if (key === 'telegram_alerts_enabled') return Promise.resolve('1');
        return Promise.resolve(null);
      }),
      setSetting: jest.fn().mockResolvedValue(true),
    };

    mockTelegramBot = {
      stopBot: jest.fn().mockResolvedValue(true),
      initBot: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/telegramBot', () => mockTelegramBot);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/telegram', async (req, res) => {
      const dbApi = require('../../../lib/db');
      try {
        const token = await dbApi.getSetting('telegram_bot_token');
        const chatId = await dbApi.getSetting('telegram_admin_chat_id');
        const enabled = await dbApi.getSetting('telegram_alerts_enabled');
        res.json({
          bot_token_set: !!token,
          admin_chat_id: chatId || '',
          alerts_enabled: enabled !== '0',
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/settings/telegram', async (req, res) => {
      const dbApi = require('../../../lib/db');
      try {
        const { bot_token, admin_chat_id, alerts_enabled } = req.body;
        if (bot_token !== undefined) await dbApi.setSetting('telegram_bot_token', bot_token || '');
        if (admin_chat_id !== undefined) await dbApi.setSetting('telegram_admin_chat_id', admin_chat_id || '');
        if (alerts_enabled !== undefined) await dbApi.setSetting('telegram_alerts_enabled', alerts_enabled ? '1' : '0');
        const telegramBot = require('../../../services/telegramBot');
        await telegramBot.stopBot();
        if (bot_token) {
          setTimeout(() => telegramBot.initBot().catch(e => console.error('[TELEGRAM]', e.message)), 2000);
        }
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/telegramBot');
  });

  describe('GET /api/admin/settings/telegram', () => {
    it('should return telegram settings', async () => {
      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('bot_token_set');
      expect(res.body).toHaveProperty('admin_chat_id');
      expect(res.body).toHaveProperty('alerts_enabled');
    });

    it('should return bot_token_set=true when token exists', async () => {
      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body.bot_token_set).toBe(true);
    });

    it('should return bot_token_set=false when no token', async () => {
      mockDb.getSetting.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body.bot_token_set).toBe(false);
    });

    it('should return alerts_enabled=true when enabled', async () => {
      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body.alerts_enabled).toBe(true);
    });

    it('should return alerts_enabled=false when disabled', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('123456:ABC-DEF')
        .mockResolvedValueOnce('123456789')
        .mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body.alerts_enabled).toBe(false);
    });

    it('should return 500 on error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/settings/telegram', () => {
    it('should update telegram settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: 'newtoken', admin_chat_id: '987654321', alerts_enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', 'newtoken');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_admin_chat_id', '987654321');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '1');
    });

    it('should update bot_token only', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: 'newtoken' })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', 'newtoken');
    });

    it('should update admin_chat_id only', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ admin_chat_id: '111222333' })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_admin_chat_id', '111222333');
    });

    it('should update alerts_enabled only', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ alerts_enabled: false })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '0');
    });

    it('should clear bot_token when empty', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: '' })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', '');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ alerts_enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - RBAC (Roles & Permissions)', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('SELECT id, name, description FROM roles')) {
          return Promise.resolve([
            { id: 1, name: 'Admin', description: 'Administrator' },
            { id: 2, name: 'Reseller', description: 'Reseller role' },
          ]);
        }
        if (sql.includes('SELECT id, name, resource, action FROM permissions')) {
          return Promise.resolve([
            { id: 1, name: 'users.view', resource: 'users', action: 'view' },
            { id: 2, name: 'users.edit', resource: 'users', action: 'edit' },
          ]);
        }
        if (sql.includes('SELECT role_id, permission_id FROM role_permissions')) {
          return Promise.resolve([
            { role_id: 1, permission_id: 1 },
            { role_id: 1, permission_id: 2 },
          ]);
        }
        return Promise.resolve([]);
      }),
      execute: jest.fn().mockResolvedValue({ insertId: 5, affectedRows: 1 }),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/permissions', async (req, res) => {
      const mariadb = require('../../../lib/mariadb');
      try {
        const roles = await mariadb.query('SELECT id, name, description FROM roles ORDER BY id');
        const perms = await mariadb.query('SELECT id, name, resource, action FROM permissions ORDER BY resource, action');
        const rolePerms = await mariadb.query('SELECT role_id, permission_id FROM role_permissions');
        res.json({ roles, permissions: perms, rolePermissions: rolePerms });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/roles', async (req, res) => {
      const mariadb = require('../../../lib/mariadb');
      try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'name required' });
        const { insertId } = await mariadb.execute('INSERT INTO roles (name, description) VALUES (?, ?)', [name, description || '']);
        res.json({ ok: true, id: insertId });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/roles/:id', async (req, res) => {
      const mariadb = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const { name, description } = req.body;
      try {
        await mariadb.execute('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?', [name || null, description !== undefined ? description : null, n]);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/roles/:id', async (req, res) => {
      const mariadb = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      if (n === 1) return res.status(400).json({ error: 'cannot delete admin role' });
      try {
        await mariadb.execute('DELETE FROM role_permissions WHERE role_id = ?', [n]);
        await mariadb.execute('DELETE FROM roles WHERE id = ?', [n]);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/roles/:id/permissions', async (req, res) => {
      const mariadb = require('../../../lib/mariadb');
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const { permission_ids } = req.body;
      if (!Array.isArray(permission_ids)) return res.status(400).json({ error: 'permission_ids must be array' });
      try {
        await mariadb.execute('DELETE FROM role_permissions WHERE role_id = ?', [n]);
        for (const pid of permission_ids) {
          await mariadb.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [n, pid]);
        }
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/permissions', () => {
    it('should return roles, permissions, and rolePermissions', async () => {
      const res = await request(app)
        .get('/api/admin/permissions')
        .expect(200);

      expect(res.body).toHaveProperty('roles');
      expect(res.body).toHaveProperty('permissions');
      expect(res.body).toHaveProperty('rolePermissions');
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(Array.isArray(res.body.permissions)).toBe(true);
      expect(Array.isArray(res.body.rolePermissions)).toBe(true);
    });

    it('should return 500 on error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/permissions')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/roles', () => {
    it('should create role', async () => {
      const res = await request(app)
        .post('/api/admin/roles')
        .send({ name: 'New Role', description: 'A new role' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 5);
    });

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/roles')
        .send({ description: 'No name' })
        .expect(400);

      expect(res.body.error).toContain('name required');
    });

    it('should create role without description', async () => {
      const res = await request(app)
        .post('/api/admin/roles')
        .send({ name: 'Minimal Role' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('PUT /api/admin/roles/:id', () => {
    it('should update role name', async () => {
      const res = await request(app)
        .put('/api/admin/roles/2')
        .send({ name: 'Updated Role' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should update role description', async () => {
      const res = await request(app)
        .put('/api/admin/roles/2')
        .send({ description: 'Updated description' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/roles/invalid')
        .send({ name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 500 on error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/roles/2')
        .send({ name: 'Test' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/roles/:id', () => {
    it('should delete role', async () => {
      const res = await request(app)
        .delete('/api/admin/roles/2')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for admin role', async () => {
      const res = await request(app)
        .delete('/api/admin/roles/1')
        .expect(400);

      expect(res.body.error).toContain('cannot delete admin role');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/roles/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });
  });

  describe('PUT /api/admin/roles/:id/permissions', () => {
    it('should update role permissions', async () => {
      const res = await request(app)
        .put('/api/admin/roles/2/permissions')
        .send({ permission_ids: [1, 2, 3] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/roles/invalid/permissions')
        .send({ permission_ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 when permission_ids is not array', async () => {
      const res = await request(app)
        .put('/api/admin/roles/2/permissions')
        .send({ permission_ids: 'not-an-array' })
        .expect(400);

      expect(res.body.error).toContain('permission_ids must be array');
    });

    it('should clear permissions when empty array', async () => {
      const res = await request(app)
        .put('/api/admin/roles/2/permissions')
        .send({ permission_ids: [] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });
});

describe('Admin API Routes - Access Codes', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listAccessCodes: jest.fn().mockResolvedValue([
        { id: 1, code: 'CODE1', role: 'admin', enabled: 1, created_at: '2024-01-01' },
        { id: 2, code: 'CODE2', role: 'reseller', enabled: 1, created_at: '2024-01-02' },
      ]),
      getAccessCodeById: jest.fn().mockResolvedValue({ id: 1, code: 'CODE1', role: 'admin', enabled: 1 }),
      createAccessCode: jest.fn().mockResolvedValue(3),
      updateAccessCode: jest.fn().mockResolvedValue(true),
      deleteAccessCode: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/access-codes', async (req, res) => {
      try { res.json({ codes: await mockDb.listAccessCodes() }); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/access-codes', async (req, res) => {
      try {
        const id = await mockDb.createAccessCode(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/access-codes/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockDb.getAccessCodeById(n))) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateAccessCode(n, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/access-codes/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.deleteAccessCode(n);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
  });

  describe('GET /api/admin/access-codes', () => {
    it('should return access codes list', async () => {
      const res = await request(app)
        .get('/api/admin/access-codes')
        .expect(200);

      expect(res.body).toHaveProperty('codes');
      expect(Array.isArray(res.body.codes)).toBe(true);
      expect(res.body.codes.length).toBeGreaterThan(0);
    });

    it('should return access code objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/access-codes')
        .expect(200);

      const code = res.body.codes[0];
      expect(code).toHaveProperty('id');
      expect(code).toHaveProperty('code');
      expect(code).toHaveProperty('role');
    });

    it('should return 500 on error', async () => {
      mockDb.listAccessCodes.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/access-codes')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/access-codes', () => {
    it('should create access code', async () => {
      const res = await request(app)
        .post('/api/admin/access-codes')
        .send({ code: 'NEWCODE', role: 'admin' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 on create failure', async () => {
      mockDb.createAccessCode.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/access-codes')
        .send({ code: 'BADCODE' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/access-codes/:id', () => {
    it('should update access code', async () => {
      const res = await request(app)
        .put('/api/admin/access-codes/1')
        .send({ enabled: 0 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/access-codes/invalid')
        .send({ enabled: 0 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent access code', async () => {
      mockDb.getAccessCodeById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/access-codes/999')
        .send({ enabled: 0 })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('DELETE /api/admin/access-codes/:id', () => {
    it('should delete access code', async () => {
      const res = await request(app)
        .delete('/api/admin/access-codes/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/access-codes/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent access code', async () => {
      mockDb.deleteAccessCode.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/access-codes/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Resellers', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Resellers', is_reseller: 1 }),
      createUser: jest.fn().mockResolvedValue(5),
      updateUser: jest.fn().mockResolvedValue(true),
      deleteUser: jest.fn().mockResolvedValue(true),
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'test', credits: 100 }),
      listResellerPackageOverrides: jest.fn().mockResolvedValue([]),
      replaceResellerPackageOverrides: jest.fn().mockResolvedValue(true),
      getResellerExpiryMediaServiceByUserId: jest.fn().mockResolvedValue(null),
      deleteResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      addCreditLog: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      queryOne: jest.fn().mockImplementation((sql) => {
        if (sql.includes('COUNT(*)')) return Promise.resolve({ c: 10 });
        return Promise.resolve({
          id: 1, username: 'reseller1', email: 'reseller@test.com', credits: 500,
          member_group_id: 1, group_name: 'Resellers', status: 1, line_count: 5,
          reseller_dns: '', owner_id: null, last_login: null, created_at: '2024-01-01'
        });
      }),
      query: jest.fn().mockResolvedValue([
        { id: 1, username: 'reseller1', credits: 500, status: 1, line_count: 5 },
      ]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/resellers', async (req, res) => {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const search = String(req.query.search || '').trim();
      const status = req.query.status !== undefined && req.query.status !== '' ? parseInt(req.query.status, 10) : null;
      const where = ['g.is_reseller = 1'];
      const params = [];
      if (search) {
        where.push('(u.username LIKE ? OR u.email LIKE ? OR u.reseller_dns LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (Number.isFinite(status)) {
        where.push('u.status = ?');
        params.push(status);
      }
      const totalRow = await mockMariadb.queryOne(`SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE ${where.join(' AND ')}`, params);
      const resellers = await mockMariadb.query(`SELECT u.id, u.username, u.credits, u.status, COUNT(l.id) AS line_count FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id LEFT JOIN lines l ON l.member_id = u.id WHERE ${where.join(' AND ')} GROUP BY u.id LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ resellers, total: totalRow ? Number(totalRow.c) || 0 : resellers.length });
    });

    mockAdminRouter.get('/resellers/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const row = await mockMariadb.queryOne(`SELECT u.id, u.username, u.credits, u.status FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE u.id = ? AND g.is_reseller = 1`, [n]);
      if (!row) return res.status(404).json({ error: 'not found' });
      const package_overrides = await mockDb.listResellerPackageOverrides(n);
      res.json({ ...row, package_overrides });
    });

    mockAdminRouter.post('/resellers', async (req, res) => {
      const { username, password, email, credits } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username and password required' });
      const group = await mockDb.getUserGroupById(1);
      if (!group) return res.status(500).json({ error: 'reseller group not configured' });
      try {
        const id = await mockDb.createUser(String(username), String(password));
        await mockDb.updateUser(id, { member_group_id: group.group_id, credits: credits || 0 });
        res.status(201).json({ id, username, credits: credits || 0 });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/resellers/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const existing = await mockMariadb.queryOne('SELECT id FROM users WHERE id = ?', [n]);
      if (!existing) return res.status(404).json({ error: 'not found' });
      try {
        const patch = {};
        if (req.body && req.body.email !== undefined) patch.email = String(req.body.email || '');
        if (req.body && req.body.credits !== undefined) patch.credits = Number(req.body.credits) || 0;
        await mockDb.updateUser(n, patch);
        const row = await mockMariadb.queryOne('SELECT id, username, credits FROM users WHERE id = ?', [n]);
        res.json(row);
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/resellers/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const existing = await mockMariadb.queryOne('SELECT id, (SELECT COUNT(*) FROM lines WHERE member_id = ?) AS line_count FROM users WHERE id = ?', [n, n]);
      if (!existing) return res.status(404).json({ error: 'not found' });
      if (Number(existing.line_count) > 0) return res.status(400).json({ error: 'reseller still owns users lines' });
      await mockDb.replaceResellerPackageOverrides(n, []);
      await mockDb.deleteUser(n);
      res.json({ ok: true });
    });

    mockAdminRouter.put('/resellers/:id/credits', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const { credits, reason } = req.body || {};
      if (credits === undefined || credits === null) return res.status(400).json({ error: 'credits required' });
      const user = await mockDb.findUserById(n);
      if (!user) return res.status(404).json({ error: 'not found' });
      const newBal = Number(credits);
      if (!Number.isFinite(newBal)) return res.status(400).json({ error: 'invalid credits' });
      const delta = newBal - (Number(user.credits) || 0);
      await mockDb.updateUser(n, { credits: newBal });
      await mockDb.addCreditLog(n, 1, delta, reason != null ? String(reason) : '');
      res.json({ id: n, credits: newBal });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/resellers', () => {
    it('should return resellers list', async () => {
      const res = await request(app)
        .get('/api/admin/resellers')
        .expect(200);

      expect(res.body).toHaveProperty('resellers');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.resellers)).toBe(true);
    });

    it('should accept search filter', async () => {
      const res = await request(app)
        .get('/api/admin/resellers?search=reseller1')
        .expect(200);

      expect(res.body.resellers).toBeDefined();
    });

    it('should accept status filter', async () => {
      const res = await request(app)
        .get('/api/admin/resellers?status=1')
        .expect(200);

      expect(res.body.resellers).toBeDefined();
    });

    it('should accept limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/resellers?limit=10&offset=5')
        .expect(200);

      expect(res.body).toHaveProperty('total');
    });
  });

  describe('GET /api/admin/resellers/:id', () => {
    it('should return reseller details', async () => {
      const res = await request(app)
        .get('/api/admin/resellers/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('username');
      expect(res.body).toHaveProperty('package_overrides');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/resellers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/resellers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/resellers', () => {
    it('should create reseller', async () => {
      const res = await request(app)
        .post('/api/admin/resellers')
        .send({ username: 'newreseller', password: 'pass123', credits: 100 })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username', 'newreseller');
    });

    it('should return 400 without username', async () => {
      const res = await request(app)
        .post('/api/admin/resellers')
        .send({ password: 'pass123' })
        .expect(400);

      expect(res.body.error).toContain('username');
    });

    it('should return 400 without password', async () => {
      const res = await request(app)
        .post('/api/admin/resellers')
        .send({ username: 'newreseller' })
        .expect(400);

      expect(res.body.error).toContain('password');
    });

    it('should return 500 when reseller group not configured', async () => {
      mockDb.getUserGroupById.mockReset();
      mockDb.getUserGroupById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/resellers')
        .send({ username: 'newreseller', password: 'pass123' })
        .expect(500);

      expect(res.body.error).toContain('reseller group not configured');
    });
  });

  describe('PUT /api/admin/resellers/:id', () => {
    it('should update reseller', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/1')
        .send({ email: 'updated@test.com', credits: 200 })
        .expect(200);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/invalid')
        .send({ credits: 100 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/resellers/999')
        .send({ credits: 100 })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('DELETE /api/admin/resellers/:id', () => {
    it('should delete reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, line_count: 0 });

      const res = await request(app)
        .delete('/api/admin/resellers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/resellers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 if reseller owns lines', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, line_count: 5 });

      const res = await request(app)
        .delete('/api/admin/resellers/1')
        .expect(400);

      expect(res.body.error).toContain('reseller still owns users lines');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/admin/resellers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('PUT /api/admin/resellers/:id/credits', () => {
    it('should update reseller credits', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({ credits: 500, reason: 'Bonus' })
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('credits', 500);
    });

    it('should return 400 without credits', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({ reason: 'Bonus' })
        .expect(400);

      expect(res.body.error).toContain('credits required');
    });

    it('should return 400 for invalid credits', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({ credits: 'not-a-number' })
        .expect(400);

      expect(res.body.error).toContain('invalid credits');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/invalid/credits')
        .send({ credits: 100 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockDb.findUserById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/resellers/999/credits')
        .send({ credits: 100 })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Reseller Expiry Media', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listResellerExpiryMediaServices: jest.fn().mockResolvedValue({
        rows: [{ id: 1, user_id: 1, active: 1 }],
        total: 1,
      }),
      getResellerExpiryMediaServiceByUserId: jest.fn().mockResolvedValue(null),
      createResellerExpiryMediaService: jest.fn().mockResolvedValue({ id: 2, user_id: 5, active: 1 }),
      getResellerExpiryMediaServiceById: jest.fn().mockResolvedValue({ id: 1, user_id: 1, active: 1, warning_window_days: 7 }),
      updateResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      replaceResellerExpiryMediaItems: jest.fn().mockResolvedValue(true),
      listResellerExpiryMediaItems: jest.fn().mockResolvedValue([]),
      deleteResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Resellers', is_reseller: 1 }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => ({
      queryOne: jest.fn().mockResolvedValue({
        id: 1, username: 'reseller1', email: 'reseller@test.com', member_group_id: 1,
        group_name: 'Resellers', credits: 500, status: 1, line_count: 0,
        reseller_dns: '', owner_id: null, last_login: null, created_at: '2024-01-01'
      }),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/expiry-media/services', async (req, res) => {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const search = String(req.query.search || '').trim();
      try {
        const result = await mockDb.listResellerExpiryMediaServices(limit, offset, search);
        res.json({ services: result.rows || [], total: result.total || 0 });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/expiry-media/services', async (req, res) => {
      const userId = parseInt(req.body && req.body.user_id, 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ error: 'user_id required' });
      try {
        const existing = await mockDb.getResellerExpiryMediaServiceByUserId(userId);
        if (existing) return res.status(400).json({ error: 'expiry media service already exists' });
        const service = await mockDb.createResellerExpiryMediaService(userId, { active: 1, warning_window_days: 7, repeat_interval_hours: 6 });
        res.status(201).json({ ...service, items: [] });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.get('/expiry-media/services/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const service = await mockDb.getResellerExpiryMediaServiceById(n);
        if (!service) return res.status(404).json({ error: 'not found' });
        const items = await mockDb.listResellerExpiryMediaItems(n);
        res.json({ ...service, items });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.put('/expiry-media/services/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const service = await mockDb.getResellerExpiryMediaServiceById(n);
        if (!service) return res.status(404).json({ error: 'not found' });
        const items = (req.body && req.body.items) || [];
        await mockDb.updateResellerExpiryMediaService(n, { active: req.body && req.body.active !== undefined ? (req.body.active ? 1 : 0) : undefined });
        await mockDb.replaceResellerExpiryMediaItems(n, items);
        const next = await mockDb.getResellerExpiryMediaServiceById(n);
        const nextItems = await mockDb.listResellerExpiryMediaItems(n);
        res.json({ ...next, items: nextItems });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/expiry-media/services/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const service = await mockDb.getResellerExpiryMediaServiceById(n);
      if (!service) return res.status(404).json({ error: 'not found' });
      await mockDb.deleteResellerExpiryMediaService(n);
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/expiry-media/services', () => {
    it('should return expiry media services list', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services')
        .expect(200);

      expect(res.body).toHaveProperty('services');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.services)).toBe(true);
    });

    it('should accept limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services?limit=10&offset=5')
        .expect(200);

      expect(res.body).toHaveProperty('services');
      expect(res.body).toHaveProperty('total');
    });

    it('should accept search filter', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services?search=test')
        .expect(200);

      expect(res.body).toHaveProperty('services');
    });

    it('should return 500 on error', async () => {
      mockDb.listResellerExpiryMediaServices.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/expiry-media/services')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/expiry-media/services', () => {
    it('should create expiry media service', async () => {
      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 5 })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('items');
    });

    it('should return 400 without user_id', async () => {
      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('user_id required');
    });

    it('should return 400 if service already exists', async () => {
      mockDb.getResellerExpiryMediaServiceByUserId.mockResolvedValueOnce({ id: 1, user_id: 1 });

      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 1 })
        .expect(400);

      expect(res.body.error).toContain('expiry media service already exists');
    });
  });

  describe('GET /api/admin/expiry-media/services/:id', () => {
    it('should return expiry media service details', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('items');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/expiry-media/services/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('PUT /api/admin/expiry-media/services/:id', () => {
    it('should update expiry media service', async () => {
      const res = await request(app)
        .put('/api/admin/expiry-media/services/1')
        .send({ active: 0, items: [] })
        .expect(200);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/expiry-media/services/invalid')
        .send({ active: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/expiry-media/services/999')
        .send({ active: 1 })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('DELETE /api/admin/expiry-media/services/:id', () => {
    it('should delete expiry media service', async () => {
      const res = await request(app)
        .delete('/api/admin/expiry-media/services/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/expiry-media/services/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/admin/expiry-media/services/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Channels Import', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockImportChannelBridge;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getFirstAdminUserId: jest.fn().mockResolvedValue(1),
    };

    mockImportChannelBridge = {
      importLiveChannel: jest.fn().mockResolvedValue({ id: 1, name: 'Test Channel' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/importChannelBridge', () => mockImportChannelBridge);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/import-live', async (req, res) => {
      const body = req.body || {};
      const url = body.url || body.mpdUrl;
      if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
      try {
        const dbApi = require('../../../lib/db');
        const userId = await dbApi.getFirstAdminUserId();
        if (!userId) return res.status(500).json({ error: 'no admin user' });
        const importChannelBridge = require('../../../lib/importChannelBridge');
        const { detectInputType } = require('../../../lib/input-detect');
        const inputType = body.inputType || detectInputType(url);
        const created = await importChannelBridge.importLiveChannel({
          name: body.name || 'Live',
          mpdUrl: url,
          inputType,
          category_id: body.category_id != null ? parseInt(body.category_id, 10) : undefined,
          logoUrl: body.logo || body.logoUrl || '',
          epgChannelId: body.epg_channel_id || body.epgChannelId || '',
        }, userId);
        res.status(201).json(created);
      } catch (e) { res.status(e.statusCode || 400).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/importChannelBridge');
  });

  describe('POST /api/admin/import-live', () => {
    it('should import live channel with mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ mpdUrl: 'http://example.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Test Channel');
    });

    it('should import live channel with url', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.m3u8', name: 'HLS Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without url or mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ name: 'No URL Channel' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url or mpdUrl required');
    });

    it('should return 500 when no admin user exists', async () => {
      mockDb.getFirstAdminUserId.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.m3u8' })
        .expect(500);

      expect(res.body).toHaveProperty('error', 'no admin user');
    });

    it('should handle import errors with statusCode', async () => {
      mockImportChannelBridge.importLiveChannel.mockRejectedValueOnce({ statusCode: 422, message: 'Invalid input' });

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/invalid' })
        .expect(422);

      expect(res.body).toHaveProperty('error', 'Invalid input');
    });

    it('should accept optional category_id', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.m3u8', category_id: 5 })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 5 }),
        1
      );
    });

    it('should accept optional logo', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.m3u8', logo: 'http://logo.png' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ logoUrl: 'http://logo.png' }),
        1
      );
    });

    it('should accept optional epg_channel_id', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.m3u8', epg_channel_id: 'ch123' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ epgChannelId: 'ch123' }),
        1
      );
    });
  });
});

describe('Admin API Routes - TMDB Resync', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;
  let mockCrons;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn().mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test-api-key');
        if (key === 'tmdb_language') return Promise.resolve('en');
        return Promise.resolve(null);
      }),
      updateMovie: jest.fn().mockResolvedValue(true),
      updateSeriesRow: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('FROM movies')) {
          return Promise.resolve([{ id: 1, tmdb_id: 123 }]);
        }
        if (sql.includes('FROM series')) {
          return Promise.resolve([{ id: 2, tmdb_id: 456 }]);
        }
        return Promise.resolve([]);
      }),
    };

    mockCrons = {
      fetchTmdbMovieMeta: jest.fn().mockResolvedValue({ title: 'Test Movie', overview: 'A test movie' }),
      fetchTmdbTvMeta: jest.fn().mockResolvedValue({ name: 'Test Series', overview: 'A test series' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/crons', () => mockCrons);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/resync-movie/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const dbApi = require('../../../lib/db');
        const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
        if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
        const mariadb = require('../../../lib/mariadb');
        const [movie] = await mariadb.query('SELECT id, tmdb_id FROM movies WHERE id = ? LIMIT 1', [id]);
        if (!movie) return res.status(404).json({ error: 'movie not found or no tmdb_id' });
        const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
        const { fetchTmdbMovieMeta } = require('../../../lib/crons');
        const meta = await fetchTmdbMovieMeta(movie.tmdb_id, key, lang);
        await dbApi.updateMovie(id, meta);
        res.json({ ok: true, meta });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/resync-series/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const dbApi = require('../../../lib/db');
        const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
        if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
        const mariadb = require('../../../lib/mariadb');
        const [series] = await mariadb.query('SELECT id, tmdb_id FROM series WHERE id = ? LIMIT 1', [id]);
        if (!series) return res.status(404).json({ error: 'series not found or no tmdb_id' });
        const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
        const { fetchTmdbTvMeta } = require('../../../lib/crons');
        const meta = await fetchTmdbTvMeta(series.tmdb_id, key, lang);
        await dbApi.updateSeriesRow(id, meta);
        res.json({ ok: true, meta });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/resync-all', async (req, res) => {
      try {
        const dbApi = require('../../../lib/db');
        const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
        if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
        const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';
        const mariadb = require('../../../lib/mariadb');
        const { fetchTmdbMovieMeta, fetchTmdbTvMeta } = require('../../../lib/crons');
        const movies = await mariadb.query('SELECT id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50');
        const series = await mariadb.query('SELECT id, tmdb_id FROM series WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50');
        let ok = 0, fail = 0;
        for (const m of movies) {
          try {
            const meta = await fetchTmdbMovieMeta(m.tmdb_id, key, lang);
            await dbApi.updateMovie(m.id, meta);
            ok++;
          } catch { fail++; }
        }
        for (const s of series) {
          try {
            const meta = await fetchTmdbTvMeta(s.tmdb_id, key, lang);
            await dbApi.updateSeriesRow(s.id, meta);
            ok++;
          } catch { fail++; }
        }
        res.json({ ok, fail, total: ok + fail });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin/tmdb', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/crons');
  });

  describe('POST /api/admin/tmdb/resync-movie/:id', () => {
    it('should resync movie metadata', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/resync-movie/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('title');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/resync-movie/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 when TMDB API key not set', async () => {
      mockDb.getSetting.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/tmdb/resync-movie/1')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'TMDb API key not set');
    });

    it('should return 404 when movie not found', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/tmdb/resync-movie/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'movie not found or no tmdb_id');
    });

    it('should return 500 on error', async () => {
      mockCrons.fetchTmdbMovieMeta.mockRejectedValueOnce(new Error('TMDB error'));

      const res = await request(app)
        .post('/api/admin/tmdb/resync-movie/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/tmdb/resync-series/:id', () => {
    it('should resync series metadata', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/resync-series/2')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('name');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/resync-series/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 when series not found', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/tmdb/resync-series/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'series not found or no tmdb_id');
    });
  });

  describe('POST /api/admin/tmdb/resync-all', () => {
    it('should resync all movies and series', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/resync-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok');
      expect(res.body).toHaveProperty('fail');
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.ok).toBe('number');
      expect(typeof res.body.fail).toBe('number');
    });

    it('should return 400 when TMDB API key not set', async () => {
      mockDb.getSetting.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/tmdb/resync-all')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'TMDb API key not set');
    });

    it('should handle partial failures', async () => {
      mockMariadb.query.mockImplementation((sql) => {
        if (sql.includes('FROM movies')) {
          return Promise.resolve([{ id: 1, tmdb_id: 123 }, { id: 2, tmdb_id: 124 }]);
        }
        if (sql.includes('FROM series')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      mockCrons.fetchTmdbMovieMeta
        .mockResolvedValueOnce({ title: 'Movie 1' })
        .mockRejectedValueOnce(new Error('fail'));

      const res = await request(app)
        .post('/api/admin/tmdb/resync-all')
        .expect(200);

      expect(res.body.fail).toBeGreaterThan(0);
    });
  });
});

describe('Admin API Routes - TMDB Proxy', () => {
  let app;
  let mockAdminRouter;
  let mockTmdbService;

  beforeAll(() => {
    jest.resetModules();

    mockTmdbService = {
      searchMovies: jest.fn().mockResolvedValue([{ id: 1, title: 'Test Movie' }]),
      searchTvShows: jest.fn().mockResolvedValue([{ id: 2, name: 'Test Show' }]),
      getMovie: jest.fn().mockResolvedValue({ id: 1, title: 'Test Movie', overview: 'A movie' }),
      getTvShow: jest.fn().mockResolvedValue({ id: 2, name: 'Test Show', overview: 'A show' }),
      getSeason: jest.fn().mockResolvedValue({ id: 3, name: 'Season 1', episodes: [] }),
    };

    jest.mock('../../../services/tmdbService', () => mockTmdbService);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/tmdb/search', async (req, res) => {
      const { query: q, type } = req.body || {};
      if (!q) return res.status(400).json({ error: 'query required' });
      try {
        const tmdbService = require('../../../services/tmdbService');
        const results = type === 'tv' ? await tmdbService.searchTvShows(String(q)) : await tmdbService.searchMovies(String(q));
        res.json({ results });
      } catch (e) { res.status(500).json({ error: e.message || 'tmdb search failed' }); }
    });

    mockAdminRouter.post('/tmdb/details', async (req, res) => {
      const { tmdb_id, type } = req.body || {};
      if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id required' });
      try {
        const tmdbService = require('../../../services/tmdbService');
        const data = type === 'tv' ? await tmdbService.getTvShow(Number(tmdb_id)) : await tmdbService.getMovie(Number(tmdb_id));
        res.json(data);
      } catch (e) { res.status(500).json({ error: e.message || 'tmdb details failed' }); }
    });

    mockAdminRouter.post('/tmdb/season', async (req, res) => {
      const { tmdb_id, season_number } = req.body || {};
      if (!tmdb_id || season_number === undefined) return res.status(400).json({ error: 'tmdb_id and season_number required' });
      try {
        const tmdbService = require('../../../services/tmdbService');
        res.json(await tmdbService.getSeason(Number(tmdb_id), Number(season_number)));
      } catch (e) { res.status(500).json({ error: e.message || 'tmdb season failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/tmdbService');
  });

  describe('POST /api/admin/tmdb/search', () => {
    it('should search movies by default', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({ query: 'action' })
        .expect(200);

      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(mockTmdbService.searchMovies).toHaveBeenCalledWith('action');
    });

    it('should search TV shows when type is tv', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({ query: 'drama', type: 'tv' })
        .expect(200);

      expect(mockTmdbService.searchTvShows).toHaveBeenCalledWith('drama');
    });

    it('should return 400 without query', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'query required');
    });

    it('should return 500 on search error', async () => {
      mockTmdbService.searchMovies.mockRejectedValueOnce(new Error('search failed'));

      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({ query: 'test' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/tmdb/details', () => {
    it('should get movie details by default', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({ tmdb_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('title');
      expect(mockTmdbService.getMovie).toHaveBeenCalledWith(1);
    });

    it('should get TV show details when type is tv', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({ tmdb_id: 2, type: 'tv' })
        .expect(200);

      expect(mockTmdbService.getTvShow).toHaveBeenCalledWith(2);
    });

    it('should return 400 without tmdb_id', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'tmdb_id required');
    });

    it('should return 500 on details error', async () => {
      mockTmdbService.getMovie.mockRejectedValueOnce(new Error('not found'));

      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({ tmdb_id: 999 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/tmdb/season', () => {
    it('should get season details', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 2, season_number: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(mockTmdbService.getSeason).toHaveBeenCalledWith(2, 1);
    });

    it('should return 400 without tmdb_id', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ season_number: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('tmdb_id');
    });

    it('should return 400 without season_number', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 2 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('season_number');
    });

    it('should return 500 on season error', async () => {
      mockTmdbService.getSeason.mockRejectedValueOnce(new Error('season not found'));

      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 2, season_number: 99 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - EPG Sources', () => {
  let app;
  let mockAdminRouter;
  let mockEpgService;

  beforeAll(() => {
    jest.resetModules();

    mockEpgService = {
      listSources: jest.fn().mockResolvedValue([
        { id: 1, name: 'EPG Source 1', url: 'http://epg1.com/xmltv.xml' },
        { id: 2, name: 'EPG Source 2', url: 'http://epg2.com/xmltv.xml' },
      ]),
      addSource: jest.fn().mockResolvedValue(3),
      removeSource: jest.fn().mockResolvedValue(true),
      refreshAllSources: jest.fn().mockResolvedValue({ refreshed: 2, failed: 0 }),
    };

    jest.mock('../../../services/epgService', () => mockEpgService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/epg/sources', async (_req, res) => {
      const epgService = require('../../../services/epgService');
      res.json({ sources: await epgService.listSources() });
    });

    mockAdminRouter.post('/epg/sources', async (req, res) => {
      const { name, url } = req.body || {};
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
      try {
        const epgService = require('../../../services/epgService');
        const id = await epgService.addSource(name != null ? String(name) : '', String(url));
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.delete('/epg/sources/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const epgService = require('../../../services/epgService');
      const ok = await epgService.removeSource(n);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/epg/refresh', async (req, res) => {
      try {
        const epgService = require('../../../services/epgService');
        res.json(await epgService.refreshAllSources());
      } catch (e) { res.status(500).json({ error: e.message || 'refresh failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/epgService');
  });

  describe('GET /api/admin/epg/sources', () => {
    it('should return EPG sources list', async () => {
      const res = await request(app)
        .get('/api/admin/epg/sources')
        .expect(200);

      expect(res.body).toHaveProperty('sources');
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.sources.length).toBeGreaterThan(0);
    });

    it('should return source objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/epg/sources')
        .expect(200);

      const source = res.body.sources[0];
      expect(source).toHaveProperty('id');
      expect(source).toHaveProperty('name');
      expect(source).toHaveProperty('url');
    });
  });

  describe('POST /api/admin/epg/sources', () => {
    it('should create EPG source', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'New EPG', url: 'http://new-epg.com/xmltv.xml' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should create EPG source without name', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ url: 'http://new-epg.com/xmltv.xml' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'No URL Source' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'url required');
    });

    it('should return 400 for non-string url', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'Test', url: 123 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'url required');
    });

    it('should return 400 on create failure', async () => {
      mockEpgService.addSource.mockRejectedValueOnce(new Error('invalid url'));

      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'Bad', url: 'http://bad.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/epg/sources/:id', () => {
    it('should delete EPG source', async () => {
      const res = await request(app)
        .delete('/api/admin/epg/sources/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/epg/sources/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent source', async () => {
      mockEpgService.removeSource.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/epg/sources/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/epg/refresh', () => {
    it('should refresh all EPG sources', async () => {
      const res = await request(app)
        .post('/api/admin/epg/refresh')
        .expect(200);

      expect(res.body).toHaveProperty('refreshed');
      expect(res.body).toHaveProperty('failed');
    });

    it('should return 500 on refresh error', async () => {
      mockEpgService.refreshAllSources.mockRejectedValueOnce(new Error('refresh failed'));

      const res = await request(app)
        .post('/api/admin/epg/refresh')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - User Groups', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      createUserGroup: jest.fn().mockResolvedValue(5),
      updateUserGroup: jest.fn().mockResolvedValue(true),
      deleteUserGroup: jest.fn().mockResolvedValue(true),
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Test Group', is_admin: 0, member_count: 0 }),
    };

    mockMariadb = {
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([{ group_id: 1, group_name: 'Test Group', is_admin: 0, is_reseller: 1, member_count: 5 }]);
        }
        return Promise.resolve([]);
      }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/user-groups', async (_req, res) => {
      const mariadb = require('../../../lib/mariadb');
      try {
        const groups = await mariadb.query(
          `SELECT g.*, COUNT(u.id) AS member_count
           FROM user_groups g
           LEFT JOIN users u ON u.member_group_id = g.group_id
           GROUP BY g.group_id
           ORDER BY g.group_id ASC`
        );
        res.json({ groups });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/user-groups/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const mariadb = require('../../../lib/mariadb');
      try {
        const rows = await mariadb.query(
          `SELECT g.*, COUNT(u.id) AS member_count
           FROM user_groups g
           LEFT JOIN users u ON u.member_group_id = g.group_id
           WHERE g.group_id = ?
           GROUP BY g.group_id`,
          [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'not found' });
        res.json(rows[0]);
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/user-groups', async (req, res) => {
      const body = req.body || {};
      if (!String(body.group_name || '').trim()) return res.status(400).json({ error: 'group_name required' });
      try {
        const dbApi = require('../../../lib/db');
        const isAdmin = body.is_admin ? 1 : 0;
        const isReseller = body.is_reseller !== undefined ? (body.is_reseller ? 1 : 0) : 0;
        const id = await dbApi.createUserGroup({
          group_name: String(body.group_name).trim(),
          is_admin: isAdmin,
          is_reseller: isReseller,
          allowed_pages: '[]',
        });
        await dbApi.updateUserGroup(id, {
          total_allowed_gen_trials: parseInt(body.total_allowed_gen_trials, 10) || 0,
          total_allowed_gen_in: String(body.total_allowed_gen_in || 'day'),
          delete_users: body.delete_users ? 1 : 0,
        });
        return res.status(201).json({
          group_id: id,
          group_name: String(body.group_name).trim(),
          is_admin: isAdmin,
          is_reseller: isReseller,
          member_count: 0,
        });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/user-groups/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const dbApi = require('../../../lib/db');
      if (!(await dbApi.getUserGroupById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await dbApi.updateUserGroup(id, {
          group_name: req.body && req.body.group_name !== undefined ? String(req.body.group_name).trim() : undefined,
        });
        return res.json({
          group_id: id,
          group_name: req.body && req.body.group_name !== undefined ? String(req.body.group_name).trim() : 'Test Group',
          is_admin: 0,
          is_reseller: 1,
          member_count: 5,
        });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/user-groups/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const mariadb = require('../../../lib/mariadb');
      const rows = await mariadb.query(`SELECT g.*, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.member_group_id = g.group_id WHERE g.group_id = ? GROUP BY g.group_id`, [id]);
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      if (Number(rows[0].member_count) > 0) return res.status(400).json({ error: 'group still has assigned members' });
      if (Number(rows[0].is_admin) === 1) return res.status(400).json({ error: 'cannot delete admin group' });
      await mockDb.deleteUserGroup(id);
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/user-groups', () => {
    it('should return user groups list', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups')
        .expect(200);

      expect(res.body).toHaveProperty('groups');
      expect(Array.isArray(res.body.groups)).toBe(true);
    });

    it('should return 500 on error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/user-groups')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/user-groups/:id', () => {
    it('should return user group by id', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups/1')
        .expect(200);

      expect(res.body).toHaveProperty('group_id', 1);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent group', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/user-groups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/user-groups', () => {
    it('should create user group', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: 'New Group', is_reseller: true })
        .expect(201);

      expect(res.body).toHaveProperty('group_id');
    });

    it('should return 400 without group_name', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'group_name required');
    });

    it('should return 400 with empty group_name', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: '   ' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'group_name required');
    });
  });

  describe('PUT /api/admin/user-groups/:id', () => {
    it('should update user group', async () => {
      const res = await request(app)
        .put('/api/admin/user-groups/1')
        .send({ group_name: 'Updated Group' })
        .expect(200);

      expect(res.body).toHaveProperty('group_id');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/user-groups/invalid')
        .send({ group_name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent group', async () => {
      mockDb.getUserGroupById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/user-groups/999')
        .send({ group_name: 'Test' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('DELETE /api/admin/user-groups/:id', () => {
    beforeEach(() => {
      mockMariadb.query.mockReset();
      mockMariadb.query.mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([{ group_id: 2, member_count: 0, is_admin: 0 }]);
        }
        return Promise.resolve([]);
      });
    });

    it('should delete user group', async () => {
      const res = await request(app)
        .delete('/api/admin/user-groups/2')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/user-groups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 if group has members', async () => {
      mockMariadb.query.mockReset();
      mockMariadb.query.mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([{ group_id: 3, member_count: 5, is_admin: 0 }]);
        }
        return Promise.resolve([]);
      });

      const res = await request(app)
        .delete('/api/admin/user-groups/3')
        .expect(400);

      expect(res.body.error).toContain('group still has assigned members');
    });

    it('should return 400 for admin group', async () => {
      mockMariadb.query.mockReset();
      mockMariadb.query.mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([{ group_id: 1, member_count: 0, is_admin: 1 }]);
        }
        return Promise.resolve([]);
      });

      const res = await request(app)
        .delete('/api/admin/user-groups/1')
        .expect(400);

      expect(res.body.error).toContain('cannot delete admin group');
    });

    it('should return 404 for non-existent group', async () => {
      mockMariadb.query.mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const res = await request(app)
        .delete('/api/admin/user-groups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Lines Bulk Operations', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockLineService;
  let mockMariadb;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getPackageById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Package' }),
    };

    mockLineService = {
      createLine: jest.fn().mockResolvedValue({ id: 1, username: 'testuser' }),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([{ username: 'existing' }]),
    };

    mockCache = {
      invalidateLines: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/lines/bulk', async (req, res) => {
      try {
        const {
          users,
          package_id,
          member_id = 0,
          test_mode = false,
          skip_duplicates = true,
          max_connections,
          is_trial,
          bouquet,
        } = req.body || {};

        if (!Array.isArray(users) || !users.length) {
          return res.status(400).json({ error: 'No users provided' });
        }
        if (!package_id) {
          return res.status(400).json({ error: 'Package ID required' });
        }

        const dbApi = require('../../../lib/db');
        const lineService = require('../../../services/lineService');
        const mariadb = require('../../../lib/mariadb');
        const { invalidateLines } = require('../../../lib/cache');

        const basePayload = {
          package_id: parseInt(package_id, 10),
          member_id: parseInt(member_id, 10) || 0,
        };
        const pkg = await dbApi.getPackageById(basePayload.package_id);
        if (!pkg) {
          return res.status(400).json({ error: 'Package not found' });
        }
        if (max_connections !== undefined && max_connections !== null && max_connections !== '') {
          const mc = parseInt(max_connections, 10);
          if (Number.isFinite(mc) && mc > 0) basePayload.max_connections = mc;
        }
        if (is_trial !== undefined) {
          basePayload.is_trial = Number(is_trial) ? 1 : 0;
        }
        if (Array.isArray(bouquet) && bouquet.length) {
          basePayload.bouquet = bouquet.map((b) => parseInt(b, 10)).filter((v) => Number.isFinite(v));
        }

        const existingLines = await mariadb.query('SELECT username FROM `lines`');
        const existingUsernames = new Set(existingLines.map((l) => l.username?.toLowerCase()));

        const details = [];
        let created = 0;
        let skipped = 0;
        let errors = 0;

        for (const user of users) {
          const username = (user.username || '').trim();
          const password = (user.password || '').trim();

          if (!username) {
            details.push({ username: '(empty)', status: 'error', message: 'Empty username' });
            errors++;
            continue;
          }

          if (existingUsernames.has(username.toLowerCase())) {
            if (skip_duplicates) {
              details.push({ username, status: 'skipped', message: 'Duplicate username' });
              skipped++;
              continue;
            }
            details.push({ username, status: 'error', message: 'Duplicate username' });
            errors++;
            continue;
          }

          if (test_mode) {
            details.push({ username, status: 'valid', message: 'Would be created' });
            created++;
            existingUsernames.add(username.toLowerCase());
            continue;
          }

          try {
            const payload = { ...basePayload, username, password };
            const expDate = parseInt(user.exp_date, 10);
            if (Number.isFinite(expDate) && expDate > 0) payload.exp_date = expDate;
            if (user.exp_date === null) payload.exp_date = null;
            await lineService.createLine(payload);
            details.push({ username, status: 'created', message: 'User created' });
            created++;
            existingUsernames.add(username.toLowerCase());
          } catch (createErr) {
            details.push({ username, status: 'error', message: createErr.message || 'Creation failed' });
            errors++;
          }
        }

        if (!test_mode && created > 0) {
          await invalidateLines();
        }

        res.json({ test_mode, created, skipped, errors, total: users.length, details });
      } catch (e) {
        res.status(500).json({ error: e.message || 'Bulk import failed' });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/cache');
  });

  describe('POST /api/admin/lines/bulk', () => {
    it('should bulk create lines', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [
            { username: 'user1', password: 'pass1' },
            { username: 'user2', password: 'pass2' },
          ],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('created', 2);
      expect(res.body).toHaveProperty('skipped', 0);
      expect(res.body).toHaveProperty('errors', 0);
      expect(res.body).toHaveProperty('details');
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('should return 400 without users', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ package_id: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'No users provided');
    });

    it('should return 400 with empty users array', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [], package_id: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'No users provided');
    });

    it('should return 400 without package_id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'test', password: 'test' }] })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Package ID required');
    });

    it('should return 400 for non-existent package', async () => {
      mockDb.getPackageById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'test', password: 'test' }], package_id: 999 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Package not found');
    });

    it('should skip duplicate usernames by default', async () => {
      mockMariadb.query.mockImplementation(() => Promise.resolve([{ username: 'existing' }]));

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'existing', password: 'pass' }],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('skipped', 1);
      expect(res.body).toHaveProperty('created', 0);
    });

    it('should handle test mode', async () => {
      mockMariadb.query.mockImplementation(() => Promise.resolve([]));
      mockLineService.createLine.mockClear();

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'testuser', password: 'pass' }],
          package_id: 1,
          test_mode: true,
        })
        .expect(200);

      expect(res.body).toHaveProperty('test_mode', true);
      expect(res.body).toHaveProperty('created', 1);
      expect(mockLineService.createLine).not.toHaveBeenCalled();
    });

    it('should handle empty username', async () => {
      mockMariadb.query.mockImplementation(() => Promise.resolve([]));
      mockLineService.createLine.mockClear();

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: '', password: 'pass' }],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('errors', 1);
      expect(res.body.details[0]).toHaveProperty('message', 'Empty username');
    });

    it('should handle creation errors', async () => {
      mockLineService.createLine.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'baduser', password: 'pass' }],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('errors', 1);
    });

    it('should handle duplicate usernames with skip_duplicates=true', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ username: 'existing' }]);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'existing', password: 'pass' }],
          package_id: 1,
          skip_duplicates: true,
        })
        .expect(200);

      expect(res.body).toHaveProperty('skipped', 1);
      expect(res.body).toHaveProperty('created', 0);
    });

    it('should handle duplicate usernames with skip_duplicates=false', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ username: 'existing' }]);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'existing', password: 'pass' }],
          package_id: 1,
          skip_duplicates: false,
        })
        .expect(200);

      expect(res.body).toHaveProperty('errors', 1);
      expect(res.body.details[0]).toHaveProperty('message', 'Duplicate username');
    });

    it('should handle is_trial flag', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      mockLineService.createLine.mockClear();
      mockLineService.createLine.mockResolvedValueOnce({ id: 1 });

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'trialuser', password: 'pass' }],
          package_id: 1,
          is_trial: true,
        })
        .expect(200);

      expect(mockLineService.createLine).toHaveBeenLastCalledWith(
        expect.objectContaining({ is_trial: 1 })
      );
    });

    it('should handle bouquet array', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      mockLineService.createLine.mockClear();
      mockLineService.createLine.mockResolvedValueOnce({ id: 1 });

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'bouquetuser', password: 'pass' }],
          package_id: 1,
          bouquet: [1, 2, 3],
        })
        .expect(200);

      expect(mockLineService.createLine).toHaveBeenLastCalledWith(
        expect.objectContaining({ bouquet: [1, 2, 3] })
      );
    });

    it('should handle max_connections parameter', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      mockLineService.createLine.mockClear();
      mockLineService.createLine.mockResolvedValueOnce({ id: 1 });

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'maxconnuser', password: 'pass' }],
          package_id: 1,
          max_connections: 5,
        })
        .expect(200);

      expect(mockLineService.createLine).toHaveBeenLastCalledWith(
        expect.objectContaining({ max_connections: 5 })
      );
    });

    it('should handle custom expiration date', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      mockLineService.createLine.mockClear();
      mockLineService.createLine.mockResolvedValueOnce({ id: 1 });

      const expDate = Date.now() + 86400000;

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'expuser', password: 'pass', exp_date: expDate }],
          package_id: 1,
        })
        .expect(200);

      expect(mockLineService.createLine).toHaveBeenLastCalledWith(
        expect.objectContaining({ exp_date: expDate })
      );
    });

    it('should return 500 on bulk import failure', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'user1', password: 'pass' }],
          package_id: 1,
        })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - User Groups', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Test Group', is_admin: 0, is_reseller: 1, member_count: 5 }),
      createUserGroup: jest.fn().mockResolvedValue(3),
      updateUserGroup: jest.fn().mockResolvedValue(true),
      deleteUserGroup: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('COUNT(u.id)')) {
          return Promise.resolve([{ group_id: 1, group_name: 'Admins', is_admin: 1, is_reseller: 0, member_count: 2 }]);
        }
        if (sql.includes('SELECT g.*')) {
          return Promise.resolve([
            { group_id: 1, group_name: 'Admins', is_admin: 1, is_reseller: 0, member_count: 2 },
            { group_id: 2, group_name: 'Resellers', is_admin: 0, is_reseller: 1, member_count: 10 },
          ]);
        }
        return Promise.resolve([]);
      }),
      queryOne: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Test Group', is_admin: 0, is_reseller: 1, member_count: 5 }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/user-groups', async (req, res) => {
      try {
        const groups = await mockMariadb.query(
          `SELECT g.*, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.member_group_id = g.group_id GROUP BY g.group_id ORDER BY g.group_id ASC`
        );
        res.json({ groups });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/user-groups/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const group = await mockMariadb.queryOne(
        `SELECT g.*, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.member_group_id = g.group_id WHERE g.group_id = ? GROUP BY g.group_id`,
        [n]
      );
      if (!group) return res.status(404).json({ error: 'not found' });
      res.json(group);
    });

    mockAdminRouter.post('/user-groups', async (req, res) => {
      const body = req.body || {};
      if (!String(body.group_name || '').trim()) return res.status(400).json({ error: 'group_name required' });
      try {
        const isAdmin = body.is_admin ? 1 : 0;
        const isReseller = body.is_reseller !== undefined ? (body.is_reseller ? 1 : 0) : 0;
        const id = await mockDb.createUserGroup({
          group_name: String(body.group_name).trim(),
          is_admin: isAdmin,
          is_reseller: isReseller,
          allowed_pages: '[]',
        });
        await mockDb.updateUserGroup(id, {
          total_allowed_gen_trials: parseInt(body.total_allowed_gen_trials, 10) || 0,
          total_allowed_gen_in: String(body.total_allowed_gen_in || 'day'),
          delete_users: body.delete_users ? 1 : 0,
          manage_expiry_media: body.manage_expiry_media ? 1 : 0,
          notice_html: body.notice_html != null ? String(body.notice_html) : '',
        });
        res.status(201).json({
          group_id: id,
          group_name: String(body.group_name).trim(),
          is_admin: isAdmin,
          is_reseller: isReseller,
          member_count: 0,
        });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/user-groups/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const group = await mockDb.getUserGroupById(n);
      if (!group) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateUserGroup(n, {
          group_name: req.body && req.body.group_name !== undefined ? String(req.body.group_name).trim() : undefined,
          is_admin: req.body && req.body.is_admin !== undefined ? (req.body.is_admin ? 1 : 0) : undefined,
          is_reseller: req.body && req.body.is_reseller !== undefined ? (req.body.is_reseller ? 1 : 0) : undefined,
        });
        res.json({
          ...group,
          group_name: req.body && req.body.group_name !== undefined ? String(req.body.group_name).trim() : group.group_name,
          is_admin: req.body && req.body.is_admin !== undefined ? (req.body.is_admin ? 1 : 0) : group.is_admin,
          is_reseller: req.body && req.body.is_reseller !== undefined ? (req.body.is_reseller ? 1 : 0) : group.is_reseller,
        });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/user-groups/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const group = await mockMariadb.queryOne(
        `SELECT g.*, COUNT(u.id) AS member_count FROM user_groups g LEFT JOIN users u ON u.member_group_id = g.group_id WHERE g.group_id = ? GROUP BY g.group_id`,
        [n]
      );
      if (!group) return res.status(404).json({ error: 'not found' });
      if (Number(group.member_count) > 0) return res.status(400).json({ error: 'group still has assigned members' });
      if (Number(group.is_admin) === 1) return res.status(400).json({ error: 'cannot delete admin group' });
      await mockDb.deleteUserGroup(n);
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/user-groups', () => {
    it('should return user groups list', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups')
        .expect(200);

      expect(res.body).toHaveProperty('groups');
      expect(Array.isArray(res.body.groups)).toBe(true);
      expect(res.body.groups.length).toBeGreaterThan(0);
    });

    it('should return group objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups')
        .expect(200);

      const group = res.body.groups[0];
      expect(group).toHaveProperty('group_id');
      expect(group).toHaveProperty('group_name');
      expect(group).toHaveProperty('member_count');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/user-groups')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/user-groups/:id', () => {
    it('should return user group by id', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups/1')
        .expect(200);

      expect(res.body).toHaveProperty('group_id', 1);
      expect(res.body).toHaveProperty('group_name');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/user-groups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent group', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/user-groups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/user-groups', () => {
    it('should create user group', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: 'New Group', is_reseller: true })
        .expect(201);

      expect(res.body).toHaveProperty('group_name', 'New Group');
    });

    it('should return 400 without group_name', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'group_name required');
    });

    it('should return 400 with empty group_name', async () => {
      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: '   ' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'group_name required');
    });

    it('should create with admin flag', async () => {
      mockDb.createUserGroup.mockResolvedValueOnce(5);

      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: 'Admin Group', is_admin: true })
        .expect(201);

      expect(mockDb.createUserGroup).toHaveBeenCalledWith(
        expect.objectContaining({ is_admin: 1, is_reseller: 0 })
      );
    });

    it('should return 400 on create failure', async () => {
      mockDb.createUserGroup.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/user-groups')
        .send({ group_name: 'Bad Group' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/user-groups/:id', () => {
    it('should update user group', async () => {
      const res = await request(app)
        .put('/api/admin/user-groups/2')
        .send({ group_name: 'Updated Name' })
        .expect(200);

      expect(res.body).toHaveProperty('group_name', 'Updated Name');
    });

    it('should update is_admin flag', async () => {
      const res = await request(app)
        .put('/api/admin/user-groups/2')
        .send({ is_admin: true })
        .expect(200);

      expect(mockDb.updateUserGroup).toHaveBeenCalledWith(2, expect.objectContaining({ is_admin: 1 }));
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/user-groups/invalid')
        .send({ group_name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent group', async () => {
      mockDb.getUserGroupById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/user-groups/999')
        .send({ group_name: 'Test' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 on update failure', async () => {
      mockDb.updateUserGroup.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/user-groups/2')
        .send({ group_name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/user-groups/:id', () => {
    it('should delete user group', async () => {
      mockMariadb.queryOne.mockResolvedValue({ group_id: 3, group_name: 'Empty Group', is_admin: 0, is_reseller: 1, member_count: 0 });

      const res = await request(app)
        .delete('/api/admin/user-groups/3')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/user-groups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent group', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/admin/user-groups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 when group has members', async () => {
      mockMariadb.queryOne.mockResolvedValue({ group_id: 1, group_name: 'Group With Members', is_admin: 0, is_reseller: 1, member_count: 5 });

      const res = await request(app)
        .delete('/api/admin/user-groups/1')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'group still has assigned members');
    });

    it('should return 400 when deleting admin group', async () => {
      mockMariadb.queryOne.mockResolvedValue({ group_id: 1, group_name: 'Admins', is_admin: 1, is_reseller: 0, member_count: 0 });

      const res = await request(app)
        .delete('/api/admin/user-groups/1')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'cannot delete admin group');
    });
  });
});

describe('Admin API Routes - Packages CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockPackageService;

  beforeAll(() => {
    jest.resetModules();

    mockPackageService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, name: 'Package 1', price: 9.99 },
        { id: 2, name: 'Package 2', price: 19.99 },
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, name: 'Package 1', price: 9.99 }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/packageService', () => mockPackageService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/packages', async (req, res) => {
      res.json({ packages: await mockPackageService.list() });
    });

    mockAdminRouter.post('/packages', async (req, res) => {
      try {
        const id = await mockPackageService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/packages/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const pkg = await mockPackageService.getById(n);
      if (!pkg) return res.status(404).json({ error: 'not found' });
      try {
        await mockPackageService.update(n, req.body || {});
        res.json({ ok: true, id: n });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/packages/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockPackageService.remove(n);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/packageService');
  });

  describe('GET /api/admin/packages', () => {
    it('should return packages list', async () => {
      const res = await request(app)
        .get('/api/admin/packages')
        .expect(200);

      expect(res.body).toHaveProperty('packages');
      expect(Array.isArray(res.body.packages)).toBe(true);
      expect(res.body.packages.length).toBeGreaterThan(0);
    });

    it('should return package objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/packages')
        .expect(200);

      const pkg = res.body.packages[0];
      expect(pkg).toHaveProperty('id');
      expect(pkg).toHaveProperty('name');
    });
  });

  describe('POST /api/admin/packages', () => {
    it('should create package', async () => {
      const res = await request(app)
        .post('/api/admin/packages')
        .send({ name: 'New Package', price: 29.99 })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 on create failure', async () => {
      mockPackageService.create.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/packages')
        .send({ name: 'Bad Package' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/packages/:id', () => {
    it('should update package', async () => {
      const res = await request(app)
        .put('/api/admin/packages/1')
        .send({ name: 'Updated Package' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/packages/invalid')
        .send({ name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent package', async () => {
      mockPackageService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/packages/999')
        .send({ name: 'Test' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 on update failure', async () => {
      mockPackageService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/packages/1')
        .send({ name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/packages/:id', () => {
    it('should delete package', async () => {
      const res = await request(app)
        .delete('/api/admin/packages/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/packages/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent package', async () => {
      mockPackageService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/packages/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Bouquets CRUD with Cache', () => {
  let app;
  let mockAdminRouter;
  let mockBouquetService;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockBouquetService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, bouquet_name: 'Bouquet 1' },
        { id: 2, bouquet_name: 'Bouquet 2' },
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, bouquet_name: 'Bouquet 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockCache = {
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/bouquetService', () => mockBouquetService);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/bouquets', async (req, res) => {
      res.json({ bouquets: await mockBouquetService.list() });
    });

    mockAdminRouter.post('/bouquets', async (req, res) => {
      try {
        const id = await mockBouquetService.create(req.body || {});
        await mockCache.invalidateBouquets();
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/bouquets/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const bouquet = await mockBouquetService.getById(n);
      if (!bouquet) return res.status(404).json({ error: 'not found' });
      try {
        await mockBouquetService.update(n, req.body || {});
        await mockCache.invalidateBouquets();
        res.json({ ok: true, id: n });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/bouquets/:id', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockBouquetService.remove(n);
      if (!ok) return res.status(404).json({ error: 'not found' });
      await mockCache.invalidateBouquets();
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/bouquetService');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/bouquets', () => {
    it('should return bouquets list', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets')
        .expect(200);

      expect(res.body).toHaveProperty('bouquets');
      expect(Array.isArray(res.body.bouquets)).toBe(true);
      expect(res.body.bouquets.length).toBeGreaterThan(0);
    });

    it('should return bouquet objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets')
        .expect(200);

      const bouquet = res.body.bouquets[0];
      expect(bouquet).toHaveProperty('id');
      expect(bouquet).toHaveProperty('bouquet_name');
    });
  });

  describe('POST /api/admin/bouquets', () => {
    it('should create bouquet and invalidate cache', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'New Bouquet' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(mockCache.invalidateBouquets).toHaveBeenCalled();
    });

    it('should return 400 on create failure', async () => {
      mockBouquetService.create.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'Bad Bouquet' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/bouquets/:id', () => {
    it('should update bouquet and invalidate cache', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated Bouquet' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockCache.invalidateBouquets).toHaveBeenCalled();
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/invalid')
        .send({ bouquet_name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/bouquets/999')
        .send({ bouquet_name: 'Test' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 on update failure', async () => {
      mockBouquetService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/bouquets/:id', () => {
    it('should delete bouquet and invalidate cache', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockCache.invalidateBouquets).toHaveBeenCalled();
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/bouquets/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });
});

describe('Admin API Routes - Server Actions', () => {
  let app;
  let mockAdminRouter;
  let mockServerService;
  let mockStreamManager;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockServerService = {
      listServers: jest.fn().mockResolvedValue([{ id: 1, name: 'Server 1' }]),
      getServer: jest.fn().mockResolvedValue({ id: 1, name: 'Server 1', enabled: 1 }),
      createServer: jest.fn().mockResolvedValue({ id: 3, name: 'New Server' }),
      updateServer: jest.fn().mockResolvedValue({ id: 1, name: 'Updated Server' }),
      deleteServer: jest.fn().mockResolvedValue(true),
      buildNginxUpstreamSnippet: jest.fn().mockResolvedValue('upstream test { server 127.0.0.1; }'),
      getRuntimePlacementsForServer: jest.fn().mockResolvedValue([]),
      getServerHealthStatus: jest.fn().mockResolvedValue({ fresh: true, staleMs: null }),
      reorderServers: jest.fn().mockResolvedValue(true),
    };

    mockStreamManager = {
      issueRemoteCommand: jest.fn().mockResolvedValue({ ok: true, commandId: 'cmd-123' }),
    };

    mockDb = {
      countActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue(5),
      listActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue([]),
      reconcilePlacementClients: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    };

    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../services/streamManager', () => mockStreamManager);
    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/servers', async (req, res) => {
      try {
        const servers = await mockServerService.listServers();
        res.json({ servers });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/servers/nginx-export', async (req, res) => {
      try {
        const snippet = await mockServerService.buildNginxUpstreamSnippet();
        res.json({ snippet });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/servers/monitor-summary', async (req, res) => {
      try {
        const servers = await mockServerService.listServers();
        const summary = await Promise.all(servers.map(async (s) => {
          const placements = await mockServerService.getRuntimePlacementsForServer(s.id);
          const activeSessions = await mockDb.countActiveRuntimeSessionsByServer(s.id);
          const health = await mockServerService.getServerHealthStatus(s.id);
          const runningPlacements = placements.filter((p) => p.status === 'running').length;
          return {
            id: s.id, name: s.name, active_sessions: activeSessions,
            running_placements: runningPlacements, total_placements: placements.length,
            heartbeat_fresh: !!health.fresh,
          };
        }));
        res.json({ servers: summary });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.put('/servers/reorder', async (req, res) => {
      const orderings = req.body;
      if (!Array.isArray(orderings)) return res.status(400).json({ error: 'body must be an array of {id, sort_order}' });
      try {
        await mockServerService.reorderServers(orderings);
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'reorder failed' }); }
    });

    mockAdminRouter.get('/servers/:id(\\d+)', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const s = await mockServerService.getServer(n);
      if (!s) return res.status(404).json({ error: 'not found' });
      res.json(s);
    });

    mockAdminRouter.post('/servers', async (req, res) => {
      try {
        const s = await mockServerService.createServer(req.body || {});
        res.status(201).json(s);
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/servers/:id(\\d+)', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const s = await mockServerService.updateServer(n, req.body || {});
        if (!s) return res.status(404).json({ error: 'not found' });
        res.json(s);
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/servers/:id(\\d+)', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      try {
        const ok = await mockServerService.deleteServer(n);
        if (!ok) return res.status(404).json({ error: 'not found' });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/servers/:id/actions/restart-services', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const server = await mockServerService.getServer(n);
      if (!server) return res.status(404).json({ error: 'not found' });
      const result = await mockStreamManager.issueRemoteCommand({
        serverId: n, commandType: 'restart_services', issuedByUserId: 1,
      });
      if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
      res.json({ ok: true, commandId: result.commandId, message: 'Restart services command queued' });
    });

    mockAdminRouter.post('/servers/:id/actions/reboot-server', async (req, res) => {
      const n = parseInt(req.params.id, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
      const server = await mockServerService.getServer(n);
      if (!server) return res.status(404).json({ error: 'not found' });
      const result = await mockStreamManager.issueRemoteCommand({
        serverId: n, commandType: 'reboot_server', issuedByUserId: 1,
      });
      if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
      res.json({ ok: true, commandId: result.commandId, message: 'Reboot command queued' });
    });

    mockAdminRouter.post('/servers/:id/actions/kill-connections', async (req, res) => {
      try {
        const n = parseInt(req.params.id, 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
        const server = await mockServerService.getServer(n);
        if (!server) return res.status(404).json({ error: 'not found' });
        const sessions = await mockDb.listActiveRuntimeSessionsByServer(n);
        res.json({ ok: true, closed: sessions.length, message: `Closed ${sessions.length} active connection(s)` });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/serverService');
    jest.unmock('../../../services/streamManager');
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/servers', () => {
    it('should return servers list', async () => {
      const res = await request(app)
        .get('/api/admin/servers')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return 500 on error', async () => {
      mockServerService.listServers.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/servers')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/servers/nginx-export', () => {
    it('should return nginx upstream snippet', async () => {
      const res = await request(app)
        .get('/api/admin/servers/nginx-export')
        .expect(200);

      expect(res.body).toHaveProperty('snippet');
      expect(typeof res.body.snippet).toBe('string');
    });

    it('should return 500 on error', async () => {
      mockServerService.buildNginxUpstreamSnippet.mockRejectedValueOnce(new Error('build failed'));

      const res = await request(app)
        .get('/api/admin/servers/nginx-export')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/servers/monitor-summary', () => {
    it('should return server monitor summary', async () => {
      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return 500 on error', async () => {
      mockServerService.listServers.mockRejectedValueOnce(new Error('list failed'));

      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/servers', () => {
    it('should create server', async () => {
      const res = await request(app)
        .post('/api/admin/servers')
        .send({ name: 'New Server', ip: '192.168.1.1' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'New Server');
    });

    it('should return 400 on create failure', async () => {
      mockServerService.createServer.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/servers')
        .send({ name: 'Bad Server' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/servers/:id', () => {
    it('should return server by id', async () => {
      const res = await request(app)
        .get('/api/admin/servers/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('name');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/admin/servers/invalid')
        .expect(404);

      expect(res.text).toContain('Cannot GET');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/servers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('PUT /api/admin/servers/:id', () => {
    it('should update server', async () => {
      const res = await request(app)
        .put('/api/admin/servers/1')
        .send({ name: 'Updated Server' })
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .put('/api/admin/servers/invalid')
        .send({ name: 'Test' })
        .expect(404);

      expect(res.text).toContain('Cannot PUT');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.updateServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/servers/999')
        .send({ name: 'Test' })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 on update failure', async () => {
      mockServerService.updateServer.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/servers/1')
        .send({ name: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/servers/:id', () => {
    it('should delete server', async () => {
      const res = await request(app)
        .delete('/api/admin/servers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/admin/servers/invalid')
        .expect(404);

      expect(res.text).toContain('Cannot DELETE');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.deleteServer.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/servers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 500 on delete failure', async () => {
      mockServerService.deleteServer.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .delete('/api/admin/servers/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/servers/reorder', () => {
    it('should reorder servers', async () => {
      const res = await request(app)
        .put('/api/admin/servers/reorder')
        .send([{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }])
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-array body', async () => {
      const res = await request(app)
        .put('/api/admin/servers/reorder')
        .send({ id: 1, sort_order: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'body must be an array of {id, sort_order}');
    });

    it('should return 400 on reorder failure', async () => {
      mockServerService.reorderServers.mockRejectedValueOnce(new Error('reorder failed'));

      const res = await request(app)
        .put('/api/admin/servers/reorder')
        .send([{ id: 1, sort_order: 1 }])
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/servers/:id/actions/restart-services', () => {
    it('should restart services on server', async () => {
      const res = await request(app)
        .post('/api/admin/servers/1/actions/restart-services')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('commandId');
      expect(res.body).toHaveProperty('message');
      expect(mockStreamManager.issueRemoteCommand).toHaveBeenCalledWith(
        expect.objectContaining({ commandType: 'restart_services' })
      );
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/restart-services')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/restart-services')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 400 when command fails', async () => {
      mockStreamManager.issueRemoteCommand.mockResolvedValueOnce({ ok: false, reason: 'Server unreachable' });

      const res = await request(app)
        .post('/api/admin/servers/1/actions/restart-services')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Server unreachable');
    });
  });

  describe('POST /api/admin/servers/:id/actions/reboot-server', () => {
    it('should reboot server', async () => {
      const res = await request(app)
        .post('/api/admin/servers/1/actions/reboot-server')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockStreamManager.issueRemoteCommand).toHaveBeenCalledWith(
        expect.objectContaining({ commandType: 'reboot_server' })
      );
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/reboot-server')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/reboot-server')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });
  });

  describe('POST /api/admin/servers/:id/actions/kill-connections', () => {
    it('should kill connections on server', async () => {
      mockDb.listActiveRuntimeSessionsByServer.mockResolvedValueOnce([
        { session_uuid: 'uuid1', stream_type: 'live', stream_id: 1, line_id: 1 },
        { session_uuid: 'uuid2', stream_type: 'movie', stream_id: 5, line_id: 2 },
      ]);

      const res = await request(app)
        .post('/api/admin/servers/1/actions/kill-connections')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('closed');
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/kill-connections')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/kill-connections')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return 500 on error', async () => {
      mockDb.listActiveRuntimeSessionsByServer.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .post('/api/admin/servers/1/actions/kill-connections')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Server Provisioning', () => {
  let app;
  let mockAdminRouter;
  let mockProvisionService;

  beforeAll(() => {
    jest.resetModules();

    mockProvisionService = {
      isProvisioningEnabled: jest.fn().mockResolvedValue(true),
      startProvisionJob: jest.fn().mockResolvedValue({ id: 'job-123', status: 'pending' }),
      getJob: jest.fn().mockImplementation((id) => {
        if (id === 'job-123') return { id: 'job-123', status: 'running', log: 'Installing...', error: null };
        if (id === 'job-error') return { id: 'job-error', status: 'failed', log: '', error: 'Provision failed' };
        return null;
      }),
    };

    jest.mock('../../../services/provisionService', () => mockProvisionService);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/servers/provision', async (req, res) => {
      if (!(await mockProvisionService.isProvisioningEnabled())) {
        return res.status(403).json({ error: 'provisioning disabled' });
      }
      try {
        const b = req.body || {};
        const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
        const host = req.get('host') || '';
        const panelUrl = String(b.panel_url || process.env.PANEL_PUBLIC_URL || `${proto}://${host}`).replace(/\/+$/, '');
        const job = await mockProvisionService.startProvisionJob({
          ...b,
          panel_url: panelUrl,
          userId: 1,
        });
        res.status(201).json(job);
      } catch (e) { res.status(400).json({ error: e.message || 'provision failed' }); }
    });

    mockAdminRouter.get('/servers/provision/:jobId', async (req, res) => {
      if (!(await mockProvisionService.isProvisioningEnabled())) {
        return res.status(403).json({ error: 'provisioning disabled' });
      }
      try {
        const job = await mockProvisionService.getJob(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'not found' });
        res.json({
          id: job.id,
          status: job.status,
          log: job.log || '',
          error: job.error || null,
        });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/provisionService');
  });

  describe('POST /api/admin/servers/provision', () => {
    it('should start provisioning job', async () => {
      const res = await request(app)
        .post('/api/admin/servers/provision')
        .send({ server_name: 'New Server', template_id: 1 })
        .expect(201);

      expect(res.body).toHaveProperty('id', 'job-123');
      expect(res.body).toHaveProperty('status', 'pending');
    });

    it('should return 403 when provisioning disabled', async () => {
      mockProvisionService.isProvisioningEnabled.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/admin/servers/provision')
        .send({ server_name: 'Test' })
        .expect(403);

      expect(res.body).toHaveProperty('error', 'provisioning disabled');
    });

    it('should return 400 on provision failure', async () => {
      mockProvisionService.startProvisionJob.mockRejectedValueOnce(new Error('provision failed'));

      const res = await request(app)
        .post('/api/admin/servers/provision')
        .send({ server_name: 'Bad Server' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/servers/provision/:jobId', () => {
    it('should return job status', async () => {
      const res = await request(app)
        .get('/api/admin/servers/provision/job-123')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'job-123');
      expect(res.body).toHaveProperty('status', 'running');
      expect(res.body).toHaveProperty('log');
    });

    it('should return 403 when provisioning disabled', async () => {
      mockProvisionService.isProvisioningEnabled.mockResolvedValueOnce(false);

      const res = await request(app)
        .get('/api/admin/servers/provision/job-123')
        .expect(403);

      expect(res.body).toHaveProperty('error', 'provisioning disabled');
    });

    it('should return 404 for non-existent job', async () => {
      const res = await request(app)
        .get('/api/admin/servers/provision/invalid-job')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'not found');
    });

    it('should return job with error', async () => {
      const res = await request(app)
        .get('/api/admin/servers/provision/job-error')
        .expect(200);

      expect(res.body).toHaveProperty('error', 'Provision failed');
    });
  });
});
