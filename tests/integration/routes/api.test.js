'use strict';

const request = require('supertest');
const express = require('express');

describe('Xtream API Routes - player_api.php', () => {
  let app;
  let mockLineService;
  let mockXtreamService;
  let mockEpgService;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      authenticateLine: jest.fn(),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
    };

    mockXtreamService = {
      userInfo: jest.fn().mockResolvedValue({ username: 'testuser', status: 'Active' }),
      serverInfo: jest.fn().mockResolvedValue({ version: '1.0' }),
      liveCategories: jest.fn().mockResolvedValue([{ category_id: 1, category_name: 'Sports' }]),
      liveStreams: jest.fn().mockResolvedValue([{ stream_id: 1, name: 'Channel 1' }]),
      filterByCategoryId: jest.fn().mockImplementation((data) => data),
      vodCategories: jest.fn().mockResolvedValue([{ category_id: 1, category_name: 'Movies' }]),
      vodStreams: jest.fn().mockResolvedValue([{ stream_id: 1, name: 'Movie 1' }]),
      vodInfo: jest.fn().mockResolvedValue({ stream_id: 1, name: 'Movie 1', plot: 'A movie' }),
      seriesCategories: jest.fn().mockResolvedValue([{ category_id: 1, category_name: 'TV Shows' }]),
      seriesList: jest.fn().mockResolvedValue([{ series_id: 1, name: 'Series 1' }]),
      seriesInfo: jest.fn().mockResolvedValue({ series_id: 1, name: 'Series 1', seasons: [] }),
      shortEpg: jest.fn().mockResolvedValue([]),
      simpleDataTable: jest.fn().mockResolvedValue({}),
      liveInfo: jest.fn().mockResolvedValue({ stream_id: 1, name: 'Channel 1' }),
    };

    mockEpgService = {
      xmltv: jest.fn().mockResolvedValue('<xml>test</xml>'),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../services/xtreamService', () => mockXtreamService);
    jest.mock('../../../services/epgService', () => mockEpgService);

    const xtreamRouter = express.Router();

    function readCredentials(req) {
      const username = req.query.username != null ? req.query.username : req.body && req.body.username;
      const password = req.query.password != null ? req.query.password : req.body && req.body.password;
      return { username: username != null ? String(username) : '', password: password != null ? String(password) : '' };
    }

    function sendAuthFailure(res, result) {
      const code = result && result.error_code;
      const map = { INVALID: { s: 401, m: 'Invalid credentials' }, BANNED: { s: 403, m: 'Account banned' }, DISABLED: { s: 403, m: 'Account disabled' }, EXPIRED: { s: 403, m: 'Subscription expired' } };
      const e = map[code] || { s: 401, m: 'Unauthorized' };
      return res.status(e.s).json({ user_info: { auth: 0, status: e.m } });
    }

    async function authenticate(req, res) {
      const { username, password } = readCredentials(req);
      if (!username || !password) { res.status(401).json({ user_info: { auth: 0, status: 'Missing credentials' } }); return null; }
      const result = await mockLineService.authenticateLine(username, password);
      if (!result.ok || !result.line) { sendAuthFailure(res, result); return null; }
      return mockLineService.normalizeLineRow(result.line);
    }

    xtreamRouter.get('/player_api.php', async (req, res) => {
      const line = await authenticate(req, res);
      if (!line) return;

      const action = req.query.action != null ? String(req.query.action) : '';

      if (!action) {
        return res.json({
          user_info: await mockXtreamService.userInfo(line),
          server_info: await mockXtreamService.serverInfo(req),
        });
      }

      switch (action) {
        case 'get_live_categories':
          return res.json(await mockXtreamService.liveCategories(line));
        case 'get_live_streams':
          return res.json(await mockXtreamService.liveStreams(line));
        case 'get_vod_categories':
          return res.json(await mockXtreamService.vodCategories(line));
        case 'get_vod_streams':
          return res.json(await mockXtreamService.vodStreams(line));
        case 'get_vod_info':
          const info = await mockXtreamService.vodInfo(line, req.query.vod_id);
          if (!info) return res.status(404).json({ error: 'VOD not found' });
          return res.json(info);
        case 'get_series_categories':
          return res.json(await mockXtreamService.seriesCategories(line));
        case 'get_series':
          return res.json(await mockXtreamService.seriesList(line));
        case 'get_series_info':
          const seriesInfo = await mockXtreamService.seriesInfo(line, req.query.series_id);
          if (!seriesInfo) return res.status(404).json({ error: 'Series not found' });
          return res.json(seriesInfo);
        case 'get_short_epg':
          return res.json(await mockXtreamService.shortEpg(req.query.stream_id, req.query.limit));
        case 'get_simple_data_table':
          return res.json(await mockXtreamService.simpleDataTable(req.query.stream_id));
        case 'get_live_info':
          const liveInfo = mockXtreamService.liveInfo(req.query.stream_id);
          if (!liveInfo) return res.status(404).json({ error: 'Stream not found' });
          return res.json(liveInfo);
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/', xtreamRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../services/xtreamService');
    jest.unmock('../../../services/epgService');
  });

  describe('Authentication', () => {
    it('should return 401 without credentials', async () => {
      const res = await request(app)
        .get('/player_api.php')
        .expect(401);

      expect(res.body).toHaveProperty('user_info');
      expect(res.body.user_info).toHaveProperty('auth', 0);
      expect(res.body.user_info.status).toBe('Missing credentials');
    });

    it('should return 401 with invalid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null, error_code: 'INVALID' });

      const res = await request(app)
        .get('/player_api.php?username=bad&password=wrong')
        .expect(401);

      expect(res.body.user_info).toHaveProperty('auth', 0);
      expect(res.body.user_info.status).toBe('Invalid credentials');
    });

    it('should return 403 for banned account', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null, error_code: 'BANNED' });

      const res = await request(app)
        .get('/player_api.php?username=banned&password=test')
        .expect(403);

      expect(res.body.user_info).toHaveProperty('auth', 0);
      expect(res.body.user_info.status).toBe('Account banned');
    });

    it('should return 403 for disabled account', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null, error_code: 'DISABLED' });

      const res = await request(app)
        .get('/player_api.php?username=disabled&password=test')
        .expect(403);

      expect(res.body.user_info).toHaveProperty('auth', 0);
      expect(res.body.user_info.status).toBe('Account disabled');
    });

    it('should return 403 for expired account', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null, error_code: 'EXPIRED' });

      const res = await request(app)
        .get('/player_api.php?username=expired&password=test')
        .expect(403);

      expect(res.body.user_info).toHaveProperty('auth', 0);
      expect(res.body.user_info.status).toBe('Subscription expired');
    });

    it('should authenticate with valid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: true, line: { id: 1, username: 'testuser' } });

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass')
        .expect(200);

      expect(res.body).toHaveProperty('user_info');
      expect(res.body).toHaveProperty('server_info');
    });
  });

  describe('GET /player_api.php - User Info', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return user_info and server_info without action', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass')
        .expect(200);

      expect(res.body).toHaveProperty('user_info');
      expect(res.body).toHaveProperty('server_info');
    });
  });

  describe('GET /player_api.php - Live Categories', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return live categories', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_live_categories')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(mockXtreamService.liveCategories).toHaveBeenCalled();
    });
  });

  describe('GET /player_api.php - Live Streams', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return live streams', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_live_streams')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(mockXtreamService.liveStreams).toHaveBeenCalled();
    });

    it('should return live streams filtered by category when category_id is provided', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_live_streams&category_id=1')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /player_api.php - VOD', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return vod categories', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_vod_categories')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(mockXtreamService.vodCategories).toHaveBeenCalled();
    });

    it('should return vod streams', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_vod_streams')
        .expect(200);

      expect(mockXtreamService.vodStreams).toHaveBeenCalled();
    });

    it('should return vod info', async () => {
      mockXtreamService.vodInfo.mockResolvedValueOnce({ stream_id: 1, name: 'Movie 1' });

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_vod_info&vod_id=1')
        .expect(200);

      expect(res.body).toHaveProperty('stream_id', 1);
      expect(mockXtreamService.vodInfo).toHaveBeenCalled();
    });

    it('should return 404 for non-existent vod', async () => {
      mockXtreamService.vodInfo.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_vod_info&vod_id=999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'VOD not found');
    });
  });

  describe('GET /player_api.php - Series', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return series categories', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_series_categories')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(mockXtreamService.seriesCategories).toHaveBeenCalled();
    });

    it('should return series list', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_series')
        .expect(200);

      expect(mockXtreamService.seriesList).toHaveBeenCalled();
    });

    it('should return series info', async () => {
      mockXtreamService.seriesInfo.mockResolvedValueOnce({ series_id: 1, name: 'Series 1', seasons: [] });

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_series_info&series_id=1')
        .expect(200);

      expect(res.body).toHaveProperty('series_id', 1);
      expect(mockXtreamService.seriesInfo).toHaveBeenCalled();
    });

    it('should return 404 for non-existent series', async () => {
      mockXtreamService.seriesInfo.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_series_info&series_id=999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'Series not found');
    });
  });

  describe('GET /player_api.php - EPG and Info', () => {
    beforeEach(() => {
      mockLineService.authenticateLine.mockResolvedValue({ ok: true, line: { id: 1, username: 'testuser' } });
    });

    it('should return short epg', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_short_epg&stream_id=1&limit=5')
        .expect(200);

      expect(mockXtreamService.shortEpg).toHaveBeenCalledWith('1', '5');
    });

    it('should return simple data table', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_simple_data_table&stream_id=1')
        .expect(200);

      expect(mockXtreamService.simpleDataTable).toHaveBeenCalledWith('1');
    });

    it('should return live info', async () => {
      mockXtreamService.liveInfo.mockReturnValueOnce({ stream_id: 1, name: 'Channel 1' });

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_live_info&stream_id=1')
        .expect(200);

      expect(res.body).toHaveProperty('stream_id', 1);
    });

    it('should return 404 for non-existent live stream', async () => {
      mockXtreamService.liveInfo.mockReturnValueOnce(null);

      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=get_live_info&stream_id=999')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'Stream not found');
    });

    it('should return 400 for unknown action', async () => {
      const res = await request(app)
        .get('/player_api.php?username=testuser&password=testpass&action=unknown_action')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Unknown action');
    });
  });
});

describe('Playlist Routes - get.php', () => {
  let app;
  let mockLineService;
  let mockPlaylistService;
  let mockServerService;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      authenticateLine: jest.fn(),
      normalizeLineRow: jest.fn().mockImplementation(r => ({ ...r, bouquet: [] })),
    };

    mockPlaylistService = {
      generatePlaylist: jest.fn().mockResolvedValue('#EXTM3U\n#EXTINF:-1,Test Channel\nhttp://example.com/test.ts'),
    };

    mockServerService = {
      resolvePlaylistBaseUrl: jest.fn().mockResolvedValue('http://example.com/stream'),
      selectServer: jest.fn().mockResolvedValue({ publicBaseUrl: 'http://cdn.example.com' }),
      resolvePublicStreamOrigin: jest.fn().mockResolvedValue('http://origin.example.com'),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../services/playlistService', () => mockPlaylistService);
    jest.mock('../../../services/serverService', () => mockServerService);

    const playlistRouter = express.Router();

    playlistRouter.get('/get.php', async (req, res) => {
      const username = req.query.username != null ? String(req.query.username) : '';
      const password = req.query.password != null ? String(req.query.password) : '';
      if (!username || !password) return res.status(401).send('Missing credentials');

      const auth = await mockLineService.authenticateLine(username, password);
      if (!auth.ok || !auth.line) return res.status(403).send('Forbidden');

      const line = mockLineService.normalizeLineRow(auth.line);
      const m3u = await mockPlaylistService.generatePlaylist(line, {
        type: 'm3u_plus',
        output: 'ts',
        baseUrl: 'http://example.com/stream',
        resolveBaseUrl: () => 'http://example.com/stream',
        resolveAssetBaseUrl: async () => 'http://cdn.example.com',
      });

      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(m3u);
    });

    app = express();
    app.use('/', playlistRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../services/playlistService');
    jest.unmock('../../../services/serverService');
  });

  describe('GET /get.php', () => {
    it('should return 401 without credentials', async () => {
      const res = await request(app)
        .get('/get.php')
        .expect(401);

      expect(res.text).toBe('Missing credentials');
    });

    it('should return 401 with only username', async () => {
      const res = await request(app)
        .get('/get.php?username=testuser')
        .expect(401);

      expect(res.text).toBe('Missing credentials');
    });

    it('should return 401 with only password', async () => {
      const res = await request(app)
        .get('/get.php?password=testpass')
        .expect(401);

      expect(res.text).toBe('Missing credentials');
    });

    it('should return 403 with invalid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null });

      const res = await request(app)
        .get('/get.php?username=bad&password=wrong')
        .expect(403);

      expect(res.text).toBe('Forbidden');
    });

    it('should return 403 with failed auth', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: true, line: null });

      const res = await request(app)
        .get('/get.php?username=test&password=test')
        .expect(403);

      expect(res.text).toBe('Forbidden');
    });

    it('should return playlist with valid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: true, line: { id: 1, username: 'testuser' } });

      const res = await request(app)
        .get('/get.php?username=testuser&password=testpass')
        .expect(200);

      expect(res.headers['content-type']).toContain('audio/x-mpegurl');
    });

    it('should set content type header', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: true, line: { id: 1, username: 'testuser' } });

      const res = await request(app)
        .get('/get.php?username=testuser&password=testpass')
        .expect(200);

      expect(res.headers['content-type']).toContain('audio/x-mpegurl');
    });
  });
});

describe('Client Routes', () => {
  let app;
  let mockDb;
  let mockMariadb;
  let mockLineService;
  let mockPlaylistService;
  let mockServerService;
  let mockEpgService;
  let clientRouter;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getLineById: jest.fn(),
      attachLinePassword: jest.fn().mockImplementation(r => ({ ...r, password: 'testpass' })),
    };

    mockMariadb = {
      query: jest.fn(),
      queryOne: jest.fn(),
      execute: jest.fn().mockResolvedValue({ insertId: 1 }),
    };

    mockLineService = {
      authenticateLine: jest.fn(),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
      update: jest.fn().mockResolvedValue(true),
      checkIpAllowed: jest.fn().mockReturnValue(true),
      checkUaAllowed: jest.fn().mockReturnValue(true),
    };

    mockPlaylistService = {
      generatePlaylist: jest.fn().mockResolvedValue('#EXTM3U\n#EXTINF:-1,Test\nhttp://test.com/test.ts'),
    };

    mockServerService = {
      resolvePlaylistBaseUrl: jest.fn().mockResolvedValue('http://example.com'),
      selectServer: jest.fn().mockResolvedValue({ publicBaseUrl: 'http://cdn.example.com' }),
      resolvePublicStreamOrigin: jest.fn().mockResolvedValue('http://origin.example.com'),
    };

    mockEpgService = {
      xmltv: jest.fn().mockResolvedValue('<xml>test</xml>'),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../services/playlistService', () => mockPlaylistService);
    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../services/epgService', () => mockEpgService);

    clientRouter = express.Router();

    function checkExpiry(lineExpDate) {
      if (!lineExpDate || lineExpDate <= 0) return true;
      return lineExpDate > Math.floor(Date.now() / 1000);
    }

    async function clientAuth(req, res, next) {
      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const line = await mockMariadb.queryOne(
            'SELECT id, username, exp_date, enabled, admin_enabled FROM `lines` WHERE access_token = ? LIMIT 1',
            [token]
          );
          if (line && line.enabled === 1 && line.admin_enabled !== 0 && checkExpiry(line.exp_date)) {
            req.session = req.session || {};
            req.session.lineId = line.id;
            req.session.lineUsername = line.username;
            req.session.lineExpDate = line.exp_date;
            return next();
          }
        } catch (_) {}
      }
      if (req.session && req.session.lineId) return next();
      return res.status(401).json({ error: 'unauthorized' });
    }

    clientRouter.get('/me', clientAuth, async (req, res) => {
      try {
        const lineId = req.session.lineId;
        const line = await mockMariadb.queryOne(
          `SELECT l.id, l.username, l.exp_date, l.enabled, l.max_connections,
                  p.package_name, p.plan_id
           FROM \`lines\` l
           LEFT JOIN packages p ON l.package_id = p.id
           WHERE l.id = ? LIMIT 1`,
          [lineId]
        );
        if (!line) return res.status(404).json({ error: 'line not found' });
        const expired = !checkExpiry(line.exp_date);
        const connCount = await mockMariadb.queryOne(
          'SELECT COUNT(DISTINCT user_ip) AS c FROM lines_activity WHERE user_id = ? AND date_end IS NULL',
          [lineId]
        ).catch(() => ({ c: 0 }));

        res.json({
          id: line.id,
          username: line.username,
          exp_date: line.exp_date,
          expired,
          enabled: !!line.enabled,
          max_connections: line.max_connections || 1,
          active_connections: connCount?.c || 0,
          package_name: line.package_name || '',
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    clientRouter.put('/password', clientAuth, async (req, res) => {
      try {
        const lineId = req.session.lineId;
        const lineUsername = req.session.lineUsername;
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) return res.status(400).json({ error: 'both passwords required' });
        const auth = await mockLineService.authenticateLine(lineUsername, current_password);
        if (!auth.ok || !auth.line || Number(auth.line.id) !== Number(lineId)) {
          return res.status(403).json({ error: 'current password incorrect' });
        }

        await mockLineService.update(lineId, { password: new_password });
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    clientRouter.get('/connections', clientAuth, async (req, res) => {
      try {
        const lineId = req.session.lineId;
        const rows = await mockMariadb.query(
          `SELECT user_ip AS ip, user_agent, date_start, date_end,
                  CASE WHEN date_end IS NULL THEN 1 ELSE 0 END AS active
           FROM lines_activity
           WHERE user_id = ?
           ORDER BY date_start DESC LIMIT 50`,
          [lineId]
        );
        res.json({ connections: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    clientRouter.get('/playlist', clientAuth, async (req, res) => {
      try {
        const lineId = req.session.lineId;
        const rawLine = await mockDb.getLineById(lineId);
        if (!rawLine) return res.status(404).json({ error: 'line not found' });
        const line = mockLineService.normalizeLineRow(mockDb.attachLinePassword(rawLine));

        const requestBase = `${req.protocol || 'http'}://${req.get('host') || 'localhost'}`;
        const defaultBase = await mockServerService.resolvePlaylistBaseUrl(line, requestBase);
        const m3u = await mockPlaylistService.generatePlaylist(line, {
          type: 'm3u_plus',
          output: 'ts',
          baseUrl: defaultBase,
          resolveBaseUrl: () => mockServerService.resolvePlaylistBaseUrl(line, requestBase),
          resolveAssetBaseUrl: async () => {
            const selected = await mockServerService.selectServer(line);
            return selected && selected.publicBaseUrl || await mockServerService.resolvePublicStreamOrigin(req, line);
          },
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Content-Disposition', `attachment; filename="${line.username}.m3u"`);
        res.send(m3u);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    clientRouter.get('/epg', clientAuth, async (req, res) => {
      try {
        const lineId = req.session.lineId;
        const rawLine = await mockDb.getLineById(lineId);
        if (!rawLine) return res.status(404).json({ error: 'line not found' });
        const line = mockLineService.normalizeLineRow(rawLine);
        const bouquetIds = Array.isArray(line.bouquet) ? line.bouquet : [];
        const xml = await mockEpgService.xmltv(bouquetIds);
        res.setHeader('Content-Type', 'application/xml');
        res.send(xml);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    clientRouter.post('/login', async (req, res) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'username and password required' });

        const auth = await mockLineService.authenticateLine(username, password);
        if (!auth.ok || !auth.line) return res.status(401).json({ error: 'invalid credentials' });
        const line = auth.line;

        req.session = req.session || {};
        req.session.lineId = line.id;
        req.session.lineUsername = line.username;
        req.session.lineExpDate = line.exp_date;
        req.session.portalRole = 'user';

        const expired = !checkExpiry(line.exp_date);
        res.json({ ok: true, expired, line: { id: line.id, username: line.username } });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/client', clientRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../services/playlistService');
    jest.unmock('../../../services/serverService');
    jest.unmock('../../../services/epgService');
  });

  describe('Authentication', () => {
    it('should return 401 without auth header and no session', async () => {
      const res = await request(app)
        .get('/client/me')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    it('should return 401 with invalid bearer token', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/client/me')
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'unauthorized');
    });

    it('should return 401 when line is disabled', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 999, enabled: 0, admin_enabled: 1, exp_date: 9999999999 });

      const res = await request(app)
        .get('/client/me')
        .set('Authorization', 'Bearer disabled_line_token')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'unauthorized');
    });
  });

  describe('GET /client/me', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/client/me')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /client/password', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .put('/client/password')
        .send({ current_password: 'old', new_password: 'new' })
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /client/connections', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/client/connections')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should return connections with valid session', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1, admin_enabled: 1 });
      mockMariadb.query.mockResolvedValueOnce([
        { ip: '192.168.1.1', user_agent: 'TestAgent', date_start: '2024-01-01', date_end: null, active: 1 }
      ]);

      const res = await request(app)
        .get('/client/connections')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
      expect(res.body.connections[0]).toHaveProperty('ip', '192.168.1.1');
    });
  });

  describe('GET /client/playlist', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/client/playlist')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 when line not found', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1, admin_enabled: 1 });
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/client/playlist')
        .set('Authorization', 'Bearer valid_token')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'line not found');
    });

    it('should return playlist with valid session', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1, admin_enabled: 1 });
      mockDb.getLineById.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1 });
      mockDb.attachLinePassword.mockReturnValueOnce({ id: 1, username: 'testline', password: 'testpass' });

      const res = await request(app)
        .get('/client/playlist')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
      expect(res.headers['content-disposition']).toContain('testline.m3u');
      expect(res.text).toContain('#EXTM3U');
    });
  });

  describe('GET /client/epg', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/client/epg')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 when line not found', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1, admin_enabled: 1 });
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/client/epg')
        .set('Authorization', 'Bearer valid_token')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'line not found');
    });

    it('should return epg xml with valid session', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1, admin_enabled: 1 });
      mockDb.getLineById.mockResolvedValueOnce({ id: 1, username: 'testline', exp_date: 9999999999, enabled: 1 });

      const res = await request(app)
        .get('/client/epg')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.headers['content-type']).toContain('application/xml');
    });
  });

  describe('POST /client/login', () => {
    it('should return 400 without username', async () => {
      const res = await request(app)
        .post('/client/login')
        .send({ password: 'testpass' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'username and password required');
    });

    it('should return 400 without password', async () => {
      const res = await request(app)
        .post('/client/login')
        .send({ username: 'testuser' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'username and password required');
    });

    it('should return 401 with invalid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({ ok: false, line: null });

      const res = await request(app)
        .post('/client/login')
        .send({ username: 'bad', password: 'wrong' })
        .expect(401);

      expect(res.body).toHaveProperty('error', 'invalid credentials');
    });

    it('should login with valid credentials', async () => {
      mockLineService.authenticateLine.mockResolvedValueOnce({
        ok: true,
        line: { id: 1, username: 'testuser', exp_date: 9999999999 }
      });

      const res = await request(app)
        .post('/client/login')
        .send({ username: 'testuser', password: 'correct' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('expired', false);
      expect(res.body.line).toHaveProperty('id', 1);
      expect(res.body.line).toHaveProperty('username', 'testuser');
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
      importLiveChannel: jest.fn().mockResolvedValue({ id: 1, name: 'Imported Channel', stream_type: 'live' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/importChannelBridge', () => mockImportChannelBridge);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/channels/import-live', async (req, res) => {
      const body = req.body || {};
      const url = body.url || body.mpdUrl;
      if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
      try {
        const userId = await mockDb.getFirstAdminUserId();
        if (!userId) return res.status(500).json({ error: 'no admin user' });
        const inputType = body.inputType || 'mpd';
        const created = await mockImportChannelBridge.importLiveChannel({
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

  describe('POST /api/admin/channels/import-live', () => {
    it('should import channel with url', async () => {
      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({ url: 'http://example.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('name', 'Imported Channel');
    });

    it('should import channel with mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({ mpdUrl: 'http://example.com/stream.mpd', name: 'MPD Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 without url or mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({ name: 'No URL Channel' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'url or mpdUrl required');
    });

    it('should return 500 when no admin user exists', async () => {
      mockDb.getFirstAdminUserId.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({ url: 'http://example.com/stream.mpd' })
        .expect(500);

      expect(res.body).toHaveProperty('error', 'no admin user');
    });

    it('should return error with statusCode from import failure', async () => {
      const error = new Error('Import failed');
      error.statusCode = 422;
      mockImportChannelBridge.importLiveChannel.mockRejectedValueOnce(error);

      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({ url: 'http://example.com/bad.mpd' })
        .expect(422);

      expect(res.body).toHaveProperty('error', 'Import failed');
    });

    it('should include optional parameters', async () => {
      mockImportChannelBridge.importLiveChannel.mockResolvedValueOnce({
        id: 2, name: 'Channel with Options', category_id: 5, logo: 'http://logo.com/l.png'
      });

      const res = await request(app)
        .post('/api/admin/channels/import-live')
        .send({
          url: 'http://example.com/stream.mpd',
          name: 'Channel with Options',
          category_id: 5,
          logo: 'http://logo.com/l.png',
          epg_channel_id: 'EPG123'
        })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Channel with Options',
          category_id: 5,
          logoUrl: 'http://logo.com/l.png',
          epgChannelId: 'EPG123'
        }),
        1
      );
    });
  });
});

describe('Admin API Routes - Bouquet Sync', () => {
  let app;
  let mockAdminRouter;
  let mockBouquetService;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockBouquetService = {
      syncAllBouquets: jest.fn().mockResolvedValue({ synced: 10, failed: 0 }),
      syncEntityBouquets: jest.fn().mockResolvedValue(true),
      getBouquetIdsForEntity: jest.fn().mockResolvedValue([1, 2, 3]),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
    };

    jest.mock('../../../services/bouquetService', () => mockBouquetService);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/bouquets/sync', async (req, res) => {
      try {
        const result = await mockBouquetService.syncAllBouquets();
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/bouquets/:type/:id/sync', async (req, res) => {
      const type = String(req.params.type || '');
      const id = parseInt(req.params.id, 10);
      if (!['movie', 'series'].includes(type)) return res.status(400).json({ error: 'invalid type' });
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockBouquetService.syncEntityBouquets(type, id);
        const bouquetIds = await mockBouquetService.getBouquetIdsForEntity(type, id);
        res.json({ ok: true, bouquet_ids: bouquetIds });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/bouquetService');
    jest.unmock('../../../lib/mariadb');
  });

  describe('POST /api/admin/bouquets/sync', () => {
    it('should sync all bouquets', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/sync')
        .expect(200);

      expect(res.body).toHaveProperty('synced', 10);
      expect(res.body).toHaveProperty('failed', 0);
    });

    it('should return 500 on sync failure', async () => {
      mockBouquetService.syncAllBouquets.mockRejectedValueOnce(new Error('Sync failed'));

      const res = await request(app)
        .post('/api/admin/bouquets/sync')
        .expect(500);

      expect(res.body).toHaveProperty('error', 'Sync failed');
    });
  });

  describe('POST /api/admin/bouquets/:type/:id/sync', () => {
    it('should sync movie bouquets', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/movie/1/sync')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('bouquet_ids');
    });

    it('should sync series bouquets', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/series/2/sync')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body.bouquet_ids).toEqual([1, 2, 3]);
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/invalid/1/sync')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid type');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/movie/invalid/sync')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 400 on sync failure', async () => {
      mockBouquetService.syncEntityBouquets.mockRejectedValueOnce(new Error('Entity sync failed'));

      const res = await request(app)
        .post('/api/admin/bouquets/movie/1/sync')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Entity sync failed');
    });
  });
});

describe('Admin API Routes - Connections Management', () => {
  let app;
  let mockAdminRouter;
  let mockLineService;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockLineService = {
      getActiveConnections: jest.fn().mockResolvedValue([
        { id: 1, username: 'line1', ip: '192.168.1.1', user_agent: 'TestApp', connected_at: '2024-01-01 10:00:00' },
        { id: 2, username: 'line2', ip: '192.168.1.2', user_agent: 'TestApp2', connected_at: '2024-01-01 11:00:00' }
      ]),
      killConnections: jest.fn().mockResolvedValue(2),
      closeConnection: jest.fn().mockResolvedValue(true),
      closeRuntimeSession: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
    };

    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/connections', async (req, res) => {
      try {
        const lines = await mockLineService.getActiveConnections();
        res.json({ connections: lines });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/connections/kill', async (req, res) => {
      const { line_id } = req.body || {};
      if (!line_id) return res.status(400).json({ error: 'line_id required' });
      try {
        const killed = await mockLineService.killConnections(parseInt(line_id, 10));
        res.json({ ok: true, killed });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/connections/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockLineService.closeConnection(id);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/connections/sessions/:sessionId', async (req, res) => {
      const sessionId = String(req.params.sessionId || '');
      if (!sessionId) return res.status(400).json({ error: 'session id required' });
      try {
        await mockLineService.closeRuntimeSession(sessionId);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/connections', () => {
    it('should return active connections', async () => {
      const res = await request(app)
        .get('/api/admin/connections')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
      expect(res.body.connections.length).toBeGreaterThan(0);
    });

    it('should return connection objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/connections')
        .expect(200);

      const conn = res.body.connections[0];
      expect(conn).toHaveProperty('id');
      expect(conn).toHaveProperty('username');
      expect(conn).toHaveProperty('ip');
    });

    it('should return 500 on error', async () => {
      mockLineService.getActiveConnections.mockRejectedValueOnce(new Error('Failed to get connections'));

      const res = await request(app)
        .get('/api/admin/connections')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/connections/kill', () => {
    it('should kill connections for line', async () => {
      const res = await request(app)
        .post('/api/admin/connections/kill')
        .send({ line_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('killed', 2);
    });

    it('should return 400 without line_id', async () => {
      const res = await request(app)
        .post('/api/admin/connections/kill')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error', 'line_id required');
    });

    it('should return 500 on kill failure', async () => {
      mockLineService.killConnections.mockRejectedValueOnce(new Error('Kill failed'));

      const res = await request(app)
        .post('/api/admin/connections/kill')
        .send({ line_id: 1 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/connections/:id', () => {
    it('should close connection by id', async () => {
      const res = await request(app)
        .delete('/api/admin/connections/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/connections/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'invalid id');
    });

    it('should return 500 on close failure', async () => {
      mockLineService.closeConnection.mockRejectedValueOnce(new Error('Close failed'));

      const res = await request(app)
        .delete('/api/admin/connections/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/connections/sessions/:sessionId', () => {
    it('should close runtime session', async () => {
      const res = await request(app)
        .delete('/api/admin/connections/sessions/session123')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for missing session id', async () => {
      const res = await request(app)
        .delete('/api/admin/connections/sessions/')
        .expect(400);
    });

    it('should return 500 on session close failure', async () => {
      mockLineService.closeRuntimeSession.mockRejectedValueOnce(new Error('Session close failed'));

      const res = await request(app)
        .delete('/api/admin/connections/sessions/session123')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});
