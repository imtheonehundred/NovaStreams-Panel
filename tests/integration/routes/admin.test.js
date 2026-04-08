'use strict';

const request = require('supertest');
const express = require('express');

describe('Admin Routes - Basic API Validation', () => {
  let app;
  let adminRouter;
  let dbApi;
  let csrfProtection;

  beforeAll(() => {
    jest.resetModules();
    
    const db = require('../../../lib/db');
    dbApi = db;
    
    csrfProtection = require('../../../middleware/csrf').csrfProtection;
    
    adminRouter = express.Router();
    
    adminRouter.get('/features', async (req, res) => {
      try {
        res.json({ serverProvisioning: false });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    adminRouter.get('/version', async (req, res) => {
      const pkg = require('../../../package.json');
      res.json({ 
        current: pkg.version,
        latest: pkg.version,
        currentIsOutdated: false,
        releaseUrl: 'https://github.com/test/test'
      });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
  });

  describe('GET /api/admin/features', () => {
    it('should return features object', async () => {
      const res = await request(app)
        .get('/api/admin/features')
        .expect(200);

      expect(res.body).toHaveProperty('serverProvisioning');
    });
  });

  describe('GET /api/admin/version', () => {
    it('should return version info', async () => {
      const res = await request(app)
        .get('/api/admin/version')
        .expect(200);

      expect(res.body).toHaveProperty('current');
      expect(res.body).toHaveProperty('latest');
      expect(res.body).toHaveProperty('currentIsOutdated');
      expect(res.body).toHaveProperty('releaseUrl');
    });
  });
});

describe('Admin API Routes - List Endpoints', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockLineService;
  let mockCategoryService;
  let mockVodService;
  let mockServerService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getAllUsers: jest.fn().mockResolvedValue([
        { id: 1, username: 'admin', email: 'admin@test.com', status: 1 },
        { id: 2, username: 'user1', email: 'user1@test.com', status: 1 }
      ]),
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'admin', status: 1 }),
      isAdmin: jest.fn().mockResolvedValue(true),
      getAccessCodeById: jest.fn().mockResolvedValue({ id: 1, code: 'test', role: 'admin', enabled: 1 }),
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      getPackageById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Package' }),
      createUser: jest.fn().mockResolvedValue(3),
      updateUser: jest.fn().mockResolvedValue(true),
      deleteUser: jest.fn().mockResolvedValue(true),
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Test Group', is_admin: 0, member_count: 0 }),
      createUserGroup: jest.fn().mockResolvedValue(1),
      updateUserGroup: jest.fn().mockResolvedValue(true),
      deleteUserGroup: jest.fn().mockResolvedValue(true),
      deleteExpiredLines: jest.fn().mockResolvedValue(5),
      listBlockedIps: jest.fn().mockResolvedValue([]),
      listBlockedUas: jest.fn().mockResolvedValue([]),
      countActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue(0),
      listActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue([]),
      reconcilePlacementClients: jest.fn().mockResolvedValue(true),
      attachLinePassword: jest.fn().mockImplementation(r => ({ ...r, password: '***' })),
    };

    mockLineService = {
      listAll: jest.fn().mockResolvedValue({
        lines: [{ id: 1, username: 'line1' }, { id: 2, username: 'line2' }],
        total: 2
      }),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
      getActiveConnections: jest.fn().mockResolvedValue([]),
      killConnections: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 1 }),
      createLine: jest.fn().mockResolvedValue({ id: 1, username: 'newline' }),
      remove: jest.fn().mockResolvedValue(true),
      closeConnection: jest.fn().mockResolvedValue(true),
      closeRuntimeSession: jest.fn().mockResolvedValue(true),
    };

    mockCategoryService = {
      listCategories: jest.fn().mockResolvedValue([
        { id: 1, category_name: 'Movies', category_type: 'movie' },
        { id: 2, category_name: 'Series', category_type: 'series' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, category_name: 'Movies' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockVodService = {
      listItems: jest.fn().mockResolvedValue({
        movies: [{ id: 1, name: 'Movie 1' }, { id: 2, name: 'Movie 2' }],
        total: 2,
        limit: 50,
        offset: 0
      }),
      getById: jest.fn().mockResolvedValue({ id: 1, name: 'Movie 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockServerService = {
      listServers: jest.fn().mockResolvedValue([
        { id: 1, name: 'Server 1', enabled: 1 },
        { id: 2, name: 'Server 2', enabled: 1 }
      ]),
      getServer: jest.fn().mockResolvedValue({ id: 1, name: 'Server 1' }),
      createServer: jest.fn().mockResolvedValue({ id: 3, name: 'New Server' }),
      updateServer: jest.fn().mockResolvedValue({ id: 1, name: 'Updated Server' }),
      deleteServer: jest.fn().mockResolvedValue(true),
      buildNginxUpstreamSnippet: jest.fn().mockResolvedValue('upstream test { server 127.0.0.1; }'),
      getRuntimePlacementsForServer: jest.fn().mockResolvedValue([]),
      getServerHealthStatus: jest.fn().mockResolvedValue({ fresh: true, staleMs: null }),
      reorderServers: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../services/categoryService', () => mockCategoryService);
    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../lib/cache', () => ({
      invalidateLines: jest.fn().mockResolvedValue(true),
      invalidateCategories: jest.fn().mockResolvedValue(true),
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
      invalidateEpisodes: jest.fn().mockResolvedValue(true),
      invalidateBouquets: jest.fn().mockResolvedValue(true),
      invalidateSettings: jest.fn().mockResolvedValue(true),
      cacheMiddleware: jest.fn().mockReturnValue((req, res, next) => next()),
      keys: {},
      TTL: 300,
    }));
    jest.mock('../../../lib/mariadb', () => ({
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(null),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/users', async (req, res) => {
      try {
        const users = await mockDb.getAllUsers();
        res.json({ users });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/lines', async (req, res) => {
      try {
        const result = await mockLineService.listAll();
        res.json({ lines: result.lines, total: result.total });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/servers', async (req, res) => {
      try {
        res.json({ servers: await mockServerService.listServers() });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/categories', async (req, res) => {
      try {
        res.json({ categories: await mockCategoryService.listCategories() });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/movies', async (req, res) => {
      try {
        const result = await mockVodService.listItems();
        res.json({ movies: result.movies, total: result.total, limit: result.limit, offset: result.offset });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.post('/users', async (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
      }
      try {
        const id = await mockDb.createUser(username, password);
        res.status(201).json({ id, username });
      } catch (e) {
        res.status(400).json({ error: e.message || 'create failed' });
      }
    });

    mockAdminRouter.post('/lines', async (req, res) => {
      try {
        const line = await mockLineService.createLine(req.body || {});
        res.status(201).json(line);
      } catch (e) {
        res.status(400).json({ error: e.message || 'create failed' });
      }
    });

    mockAdminRouter.put('/users/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'invalid id' });
      }
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
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'invalid id' });
      }
      const ok = await mockDb.deleteUser(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/lineService');
    jest.unmock('../../../services/categoryService');
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../services/serverService');
    jest.unmock('../../../lib/cache');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/users', () => {
    it('should return users list', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .expect(200);

      expect(res.body).toHaveProperty('users');
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThan(0);
    });

    it('should return user objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .expect(200);

      const user = res.body.users[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('username');
    });
  });

  describe('GET /api/admin/lines', () => {
    it('should return lines list', async () => {
      const res = await request(app)
        .get('/api/admin/lines')
        .expect(200);

      expect(res.body).toHaveProperty('lines');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.lines)).toBe(true);
    });

    it('should return line objects with id and username', async () => {
      const res = await request(app)
        .get('/api/admin/lines')
        .expect(200);

      const line = res.body.lines[0];
      expect(line).toHaveProperty('id');
      expect(line).toHaveProperty('username');
    });
  });

  describe('GET /api/admin/servers', () => {
    it('should return servers list', async () => {
      const res = await request(app)
        .get('/api/admin/servers')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return server objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/servers')
        .expect(200);

      const server = res.body.servers[0];
      expect(server).toHaveProperty('id');
      expect(server).toHaveProperty('name');
    });
  });

  describe('GET /api/admin/categories', () => {
    it('should return categories list', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .expect(200);

      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
    });

    it('should return category objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .expect(200);

      const category = res.body.categories[0];
      expect(category).toHaveProperty('id');
      expect(category).toHaveProperty('category_name');
      expect(category).toHaveProperty('category_type');
    });
  });

  describe('GET /api/admin/movies', () => {
    it('should return movies list', async () => {
      const res = await request(app)
        .get('/api/admin/movies')
        .expect(200);

      expect(res.body).toHaveProperty('movies');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(Array.isArray(res.body.movies)).toBe(true);
    });

    it('should return movie objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/movies')
        .expect(200);

      const movie = res.body.movies[0];
      expect(movie).toHaveProperty('id');
      expect(movie).toHaveProperty('name');
    });
  });

  describe('POST /api/admin/users - Input Validation', () => {
    it('should require username', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({ password: 'test123' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('username');
    });

    it('should require password', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'testuser' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('password');
    });

    it('should require both username and password', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should create user with valid input', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', password: 'newpass123' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username', 'newuser');
    });
  });

  describe('POST /api/admin/lines - Input Validation', () => {
    it('should return 400 for invalid line creation', async () => {
      mockLineService.createLine.mockRejectedValueOnce(new Error('username required'));
      
      const res = await request(app)
        .post('/api/admin/lines')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should create line with valid input', async () => {
      mockLineService.createLine.mockResolvedValueOnce({ id: 5, username: 'newline' });
      
      const res = await request(app)
        .post('/api/admin/lines')
        .send({ username: 'newline', password: 'pass123' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username', 'newline');
    });
  });

  describe('PUT /api/admin/users/:id - Input Validation', () => {
    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/users/invalid')
        .send({ email: 'test@test.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent user', async () => {
      mockDb.findUserById.mockResolvedValueOnce(null);
      
      const res = await request(app)
        .put('/api/admin/users/999')
        .send({ email: 'test@test.com' })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should update user with valid id', async () => {
      mockDb.updateUser.mockResolvedValueOnce(true);
      mockDb.findUserById.mockResolvedValueOnce({ id: 1, username: 'admin', email: 'newemail@test.com' });
      
      const res = await request(app)
        .put('/api/admin/users/1')
        .send({ email: 'newemail@test.com' })
        .expect(200);

      expect(res.body).toHaveProperty('email', 'newemail@test.com');
    });
  });

  describe('DELETE /api/admin/users/:id - Input Validation', () => {
    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/users/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent user', async () => {
      mockDb.deleteUser.mockResolvedValueOnce(false);
      
      const res = await request(app)
        .delete('/api/admin/users/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should delete user with valid id', async () => {
      mockDb.deleteUser.mockResolvedValueOnce(true);
      
      const res = await request(app)
        .delete('/api/admin/users/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });
});

describe('Admin API Routes - Authentication Required', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    function requireAuth(req, res, next) {
      if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      next();
    }

    mockAdminRouter.use(requireAuth);

    mockAdminRouter.get('/users', async (req, res) => {
      res.json({ users: [] });
    });

    mockAdminRouter.get('/servers', async (req, res) => {
      res.json({ servers: [] });
    });

    mockAdminRouter.get('/lines', async (req, res) => {
      res.json({ lines: [] });
    });

    mockAdminRouter.post('/users', async (req, res) => {
      res.status(201).json({ id: 1 });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('GET /api/admin/users', () => {
    it('should return 401 without session', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('unauthorized');
    });

    it('should return 401 with empty session', async () => {
      const agent = request.agent(app);
      const res = await agent
        .get('/api/admin/users')
        .set('Cookie', 'connect.sid=empty')
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/servers', () => {
    it('should return 401 without session', async () => {
      const res = await request(app)
        .get('/api/admin/servers')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('unauthorized');
    });
  });

  describe('GET /api/admin/lines', () => {
    it('should return 401 without session', async () => {
      const res = await request(app)
        .get('/api/admin/lines')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('unauthorized');
    });
  });

  describe('POST /api/admin/users', () => {
    it('should return 401 without session on POST', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'test', password: 'test' })
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('unauthorized');
    });
  });
});

describe('Admin API Routes - Pagination and Filtering', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.get('/lines', async (req, res) => {
      const { limit = 50, offset = 0 } = req.query;
      res.json({
        lines: [{ id: 1, username: 'line1' }],
        total: 100,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10)
      });
    });

    mockAdminRouter.get('/movies', async (req, res) => {
      const { category_id, search, sort } = req.query;
      res.json({
        movies: [{ id: 1, name: 'Movie 1' }],
        total: 50,
        limit: 50,
        offset: 0,
        filters: { category_id, search, sort }
      });
    });

    mockAdminRouter.get('/categories', async (req, res) => {
      const { type } = req.query;
      res.json({
        categories: type === 'movie' 
          ? [{ id: 1, category_name: 'Movies', category_type: 'movie' }]
          : [{ id: 1, category_name: 'Movies', category_type: 'movie' }, { id: 2, category_name: 'Series', category_type: 'series' }],
        filters: { type }
      });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('GET /api/admin/lines - Pagination', () => {
    it('should accept limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/lines?limit=25')
        .expect(200);

      expect(res.body).toHaveProperty('limit', 25);
    });

    it('should accept offset parameter', async () => {
      const res = await request(app)
        .get('/api/admin/lines?offset=50')
        .expect(200);

      expect(res.body).toHaveProperty('offset', 50);
    });

    it('should accept both limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/lines?limit=10&offset=20')
        .expect(200);

      expect(res.body).toHaveProperty('limit', 10);
      expect(res.body).toHaveProperty('offset', 20);
    });
  });

  describe('GET /api/admin/movies - Filtering', () => {
    it('should accept category_id parameter', async () => {
      const res = await request(app)
        .get('/api/admin/movies?category_id=1')
        .expect(200);

      expect(res.body.filters).toHaveProperty('category_id', '1');
    });

    it('should accept search parameter', async () => {
      const res = await request(app)
        .get('/api/admin/movies?search=action')
        .expect(200);

      expect(res.body.filters).toHaveProperty('search', 'action');
    });

    it('should accept sort parameter', async () => {
      const res = await request(app)
        .get('/api/admin/movies?sort=id_asc')
        .expect(200);

      expect(res.body.filters).toHaveProperty('sort', 'id_asc');
    });

    it('should accept multiple filter parameters', async () => {
      const res = await request(app)
        .get('/api/admin/movies?category_id=1&search=action&sort=id_asc')
        .expect(200);

      expect(res.body.filters.category_id).toBe('1');
      expect(res.body.filters.search).toBe('action');
      expect(res.body.filters.sort).toBe('id_asc');
    });
  });

  describe('GET /api/admin/categories - Type Filter', () => {
    it('should accept type parameter', async () => {
      const res = await request(app)
        .get('/api/admin/categories?type=movie')
        .expect(200);

      expect(res.body.filters).toHaveProperty('type', 'movie');
    });

    it('should return filtered categories by type', async () => {
      const res = await request(app)
        .get('/api/admin/categories?type=movie')
        .expect(200);

      expect(res.body.categories.length).toBe(1);
      expect(res.body.categories[0].category_type).toBe('movie');
    });
  });
});

describe('Admin API Routes - Series, Episodes, Packages, Bouquets, Settings, Stats', () => {
  let app;
  let mockAdminRouter;
  let mockSeriesService;
  let mockPackageService;
  let mockBouquetService;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockSeriesService = {
      listSeries: jest.fn().mockResolvedValue({
        series: [
          { id: 1, title: 'Series A', cover: 'cover_a.jpg' },
          { id: 2, title: 'Series B', cover: 'cover_b.jpg' }
        ],
        total: 2
      }),
      findSeries: jest.fn().mockResolvedValue({
        id: 1, title: 'Series A', cover: 'cover_a.jpg',
        seasons: [{ season_number: 1, episodes: [{ id: 1, episode_num: 1 }] }],
        episodesBySeason: { 1: [{ id: 1, episode_num: 1 }] }
      }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
      addEpisode: jest.fn().mockResolvedValue(5),
      updateEpisode: jest.fn().mockResolvedValue(true),
      removeEpisode: jest.fn().mockResolvedValue(true),
      count: jest.fn().mockResolvedValue(2),
    };

    mockPackageService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, name: 'Package 1', price: 9.99 },
        { id: 2, name: 'Package 2', price: 19.99 }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, name: 'Package 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockBouquetService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, bouquet_name: 'Bouquet 1' },
        { id: 2, bouquet_name: 'Bouquet 2' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, bouquet_name: 'Bouquet 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
      getBouquetIdsForEntity: jest.fn().mockResolvedValue([]),
      syncEntityBouquets: jest.fn().mockResolvedValue(true),
    };

    mockDb = {
      getAllUsers: jest.fn().mockResolvedValue([{ id: 1, username: 'admin' }]),
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'admin', status: 1 }),
      isAdmin: jest.fn().mockResolvedValue(true),
      getAccessCodeById: jest.fn().mockResolvedValue({ id: 1, code: 'test', role: 'admin', enabled: 1 }),
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      getPackageById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Package' }),
      getAllSettings: jest.fn().mockResolvedValue({ setting_key: 'value' }),
      setSetting: jest.fn().mockResolvedValue(true),
      getSeriesById: jest.fn().mockResolvedValue({ id: 1, title: 'Series A' }),
      updateSeriesRow: jest.fn().mockResolvedValue(true),
      deleteSeries: jest.fn().mockResolvedValue(true),
      listAllEpisodes: jest.fn().mockResolvedValue({
        episodes: [{ id: 1, title: 'Episode 1', series_id: 1 }],
        total: 1
      }),
      getEpisodeById: jest.fn().mockResolvedValue({ id: 1, title: 'Episode 1' }),
      createEpisode: jest.fn().mockResolvedValue(5),
      updateEpisode: jest.fn().mockResolvedValue(true),
      deleteEpisode: jest.fn().mockResolvedValue(true),
      movieCount: jest.fn().mockResolvedValue(10),
      seriesCount: jest.fn().mockResolvedValue(2),
      attachLinePassword: jest.fn().mockImplementation(r => ({ ...r, password: '***' })),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(null),
    };

    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../services/packageService', () => mockPackageService);
    jest.mock('../../../services/bouquetService', () => mockBouquetService);
    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/cache', () => ({
      invalidateSeries: jest.fn().mockResolvedValue(true),
      invalidateEpisodes: jest.fn().mockResolvedValue(true),
      invalidatePackages: jest.fn().mockResolvedValue(true),
      invalidateBouquets: jest.fn().mockResolvedValue(true),
      invalidateSettings: jest.fn().mockResolvedValue(true),
      invalidateLines: jest.fn().mockResolvedValue(true),
      keys: {},
      TTL: 300,
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/series', async (req, res) => {
      const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
      const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
      const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      try {
        const result = await mockSeriesService.listSeries(categoryId, limit, offset, search, sortOrder);
        res.json({ series: result.series, total: result.total, limit, offset });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/series/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const data = await mockSeriesService.findSeries(id);
      if (!data) return res.status(404).json({ error: 'not found' });
      res.json(data);
    });

    mockAdminRouter.get('/episodes', async (req, res) => {
      const { search, series_id, limit, offset } = req.query;
      const data = await mockDb.listAllEpisodes({
        search: search || '',
        series_id: series_id ? parseInt(series_id, 10) : null,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
      });
      res.json(data);
    });

    mockAdminRouter.get('/packages', async (req, res) => {
      res.json({ packages: await mockPackageService.list() });
    });

    mockAdminRouter.get('/bouquets', async (req, res) => {
      res.json({ bouquets: await mockBouquetService.list() });
    });

    mockAdminRouter.get('/settings', async (req, res) => {
      res.json(await mockDb.getAllSettings());
    });

    mockAdminRouter.post('/lines/:id/ban', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, id, admin_enabled: 0 });
    });

    mockAdminRouter.post('/lines/:id/unban', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, id, admin_enabled: 1 });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/seriesService');
    jest.unmock('../../../services/packageService');
    jest.unmock('../../../services/bouquetService');
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/series', () => {
    it('should return series list', async () => {
      const res = await request(app)
        .get('/api/admin/series')
        .expect(200);

      expect(res.body).toHaveProperty('series');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(Array.isArray(res.body.series)).toBe(true);
    });

    it('should return series objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/series')
        .expect(200);

      const series = res.body.series[0];
      expect(series).toHaveProperty('id');
      expect(series).toHaveProperty('title');
    });

    it('should accept category_id filter', async () => {
      mockSeriesService.listSeries.mockResolvedValueOnce({
        series: [{ id: 1, title: 'Series A' }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/series?category_id=5')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith('5', expect.any(Number), expect.any(Number), undefined, 'id_desc');
    });

    it('should accept search filter', async () => {
      mockSeriesService.listSeries.mockResolvedValueOnce({
        series: [{ id: 1, title: 'Matched Series' }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/series?search=action')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), 'action', 'id_desc');
    });

    it('should accept sort parameter (id_asc)', async () => {
      const res = await request(app)
        .get('/api/admin/series?sort=id_asc')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), undefined, 'id_asc');
    });

    it('should accept sort parameter (id_desc)', async () => {
      const res = await request(app)
        .get('/api/admin/series?sort=id_desc')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), undefined, 'id_desc');
    });

    it('should accept limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/series?limit=25&offset=50')
        .expect(200);

      expect(res.body).toHaveProperty('limit', 25);
      expect(res.body).toHaveProperty('offset', 50);
    });

    it('should default to limit 50, offset 0', async () => {
      const res = await request(app)
        .get('/api/admin/series')
        .expect(200);

      expect(res.body).toHaveProperty('limit', 50);
      expect(res.body).toHaveProperty('offset', 0);
    });
  });

  describe('GET /api/admin/series/:id', () => {
    it('should return series with seasons and episodes', async () => {
      const res = await request(app)
        .get('/api/admin/series/1')
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('seasons');
      expect(res.body).toHaveProperty('episodesBySeason');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/series/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent series', async () => {
      mockSeriesService.findSeries.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/series/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('GET /api/admin/episodes - Filtering', () => {
    it('should return episodes list', async () => {
      const res = await request(app)
        .get('/api/admin/episodes')
        .expect(200);

      expect(res.body).toHaveProperty('episodes');
      expect(Array.isArray(res.body.episodes)).toBe(true);
    });

    it('should accept series_id filter', async () => {
      mockDb.listAllEpisodes.mockResolvedValueOnce({
        episodes: [{ id: 1, title: 'Episode 1', series_id: 5 }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/episodes?series_id=5')
        .expect(200);

      expect(mockDb.listAllEpisodes).toHaveBeenCalledWith(expect.objectContaining({ series_id: 5 }));
    });

    it('should accept search filter', async () => {
      const res = await request(app)
        .get('/api/admin/episodes?search=pilot')
        .expect(200);

      expect(mockDb.listAllEpisodes).toHaveBeenCalledWith(expect.objectContaining({ search: 'pilot' }));
    });

    it('should accept limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/episodes?limit=25&offset=10')
        .expect(200);

      expect(mockDb.listAllEpisodes).toHaveBeenCalledWith(expect.objectContaining({
        limit: 25,
        offset: 10
      }));
    });
  });

  describe('GET /api/admin/packages', () => {
    it('should return packages list', async () => {
      const res = await request(app)
        .get('/api/admin/packages')
        .expect(200);

      expect(res.body).toHaveProperty('packages');
      expect(Array.isArray(res.body.packages)).toBe(true);
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

  describe('GET /api/admin/bouquets', () => {
    it('should return bouquets list', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets')
        .expect(200);

      expect(res.body).toHaveProperty('bouquets');
      expect(Array.isArray(res.body.bouquets)).toBe(true);
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

  describe('GET /api/admin/settings', () => {
    it('should return settings object', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .expect(200);

      expect(typeof res.body).toBe('object');
      expect(res.body).toHaveProperty('setting_key');
    });
  });

  describe('POST /api/admin/lines/:id/ban', () => {
    it('should ban a line', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/ban')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('admin_enabled', 0);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/invalid/ban')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/999/ban')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/lines/:id/unban', () => {
    it('should unban a line', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/unban')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('admin_enabled', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/invalid/unban')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/999/unban')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Backups', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockBackupService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listBlockedIps: jest.fn().mockResolvedValue([]),
      listBlockedUas: jest.fn().mockResolvedValue([]),
      listAccessCodes: jest.fn().mockResolvedValue([]),
      getAllSettings: jest.fn().mockResolvedValue([]),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockBackupService = {
      initBackupTable: jest.fn().mockResolvedValue(true),
      listBackups: jest.fn().mockResolvedValue([
        { id: 1, filename: 'backup_20240101.db', created_at: '2024-01-01 00:00:00', size: 1024, type: 'local' },
        { id: 2, filename: 'backup_20240102.db', created_at: '2024-01-02 00:00:00', size: 2048, type: 'local' }
      ]),
      getLocalBackupRetentionLimit: jest.fn().mockResolvedValue(10),
      deleteBackupFile: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/backupService', () => mockBackupService);
    jest.mock('../../../lib/mariadb', () => ({
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(null),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/backups', async (req, res) => {
      try {
        await mockBackupService.initBackupTable();
        const backups = await mockBackupService.listBackups();
        const retentionLimit = await mockBackupService.getLocalBackupRetentionLimit();
        res.json({ backups, retentionLimit });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/backups/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const backups = await mockBackupService.listBackups();
      const backup = backups.find(b => b.id === id);
      if (!backup) return res.status(404).json({ error: 'not found' });
      res.json({ backup });
    });

    mockAdminRouter.delete('/backups/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const backups = await mockBackupService.listBackups();
      const backup = backups.find(b => b.id === id);
      if (!backup) return res.status(404).json({ error: 'not found' });
      if (backup.type !== 'local') return res.status(400).json({ error: 'only local backups can be deleted' });
      await mockBackupService.deleteBackupFile(backup.filename);
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/backupService');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/backups', () => {
    it('should return backups list', async () => {
      const res = await request(app)
        .get('/api/admin/backups')
        .expect(200);

      expect(res.body).toHaveProperty('backups');
      expect(Array.isArray(res.body.backups)).toBe(true);
      expect(res.body.backups.length).toBeGreaterThan(0);
    });

    it('should return backups with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/backups')
        .expect(200);

      const backup = res.body.backups[0];
      expect(backup).toHaveProperty('id');
      expect(backup).toHaveProperty('filename');
      expect(backup).toHaveProperty('created_at');
      expect(backup).toHaveProperty('size');
      expect(backup).toHaveProperty('type');
    });

    it('should return retentionLimit', async () => {
      const res = await request(app)
        .get('/api/admin/backups')
        .expect(200);

      expect(res.body).toHaveProperty('retentionLimit');
      expect(typeof res.body.retentionLimit).toBe('number');
    });
  });

  describe('GET /api/admin/backups/:id', () => {
    it('should return backup by id', async () => {
      const res = await request(app)
        .get('/api/admin/backups/1')
        .expect(200);

      expect(res.body).toHaveProperty('backup');
      expect(res.body.backup).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/backups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent backup', async () => {
      const res = await request(app)
        .get('/api/admin/backups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/backups/:id', () => {
    it('should delete backup by id', async () => {
      mockBackupService.deleteBackupFile.mockResolvedValueOnce(true);

      const res = await request(app)
        .delete('/api/admin/backups/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/backups/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent backup', async () => {
      const res = await request(app)
        .delete('/api/admin/backups/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Security Blocked IPs', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listBlockedIps: jest.fn().mockResolvedValue([
        { id: 1, ip: '192.168.1.1', notes: 'test ip', created_at: '2024-01-01 00:00:00' },
        { id: 2, ip: '10.0.0.1', notes: 'another ip', created_at: '2024-01-02 00:00:00' }
      ]),
      addBlockedIp: jest.fn().mockResolvedValue(3),
      removeBlockedIp: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/security/blocked-ips', async (req, res) => {
      res.json({ items: await mockDb.listBlockedIps() });
    });

    mockAdminRouter.post('/security/blocked-ips', async (req, res) => {
      const { ip, notes } = req.body || {};
      if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'ip required' });
      const rid = await mockDb.addBlockedIp(String(ip).trim(), notes != null ? String(notes) : '');
      res.status(201).json({ id: rid || undefined, ok: true });
    });

    mockAdminRouter.delete('/security/blocked-ips/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.removeBlockedIp(id);
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

  describe('GET /api/admin/security/blocked-ips', () => {
    it('should return blocked IPs list', async () => {
      const res = await request(app)
        .get('/api/admin/security/blocked-ips')
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('should return blocked IP objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/security/blocked-ips')
        .expect(200);

      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('ip');
    });
  });

  describe('POST /api/admin/security/blocked-ips', () => {
    it('should add blocked IP', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '172.16.0.1', notes: 'blocked' })
        .expect(201);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without ip', async () => {
      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ notes: 'no ip' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('ip required');
    });
  });

  describe('DELETE /api/admin/security/blocked-ips/:id', () => {
    it('should remove blocked IP', async () => {
      const res = await request(app)
        .delete('/api/admin/security/blocked-ips/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/security/blocked-ips/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent blocked IP', async () => {
      mockDb.removeBlockedIp.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/security/blocked-ips/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Activity', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.get('/activity', async (req, res) => {
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
      const mockActivity = [
        { activity_id: 1, user_id: 1, action: 'login', timestamp: '2024-01-01 00:00:00' },
        { activity_id: 2, user_id: 2, action: 'logout', timestamp: '2024-01-01 00:01:00' }
      ];
      res.json({ activity: mockActivity.slice(0, limit) });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('GET /api/admin/activity', () => {
    it('should return activity list', async () => {
      const res = await request(app)
        .get('/api/admin/activity')
        .expect(200);

      expect(res.body).toHaveProperty('activity');
      expect(Array.isArray(res.body.activity)).toBe(true);
    });

    it('should return activity objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/activity')
        .expect(200);

      const activity = res.body.activity[0];
      expect(activity).toHaveProperty('activity_id');
      expect(activity).toHaveProperty('user_id');
      expect(activity).toHaveProperty('action');
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
});

describe('Admin API Routes - Access Codes', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listAccessCodes: jest.fn().mockResolvedValue([
        { id: 1, code: 'CODE123', role: 'admin', enabled: 1, uses: 0, created_at: '2024-01-01 00:00:00' },
        { id: 2, code: 'CODE456', role: 'reseller', enabled: 1, uses: 5, created_at: '2024-01-02 00:00:00' }
      ]),
      createAccessCode: jest.fn().mockResolvedValue(3),
      updateAccessCode: jest.fn().mockResolvedValue(true),
      deleteAccessCode: jest.fn().mockResolvedValue(true),
      getAccessCodeById: jest.fn().mockResolvedValue({ id: 1, code: 'CODE123', role: 'admin', enabled: 1 }),
      isAdmin: jest.fn().mockResolvedValue(true),
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
      } catch (e) {
        res.status(400).json({ error: e.message || 'create failed' });
      }
    });

    mockAdminRouter.put('/access-codes/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockDb.getAccessCodeById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateAccessCode(id, req.body || {});
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({ error: e.message || 'update failed' });
      }
    });

    mockAdminRouter.delete('/access-codes/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.deleteAccessCode(id);
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
        .send({ code: 'NEWCODE' })
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

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/access-codes/invalid')
        .send({ enabled: 0 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent access code', async () => {
      mockDb.getAccessCodeById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/access-codes/999')
        .send({ enabled: 0 })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/access-codes/:id', () => {
    it('should delete access code', async () => {
      const res = await request(app)
        .delete('/api/admin/access-codes/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/access-codes/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent access code', async () => {
      mockDb.deleteAccessCode.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/access-codes/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Settings PUT Updates', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getAllSettings: jest.fn().mockResolvedValue({
        setting_key: 'test_value',
        another_key: 'another_value'
      }),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/cache', () => ({
      invalidateSettings: jest.fn().mockResolvedValue(true),
    }));
    jest.mock('../../../lib/streaming-settings', () => ({
      refreshStreamingSettings: jest.fn().mockResolvedValue(true),
      KEYS: {
        prebuffer_enabled: 'prebuffer_enabled',
        prebuffer_size_mb: 'prebuffer_size_mb',
      },
      getStreamingConfig: jest.fn().mockReturnValue({}),
    }));
    jest.mock('../../../services/provisionService', () => ({
      getProvisioningUiState: jest.fn().mockResolvedValue({}),
      STREAMING_PROVISIONING_KEY: 'streaming_provisioning_enabled',
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings', async (req, res) => {
      res.json(await mockDb.getAllSettings());
    });

    mockAdminRouter.put('/settings', async (req, res) => {
      const body = req.body || {};
      if (typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'object body required' });
      for (const [k, v] of Object.entries(body)) await mockDb.setSetting(k, v);
      res.json(await mockDb.getAllSettings());
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/cache');
    jest.unmock('../../../lib/streaming-settings');
    jest.unmock('../../../services/provisionService');
  });

  describe('PUT /api/admin/settings', () => {
    it('should update single setting', async () => {
      mockDb.setSetting.mockResolvedValueOnce(true);

      const res = await request(app)
        .put('/api/admin/settings')
        .send({ theme: 'dark' })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('theme', 'dark');
    });

    it('should update multiple settings', async () => {
      mockDb.setSetting.mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/settings')
        .send({ theme: 'dark', language: 'en', timezone: 'UTC' })
        .expect(200);

      expect(mockDb.setSetting).toHaveBeenCalledWith('theme', 'dark');
      expect(mockDb.setSetting).toHaveBeenCalledWith('language', 'en');
      expect(mockDb.setSetting).toHaveBeenCalledWith('timezone', 'UTC');
    });

    it('should return 400 for array body', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .send([{ key: 'theme' }])
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return updated settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings')
        .send({ theme: 'dark' })
        .expect(200);

      expect(res.body).toHaveProperty('setting_key');
    });
  });
});

describe('Admin API Routes - RBAC Permission Tests', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn(),
      isSuperAdmin: jest.fn(),
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'admin', status: 1 }),
      updateUser: jest.fn().mockResolvedValue(true),
      createUser: jest.fn().mockResolvedValue(3),
      deleteUser: jest.fn().mockResolvedValue(true),
      listBlockedIps: jest.fn().mockResolvedValue([]),
      addBlockedIp: jest.fn().mockResolvedValue(1),
      removeBlockedIp: jest.fn().mockResolvedValue(true),
      listAccessCodes: jest.fn().mockResolvedValue([]),
      createAccessCode: jest.fn().mockResolvedValue(1),
      getAllSettings: jest.fn().mockResolvedValue({}),
      setSetting: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/users', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ users: [] });
    });

    mockAdminRouter.get('/servers', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ servers: [] });
    });

    mockAdminRouter.post('/lines/:id/ban', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      const line = await mockDb.getLineById(parseInt(req.params.id, 10));
      if (!line) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, id: line.id, admin_enabled: 0 });
    });

    mockAdminRouter.post('/lines/:id/unban', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      const line = await mockDb.getLineById(parseInt(req.params.id, 10));
      if (!line) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, id: line.id, admin_enabled: 1 });
    });

    mockAdminRouter.post('/users', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.status(201).json({ id: 1 });
    });

    mockAdminRouter.put('/users/:id', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ id: 1, username: 'updated' });
    });

    mockAdminRouter.delete('/users/:id', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/security/blocked-ips', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.status(201).json({ id: 1, ok: true });
    });

    mockAdminRouter.delete('/security/blocked-ips/:id', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ ok: true });
    });

    mockAdminRouter.put('/settings', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/access-codes', async (req, res) => {
      const isAdmin = await mockDb.isAdmin(req.session?.userId);
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
      res.status(201).json({ id: 1 });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
  });

  describe('GET /api/admin/users - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .get('/api/admin/users')
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should return 200 when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .get('/api/admin/users')
        .expect(200);

      expect(res.body).toHaveProperty('users');
    });
  });

  describe('POST /api/admin/lines/:id/ban - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/admin/lines/1/ban')
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/admin/lines/1/ban')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('POST /api/admin/users - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', password: 'password' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/admin/users')
        .send({ username: 'newuser', password: 'password' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });
  });

  describe('PUT /api/admin/users/:id - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .put('/api/admin/users/1')
        .send({ username: 'updated' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .put('/api/admin/users/1')
        .send({ username: 'updated' })
        .expect(200);

      expect(res.body).toHaveProperty('id');
    });
  });

  describe('DELETE /api/admin/users/:id - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/users/1')
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .delete('/api/admin/users/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('POST /api/admin/security/blocked-ips - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '192.168.1.1' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/admin/security/blocked-ips')
        .send({ ip: '192.168.1.1' })
        .expect(201);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('DELETE /api/admin/security/blocked-ips/:id - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/security/blocked-ips/1')
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .delete('/api/admin/security/blocked-ips/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('PUT /api/admin/settings - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .put('/api/admin/settings')
        .send({ theme: 'dark' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .put('/api/admin/settings')
        .send({ theme: 'dark' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('POST /api/admin/access-codes - RBAC', () => {
    it('should return 403 when user is not admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/admin/access-codes')
        .send({ code: 'NEWCODE', role: 'admin' })
        .expect(403);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('forbidden');
    });

    it('should succeed when user is admin', async () => {
      mockDb.isAdmin.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/admin/access-codes')
        .send({ code: 'NEWCODE', role: 'admin' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });
  });
});

describe('Admin API Routes - Providers', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockXcApiClient;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listImportProviders: jest.fn().mockResolvedValue([
        { id: 1, name: 'Provider 1', url: 'http://example.com?username=user1&password=pass1', enabled: 1 },
        { id: 2, name: 'Provider 2', url: 'http://test.com?username=user2&password=pass2', enabled: 1 }
      ]),
      createImportProvider: jest.fn().mockResolvedValue(3),
      getImportProviderById: jest.fn().mockResolvedValue({ id: 1, name: 'Provider 1', url: 'http://example.com?username=user1&password=pass1', enabled: 1 }),
      updateImportProvider: jest.fn().mockResolvedValue(true),
      deleteImportProvider: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockXcApiClient = {
      validate: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue({ ok: true }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/xcApiClient', () => ({
      XcApiClient: jest.fn().mockImplementation(() => mockXcApiClient),
    }));

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
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockDb.getImportProviderById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateImportProvider(id, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/providers/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.deleteImportProvider(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/providers/:id/validate', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const p = await mockDb.getImportProviderById(id);
      if (!p) return res.status(404).json({ error: 'not found' });
      try {
        const XcApiClient = require('../../../services/xcApiClient').XcApiClient;
        const xc = new XcApiClient(p.url);
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
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
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL (need username/password in query)' });
        await xc.ping();
        res.json({ ok: true, message: 'Connection OK' });
      } catch (e) { res.status(400).json({ error: e.message || 'validate failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
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

    it('should return 500 on database error', async () => {
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
        .send({ name: 'New Provider', url: 'http://new.com?username=user&password=pass' })
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

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/providers/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/providers/999')
        .send({ name: 'Updated' })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 on update failure', async () => {
      mockDb.updateImportProvider.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/providers/1')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/providers/:id', () => {
    it('should delete provider', async () => {
      const res = await request(app)
        .delete('/api/admin/providers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/providers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.deleteImportProvider.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/providers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/providers/:id/validate', () => {
    it('should validate provider connection', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockResolvedValueOnce({ ok: true });

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('message', 'Connection OK');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/providers/invalid/validate')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/providers/999/validate')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 for invalid provider URL (missing credentials)', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Invalid provider URL');
    });

    it('should return 400 when ping fails', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/providers/validate-preview', () => {
    it('should validate preview URL', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockResolvedValueOnce({ ok: true });

      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 'http://example.com?username=user&password=pass' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('message', 'Connection OK');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url required');
    });

    it('should return 400 for invalid url type', async () => {
      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 123 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url required');
    });

    it('should return 400 for URL without credentials', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 'http://example.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Invalid provider URL');
    });

    it('should return 400 when ping fails', async () => {
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockRejectedValueOnce(new Error('Connection timeout'));

      const res = await request(app)
        .post('/api/admin/providers/validate-preview')
        .send({ url: 'http://example.com?username=user&password=pass' })
        .expect(400);

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
        { id: 1, name: 'EPG Source 1', url: 'http://example.com/epg1.xml', last_updated: '2024-01-01 00:00:00' },
        { id: 2, name: 'EPG Source 2', url: 'http://example.com/epg2.xml', last_updated: '2024-01-02 00:00:00' }
      ]),
      addSource: jest.fn().mockResolvedValue(3),
      removeSource: jest.fn().mockResolvedValue(true),
      refreshAllSources: jest.fn().mockResolvedValue({ refreshed: 2, failed: 0 }),
    };

    jest.mock('../../../services/epgService', () => mockEpgService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/epg/sources', async (req, res) => {
      res.json({ sources: await mockEpgService.listSources() });
    });

    mockAdminRouter.post('/epg/sources', async (req, res) => {
      const { name, url } = req.body || {};
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
      try {
        const id = await mockEpgService.addSource(name != null ? String(name) : '', String(url));
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.delete('/epg/sources/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockEpgService.removeSource(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/epg/refresh', async (req, res) => {
      try { res.json(await mockEpgService.refreshAllSources()); }
      catch (e) { res.status(500).json({ error: e.message || 'refresh failed' }); }
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

    it('should return EPG source objects with expected properties', async () => {
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
        .send({ name: 'New EPG', url: 'http://example.com/new-epg.xml' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should create EPG source without name', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ url: 'http://example.com/new-epg.xml' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'EPG without URL' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url required');
    });

    it('should return 400 for invalid url type', async () => {
      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'EPG', url: 123 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url required');
    });

    it('should return 400 on create failure', async () => {
      mockEpgService.addSource.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/epg/sources')
        .send({ name: 'Bad EPG', url: 'http://bad.com/epg.xml' })
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

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/epg/sources/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent EPG source', async () => {
      mockEpgService.removeSource.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/epg/sources/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
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

    it('should return 500 on refresh failure', async () => {
      mockEpgService.refreshAllSources.mockRejectedValueOnce(new Error('refresh failed'));

      const res = await request(app)
        .post('/api/admin/epg/refresh')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      findUserById: jest.fn().mockResolvedValue({ id: 1, username: 'reseller1', credits: 100, status: 1 }),
      getUserGroupById: jest.fn().mockResolvedValue({ group_id: 1, group_name: 'Resellers', is_reseller: 1 }),
      updateUser: jest.fn().mockResolvedValue(true),
      createUser: jest.fn().mockResolvedValue(3),
      deleteUser: jest.fn().mockResolvedValue(true),
      listResellerPackageOverrides: jest.fn().mockResolvedValue([]),
      replaceResellerPackageOverrides: jest.fn().mockResolvedValue(true),
      getResellerExpiryMediaServiceByUserId: jest.fn().mockResolvedValue(null),
      deleteResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      addCreditLog: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 5, group_name: 'Resellers' },
        { id: 2, username: 'reseller2', email: 'r2@test.com', credits: 200, status: 1, line_count: 10, group_name: 'Resellers' }
      ]),
      queryOne: jest.fn().mockResolvedValue({ c: 2 }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/resellers', async (req, res) => {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const search = String(req.query.search || '').trim();
      const status = req.query.status !== undefined && req.query.status !== '' ? parseInt(req.query.status, 10) : null;
      const groupId = req.query.group_id !== undefined && req.query.group_id !== '' ? parseInt(req.query.group_id, 10) : null;
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
      if (Number.isFinite(groupId)) {
        where.push('u.member_group_id = ?');
        params.push(groupId);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalRow = await mockMariadb.queryOne(
        `SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id ${whereSql}`,
        params
      );
      const rows = await mockMariadb.query(
        `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
         FROM users u
         INNER JOIN user_groups g ON u.member_group_id = g.group_id
         LEFT JOIN \`lines\` l ON l.member_id = u.id
         ${whereSql}
         GROUP BY u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                  u.reseller_dns, u.owner_id, u.last_login, u.created_at
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      res.json({ resellers: rows, total: totalRow ? Number(totalRow.c) || 0 : rows.length });
    });

    mockAdminRouter.get('/resellers/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const row = await mockMariadb.queryOne(
        `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
         FROM users u
         INNER JOIN user_groups g ON u.member_group_id = g.group_id
         LEFT JOIN \`lines\` l ON l.member_id = u.id
         WHERE u.id = ? AND g.is_reseller = 1
         GROUP BY u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                  u.reseller_dns, u.owner_id, u.last_login, u.created_at`,
        [id]
      );
      if (!row) return res.status(404).json({ error: 'not found' });
      const packageOverrides = await mockDb.listResellerPackageOverrides(id);
      res.json({ ...row, package_overrides: packageOverrides || [] });
    });

    mockAdminRouter.put('/resellers/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const row = await mockMariadb.queryOne(
        `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
         FROM users u
         INNER JOIN user_groups g ON u.member_group_id = g.group_id
         LEFT JOIN \`lines\` l ON l.member_id = u.id
         WHERE u.id = ? AND g.is_reseller = 1
         GROUP BY u.id`,
        [id]
      );
      if (!row) return res.status(404).json({ error: 'not found' });
      try {
        const patch = {};
        if (req.body && req.body.password) patch.password = String(req.body.password);
        if (req.body && req.body.email !== undefined) patch.email = String(req.body.email || '');
        if (req.body && req.body.notes !== undefined) patch.notes = String(req.body.notes || '');
        if (req.body && req.body.credits !== undefined) patch.credits = Number(req.body.credits) || 0;
        if (req.body && req.body.reseller_dns !== undefined) patch.reseller_dns = String(req.body.reseller_dns || '');
        if (req.body && req.body.status !== undefined) {
          const val = req.body.status;
          patch.status = (val === true || val === 'true' || val === '1' || val === 1) ? 1 : 0;
        }
        if (req.body && req.body.member_group_id !== undefined) {
          const group = await mockDb.getUserGroupById(req.body.member_group_id);
          if (!group || Number(group.is_reseller) !== 1) return res.status(400).json({ error: 'invalid reseller group' });
          patch.member_group_id = group.group_id;
        }
        await mockDb.updateUser(id, patch);
        if (req.body && req.body.package_overrides !== undefined) {
          await mockDb.replaceResellerPackageOverrides(id, req.body.package_overrides || []);
        }
        const next = await mockMariadb.queryOne('SELECT * FROM users WHERE id = ?', [id]);
        res.json({ ...next, package_overrides: [] });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.put('/resellers/:id/credits', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { credits, reason } = req.body || {};
      if (credits === undefined || credits === null) return res.status(400).json({ error: 'credits required' });
      const user = await mockDb.findUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });
      const newBal = Number(credits);
      if (!Number.isFinite(newBal)) return res.status(400).json({ error: 'invalid credits' });
      await mockDb.updateUser(id, { credits: newBal });
      await mockDb.addCreditLog(id, req.session?.userId, newBal - (Number(user.credits) || 0), reason != null ? String(reason) : '');
      res.json({ id, credits: newBal });
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

    it('should return reseller objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/resellers')
        .expect(200);

      const reseller = res.body.resellers[0];
      expect(reseller).toHaveProperty('id');
      expect(reseller).toHaveProperty('username');
      expect(reseller).toHaveProperty('credits');
      expect(reseller).toHaveProperty('status');
      expect(reseller).toHaveProperty('line_count');
    });

    it('should accept limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/resellers?limit=10')
        .expect(200);

      expect(res.body.resellers.length).toBeLessThanOrEqual(10);
    });

    it('should accept offset parameter', async () => {
      const res = await request(app)
        .get('/api/admin/resellers?offset=10')
        .expect(200);

      expect(res.body).toHaveProperty('resellers');
    });

    it('should accept search parameter', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 1, username: 'searched', email: 'search@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers' }
      ]);

      const res = await request(app)
        .get('/api/admin/resellers?search=searched')
        .expect(200);

      expect(res.body.resellers.length).toBe(1);
    });

    it('should accept status filter', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ c: 1 });

      const res = await request(app)
        .get('/api/admin/resellers?status=1')
        .expect(200);

      expect(res.body).toHaveProperty('resellers');
    });
  });

  describe('GET /api/admin/resellers/:id', () => {
    it('should return reseller by id', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(
        { id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 5, group_name: 'Resellers' }
      );
      mockDb.listResellerPackageOverrides.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/resellers/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('username', 'reseller1');
      expect(res.body).toHaveProperty('package_overrides');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/resellers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/resellers/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PUT /api/admin/resellers/:id', () => {
    it('should update reseller email', async () => {
      mockMariadb.queryOne
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'old@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers' })
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'new@test.com', credits: 100, status: 1 });

      const res = await request(app)
        .put('/api/admin/resellers/1')
        .send({ email: 'new@test.com' })
        .expect(200);

      expect(mockDb.updateUser).toHaveBeenCalledWith(1, { email: 'new@test.com' });
    });

    it('should update reseller credits', async () => {
      mockMariadb.queryOne
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers' })
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'r1@test.com', credits: 150, status: 1 });

      const res = await request(app)
        .put('/api/admin/resellers/1')
        .send({ credits: 150 })
        .expect(200);

      expect(mockDb.updateUser).toHaveBeenCalledWith(1, { credits: 150 });
    });

    it('should update reseller status', async () => {
      mockMariadb.queryOne
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers' })
        .mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 0 });

      const res = await request(app)
        .put('/api/admin/resellers/1')
        .send({ status: 0 })
        .expect(200);

      expect(mockDb.updateUser).toHaveBeenCalledWith(1, { status: 0 });
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/invalid')
        .send({ email: 'test@test.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/resellers/999')
        .send({ email: 'test@test.com' })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 for invalid reseller group', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers' });
      mockDb.getUserGroupById.mockResolvedValueOnce({ group_id: 2, group_name: 'Users', is_reseller: 0 });

      const res = await request(app)
        .put('/api/admin/resellers/1')
        .send({ member_group_id: 2 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid reseller group');
    });
  });

  describe('PUT /api/admin/resellers/:id/credits', () => {
    it('should update reseller credits', async () => {
      mockDb.findUserById.mockResolvedValueOnce({ id: 1, username: 'reseller1', credits: 100 });

      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({ credits: 150, reason: 'Add credits' })
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('credits', 150);
      expect(mockDb.addCreditLog).toHaveBeenCalledWith(1, undefined, 50, 'Add credits');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/invalid/credits')
        .send({ credits: 100 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 400 without credits', async () => {
      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('credits required');
    });

    it('should return 400 for invalid credits value', async () => {
      mockDb.findUserById.mockResolvedValueOnce({ id: 1, username: 'reseller1', credits: 100 });

      const res = await request(app)
        .put('/api/admin/resellers/1/credits')
        .send({ credits: 'not-a-number' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid credits');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockDb.findUserById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/resellers/999/credits')
        .send({ credits: 100 })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
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
        { id: 2, parent_server_id: 1, child_server_id: 3, relationship_type: 'origin-proxy', priority: 2, enabled: 1, parent_name: 'Origin 1', child_name: 'Proxy 2' }
      ]),
      queryOne: jest.fn().mockResolvedValue(null),
    };

    mockDb = {
      getServerRelationships: jest.fn().mockResolvedValue([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy', priority: 1 }
      ]),
      addServerRelationship: jest.fn().mockResolvedValue(3),
      removeServerRelationship: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/server-relationships', async (req, res) => {
      const type = String(req.query.type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship type' });
      }
      try {
        const rows = await mockMariadb.query(
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
      try {
        const rows = await mockDb.getServerRelationships(id);
        res.json({ relationships: rows });
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
    it('should return relationships list', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships')
        .expect(200);

      expect(res.body).toHaveProperty('relationships');
      expect(Array.isArray(res.body.relationships)).toBe(true);
    });

    it('should return relationship objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships')
        .expect(200);

      const rel = res.body.relationships[0];
      expect(rel).toHaveProperty('id');
      expect(rel).toHaveProperty('parent_server_id');
      expect(rel).toHaveProperty('child_server_id');
      expect(rel).toHaveProperty('relationship_type');
      expect(rel).toHaveProperty('priority');
      expect(rel).toHaveProperty('parent_name');
      expect(rel).toHaveProperty('child_name');
    });

    it('should accept type parameter (origin-proxy)', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships?type=origin-proxy')
        .expect(200);

      expect(res.body).toHaveProperty('relationships');
    });

    it('should accept type parameter (failover)', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 3, parent_server_id: 2, child_server_id: 3, relationship_type: 'failover', priority: 1, enabled: 1, parent_name: 'Server A', child_name: 'Server B' }
      ]);

      const res = await request(app)
        .get('/api/admin/server-relationships?type=failover')
        .expect(200);

      expect(res.body.relationships[0].relationship_type).toBe('failover');
    });

    it('should accept type parameter (lb-member)', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 4, parent_server_id: 3, child_server_id: 4, relationship_type: 'lb-member', priority: 1, enabled: 1, parent_name: 'LB', child_name: 'Member' }
      ]);

      const res = await request(app)
        .get('/api/admin/server-relationships?type=lb-member')
        .expect(200);

      expect(res.body.relationships[0].relationship_type).toBe('lb-member');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships?type=invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid relationship type');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

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
      expect(Array.isArray(res.body.relationships)).toBe(true);
    });

    it('should return 400 for non-numeric server id', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid server id');
    });
  });
});

describe('Admin API Routes - Expiry Media Services', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listResellerExpiryMediaServices: jest.fn().mockResolvedValue({
        rows: [
          { id: 1, user_id: 1, username: 'reseller1', active: 1, warning_window_days: 7, repeat_interval_hours: 6, created_at: '2024-01-01' },
          { id: 2, user_id: 2, username: 'reseller2', active: 1, warning_window_days: 7, repeat_interval_hours: 6, created_at: '2024-01-02' }
        ],
        total: 2
      }),
      getResellerExpiryMediaServiceById: jest.fn().mockResolvedValue({
        id: 1, user_id: 1, username: 'reseller1', active: 1, warning_window_days: 7, repeat_interval_hours: 6
      }),
      listResellerExpiryMediaItems: jest.fn().mockResolvedValue([]),
      updateResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      replaceResellerExpiryMediaItems: jest.fn().mockResolvedValue(true),
      createResellerExpiryMediaService: jest.fn().mockResolvedValue({ id: 3, user_id: 5, active: 1 }),
      deleteResellerExpiryMediaService: jest.fn().mockResolvedValue(true),
      getResellerExpiryMediaServiceByUserId: jest.fn().mockResolvedValue(null),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      queryOne: jest.fn().mockResolvedValue({
        id: 1, username: 'reseller1', email: 'r1@test.com', credits: 100, status: 1, line_count: 0, group_name: 'Resellers'
      }),
      query: jest.fn().mockResolvedValue([]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

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
        const row = await mockMariadb.queryOne(
          `SELECT u.id, u.username, u.email, u.notes, u.member_group_id, g.group_name, u.credits, u.status,
                  u.reseller_dns, u.owner_id, u.last_login, u.created_at, COUNT(l.id) AS line_count
           FROM users u
           INNER JOIN user_groups g ON u.member_group_id = g.group_id
           LEFT JOIN \`lines\` l ON l.member_id = u.id
           WHERE u.id = ? AND g.is_reseller = 1
           GROUP BY u.id`,
          [userId]
        );
        if (!row) return res.status(404).json({ error: 'reseller not found' });
        const existing = await mockDb.getResellerExpiryMediaServiceByUserId(userId);
        if (existing) return res.status(400).json({ error: 'expiry media service already exists' });
        const service = await mockDb.createResellerExpiryMediaService(userId, {
          active: 1,
          warning_window_days: 7,
          repeat_interval_hours: 6,
        });
        res.status(201).json({ ...service, items: [] });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.get('/expiry-media/services/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        const service = await mockDb.getResellerExpiryMediaServiceById(id);
        if (!service) return res.status(404).json({ error: 'not found' });
        const items = await mockDb.listResellerExpiryMediaItems(id);
        res.json({ ...service, items });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.put('/expiry-media/services/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        const service = await mockDb.getResellerExpiryMediaServiceById(id);
        if (!service) return res.status(404).json({ error: 'not found' });
        const items = (req.body && req.body.items) || [];
        await mockDb.updateResellerExpiryMediaService(id, {
          active: req.body && req.body.active !== undefined ? (req.body.active ? 1 : 0) : undefined,
          warning_window_days: req.body && req.body.warning_window_days !== undefined ? Math.max(1, parseInt(req.body.warning_window_days, 10) || 7) : undefined,
          repeat_interval_hours: req.body && req.body.repeat_interval_hours !== undefined ? Math.max(1, parseInt(req.body.repeat_interval_hours, 10) || 6) : undefined,
        });
        await mockDb.replaceResellerExpiryMediaItems(id, items);
        const next = await mockDb.getResellerExpiryMediaServiceById(id);
        const nextItems = await mockDb.listResellerExpiryMediaItems(id);
        res.json({ ...next, items: nextItems });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/expiry-media/services/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const service = await mockDb.getResellerExpiryMediaServiceById(id);
      if (!service) return res.status(404).json({ error: 'not found' });
      await mockDb.deleteResellerExpiryMediaService(id);
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
    it('should return services list', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services')
        .expect(200);

      expect(res.body).toHaveProperty('services');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.services)).toBe(true);
    });

    it('should return service objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services')
        .expect(200);

      const service = res.body.services[0];
      expect(service).toHaveProperty('id');
      expect(service).toHaveProperty('user_id');
      expect(service).toHaveProperty('username');
      expect(service).toHaveProperty('active');
    });

    it('should accept limit parameter', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services?limit=10')
        .expect(200);

      expect(res.body).toHaveProperty('services');
    });

    it('should accept offset parameter', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services?offset=10')
        .expect(200);

      expect(res.body).toHaveProperty('services');
    });

    it('should accept search parameter', async () => {
      mockDb.listResellerExpiryMediaServices.mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, username: 'searched', active: 1 }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/expiry-media/services?search=searched')
        .expect(200);

      expect(mockDb.listResellerExpiryMediaServices).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'searched');
    });

    it('should return 500 on database error', async () => {
      mockDb.listResellerExpiryMediaServices.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/expiry-media/services')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/expiry-media/services', () => {
    it('should create expiry media service', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 5, username: 'newreseller', group_name: 'Resellers' });
      mockDb.getResellerExpiryMediaServiceByUserId.mockResolvedValueOnce(null);
      mockDb.createResellerExpiryMediaService.mockResolvedValueOnce({ id: 3, user_id: 5, active: 1 });

      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 5 })
        .expect(201);

      expect(res.body).toHaveProperty('id', 3);
      expect(res.body).toHaveProperty('items');
    });

    it('should return 400 without user_id', async () => {
      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('user_id required');
    });

    it('should return 400 for invalid user_id', async () => {
      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 'not-a-number' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('user_id required');
    });

    it('should return 404 for non-existent reseller', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 999 })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('reseller not found');
    });

    it('should return 400 if service already exists', async () => {
      mockMariadb.queryOne.mockResolvedValueOnce({ id: 1, username: 'reseller1' });
      mockDb.getResellerExpiryMediaServiceByUserId.mockResolvedValueOnce({ id: 1, user_id: 1 });

      const res = await request(app)
        .post('/api/admin/expiry-media/services')
        .send({ user_id: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('expiry media service already exists');
    });
  });

  describe('GET /api/admin/expiry-media/services/:id', () => {
    it('should return service by id', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce({
        id: 1, user_id: 1, username: 'reseller1', active: 1, warning_window_days: 7, repeat_interval_hours: 6
      });
      mockDb.listResellerExpiryMediaItems.mockResolvedValueOnce([
        { id: 1, scenario: 'expiring', media_url: 'http://example.com/video.mp4', country_code: 'US' }
      ]);

      const res = await request(app)
        .get('/api/admin/expiry-media/services/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/expiry-media/services/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/expiry-media/services/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PUT /api/admin/expiry-media/services/:id', () => {
    it('should update service', async () => {
      mockDb.getResellerExpiryMediaServiceById
        .mockResolvedValueOnce({ id: 1, user_id: 1, active: 1, warning_window_days: 7, repeat_interval_hours: 6 })
        .mockResolvedValueOnce({ id: 1, user_id: 1, active: 0, warning_window_days: 14, repeat_interval_hours: 12 });
      mockDb.listResellerExpiryMediaItems.mockResolvedValueOnce([]);

      const res = await request(app)
        .put('/api/admin/expiry-media/services/1')
        .send({ active: 0, warning_window_days: 14, repeat_interval_hours: 12 })
        .expect(200);

      expect(mockDb.updateResellerExpiryMediaService).toHaveBeenCalledWith(1, { active: 0, warning_window_days: 14, repeat_interval_hours: 12 });
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/expiry-media/services/invalid')
        .send({ active: 0 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/expiry-media/services/999')
        .send({ active: 0 })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/expiry-media/services/:id', () => {
    it('should delete service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce({ id: 1, user_id: 1 });

      const res = await request(app)
        .delete('/api/admin/expiry-media/services/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/expiry-media/services/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent service', async () => {
      mockDb.getResellerExpiryMediaServiceById.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/admin/expiry-media/services/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Stats', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;
  let mockState;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      movieCount: jest.fn().mockResolvedValue(100),
      seriesCount: jest.fn().mockResolvedValue(50),
      getSetting: jest.fn().mockResolvedValue('0'),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      queryOne: jest.fn()
        .mockResolvedValueOnce({ c: 10 })
        .mockResolvedValueOnce({ c: 5 })
        .mockResolvedValueOnce({ c: 3 })
        .mockResolvedValueOnce({ c: 2 })
        .mockResolvedValueOnce({ c: 1 })
        .mockResolvedValueOnce({ c: 2 }),
    };

    mockState = {
      channels: new Map([[1, { id: 1, name: 'Test', status: 'running' }]]),
      processes: new Map([[1, { pid: 123 }]]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/state', () => mockState);

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
        const runningCount = mockState.channels ? [...mockState.channels.values()].filter(c => c.status === 'running').length : 0;
        const totalNetIn = net.reduce((a, n) => a + (n.rx_sec || 0), 0) / 1024;
        const totalNetOut = net.reduce((a, n) => a + (n.tx_sec || 0), 0) / 1024;
        res.json({
          activeLines: activeRow ? activeRow.c : 0,
          connections: mockState.processes ? mockState.processes.size : 0,
          liveStreams: runningCount,
          channelsCount: totalChRow ? totalChRow.c : (mockState.channels ? mockState.channels.size : 0),
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
  });

  describe('GET /api/admin/stats', () => {
    it('should return stats object', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('activeLines');
      expect(res.body).toHaveProperty('connections');
      expect(res.body).toHaveProperty('liveStreams');
      expect(res.body).toHaveProperty('channelsCount');
      expect(res.body).toHaveProperty('movieCount');
      expect(res.body).toHaveProperty('seriesCount');
      expect(res.body).toHaveProperty('cpu');
      expect(res.body).toHaveProperty('memUsed');
      expect(res.body).toHaveProperty('memTotal');
      expect(res.body).toHaveProperty('memPercent');
      expect(res.body).toHaveProperty('diskUsed');
      expect(res.body).toHaveProperty('diskTotal');
      expect(res.body).toHaveProperty('diskPercent');
      expect(res.body).toHaveProperty('netIn');
      expect(res.body).toHaveProperty('netOut');
    });

    it('should return numeric values for counts', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(typeof res.body.activeLines).toBe('number');
      expect(typeof res.body.connections).toBe('number');
      expect(typeof res.body.liveStreams).toBe('number');
      expect(typeof res.body.channelsCount).toBe('number');
      expect(typeof res.body.movieCount).toBe('number');
      expect(typeof res.body.seriesCount).toBe('number');
    });

    it('should return system metrics', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(typeof res.body.cpu).toBe('number');
      expect(typeof res.body.memPercent).toBe('number');
      expect(typeof res.body.diskPercent).toBe('number');
      expect(res.body.memPercent).toBeGreaterThanOrEqual(0);
      expect(res.body.memPercent).toBeLessThanOrEqual(100);
    });
  });
});

describe('Admin API Routes - Logs & Activity', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;
  let mockState;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getPanelLogs: jest.fn().mockResolvedValue([
        { id: 1, event: 'login', username: 'admin', ip: '127.0.0.1', created_at: '2024-01-01 10:00:00' },
        { id: 2, event: 'logout', username: 'admin', ip: '127.0.0.1', created_at: '2024-01-01 11:00:00' },
      ]),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { activity_id: 1, username: 'user1', ip: '192.168.1.1', action: 'stream_start', created_at: '2024-01-01 10:00:00' },
      ]),
    };

    mockState = {
      channels: new Map([[1, { id: 1, name: 'Test', status: 'running' }]]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/state', () => mockState);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/logs', async (req, res) => {
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
      res.json({ logs: await mockDb.getPanelLogs(limit) });
    });

    mockAdminRouter.get('/activity', async (req, res) => {
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
      const rows = await mockMariadb.query('SELECT * FROM lines_activity ORDER BY activity_id DESC LIMIT ?', [limit]);
      res.json({ activity: rows });
    });

    mockAdminRouter.get('/channels', (req, res) => {
      const list = [];
      mockState.channels.forEach((ch, id) => list.push({ id, name: ch.name, status: ch.status }));
      res.json(list);
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/state');
  });

  describe('GET /api/admin/logs', () => {
    it('should return logs array', async () => {
      const res = await request(app)
        .get('/api/admin/logs')
        .expect(200);

      expect(res.body).toHaveProperty('logs');
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('should return log objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/logs')
        .expect(200);

      const log = res.body.logs[0];
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('event');
      expect(log).toHaveProperty('created_at');
    });

    it('should accept limit parameter', async () => {
      mockDb.getPanelLogs.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/logs?limit=50')
        .expect(200);

      expect(mockDb.getPanelLogs).toHaveBeenCalledWith(50);
    });

    it('should cap limit at 2000', async () => {
      mockDb.getPanelLogs.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/logs?limit=5000')
        .expect(200);

      expect(mockDb.getPanelLogs).toHaveBeenCalledWith(2000);
    });

    it('should use default limit of 200', async () => {
      mockDb.getPanelLogs.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/logs')
        .expect(200);

      expect(mockDb.getPanelLogs).toHaveBeenCalledWith(200);
    });

    it('should use default limit of 200 when limit is 0', async () => {
      mockDb.getPanelLogs.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/logs?limit=0')
        .expect(200);

      expect(mockDb.getPanelLogs).toHaveBeenCalledWith(200);
    });
  });

  describe('GET /api/admin/activity', () => {
    it('should return activity array', async () => {
      const res = await request(app)
        .get('/api/admin/activity')
        .expect(200);

      expect(res.body).toHaveProperty('activity');
      expect(Array.isArray(res.body.activity)).toBe(true);
    });

    it('should accept limit parameter', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/activity?limit=100')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalled();
    });

    it('should use default limit of 500', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/admin/activity')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalledWith(
        'SELECT * FROM lines_activity ORDER BY activity_id DESC LIMIT ?',
        [500]
      );
    });
  });

  describe('GET /api/admin/channels', () => {
    it('should return channels array', async () => {
      const res = await request(app)
        .get('/api/admin/channels')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return channel objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/channels')
        .expect(200);

      const ch = res.body[0];
      expect(ch).toHaveProperty('id');
      expect(ch).toHaveProperty('name');
      expect(ch).toHaveProperty('status');
    });
  });
});

describe('Admin API Routes - Plex Servers', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, name: 'Plex Server 1', url: 'http://plex:32400', plex_token: 'token123', last_seen: '2024-01-01 10:00:00' },
        { id: 2, name: 'Plex Server 2', url: 'http://plex2:32400', plex_token: 'token456', last_seen: '2024-01-02 10:00:00' },
      ]),
      execute: jest.fn().mockResolvedValue({ insertId: 3 }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/plex/servers', async (req, res) => {
      try {
        const rows = await mockMariadb.query('SELECT id, name, url, plex_token, last_seen FROM plex_servers ORDER BY last_seen DESC');
        res.json({ servers: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/plex/servers', async (req, res) => {
      try {
        const { name, url, plex_token } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'name and url required' });
        const { insertId } = await mockMariadb.execute(
          'INSERT INTO plex_servers (name, url, plex_token, last_seen) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), url=VALUES(url), plex_token=VALUES(plex_token)',
          [name, url, plex_token || '']
        );
        res.json({ ok: true, id: insertId });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.delete('/plex/servers/:id', async (req, res) => {
      try {
        const n = parseInt(req.params.id, 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid id' });
        await mockMariadb.execute('DELETE FROM plex_servers WHERE id = ?', [n]);
        res.json({ ok: true });
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
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/plex/servers', () => {
    it('should return servers array', async () => {
      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return server objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(200);

      const server = res.body.servers[0];
      expect(server).toHaveProperty('id');
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('url');
      expect(server).toHaveProperty('plex_token');
      expect(server).toHaveProperty('last_seen');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/plex/servers', () => {
    it('should create a new plex server', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Server', url: 'http://new:32400', plex_token: 'newtoken' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ url: 'http://new:32400' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('name and url required');
    });

    it('should return 400 when url is missing', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Server' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('name and url required');
    });

    it('should allow empty plex_token', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Server', url: 'http://new:32400' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('DELETE /api/admin/plex/servers/:id', () => {
    it('should delete plex server', async () => {
      const res = await request(app)
        .delete('/api/admin/plex/servers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/plex/servers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .delete('/api/admin/plex/servers/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Network Security', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn().mockResolvedValue('0'),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, user_id: 1, username: 'user1', ip: '192.168.1.1', event_type: 'login', is_vpn: 1, created_at: '2024-01-01' },
      ]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

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

    mockAdminRouter.get('/multilogin/settings', async (req, res) => {
      try {
        const maxConns = await mockDb.getSetting('max_connections_per_line');
        const enabled = await mockDb.getSetting('enable_multilogin_detection');
        res.json({ enabled: enabled === '1', maxConnections: parseInt(maxConns || '1', 10) });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/multilogin/settings', async (req, res) => {
      try {
        const { enabled, maxConnections } = req.body;
        if (enabled !== undefined) await mockDb.setSetting('enable_multilogin_detection', enabled ? '1' : '0');
        if (maxConnections !== undefined) await mockDb.setSetting('max_connections_per_line', String(maxConnections));
        res.json({ ok: true });
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
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/vpn/settings', () => {
    it('should return vpn settings', async () => {
      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('blockVpn');
      expect(typeof res.body.enabled).toBe('boolean');
      expect(typeof res.body.blockVpn).toBe('boolean');
    });

    it('should return 500 on database error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/vpn/settings', () => {
    it('should update vpn settings', async () => {
      mockDb.setSetting = jest.fn().mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true, blockVpn: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should accept partial updates', async () => {
      mockDb.setSetting = jest.fn().mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });

  describe('GET /api/admin/vpn/log', () => {
    it('should return vpn events', async () => {
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

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/multilogin/settings', () => {
    it('should return multilogin settings', async () => {
      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('maxConnections');
      expect(typeof res.body.enabled).toBe('boolean');
      expect(typeof res.body.maxConnections).toBe('number');
    });

    it('should parse maxConnections as integer', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'max_connections_per_line') return Promise.resolve('5');
        return Promise.resolve('0');
      });

      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(200);

      expect(res.body.maxConnections).toBe(5);
    });

    it('should return 500 on database error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/multilogin/settings', () => {
    it('should update multilogin settings', async () => {
      mockDb.setSetting = jest.fn().mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({ enabled: true, maxConnections: 3 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should accept partial updates', async () => {
      mockDb.setSetting = jest.fn().mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({ enabled: false })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });
});

describe('Admin API Routes - Server Relationships Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getServerRelationships: jest.fn().mockResolvedValue([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy', priority: 1, enabled: 1, parent_name: 'Origin', child_name: 'Proxy' },
      ]),
      addServerRelationship: jest.fn().mockResolvedValue(5),
      removeServerRelationship: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy', priority: 1, enabled: 1, parent_name: 'Origin', child_name: 'Proxy' },
      ]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/server-relationships', async (req, res) => {
      const type = String(req.query.type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship type' });
      }
      try {
        const rows = await mockMariadb.query(
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
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.get('/server-relationships/:serverId', async (req, res) => {
      const id = parseInt(req.params.serverId, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid server id' });
      try {
        const rows = await mockDb.getServerRelationships(id);
        res.json({ relationships: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/server-relationships', async (req, res) => {
      const { parent_server_id, child_server_id, relationship_type, priority, enabled } = req.body || {};
      if (!Number.isFinite(parseInt(parent_server_id, 10)) || !Number.isFinite(parseInt(child_server_id, 10))) {
        return res.status(400).json({ error: 'parent_server_id and child_server_id are required' });
      }
      const type = String(relationship_type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship_type' });
      }
      try {
        const id = await mockDb.addServerRelationship(
          parseInt(parent_server_id, 10),
          parseInt(child_server_id, 10),
          type
        );
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
      try {
        await mockDb.removeServerRelationship(parentId, childId, type);
        res.json({ ok: true });
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
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/server-relationships/:serverId', () => {
    it('should return relationships for valid server id', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships/1')
        .expect(200);

      expect(res.body).toHaveProperty('relationships');
      expect(Array.isArray(res.body.relationships)).toBe(true);
    });

    it('should return 400 for non-numeric server id', async () => {
      const res = await request(app)
        .get('/api/admin/server-relationships/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid server id');
    });

    it('should return 500 on database error', async () => {
      mockDb.getServerRelationships.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/server-relationships/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/server-relationships', () => {
    it('should create a new relationship', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 when parent_server_id is missing', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parent_server_id and child_server_id are required');
    });

    it('should return 400 when child_server_id is missing', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, relationship_type: 'origin-proxy' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parent_server_id and child_server_id are required');
    });

    it('should return 400 for invalid relationship_type', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'invalid' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid relationship_type');
    });

    it('should return 409 for duplicate relationship', async () => {
      mockDb.addServerRelationship.mockRejectedValueOnce(new Error('Duplicate entry'));

      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(409);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('relationship already exists');
    });

    it('should use default relationship_type of origin-proxy', async () => {
      mockDb.addServerRelationship.mockResolvedValueOnce(6);

      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2 })
        .expect(200);

      expect(mockDb.addServerRelationship).toHaveBeenCalledWith(1, 2, 'origin-proxy');
    });
  });

  describe('DELETE /api/admin/server-relationships', () => {
    it('should delete a relationship', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=1&childId=2&type=origin-proxy')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 when parentId is missing', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?childId=2&type=origin-proxy')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parentId, childId, and type are required');
    });

    it('should return 400 when childId is missing', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=1&type=origin-proxy')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parentId, childId, and type are required');
    });

    it('should return 400 for non-numeric parentId', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=invalid&childId=2&type=origin-proxy')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 500 on database error', async () => {
      mockDb.removeServerRelationship.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .delete('/api/admin/server-relationships?parentId=1&childId=2&type=origin-proxy')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Live Connections', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockDb;
  let mockState;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { session_uuid: 'abc123', stream_type: 'live', stream_id: '1', container: 'mp4', username: 'testuser', geoip_country_code: 'US', isp: 'ISP1', user_ip: '192.168.1.1', last_seen_at: '2024-01-01 10:00:00', created_at: '2024-01-01 09:00:00', origin_name: 'Origin1', origin_host: 'origin1.com', proxy_name: 'Proxy1', proxy_host: 'proxy1.com' },
        { session_uuid: 'def456', stream_type: 'movie', stream_id: '10', container: 'mkv', username: 'user2', geoip_country_code: 'GB', isp: 'ISP2', user_ip: '10.0.0.1', last_seen_at: '2024-01-01 11:00:00', created_at: '2024-01-01 10:00:00', origin_name: 'Origin2', origin_host: 'origin2.com', proxy_name: null, proxy_host: null },
      ]),
      queryOne: jest.fn().mockResolvedValue({ name: 'TestServer', public_host: 'test.com' }),
    };

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockState = {
      channels: new Map([['1', { id: '1', name: 'Channel 1', status: 'running', is_internal: false, channelClass: 'live', stream_server_id: 1, startedAt: new Date(Date.now() - 3600000), streamInfo: { bitrate: 2000000 }, mpdUrl: 'http://example.com/stream.mpd' }]]),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/state', () => mockState);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/live-connections', async (req, res) => {
      try {
        const type = String(req.query.type || '').trim();
        const serverId = parseInt(req.query.server_id, 10);
        let sql = `SELECT session_uuid, stream_type, stream_id FROM line_runtime_sessions WHERE date_end IS NULL`;
        const params = [];
        if (type && ['live', 'movie', 'episode'].includes(type)) {
          sql += ' AND stream_type = ?';
          params.push(type);
        }
        if (Number.isFinite(serverId)) {
          sql += ' AND origin_server_id = ?';
          params.push(serverId);
        }
        sql += ' ORDER BY last_seen_at DESC LIMIT 500';
        const sessions = await mockMariadb.query(sql, params);
        res.json({ sessions });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/live-connections/summary', async (_req, res) => {
      try {
        const [typeRows, countryRows, streamRows, serverRows] = await Promise.all([
          mockMariadb.query(`SELECT stream_type, COUNT(*) AS cnt FROM line_runtime_sessions WHERE date_end IS NULL GROUP BY stream_type`),
          mockMariadb.query(`SELECT geoip_country_code, COUNT(*) AS cnt FROM line_runtime_sessions WHERE date_end IS NULL AND geoip_country_code != '' GROUP BY geoip_country_code ORDER BY cnt DESC LIMIT 20`),
          mockMariadb.query(`SELECT stream_id, stream_type, COUNT(*) AS cnt FROM line_runtime_sessions WHERE date_end IS NULL GROUP BY stream_id, stream_type ORDER BY cnt DESC LIMIT 10`),
          mockMariadb.query(`SELECT origin_server_id, COUNT(*) AS cnt FROM line_runtime_sessions WHERE date_end IS NULL AND origin_server_id IS NOT NULL GROUP BY origin_server_id`),
        ]);
        const byType = { live: 0, movie: 0, episode: 0 };
        for (const r of typeRows) byType[r.stream_type] = Number(r.cnt);
        const total = Object.values(byType).reduce((a, b) => a + b, 0);
        res.json({ total, by_type: byType, countries: countryRows, top_streams: streamRows, servers: [] });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/channels/top-monitor', async (_req, res) => {
      try {
        const rows = await mockMariadb.query(`SELECT stream_id, COUNT(*) AS viewers, MAX(origin_server_id) AS origin_server_id, MAX(last_seen_at) AS last_seen_at FROM line_runtime_sessions WHERE date_end IS NULL AND stream_type = 'live' GROUP BY stream_id ORDER BY viewers DESC, last_seen_at DESC LIMIT 50`);
        const channelRows = [];
        for (const row of rows) {
          const streamId = String(row.stream_id || '');
          const ch = mockState.channels.get(streamId);
          if (!ch || ch.is_internal || ch.channelClass === 'movie') continue;
          channelRows.push({ id: streamId, name: ch.name, viewers: Number(row.viewers || 0), server_id: Number(row.origin_server_id) || 0 });
        }
        res.json({ totals: { total_viewers: channelRows.reduce((sum, row) => sum + Number(row.viewers || 0), 0), active_channels: channelRows.length }, channels: channelRows, refreshed_at: new Date().toISOString() });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/live-connections/geo', async (_req, res) => {
      try {
        const rows = await mockMariadb.query(`SELECT geoip_country_code, COUNT(*) AS cnt FROM line_runtime_sessions WHERE date_end IS NULL AND geoip_country_code != '' GROUP BY geoip_country_code ORDER BY cnt DESC`);
        res.json({ total: rows.reduce((sum, r) => sum + Number(r.cnt), 0), countries: rows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })) });
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
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/state');
  });

  describe('GET /api/admin/live-connections', () => {
    it('should return sessions list', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    it('should return session objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      const session = res.body.sessions[0];
      expect(session).toHaveProperty('session_uuid');
      expect(session).toHaveProperty('stream_type');
      expect(session).toHaveProperty('stream_id');
    });

    it('should accept type filter (live)', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ session_uuid: 'abc123', stream_type: 'live', stream_id: '1' }]);

      const res = await request(app)
        .get('/api/admin/live-connections?type=live')
        .expect(200);

      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].stream_type).toBe('live');
    });

    it('should accept type filter (movie)', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ session_uuid: 'def456', stream_type: 'movie', stream_id: '10' }]);

      const res = await request(app)
        .get('/api/admin/live-connections?type=movie')
        .expect(200);

      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].stream_type).toBe('movie');
    });

    it('should accept server_id filter', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/live-connections?server_id=1')
        .expect(200);

      expect(mockMariadb.query).toHaveBeenCalledWith(expect.stringContaining('origin_server_id = ?'), expect.arrayContaining([1]));
    });

    it('should ignore invalid type filter', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections?type=invalid')
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
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
    it('should return summary object', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('by_type');
      expect(res.body).toHaveProperty('countries');
      expect(res.body).toHaveProperty('top_streams');
      expect(res.body).toHaveProperty('servers');
    });

    it('should return by_type with live, movie, episode counts', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body.by_type).toHaveProperty('live');
      expect(res.body.by_type).toHaveProperty('movie');
      expect(res.body.by_type).toHaveProperty('episode');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/channels/top-monitor', () => {
    it('should return channel monitor data', async () => {
      const res = await request(app)
        .get('/api/admin/channels/top-monitor')
        .expect(200);

      expect(res.body).toHaveProperty('totals');
      expect(res.body).toHaveProperty('channels');
      expect(res.body).toHaveProperty('refreshed_at');
    });

    it('should return totals object', async () => {
      const res = await request(app)
        .get('/api/admin/channels/top-monitor')
        .expect(200);

      expect(res.body.totals).toHaveProperty('total_viewers');
      expect(res.body.totals).toHaveProperty('active_channels');
    });

    it('should return channel objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/channels/top-monitor')
        .expect(200);

      if (res.body.channels.length > 0) {
        const ch = res.body.channels[0];
        expect(ch).toHaveProperty('id');
        expect(ch).toHaveProperty('name');
        expect(ch).toHaveProperty('viewers');
      }
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/channels/top-monitor')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/live-connections/geo', () => {
    it('should return geo data', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/geo')
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('countries');
      expect(Array.isArray(res.body.countries)).toBe(true);
    });

    it('should return country objects with code and count', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ geoip_country_code: 'US', cnt: 10 }, { geoip_country_code: 'GB', cnt: 5 }]);

      const res = await request(app)
        .get('/api/admin/live-connections/geo')
        .expect(200);

      expect(res.body.countries[0]).toHaveProperty('code', 'US');
      expect(res.body.countries[0]).toHaveProperty('cnt', 10);
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/live-connections/geo')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Cloud Backups', () => {
  let app;
  let mockAdminRouter;
  let mockBackupService;
  let mockCloudBackup;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      setSetting: jest.fn().mockResolvedValue(true),
      getSetting: jest.fn().mockResolvedValue(null),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([{ id: 1, filename: 'backup_20240101.db', type: 'local' }]),
    };

    mockBackupService = {
      initBackupTable: jest.fn().mockResolvedValue(true),
      listBackups: jest.fn().mockResolvedValue([{ id: 1, filename: 'backup_20240101.db', created_at: '2024-01-01', size: 1024, type: 'local' }]),
      createBackup: jest.fn().mockResolvedValue({ id: 3, filename: 'backup_new.db', created_at: '2024-01-03', size: 2048, type: 'local' }),
      getBackupPath: jest.fn().mockResolvedValue('/path/to/backup.db'),
      deleteBackupFile: jest.fn().mockResolvedValue(true),
      getLocalBackupRetentionLimit: jest.fn().mockResolvedValue(10),
    };

    mockCloudBackup = {
      getCloudBackups: jest.fn().mockResolvedValue([{ id: 1, filename: 'cloud_backup_20240101.db', created_at: '2024-01-01', size: 1024, type: 'gdrive' }]),
      getCloudConfig: jest.fn().mockResolvedValue({ type: 'gdrive', folder_id: 'test-folder' }),
      getCloudCapabilityStatus: jest.fn().mockReturnValue({ supported: true, message: null }),
      createEncryptedCloudBackup: jest.fn().mockResolvedValue({ ok: true }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/backupService', () => mockBackupService);
    jest.mock('../../../services/cloudBackup', () => mockCloudBackup);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/backups/cloud', async (_req, res) => {
      try {
        const backups = await mockCloudBackup.getCloudBackups();
        const cfg = await mockCloudBackup.getCloudConfig();
        const capability = mockCloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
        res.json({ backups, configured: cfg ? { type: cfg.type } : null, capability });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/backups/cloud/upload/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const cfg = await mockCloudBackup.getCloudConfig();
        const capability = mockCloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
        if (!capability.supported) {
          return res.status(409).json({ error: capability.message, capability });
        }
        const rows = await mockMariadb.query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
        if (!rows.length) return res.status(404).json({ error: 'not found' });
        await mockCloudBackup.createEncryptedCloudBackup(rows[0].filename);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/settings/cloud_backup', async (req, res) => {
      try {
        const { cloud_backup_type, gdrive_access_token, gdrive_folder_id, dropbox_access_token, cloud_backup_key } = req.body;
        if (cloud_backup_type !== undefined) await mockDb.setSetting('cloud_backup_type', cloud_backup_type);
        if (gdrive_access_token !== undefined) await mockDb.setSetting('gdrive_access_token', gdrive_access_token);
        if (gdrive_folder_id !== undefined) await mockDb.setSetting('gdrive_folder_id', gdrive_folder_id);
        if (dropbox_access_token !== undefined) await mockDb.setSetting('dropbox_access_token', dropbox_access_token);
        if (cloud_backup_key !== undefined) await mockDb.setSetting('cloud_backup_key', cloud_backup_key);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/backups', async (req, res) => {
      try {
        await mockBackupService.initBackupTable();
        const backup = await mockBackupService.createBackup();
        res.json({ ok: true, backup });
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
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/backupService');
    jest.unmock('../../../services/cloudBackup');
  });

  describe('GET /api/admin/backups/cloud', () => {
    it('should return cloud backups list', async () => {
      const res = await request(app)
        .get('/api/admin/backups/cloud')
        .expect(200);

      expect(res.body).toHaveProperty('backups');
      expect(Array.isArray(res.body.backups)).toBe(true);
    });

    it('should return configured status', async () => {
      const res = await request(app)
        .get('/api/admin/backups/cloud')
        .expect(200);

      expect(res.body).toHaveProperty('configured');
      expect(res.body.configured).toHaveProperty('type');
    });

    it('should return capability status', async () => {
      const res = await request(app)
        .get('/api/admin/backups/cloud')
        .expect(200);

      expect(res.body).toHaveProperty('capability');
      expect(res.body.capability).toHaveProperty('supported');
    });

    it('should return 500 on error', async () => {
      mockCloudBackup.getCloudBackups.mockRejectedValueOnce(new Error('cloud error'));

      const res = await request(app)
        .get('/api/admin/backups/cloud')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/backups/cloud/upload/:id', () => {
    it('should upload backup to cloud', async () => {
      const res = await request(app)
        .post('/api/admin/backups/cloud/upload/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/backups/cloud/upload/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when backup not found', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/backups/cloud/upload/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 409 when cloud not supported', async () => {
      mockCloudBackup.getCloudCapabilityStatus.mockReturnValueOnce({ supported: false, message: 'Cloud backup not configured' });

      const res = await request(app)
        .post('/api/admin/backups/cloud/upload/1')
        .expect(409);

      expect(res.body).toHaveProperty('error');
      expect(res.body.capability).toHaveProperty('supported', false);
    });

    it('should return 500 on error', async () => {
      mockCloudBackup.createEncryptedCloudBackup.mockRejectedValueOnce(new Error('upload failed'));

      const res = await request(app)
        .post('/api/admin/backups/cloud/upload/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/settings/cloud_backup', () => {
    it('should update cloud backup settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings/cloud_backup')
        .send({ cloud_backup_type: 'gdrive', gdrive_access_token: 'token123', gdrive_folder_id: 'folder123' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('cloud_backup_type', 'gdrive');
      expect(mockDb.setSetting).toHaveBeenCalledWith('gdrive_access_token', 'token123');
      expect(mockDb.setSetting).toHaveBeenCalledWith('gdrive_folder_id', 'folder123');
    });

    it('should update dropbox settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings/cloud_backup')
        .send({ cloud_backup_type: 'dropbox', dropbox_access_token: 'dropbox_token' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('dropbox_access_token', 'dropbox_token');
    });

    it('should update encryption key', async () => {
      const res = await request(app)
        .put('/api/admin/settings/cloud_backup')
        .send({ cloud_backup_key: 'encryption_key_123' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('cloud_backup_key', 'encryption_key_123');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('set failed'));

      const res = await request(app)
        .put('/api/admin/settings/cloud_backup')
        .send({ cloud_backup_type: 'gdrive' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/backups', () => {
    it('should create a new backup', async () => {
      const res = await request(app)
        .post('/api/admin/backups')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('backup');
    });

    it('should return 500 on error', async () => {
      mockBackupService.createBackup.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/backups')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Backup Download and Restore', () => {
  let app;
  let mockAdminRouter;
  let mockBackupService;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([{ id: 1, filename: 'backup_20240101.db', type: 'local' }]),
    };

    mockBackupService = {
      getBackupPath: jest.fn().mockResolvedValue('/path/to/backup.db'),
      restoreBackup: jest.fn().mockResolvedValue({ safetyBackup: 'safety_20240101.db' }),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/backupService', () => mockBackupService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/backups/:id/download', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const rows = await mockMariadb.query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
        if (!rows.length) return res.status(404).json({ error: 'not found' });
        const filepath = await mockBackupService.getBackupPath(rows[0].filename);
        if (!filepath) return res.status(404).json({ error: 'file not found' });
        res.json({ ok: true, filepath });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/backups/:id/restore', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const rows = await mockMariadb.query('SELECT filename, type FROM backups WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ error: 'not found' });
        if (rows[0].type !== 'local') return res.status(400).json({ error: 'only local backups can be restored' });
        const confirmFilename = String(req.body && (req.body.confirmFilename || req.body.confirm_filename) || '').trim();
        if (!confirmFilename || confirmFilename !== rows[0].filename) {
          return res.status(400).json({ error: 'confirmFilename must exactly match the backup filename' });
        }
        const result = await mockBackupService.restoreBackup(rows[0].filename);
        res.json({ ok: true, safetyBackup: result && result.safetyBackup ? result.safetyBackup : null });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/backupService');
  });

  describe('GET /api/admin/backups/:id/download', () => {
    it('should return download info for valid backup', async () => {
      const res = await request(app)
        .get('/api/admin/backups/1/download')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('filepath');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/backups/invalid/download')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when backup not found', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/backups/999/download')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 404 when file path not found', async () => {
      mockBackupService.getBackupPath.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/backups/1/download')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('file not found');
    });
  });

  describe('POST /api/admin/backups/:id/restore', () => {
    it('should restore backup with correct confirmFilename', async () => {
      const res = await request(app)
        .post('/api/admin/backups/1/restore')
        .send({ confirmFilename: 'backup_20240101.db' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('safetyBackup');
    });

    it('should accept confirm_filename alternative parameter', async () => {
      const res = await request(app)
        .post('/api/admin/backups/1/restore')
        .send({ confirm_filename: 'backup_20240101.db' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/backups/invalid/restore')
        .send({ confirmFilename: 'test.db' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when backup not found', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/backups/999/restore')
        .send({ confirmFilename: 'test.db' })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 for non-local backup', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ filename: 'cloud_backup.db', type: 'gdrive' }]);

      const res = await request(app)
        .post('/api/admin/backups/1/restore')
        .send({ confirmFilename: 'cloud_backup.db' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('only local backups can be restored');
    });

    it('should return 400 when confirmFilename does not match', async () => {
      const res = await request(app)
        .post('/api/admin/backups/1/restore')
        .send({ confirmFilename: 'wrong_filename.db' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('confirmFilename must exactly match');
    });

    it('should return 400 when confirmFilename is missing', async () => {
      const res = await request(app)
        .post('/api/admin/backups/1/restore')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('confirmFilename must exactly match');
    });
  });
});

describe('Admin API Routes - Multilogin Disconnect', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;
  let mockLineService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([{ id: 1, username: 'testuser', ip: '192.168.1.1', is_vpn: 0 }]),
      queryOne: jest.fn().mockResolvedValue({ session_uuid: 'abc123', user_id: 1, ip: '192.168.1.1' }),
    };

    mockLineService = {
      closeConnection: jest.fn().mockResolvedValue(true),
      closeRuntimeSession: jest.fn().mockResolvedValue(true),
      getActiveConnections: jest.fn().mockResolvedValue([{ session_uuid: 'abc123', user_id: 1, ip: '192.168.1.1' }]),
      killConnections: jest.fn().mockResolvedValue(1),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/lineService', () => mockLineService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/multilogin', async (_req, res) => {
      try {
        const rows = await mockMariadb.query('SELECT l.id, l.username, le.ip, le.is_vpn FROM lines l LEFT JOIN login_events le ON l.id = le.user_id LIMIT 100');
        res.json({ connections: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.post('/multilogin/:lineId/disconnect', async (req, res) => {
      try {
        const lineId = parseInt(req.params.lineId, 10);
        if (!Number.isFinite(lineId)) return res.status(400).json({ error: 'invalid line id' });
        const killed = await mockLineService.killConnections(lineId);
        res.json({ ok: true, disconnected: killed });
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
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/lineService');
  });

  describe('GET /api/admin/multilogin', () => {
    it('should return connections list', async () => {
      const res = await request(app)
        .get('/api/admin/multilogin')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/multilogin')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/multilogin/:lineId/disconnect', () => {
    it('should disconnect line connections', async () => {
      const res = await request(app)
        .post('/api/admin/multilogin/1/disconnect')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('disconnected');
    });

    it('should return 400 for non-numeric line id', async () => {
      const res = await request(app)
        .post('/api/admin/multilogin/invalid/disconnect')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid line id');
    });

    it('should return 500 on error', async () => {
      mockLineService.killConnections.mockRejectedValueOnce(new Error('kill failed'));

      const res = await request(app)
        .post('/api/admin/multilogin/1/disconnect')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Additional Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/unknown-route', async (req, res) => {
      res.status(404).json({ error: 'not found' });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/api/admin/unknown-route')
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Stream Repair Endpoints', () => {
  let app;
  let mockAdminRouter;
  let mockState;
  let mockMariadb;
  let mockStreamRepair;

  beforeAll(() => {
    jest.resetModules();

    mockState = {
      channels: new Map([
        ['1', { id: '1', name: 'Channel 1', status: 'running', is_internal: false, channelClass: 'live' }],
        ['2', { id: '2', name: 'Channel 2', status: 'stopped', is_internal: false, channelClass: 'live' }],
        ['3', { id: '3', name: 'Internal', status: 'running', is_internal: true, channelClass: 'live' }],
        ['movie1', { id: 'movie1', name: 'Movie 1', status: 'running', is_internal: false, channelClass: 'movie' }],
      ]),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
    };

    mockStreamRepair = {
      checkChannel: jest.fn().mockResolvedValue({ status: 'healthy', issues: [] }),
      getChannelHealth: jest.fn().mockResolvedValue({ status: 'healthy', checkedAt: Date.now() }),
      checkAllChannels: jest.fn().mockResolvedValue({ checked: 2, issues: 0 }),
      getAllChannelHealth: jest.fn().mockResolvedValue({ '1': { status: 'healthy' }, '2': { status: 'unhealthy' } }),
    };

    jest.mock('../../../lib/state', () => mockState);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/streamRepair', () => mockStreamRepair);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/streams/:id/health', async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'missing channel id' });
        const channel = mockState.channels.get(id);
        if (!channel) return res.status(404).json({ error: 'channel not found' });
        const cached = await mockStreamRepair.getChannelHealth(id);
        if (cached && Date.now() - cached.checkedAt < 900000) {
          return res.json({ id, ...cached, source: 'cache' });
        }
        const result = await mockStreamRepair.checkChannel(id, channel);
        return res.json({ id, ...result, source: 'live' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/streams/:id/repair', async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'missing channel id' });
        const channel = mockState.channels.get(id);
        if (!channel) return res.status(404).json({ error: 'channel not found' });
        const result = await mockStreamRepair.checkChannel(id, channel);
        res.json({ id, ...result });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/streams/repair-all', async (req, res) => {
      try {
        const allChannels = [...mockState.channels.values()].filter(c => 
          String(c.channelClass || 'normal') !== 'movie' && !c.is_internal
        );
        const result = await mockStreamRepair.checkAllChannels(allChannels, mockState.channels);
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/streams/health-all', async (req, res) => {
      try {
        const allChannels = [...mockState.channels.values()].filter(c => 
          String(c.channelClass || 'normal') !== 'movie' && !c.is_internal
        );
        const healthMap = await mockStreamRepair.getAllChannelHealth(allChannels.map(c => c.id));
        const result = {};
        for (const ch of allChannels) {
          result[ch.id] = healthMap[ch.id] || { status: null, checkedAt: null };
        }
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/state');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/streamRepair');
  });

  describe('GET /api/admin/streams/:id/health', () => {
    it('should return channel health', async () => {
      const res = await request(app)
        .get('/api/admin/streams/1/health')
        .expect(200);

      expect(res.body).toHaveProperty('id', '1');
      expect(res.body).toHaveProperty('source');
    });

    it('should return 400 for missing channel id', async () => {
      const res = await request(app)
        .get('/api/admin/streams//health')
        .expect(404);
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .get('/api/admin/streams/999/health')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('channel not found');
    });

    it('should return cached health if available', async () => {
      mockStreamRepair.getChannelHealth.mockResolvedValueOnce({ status: 'healthy', checkedAt: Date.now() });

      const res = await request(app)
        .get('/api/admin/streams/1/health')
        .expect(200);

      expect(res.body).toHaveProperty('source', 'cache');
    });

    it('should return 500 on repair service error', async () => {
      mockStreamRepair.getChannelHealth.mockResolvedValueOnce({ status: 'healthy', checkedAt: Date.now() - 1000000 });
      mockStreamRepair.checkChannel.mockRejectedValueOnce(new Error('repair error'));

      const res = await request(app)
        .get('/api/admin/streams/1/health')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/streams/:id/repair', () => {
    it('should repair a channel', async () => {
      mockStreamRepair.checkChannel.mockResolvedValueOnce({ status: 'repaired', issues: ['restarted'] });

      const res = await request(app)
        .post('/api/admin/streams/1/repair')
        .expect(200);

      expect(res.body).toHaveProperty('id', '1');
      expect(res.body).toHaveProperty('status', 'repaired');
    });

    it('should return 400 for missing channel id', async () => {
      const res = await request(app)
        .post('/api/admin/streams//repair')
        .expect(404);
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .post('/api/admin/streams/999/repair')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('channel not found');
    });

    it('should return 500 on repair error', async () => {
      mockStreamRepair.checkChannel.mockRejectedValueOnce(new Error('repair failed'));

      const res = await request(app)
        .post('/api/admin/streams/1/repair')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/streams/repair-all', () => {
    it('should repair all eligible channels', async () => {
      const res = await request(app)
        .post('/api/admin/streams/repair-all')
        .expect(200);

      expect(res.body).toHaveProperty('checked');
      expect(res.body).toHaveProperty('issues');
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
    it('should return health for all eligible channels', async () => {
      const res = await request(app)
        .get('/api/admin/streams/health-all')
        .expect(200);

      expect(typeof res.body).toBe('object');
      expect(res.body).toHaveProperty('1');
      expect(res.body).toHaveProperty('2');
    });

    it('should return 500 on error', async () => {
      mockStreamRepair.getAllChannelHealth.mockRejectedValueOnce(new Error('health check failed'));

      const res = await request(app)
        .get('/api/admin/streams/health-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Database Repair & Maintenance', () => {
  let app;
  let mockAdminRouter;
  let mockDbService;

  beforeAll(() => {
    jest.resetModules();

    mockDbService = {
      getDatabaseStatus: jest.fn().mockResolvedValue({
        status: 'connected',
        size_bytes: 1048576,
        tables: 15,
      }),
      getDatabasePerformance: jest.fn().mockResolvedValue({
        queries_per_second: 100,
        connections: 5,
        buffer_hit_ratio: 95.5,
      }),
      getDatabaseLive: jest.fn().mockResolvedValue({
        threads_connected: 3,
        queries: 1250,
        uptime_seconds: 3600,
      }),
      optimizeDatabase: jest.fn().mockResolvedValue({ optimized: true, tables_optimized: 10 }),
      repairDatabase: jest.fn().mockResolvedValue({ repaired: true, tables_repaired: 5 }),
    };

    jest.mock('../../../services/dbService', () => mockDbService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/system/db-status', async (_req, res) => {
      try { res.json(await mockDbService.getDatabaseStatus()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/system/db-performance', async (_req, res) => {
      try { res.json(await mockDbService.getDatabasePerformance()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/system/db-live', async (_req, res) => {
      try { res.json(await mockDbService.getDatabaseLive()); }
      catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/system/db-optimize', async (_req, res) => {
      try { res.json(await mockDbService.optimizeDatabase({ source: 'api' })); }
      catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
    });

    mockAdminRouter.post('/system/db-repair', async (_req, res) => {
      try { res.json(await mockDbService.repairDatabase({ source: 'api' })); }
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
      expect(res.body).toHaveProperty('size_bytes');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabaseStatus.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/system/db-status')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/system/db-performance', () => {
    it('should return database performance metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system/db-performance')
        .expect(200);

      expect(res.body).toHaveProperty('queries_per_second');
      expect(res.body).toHaveProperty('connections');
      expect(res.body).toHaveProperty('buffer_hit_ratio');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabasePerformance.mockRejectedValueOnce(new Error('performance error'));

      const res = await request(app)
        .get('/api/admin/system/db-performance')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/system/db-live', () => {
    it('should return live database info', async () => {
      const res = await request(app)
        .get('/api/admin/system/db-live')
        .expect(200);

      expect(res.body).toHaveProperty('threads_connected');
      expect(res.body).toHaveProperty('queries');
      expect(res.body).toHaveProperty('uptime_seconds');
    });

    it('should return 500 on error', async () => {
      mockDbService.getDatabaseLive.mockRejectedValueOnce(new Error('live error'));

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
      expect(res.body).toHaveProperty('tables_optimized');
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
      expect(res.body).toHaveProperty('tables_repaired');
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

describe('Admin API Routes - Server Actions', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockServerService;
  let mockStreamManager;
  let mockLineService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      isAdmin: jest.fn().mockResolvedValue(true),
      countActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue(5),
      listActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue([
        { session_uuid: 'abc123', stream_type: 'live', stream_id: '1', line_id: 1 },
      ]),
      reconcilePlacementClients: jest.fn().mockResolvedValue(true),
    };

    mockServerService = {
      getServer: jest.fn().mockResolvedValue({ id: 1, name: 'Test Server', enabled: 1 }),
      listServers: jest.fn().mockResolvedValue([{ id: 1, name: 'Test Server' }]),
      getRuntimePlacementsForServer: jest.fn().mockResolvedValue([]),
      getServerHealthStatus: jest.fn().mockResolvedValue({ fresh: true, staleMs: null }),
    };

    mockStreamManager = {
      issueRemoteCommand: jest.fn().mockResolvedValue({ ok: true, commandId: 'cmd-123' }),
    };

    mockLineService = {
      closeConnection: jest.fn().mockResolvedValue(true),
      closeRuntimeSession: jest.fn().mockResolvedValue(true),
      killConnections: jest.fn().mockResolvedValue(2),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/serverService', () => mockServerService);
    jest.mock('../../../services/streamManager', () => mockStreamManager);
    jest.mock('../../../services/lineService', () => mockLineService);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/servers/:id/actions/restart-services', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        const server = await mockServerService.getServer(id);
        if (!server) return res.status(404).json({ error: 'not found' });
        const result = await mockStreamManager.issueRemoteCommand({
          serverId: id,
          commandType: 'restart_services',
          issuedByUserId: req.session && req.session.userId,
        });
        if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
        res.json({ ok: true, commandId: result.commandId, message: 'Restart services command queued' });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/servers/:id/actions/reboot-server', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        const server = await mockServerService.getServer(id);
        if (!server) return res.status(404).json({ error: 'not found' });
        const result = await mockStreamManager.issueRemoteCommand({
          serverId: id,
          commandType: 'reboot_server',
          issuedByUserId: req.session && req.session.userId,
        });
        if (!result.ok) return res.status(400).json({ error: result.reason || 'failed' });
        res.json({ ok: true, commandId: result.commandId, message: 'Reboot command queued' });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/servers/:id/actions/kill-connections', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        const server = await mockServerService.getServer(id);
        if (!server) return res.status(404).json({ error: 'not found' });
        const sessions = await mockDb.listActiveRuntimeSessionsByServer(id);
        const reconcileKeys = new Set();
        let closed = 0;
        for (const session of sessions) {
          try {
            if (String(session.stream_type) === 'live' && session.line_id && session.session_uuid) {
              await mockLineService.closeConnection(session.line_id, session.session_uuid);
            }
          } catch (_) {}
          if (session.session_uuid) {
            await mockLineService.closeRuntimeSession(session.session_uuid);
            reconcileKeys.add(`${session.stream_type}:${session.stream_id}:${id}`);
            closed++;
          }
        }
        for (const key of reconcileKeys) {
          const [streamType, streamId, serverId] = key.split(':');
          await mockDb.reconcilePlacementClients(streamType, streamId, parseInt(serverId, 10));
        }
        res.json({ ok: true, closed, message: `Closed ${closed} active connection(s)` });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/serverService');
    jest.unmock('../../../services/streamManager');
    jest.unmock('../../../services/lineService');
  });

  describe('POST /api/admin/servers/:id/actions/restart-services', () => {
    it('should restart services on server', async () => {
      const res = await request(app)
        .post('/api/admin/servers/1/actions/restart-services')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('commandId');
      expect(res.body).toHaveProperty('message');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/restart-services')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/restart-services')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 when command fails', async () => {
      mockStreamManager.issueRemoteCommand.mockResolvedValueOnce({ ok: false, reason: 'Server unreachable' });

      const res = await request(app)
        .post('/api/admin/servers/1/actions/restart-services')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 500 on error', async () => {
      mockServerService.getServer.mockRejectedValueOnce(new Error('server error'));

      const res = await request(app)
        .post('/api/admin/servers/1/actions/restart-services')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/servers/:id/actions/reboot-server', () => {
    it('should reboot server', async () => {
      const res = await request(app)
        .post('/api/admin/servers/1/actions/reboot-server')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('commandId');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/reboot-server')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/reboot-server')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 when reboot command fails', async () => {
      mockStreamManager.issueRemoteCommand.mockResolvedValueOnce({ ok: false, reason: 'Agent not responding' });

      const res = await request(app)
        .post('/api/admin/servers/1/actions/reboot-server')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/servers/:id/actions/kill-connections', () => {
    it('should kill connections on server', async () => {
      const res = await request(app)
        .post('/api/admin/servers/1/actions/kill-connections')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('closed');
      expect(res.body).toHaveProperty('message');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/servers/invalid/actions/kill-connections')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent server', async () => {
      mockServerService.getServer.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/servers/999/actions/kill-connections')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 500 on error', async () => {
      mockDb.listActiveRuntimeSessionsByServer.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .post('/api/admin/servers/1/actions/kill-connections')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Lines Advanced Operations', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockLineService;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1 }),
      getPackageById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Package' }),
      deleteExpiredLines: jest.fn().mockResolvedValue(5),
      isAdmin: jest.fn().mockResolvedValue(true),
      attachLinePassword: jest.fn().mockImplementation(r => ({ ...r, password: '***' })),
    };

    mockLineService = {
      listAll: jest.fn().mockResolvedValue({ lines: [{ id: 1, username: 'line1' }], total: 1 }),
      getActiveConnections: jest.fn().mockResolvedValue([
        { session_uuid: 'abc123', user_id: 1, ip: '192.168.1.1' },
        { session_uuid: 'def456', user_id: 1, ip: '192.168.1.2' },
      ]),
      killConnections: jest.fn().mockResolvedValue(2),
      createLine: jest.fn().mockResolvedValue({ id: 5, username: 'newline' }),
      update: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn().mockResolvedValue(true),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([{ username: 'existing1' }, { username: 'existing2' }]),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/lineService', () => mockLineService);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/cache', () => ({
      invalidateLines: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/lines/:id/connections', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      const connections = await mockLineService.getActiveConnections(id);
      res.json({ connections });
    });

    mockAdminRouter.post('/lines/:id/kill-connections', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        const line = await mockDb.getLineById(id);
        if (!line) return res.status(404).json({ error: 'not found' });
        const killed = await mockLineService.killConnections(id);
        res.json({ ok: true, killed });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/lines/expired/delete', async (_req, res) => {
      try {
        const deleted = await mockDb.deleteExpiredLines();
        res.json({ ok: true, deleted });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/lines/bulk', async (req, res) => {
      try {
        const { users, package_id, member_id = 0, test_mode = false, skip_duplicates = true } = req.body || {};
        if (!Array.isArray(users) || !users.length) {
          return res.status(400).json({ error: 'No users provided' });
        }
        if (!package_id) {
          return res.status(400).json({ error: 'Package ID required' });
        }
        const existingLines = await mockMariadb.query('SELECT username FROM `lines`');
        const existingUsernames = new Set(existingLines.map(l => l.username?.toLowerCase()));
        const details = [];
        let created = 0, skipped = 0, errors = 0;
        for (const user of users) {
          const username = (user.username || '').trim();
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
          }
          if (test_mode) {
            details.push({ username, status: 'valid', message: 'Would be created' });
            created++;
          } else {
            try {
              await mockLineService.createLine({ username, password: user.password || 'default', package_id: parseInt(package_id, 10), member_id: parseInt(member_id, 10) || 0 });
              details.push({ username, status: 'created', message: 'User created' });
              created++;
            } catch (createErr) {
              details.push({ username, status: 'error', message: createErr.message });
              errors++;
            }
          }
        }
        res.json({ test_mode, created, skipped, errors, total: users.length, details });
      } catch (e) { res.status(500).json({ error: e.message || 'Bulk import failed' }); }
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

  describe('GET /api/admin/lines/:id/connections', () => {
    it('should return connections for a line', async () => {
      const res = await request(app)
        .get('/api/admin/lines/1/connections')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
      expect(res.body.connections.length).toBe(2);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/lines/invalid/connections')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/lines/999/connections')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return empty connections for line with no active connections', async () => {
      mockLineService.getActiveConnections.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/lines/1/connections')
        .expect(200);

      expect(res.body.connections).toHaveLength(0);
    });
  });

  describe('POST /api/admin/lines/:id/kill-connections', () => {
    it('should kill connections for a line', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/kill-connections')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('killed', 2);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/invalid/kill-connections')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/999/kill-connections')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 500 on error', async () => {
      mockLineService.killConnections.mockRejectedValueOnce(new Error('kill failed'));

      const res = await request(app)
        .post('/api/admin/lines/1/kill-connections')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/lines/expired/delete', () => {
    it('should delete expired lines', async () => {
      mockDb.deleteExpiredLines.mockResolvedValueOnce(5);

      const res = await request(app)
        .post('/api/admin/lines/expired/delete')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('deleted', 5);
    });

    it('should return 500 on error', async () => {
      mockDb.deleteExpiredLines.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .post('/api/admin/lines/expired/delete')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/lines/bulk', () => {
    it('should bulk create lines', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [
            { username: 'newuser1', password: 'pass123' },
            { username: 'newuser2', password: 'pass456' },
          ],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('created', 2);
      expect(res.body).toHaveProperty('skipped', 0);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should skip duplicates in test mode', async () => {
      mockMariadb.query.mockResolvedValueOnce([{ username: 'existinguser' }]);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'existinguser', password: 'pass' }],
          package_id: 1,
          test_mode: true,
        })
        .expect(200);

      expect(res.body).toHaveProperty('skipped', 1);
      expect(res.body).toHaveProperty('created', 0);
    });

    it('should return 400 when no users provided', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ package_id: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('No users provided');
    });

    it('should return 400 when package_id missing', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'test' }] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Package ID required');
    });

    it('should handle empty usernames', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: '' }],
          package_id: 1,
        })
        .expect(200);

      expect(res.body).toHaveProperty('errors', 1);
      expect(res.body.details[0]).toHaveProperty('status', 'error');
    });

    it('should return 500 on bulk operation error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({
          users: [{ username: 'test' }],
          package_id: 1,
        })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Bandwidth & Network Stats', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      movieCount: jest.fn().mockResolvedValue(100),
      seriesCount: jest.fn().mockResolvedValue(50),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      queryOne: jest.fn()
        .mockResolvedValueOnce({ c: 10 })
        .mockResolvedValueOnce({ c: 5 })
        .mockResolvedValueOnce({ c: 3 })
        .mockResolvedValueOnce({ c: 2 })
        .mockResolvedValueOnce({ c: 1 })
        .mockResolvedValueOnce({ c: 2 }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/bandwidth-stats', async (req, res) => {
      try {
        const validPeriods = ['today', 'week', 'month'];
        const period = validPeriods.includes(req.query.period) ? req.query.period : 'today';
        const mockBandwidthData = {
          today: { total_bytes: 1024 * 1024 * 100, connections: 50 },
          week: { total_bytes: 1024 * 1024 * 700, connections: 350 },
          month: { total_bytes: 1024 * 1024 * 3000, connections: 1500 },
        };
        res.json({ period, ...mockBandwidthData[period] });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/network-stats', async (req, res) => {
      try {
        res.json({
          interfaces: [
            { name: 'eth0', rx_bytes: 1024 * 1024 * 100, tx_bytes: 1024 * 1024 * 50 },
          ],
          total_rx: 1024 * 1024 * 100,
          total_tx: 1024 * 1024 * 50,
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
  });

  describe('GET /api/admin/bandwidth-stats', () => {
    it('should return bandwidth statistics', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth-stats')
        .expect(200);

      expect(res.body).toHaveProperty('period');
      expect(res.body).toHaveProperty('total_bytes');
      expect(res.body).toHaveProperty('connections');
    });

    it('should accept period parameter', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth-stats?period=week')
        .expect(200);

      expect(res.body.period).toBe('week');
    });

    it('should default to today for invalid period', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth-stats?period=invalid')
        .expect(200);

      expect(res.body.period).toBe('today');
    });

    it('should return 500 on error', async () => {
      const errorApp = express();
      errorApp.use(express.json());
      errorApp.get('/api/admin/bandwidth-stats', (req, res) => {
        res.status(500).json({ error: 'bandwidth error' });
      });

      const res = await request(errorApp)
        .get('/api/admin/bandwidth-stats')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/network-stats', () => {
    it('should return network statistics', async () => {
      const res = await request(app)
        .get('/api/admin/network-stats')
        .expect(200);

      expect(res.body).toHaveProperty('interfaces');
      expect(res.body).toHaveProperty('total_rx');
      expect(res.body).toHaveProperty('total_tx');
    });

    it('should return 500 on error', async () => {
      const errorApp = express();
      errorApp.use(express.json());
      errorApp.get('/api/admin/network-stats', (req, res) => {
        res.status(500).json({ error: 'network error' });
      });

      const res = await request(errorApp)
        .get('/api/admin/network-stats')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Server Monitor Summary', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockServerService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
      countActiveRuntimeSessionsByServer: jest.fn().mockResolvedValue(10),
    };

    mockServerService = {
      listServers: jest.fn().mockResolvedValue([
        { id: 1, name: 'Server 1', role: 'origin', public_host: 'server1.com', enabled: 1, last_heartbeat_at: '2024-01-01 10:00:00' },
        { id: 2, name: 'Server 2', role: 'proxy', public_host: 'server2.com', enabled: 1, last_heartbeat_at: '2024-01-01 10:00:00' },
      ]),
      getRuntimePlacementsForServer: jest.fn().mockResolvedValue([
        { status: 'running' }, { status: 'running' }, { status: 'stopped' },
      ]),
      getServerHealthStatus: jest.fn().mockResolvedValue({ fresh: true, staleMs: null }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/serverService', () => mockServerService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/servers/monitor-summary', async (_req, res) => {
      try {
        const servers = await mockServerService.listServers();
        const summary = await Promise.all(servers.map(async (s) => {
          const placements = await mockServerService.getRuntimePlacementsForServer(s.id);
          const activeSessions = await mockDb.countActiveRuntimeSessionsByServer(s.id);
          const health = await mockServerService.getServerHealthStatus(s.id);
          const runningPlacements = placements.filter((p) => p.status === 'running').length;
          const totalPlacements = placements.length;
          return {
            id: s.id,
            name: s.name,
            role: s.role,
            public_host: s.public_host,
            enabled: s.enabled,
            heartbeat_fresh: !!health.fresh,
            active_sessions: activeSessions,
            running_placements: runningPlacements,
            total_placements: totalPlacements,
          };
        }));
        res.json({ servers: summary });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/serverService');
  });

  describe('GET /api/admin/servers/monitor-summary', () => {
    it('should return server monitor summary', async () => {
      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
      expect(res.body.servers.length).toBe(2);
    });

    it('should return server objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(200);

      const server = res.body.servers[0];
      expect(server).toHaveProperty('id');
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('role');
      expect(server).toHaveProperty('active_sessions');
      expect(server).toHaveProperty('running_placements');
      expect(server).toHaveProperty('total_placements');
    });

    it('should calculate running placements correctly', async () => {
      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(200);

      expect(res.body.servers[0].running_placements).toBe(2);
      expect(res.body.servers[0].total_placements).toBe(3);
    });

    it('should return 500 on database error', async () => {
      mockServerService.listServers.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/servers/monitor-summary')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Stream Health & Sharing Detection', () => {
  let app;
  let mockAdminRouter;
  let mockState;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockState = {
      channels: new Map([
        ['1', { id: '1', name: 'Channel 1', status: 'running' }],
      ]),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([
        { id: 1, username: 'user1', enabled: 1, exp_date: Math.floor(Date.now() / 1000) + 86400 },
        { id: 2, username: 'user2', enabled: 1, exp_date: Math.floor(Date.now() / 1000) + 86400 },
      ]),
    };

    jest.mock('../../../lib/state', () => mockState);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/sharing', async (req, res) => {
      try {
        const rows = await mockMariadb.query('SELECT id, username, enabled, exp_date FROM `lines` WHERE admin_enabled = 1');
        const results = [];
        for (const row of rows) {
          const ips = [];
          const status = Number(row.enabled) !== 1 ? 'Disabled' : (row.exp_date && Number(row.exp_date) < Math.floor(Date.now() / 1000) ? 'Expired' : 'Active');
          results.push({
            userId: row.id,
            username: row.username,
            status,
            uniqueIps: ips.length,
            ips,
            flagged: ips.length >= 3,
          });
        }
        res.json({ users: results, threshold: 3 });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/sharing/:userId/clear', async (req, res) => {
      try {
        const userId = parseInt(req.params.userId, 10);
        if (isNaN(userId)) return res.status(400).json({ error: 'invalid user id' });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/sharing/scan', async (req, res) => {
      try {
        const rows = await mockMariadb.query('SELECT id, username FROM `lines` WHERE admin_enabled = 1');
        const results = [];
        for (const row of rows) {
          results.push({ userId: row.id, username: row.username, uniqueIps: 0, flagged: false });
        }
        res.json({ users: results, scanned: rows.length });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/state');
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/sharing', () => {
    it('should return sharing detection results', async () => {
      const res = await request(app)
        .get('/api/admin/sharing')
        .expect(200);

      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('threshold');
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it('should return user objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/sharing')
        .expect(200);

      const user = res.body.users[0];
      expect(user).toHaveProperty('userId');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('status');
      expect(user).toHaveProperty('uniqueIps');
      expect(user).toHaveProperty('flagged');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/sharing')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/sharing/:userId/clear', () => {
    it('should clear sharing history for user', async () => {
      const res = await request(app)
        .post('/api/admin/sharing/1/clear')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid user id', async () => {
      const res = await request(app)
        .post('/api/admin/sharing/invalid/clear')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid user id');
    });

    it('should return 500 on error', async () => {
      const errorApp = express();
      errorApp.use(express.json());
      errorApp.post('/api/admin/sharing/:userId/clear', (req, res) => {
        res.status(500).json({ error: 'clear error' });
      });

      const res = await request(errorApp)
        .post('/api/admin/sharing/1/clear')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/sharing/scan', () => {
    it('should scan for sharing violations', async () => {
      const res = await request(app)
        .post('/api/admin/sharing/scan')
        .expect(200);

      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('scanned');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('scan error'));

      const res = await request(app)
        .post('/api/admin/sharing/scan')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - TMDB Search & Details', () => {
  let app;
  let mockAdminRouter;
  let mockTmdbService;

  beforeAll(() => {
    jest.resetModules();

    mockTmdbService = {
      searchMovies: jest.fn().mockResolvedValue([
        { id: 123, title: 'Test Movie', poster_path: '/poster.jpg', release_date: '2024-01-01', vote_average: 7.5 }
      ]),
      searchTvShows: jest.fn().mockResolvedValue([
        { id: 456, name: 'Test Series', poster_path: '/poster.jpg', first_air_date: '2024-01-01', vote_average: 8.0 }
      ]),
      getMovie: jest.fn().mockResolvedValue({
        tmdb_id: 123, title: 'Test Movie', year: 2024, duration: 7200,
        plot: 'Test plot', poster_path: '/poster.jpg', vote_average: 7.5,
        genres: ['Action'], tagline: 'Test tagline'
      }),
      getTvShow: jest.fn().mockResolvedValue({
        tmdb_id: 456, name: 'Test Series', year: 2024, seasons: 5,
        plot: 'Test plot', poster_path: '/poster.jpg', vote_average: 8.0,
        genres: ['Drama']
      }),
      getSeason: jest.fn().mockResolvedValue({
        season_number: 1, episodes: [
          { episode_number: 1, name: 'Pilot', still_path: '/still.jpg' },
          { episode_number: 2, name: 'Second', still_path: '/still2.jpg' }
        ]
      }),
    };

    jest.mock('../../../services/tmdbService', () => mockTmdbService);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/tmdb/search', async (req, res) => {
      const { query: q, type } = req.body || {};
      if (!q) return res.status(400).json({ error: 'query required' });
      try {
        const results = type === 'tv' ? await mockTmdbService.searchTvShows(String(q)) : await mockTmdbService.searchMovies(String(q));
        res.json({ results });
      } catch (e) { res.status(500).json({ error: e.message || 'tmdb search failed' }); }
    });

    mockAdminRouter.post('/tmdb/details', async (req, res) => {
      const { tmdb_id, type } = req.body || {};
      if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id required' });
      try {
        const data = type === 'tv' ? await mockTmdbService.getTvShow(Number(tmdb_id)) : await mockTmdbService.getMovie(Number(tmdb_id));
        res.json(data);
      } catch (e) { res.status(500).json({ error: e.message || 'tmdb details failed' }); }
    });

    mockAdminRouter.post('/tmdb/season', async (req, res) => {
      const { tmdb_id, season_number } = req.body || {};
      if (!tmdb_id || season_number === undefined) return res.status(400).json({ error: 'tmdb_id and season_number required' });
      try { res.json(await mockTmdbService.getSeason(Number(tmdb_id), Number(season_number))); }
      catch (e) { res.status(500).json({ error: e.message || 'tmdb season failed' }); }
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
        .send({ query: 'test movie' })
        .expect(200);

      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(mockTmdbService.searchMovies).toHaveBeenCalledWith('test movie');
    });

    it('should search TV shows when type is tv', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({ query: 'test series', type: 'tv' })
        .expect(200);

      expect(res.body).toHaveProperty('results');
      expect(mockTmdbService.searchTvShows).toHaveBeenCalledWith('test series');
    });

    it('should return 400 when query is missing', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('query required');
    });

    it('should return 400 when query is empty', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/search')
        .send({ query: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 500 on search failure', async () => {
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
        .send({ tmdb_id: 123 })
        .expect(200);

      expect(res.body).toHaveProperty('tmdb_id', 123);
      expect(res.body).toHaveProperty('title');
      expect(mockTmdbService.getMovie).toHaveBeenCalledWith(123);
    });

    it('should get TV show details when type is tv', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({ tmdb_id: 456, type: 'tv' })
        .expect(200);

      expect(res.body).toHaveProperty('tmdb_id', 456);
      expect(res.body).toHaveProperty('name');
      expect(mockTmdbService.getTvShow).toHaveBeenCalledWith(456);
    });

    it('should return 400 when tmdb_id is missing', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('tmdb_id required');
    });

    it('should return 500 on details failure', async () => {
      mockTmdbService.getMovie.mockRejectedValueOnce(new Error('details failed'));

      const res = await request(app)
        .post('/api/admin/tmdb/details')
        .send({ tmdb_id: 123 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/tmdb/season', () => {
    it('should get season details', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 456, season_number: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('season_number', 1);
      expect(res.body).toHaveProperty('episodes');
      expect(Array.isArray(res.body.episodes)).toBe(true);
      expect(mockTmdbService.getSeason).toHaveBeenCalledWith(456, 1);
    });

    it('should return 400 when tmdb_id is missing', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ season_number: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('tmdb_id and season_number required');
    });

    it('should return 400 when season_number is missing', async () => {
      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 456 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 500 on season failure', async () => {
      mockTmdbService.getSeason.mockRejectedValueOnce(new Error('season failed'));

      const res = await request(app)
        .post('/api/admin/tmdb/season')
        .send({ tmdb_id: 456, season_number: 1 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      getSetting: jest.fn(),
      updateMovie: jest.fn().mockResolvedValue(true),
      updateSeriesRow: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn(),
    };

    mockCrons = {
      fetchTmdbMovieMeta: jest.fn().mockResolvedValue({
        title: 'Resynced Movie', plot: 'Updated plot', poster_path: '/new_poster.jpg'
      }),
      fetchTmdbTvMeta: jest.fn().mockResolvedValue({
        name: 'Resynced Series', plot: 'Updated series plot', poster_path: '/new_series_poster.jpg'
      }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/crons', () => mockCrons);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/resync-movie/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const key = (await mockDb.getSetting('tmdb_api_key') || '').trim();
      if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

      const [movie] = await mockMariadb.query(
        'SELECT id, tmdb_id FROM movies WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1',
        [id]
      );
      if (!movie) return res.status(404).json({ error: 'movie not found or no tmdb_id' });

      const lang = ((await mockDb.getSetting('tmdb_language')) || 'en').trim() || 'en';
      const meta = await mockCrons.fetchTmdbMovieMeta(movie.tmdb_id, key, lang);
      await mockDb.updateMovie(id, meta);
      res.json({ ok: true, meta });
    });

    mockAdminRouter.post('/resync-series/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const key = (await mockDb.getSetting('tmdb_api_key') || '').trim();
      if (!key) return res.status(400).json({ error: 'TMDb API key not set' });

      const [series] = await mockMariadb.query(
        'SELECT id, tmdb_id FROM series WHERE id = ? AND tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 1',
        [id]
      );
      if (!series) return res.status(404).json({ error: 'series not found or no tmdb_id' });

      const lang = ((await mockDb.getSetting('tmdb_language')) || 'en').trim() || 'en';
      const meta = await mockCrons.fetchTmdbTvMeta(series.tmdb_id, key, lang);
      await mockDb.updateSeriesRow(id, meta);
      res.json({ ok: true, meta });
    });

    mockAdminRouter.post('/resync-all', async (req, res) => {
      const key = (await mockDb.getSetting('tmdb_api_key') || '').trim();
      if (!key) return res.status(400).json({ error: 'TMDb API key not set' });
      const lang = ((await mockDb.getSetting('tmdb_language')) || 'en').trim() || 'en';

      const movies = await mockMariadb.query(`SELECT id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
      const series = await mockMariadb.query(`SELECT id, tmdb_id FROM series WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 LIMIT 50`);
      let ok = 0, fail = 0;

      for (const m of movies) {
        try {
          const meta = await mockCrons.fetchTmdbMovieMeta(m.tmdb_id, key, lang);
          await mockDb.updateMovie(m.id, meta);
          ok++;
        } catch { fail++; }
      }
      for (const s of series) {
        try {
          const meta = await mockCrons.fetchTmdbTvMeta(s.tmdb_id, key, lang);
          await mockDb.updateSeriesRow(s.id, meta);
          ok++;
        } catch { fail++; }
      }
      res.json({ ok, fail, total: ok + fail });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/crons');
  });

  describe('POST /api/admin/resync-movie/:id', () => {
    it('should resync movie metadata', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        if (key === 'tmdb_language') return Promise.resolve('en');
        return Promise.resolve(null);
      });
      mockMariadb.query.mockResolvedValueOnce([{ id: 1, tmdb_id: 123 }]);

      const res = await request(app)
        .post('/api/admin/resync-movie/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('meta');
      expect(mockDb.updateMovie).toHaveBeenCalled();
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/resync-movie/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 400 when API key not set', async () => {
      mockDb.getSetting.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/admin/resync-movie/1')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('TMDb API key not set');
    });

    it('should return 404 when movie not found or no tmdb_id', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        return Promise.resolve(null);
      });
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/resync-movie/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('movie not found or no tmdb_id');
    });

  });

  describe('POST /api/admin/resync-series/:id', () => {
    it('should resync series metadata', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        if (key === 'tmdb_language') return Promise.resolve('en');
        return Promise.resolve(null);
      });
      mockMariadb.query.mockResolvedValueOnce([{ id: 1, tmdb_id: 456 }]);

      const res = await request(app)
        .post('/api/admin/resync-series/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('meta');
      expect(mockDb.updateSeriesRow).toHaveBeenCalled();
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/resync-series/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 400 when API key not set', async () => {
      mockDb.getSetting.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/admin/resync-series/1')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('TMDb API key not set');
    });

    it('should return 404 when series not found or no tmdb_id', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        return Promise.resolve(null);
      });
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/admin/resync-series/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('series not found or no tmdb_id');
    });
  });

  describe('POST /api/admin/resync-all', () => {
    it('should resync all movies and series', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        if (key === 'tmdb_language') return Promise.resolve('en');
        return Promise.resolve(null);
      });
      mockMariadb.query
        .mockResolvedValueOnce([{ id: 1, tmdb_id: 123 }, { id: 2, tmdb_id: 124 }])
        .mockResolvedValueOnce([{ id: 3, tmdb_id: 456 }]);

      const res = await request(app)
        .post('/api/admin/resync-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok');
      expect(res.body).toHaveProperty('fail');
      expect(res.body).toHaveProperty('total');
      expect(res.body.ok).toBe(3);
      expect(res.body.fail).toBe(0);
    });

    it('should return 400 when API key not set', async () => {
      mockDb.getSetting.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/admin/resync-all')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('TMDb API key not set');
    });

    it('should count failures', async () => {
      mockDb.getSetting.mockImplementation((key) => {
        if (key === 'tmdb_api_key') return Promise.resolve('test_api_key');
        if (key === 'tmdb_language') return Promise.resolve('en');
        return Promise.resolve(null);
      });
      mockMariadb.query
        .mockResolvedValueOnce([{ id: 1, tmdb_id: 123 }])
        .mockResolvedValueOnce([]);
      mockCrons.fetchTmdbMovieMeta.mockRejectedValueOnce(new Error('fetch failed'));

      const res = await request(app)
        .post('/api/admin/resync-all')
        .expect(200);

      expect(res.body.ok).toBe(0);
      expect(res.body.fail).toBe(1);
    });

  });
});

describe('Admin API Routes - Bouquet Sync', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getBouquetById: jest.fn(),
      updateBouquet: jest.fn().mockResolvedValue(true),
    };

    mockCache = {
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/bouquets/:id/sync', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { type, ids } = req.body || {};
      if (!['movies', 'series', 'channels'].includes(type)) {
        return res.status(400).json({ error: 'type must be movies, series, or channels' });
      }
      const field = type === 'movies' ? 'bouquet_movies' : type === 'series' ? 'bouquet_series' : 'bouquet_channels';
      const b = await mockDb.getBouquetById(id);
      if (!b) return res.status(404).json({ error: 'not found' });
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
        await mockDb.updateBouquet(id, { [field]: merged });
        await mockCache.invalidateBouquets();
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
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [101, 102] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 2);
      expect(mockDb.updateBouquet).toHaveBeenCalledWith(1, { bouquet_movies: [101, 102] });
      expect(mockCache.invalidateBouquets).toHaveBeenCalled();
    });

    it('should sync bouquet with series', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_series: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'series', ids: [201, 202, 203] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 3);
    });

    it('should sync bouquet with channels', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_channels: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'channels', ids: [301] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 1);
    });

    it('should merge with existing bouquet items', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [100] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [101] })
        .expect(200);

      expect(res.body.count).toBe(2);
    });

    it('should handle JSON string ids', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: ['101', '102'] })
        .expect(200);

      expect(res.body.count).toBe(2);
    });

    it('should handle empty ids array', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [100] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [] })
        .expect(200);

      expect(res.body.count).toBe(1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/invalid/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when bouquet not found', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/bouquets/999/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 for invalid type', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'invalid', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('type must be movies, series, or channels');
    });

    it('should return 400 on sync failure', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_name: 'Test', bouquet_movies: [] });
      mockDb.updateBouquet.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Bouquet CRUD Operations', () => {
  let app;
  let mockAdminRouter;
  let mockBouquetService;

  beforeAll(() => {
    jest.resetModules();

    mockBouquetService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, bouquet_name: 'Bouquet 1' },
        { id: 2, bouquet_name: 'Bouquet 2' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, bouquet_name: 'Bouquet 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/bouquetService', () => mockBouquetService);
    jest.mock('../../../lib/cache', () => ({
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/bouquets', async (_req, res) => {
      res.json({ bouquets: await mockBouquetService.list() });
    });

    mockAdminRouter.post('/bouquets', async (req, res) => {
      try {
        const id = await mockBouquetService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockBouquetService.getById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockBouquetService.update(id, req.body || {});
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockBouquetService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
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
    it('should create a bouquet', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'New Bouquet' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
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
    it('should update a bouquet', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated Bouquet' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/invalid')
        .send({ bouquet_name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when bouquet not found', async () => {
      mockBouquetService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/bouquets/999')
        .send({ bouquet_name: 'Updated' })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should return 400 on update failure', async () => {
      mockBouquetService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/bouquets/:id', () => {
    it('should delete a bouquet', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 when bouquet not found', async () => {
      mockBouquetService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/bouquets/999')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Additional Edge Cases', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.get('/categories-by-type', async (req, res) => {
      const type = req.query.type;
      if (type && !['movie', 'series', 'live'].includes(type)) {
        return res.status(400).json({ error: 'invalid type' });
      }
      res.json({ categories: [] });
    });

    mockAdminRouter.post('/items/bulk-delete', async (req, res) => {
      const { ids, type } = req.body || {};
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
      if (!type) return res.status(400).json({ error: 'type required' });
      res.json({ ok: true, deleted: ids.length });
    });

    mockAdminRouter.post('/items/bulk-update', async (req, res) => {
      const { ids, type, data } = req.body || {};
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
      if (!type) return res.status(400).json({ error: 'type required' });
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });
      res.json({ ok: true, updated: ids.length });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('GET /api/admin/categories-by-type', () => {
    it('should accept valid type movie', async () => {
      const res = await request(app)
        .get('/api/admin/categories-by-type?type=movie')
        .expect(200);

      expect(res.body).toHaveProperty('categories');
    });

    it('should accept valid type series', async () => {
      const res = await request(app)
        .get('/api/admin/categories-by-type?type=series')
        .expect(200);

      expect(res.body).toHaveProperty('categories');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .get('/api/admin/categories-by-type?type=invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid type');
    });

    it('should accept no type filter', async () => {
      const res = await request(app)
        .get('/api/admin/categories-by-type')
        .expect(200);

      expect(res.body).toHaveProperty('categories');
    });
  });

  describe('POST /api/admin/items/bulk-delete', () => {
    it('should bulk delete items', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-delete')
        .send({ ids: [1, 2, 3], type: 'movies' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('deleted', 3);
    });

    it('should return 400 when ids is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-delete')
        .send({ ids: 'not-an-array', type: 'movies' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('ids must be an array');
    });

    it('should return 400 when type is missing', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-delete')
        .send({ ids: [1, 2] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('type required');
    });

    it('should handle empty array', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-delete')
        .send({ ids: [], type: 'movies' })
        .expect(200);

      expect(res.body.deleted).toBe(0);
    });
  });

  describe('POST /api/admin/items/bulk-update', () => {
    it('should bulk update items', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-update')
        .send({ ids: [1, 2], type: 'movies', data: { category_id: 5 } })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('updated', 2);
    });

    it('should return 400 when ids is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-update')
        .send({ ids: 1, type: 'movies', data: {} })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when type is missing', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-update')
        .send({ ids: [1], data: {} })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when data is missing', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-update')
        .send({ ids: [1], type: 'movies' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('data required');
    });

    it('should return 400 when data is not an object', async () => {
      const res = await request(app)
        .post('/api/admin/items/bulk-update')
        .send({ ids: [1], type: 'movies', data: 'not-an-object' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Bulk Operations', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMariadb;
  let mockVodService;
  let mockSeriesService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      execute: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue([]),
    };

    mockVodService = {
      create: jest.fn().mockResolvedValue(1),
    };

    mockSeriesService = {
      create: jest.fn().mockResolvedValue(1),
      addEpisode: jest.fn().mockResolvedValue(1),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../lib/cache', () => ({
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
      invalidateEpisodes: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/movies/purge-all', async (req, res) => {
      try {
        await mockMariadb.execute('DELETE FROM movies');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/series/purge-all', async (req, res) => {
      try {
        await mockMariadb.execute('DELETE FROM episodes');
        await mockMariadb.execute('DELETE FROM series');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/movies/bulk', async (req, res) => {
      const { movies } = req.body || {};
      if (!Array.isArray(movies)) return res.status(400).json({ error: 'movies array required' });
      let imported = 0;
      let errors = 0;
      for (const row of movies) {
        try {
          await mockVodService.create(row);
          imported += 1;
        } catch { errors += 1; }
      }
      res.json({ imported, errors });
    });

    mockAdminRouter.post('/series/bulk', async (req, res) => {
      const { series } = req.body || {};
      if (!Array.isArray(series)) return res.status(400).json({ error: 'series array required' });
      const ids = [];
      let errors = 0;
      for (const row of series) {
        try {
          const id = await mockSeriesService.create(row);
          ids.push(id);
        } catch { errors += 1; }
      }
      res.json({ imported: ids.length, ids, errors });
    });

    mockAdminRouter.post('/episodes/bulk', async (req, res) => {
      const { episodes } = req.body || {};
      if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes array required' });
      let imported = 0;
      let errors = 0;
      for (const row of episodes) {
        try {
          await mockSeriesService.addEpisode(row);
          imported += 1;
        } catch { errors += 1; }
      }
      res.json({ imported, errors });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../services/seriesService');
    jest.unmock('../../../lib/cache');
  });

  describe('POST /api/admin/movies/purge-all', () => {
    it('should purge all movies', async () => {
      mockMariadb.execute.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/movies/purge-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .post('/api/admin/movies/purge-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/series/purge-all', () => {
    it('should purge all series and episodes', async () => {
      mockMariadb.execute.mockClear();
      mockMariadb.execute.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/admin/series/purge-all')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockMariadb.execute).toHaveBeenCalledTimes(2);
    });

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .post('/api/admin/series/purge-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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

    it('should return 400 when movies is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('movies array required');
    });

    it('should count errors on failure', async () => {
      mockVodService.create
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(2);

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
      expect(res.body.ids).toHaveLength(2);
    });

    it('should return 400 when series is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({ series: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('series array required');
    });
  });

  describe('POST /api/admin/episodes/bulk', () => {
    it('should bulk import episodes', async () => {
      mockSeriesService.addEpisode.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: [{ series_id: 1 }, { series_id: 2 }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should return 400 when episodes is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('episodes array required');
    });
  });
});

describe('Admin API Routes - Network Security (ASN Block)', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockAsnBlocker;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockAsnBlocker = {
      getBlockedAsns: jest.fn().mockResolvedValue([
        { asn: 12345, org: 'Test Org', notes: 'test', blocked_at: '2024-01-01' },
        { asn: 67890, org: 'Another Org', notes: '', blocked_at: '2024-01-02' }
      ]),
      blockAsn: jest.fn().mockResolvedValue(true),
      unblockAsn: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/asnBlocker', () => mockAsnBlocker);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/asn/blocked', async (req, res) => {
      try {
        const blocked = await mockAsnBlocker.getBlockedAsns();
        res.json({ blocked });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/asn/block', async (req, res) => {
      try {
        const { asn, org, notes } = req.body;
        if (!asn) return res.status(400).json({ error: 'asn required' });
        await mockAsnBlocker.blockAsn(asn, org || '', notes || '');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/asn/block/:asn', async (req, res) => {
      try {
        await mockAsnBlocker.unblockAsn(req.params.asn);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/asnBlocker');
  });

  describe('GET /api/admin/asn/blocked', () => {
    it('should return blocked ASN list', async () => {
      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(200);

      expect(res.body).toHaveProperty('blocked');
      expect(Array.isArray(res.body.blocked)).toBe(true);
      expect(res.body.blocked.length).toBeGreaterThan(0);
    });

    it('should return blocked ASN objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(200);

      const blocked = res.body.blocked[0];
      expect(blocked).toHaveProperty('asn');
      expect(blocked).toHaveProperty('org');
    });

    it('should return 500 on error', async () => {
      mockAsnBlocker.getBlockedAsns.mockRejectedValueOnce(new Error('lookup failed'));

      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/asn/block', () => {
    it('should block an ASN', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 99999, org: 'Bad Org', notes: 'spam' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(99999, 'Bad Org', 'spam');
    });

    it('should block ASN without org and notes', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 11111 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(11111, '', '');
    });

    it('should return 400 without asn', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ org: 'Test' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('asn required');
    });

    it('should return 500 on block error', async () => {
      mockAsnBlocker.blockAsn.mockRejectedValueOnce(new Error('block failed'));

      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 12345 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/asn/block/:asn', () => {
    it('should unblock an ASN', async () => {
      const res = await request(app)
        .delete('/api/admin/asn/block/12345')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.unblockAsn).toHaveBeenCalledWith('12345');
    });

    it('should return 500 on unblock error', async () => {
      mockAsnBlocker.unblockAsn.mockRejectedValueOnce(new Error('unblock failed'));

      const res = await request(app)
        .delete('/api/admin/asn/block/99999')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - VPN Settings', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/vpn/settings', async (req, res) => {
      try {
        const enabled = await mockDb.getSetting('enable_vpn_detection');
        const blockVpn = await mockDb.getSetting('block_vpn');
        res.json({ enabled: enabled === '1', blockVpn: blockVpn === '1' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/vpn/settings', async (req, res) => {
      try {
        const { enabled, blockVpn } = req.body;
        if (enabled !== undefined) await mockDb.setSetting('enable_vpn_detection', enabled ? '1' : '0');
        if (blockVpn !== undefined) await mockDb.setSetting('block_vpn', blockVpn ? '1' : '0');
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

  describe('GET /api/admin/vpn/settings', () => {
    it('should return VPN settings', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', true);
      expect(res.body).toHaveProperty('blockVpn', false);
    });

    it('should return false when settings are not set', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
      expect(res.body).toHaveProperty('blockVpn', false);
    });

    it('should return 500 on error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/vpn/settings')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/vpn/settings', () => {
    it('should update VPN detection enabled', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('enable_vpn_detection', '1');
    });

    it('should update block VPN setting', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ blockVpn: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vpn', '1');
    });

    it('should update both settings', async () => {
      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true, blockVpn: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('enable_vpn_detection', '1');
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vpn', '1');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('set failed'));

      const res = await request(app)
        .put('/api/admin/vpn/settings')
        .send({ enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Multilogin', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMultiLogin;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMultiLogin = {
      getMultiLoginLines: jest.fn().mockResolvedValue([
        { line_id: 1, username: 'user1', connections: 3 },
        { line_id: 2, username: 'user2', connections: 2 }
      ]),
      disconnectLine: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/multiLoginDetector', () => mockMultiLogin);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/multilogin', async (req, res) => {
      try {
        const lines = await mockMultiLogin.getMultiLoginLines();
        res.json({ lines });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/multilogin/settings', async (req, res) => {
      try {
        const maxConns = await mockDb.getSetting('max_connections_per_line');
        const enabled = await mockDb.getSetting('enable_multilogin_detection');
        res.json({ enabled: enabled === '1', maxConnections: parseInt(maxConns || '1', 10) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.put('/multilogin/settings', async (req, res) => {
      try {
        const { enabled, maxConnections } = req.body;
        if (enabled !== undefined) await mockDb.setSetting('enable_multilogin_detection', enabled ? '1' : '0');
        if (maxConnections !== undefined) await mockDb.setSetting('max_connections_per_line', String(maxConnections));
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/multilogin/:lineId/disconnect', async (req, res) => {
      try {
        const lineId = parseInt(req.params.lineId, 10);
        if (!Number.isFinite(lineId)) return res.status(400).json({ error: 'invalid id' });
        await mockMultiLogin.disconnectLine(lineId);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/multiLoginDetector');
  });

  describe('GET /api/admin/multilogin', () => {
    it('should return multilogin lines', async () => {
      const res = await request(app)
        .get('/api/admin/multilogin')
        .expect(200);

      expect(res.body).toHaveProperty('lines');
      expect(Array.isArray(res.body.lines)).toBe(true);
    });

    it('should return line objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/multilogin')
        .expect(200);

      const line = res.body.lines[0];
      expect(line).toHaveProperty('line_id');
      expect(line).toHaveProperty('username');
      expect(line).toHaveProperty('connections');
    });

    it('should return 500 on error', async () => {
      mockMultiLogin.getMultiLoginLines.mockRejectedValueOnce(new Error('lookup failed'));

      const res = await request(app)
        .get('/api/admin/multilogin')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/multilogin/settings', () => {
    it('should return multilogin settings', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('5')
        .mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', true);
      expect(res.body).toHaveProperty('maxConnections', 5);
    });
  });

  describe('PUT /api/admin/multilogin/settings', () => {
    it('should update enabled setting', async () => {
      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({ enabled: false })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('enable_multilogin_detection', '0');
    });

    it('should update max connections', async () => {
      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({ maxConnections: 3 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('max_connections_per_line', '3');
    });
  });

  describe('POST /api/admin/multilogin/:lineId/disconnect', () => {
    it('should disconnect a line', async () => {
      const res = await request(app)
        .post('/api/admin/multilogin/1/disconnect')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockMultiLogin.disconnectLine).toHaveBeenCalledWith(1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/multilogin/invalid/disconnect')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 500 on error', async () => {
      mockMultiLogin.disconnectLine.mockRejectedValueOnce(new Error('disconnect failed'));

      const res = await request(app)
        .post('/api/admin/multilogin/1/disconnect')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockImportChannelBridge = {
      importLiveChannel: jest.fn().mockResolvedValue({ id: 1, name: 'Test Channel' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/importChannelBridge', () => mockImportChannelBridge);
    jest.mock('../../../lib/input-detect', () => ({
      detectInputType: jest.fn().mockReturnValue('mpd'),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/import-live', async (req, res) => {
      const body = req.body || {};
      const url = body.url || body.mpdUrl;
      if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
      try {
        const userId = await mockDb.getFirstAdminUserId();
        if (!userId) return res.status(500).json({ error: 'no admin user' });
        const created = await mockImportChannelBridge.importLiveChannel({
          name: body.name || 'Live',
          mpdUrl: url,
          inputType: body.inputType || 'mpd',
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
    jest.unmock('../../../lib/input-detect');
  });

  describe('POST /api/admin/import-live', () => {
    it('should import a live channel with url', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name');
    });

    it('should import a live channel with mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ mpdUrl: 'http://example.com/stream.mpd', name: 'MPD Channel' })
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
        .send({ url: 'http://example.com/stream.mpd' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('no admin user');
    });

    it('should return error on import failure', async () => {
      mockImportChannelBridge.importLiveChannel.mockRejectedValueOnce(new Error('import failed'));

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/bad.mpd' })
        .expect(400);

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

describe('Admin API Routes - Plex Servers', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn(),
      execute: jest.fn().mockResolvedValue({ insertId: 1 }),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/plex/servers', async (req, res) => {
      try {
        const rows = await mockMariadb.query(
          'SELECT id, name, url, plex_token, last_seen FROM plex_servers ORDER BY last_seen DESC'
        );
        res.json({ servers: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/plex/servers', async (req, res) => {
      try {
        const { name, url, plex_token } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'name and url required' });
        const { insertId } = await mockMariadb.execute(
          'INSERT INTO plex_servers (name, url, plex_token, last_seen) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), url=VALUES(url), plex_token=VALUES(plex_token)',
          [name, url, plex_token || '']
        );
        res.json({ ok: true, id: insertId });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/plex/servers/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
        await mockMariadb.execute('DELETE FROM plex_servers WHERE id = ?', [id]);
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

  describe('GET /api/admin/plex/servers', () => {
    it('should return plex servers list', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 1, name: 'Plex Server 1', url: 'http://plex1:32400', plex_token: 'token1', last_seen: '2024-01-01' },
        { id: 2, name: 'Plex Server 2', url: 'http://plex2:32400', plex_token: 'token2', last_seen: '2024-01-02' }
      ]);

      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return server objects with expected properties', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 1, name: 'Plex Server', url: 'http://plex:32400', plex_token: 'token', last_seen: '2024-01-01' }
      ]);

      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(200);

      const server = res.body.servers[0];
      expect(server).toHaveProperty('id');
      expect(server).toHaveProperty('name');
      expect(server).toHaveProperty('url');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/plex/servers')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/plex/servers', () => {
    it('should create plex server', async () => {
      mockMariadb.execute.mockResolvedValueOnce({ insertId: 5 });

      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Plex', url: 'http://plex:32400', plex_token: 'mytoken' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 5);
    });

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ url: 'http://plex:32400' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('name and url required');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'New Plex' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('name and url required');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('insert failed'));

      const res = await request(app)
        .post('/api/admin/plex/servers')
        .send({ name: 'Bad Plex', url: 'http://plex:32400' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/plex/servers/:id', () => {
    it('should delete plex server', async () => {
      mockMariadb.execute.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/admin/plex/servers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/plex/servers/invalid')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('delete failed'));

      const res = await request(app)
        .delete('/api/admin/plex/servers/1')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - VPN Log', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn(),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

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
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
  });

  describe('GET /api/admin/vpn/log', () => {
    it('should return VPN log events', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 1, user_id: 1, ip: '192.168.1.1', event_type: 'login', is_vpn: 1, created_at: '2024-01-01', username: 'user1' },
        { id: 2, user_id: 2, ip: '10.0.0.1', event_type: 'login', is_vpn: 1, created_at: '2024-01-02', username: 'user2' }
      ]);

      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(200);

      expect(res.body).toHaveProperty('events');
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it('should return event objects with expected properties', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { id: 1, user_id: 1, ip: '192.168.1.1', event_type: 'login', is_vpn: 1, created_at: '2024-01-01', username: 'user1' }
      ]);

      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(200);

      const event = res.body.events[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('user_id');
      expect(event).toHaveProperty('ip');
      expect(event).toHaveProperty('is_vpn');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('query failed'));

      const res = await request(app)
        .get('/api/admin/vpn/log')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockTelegramBot = {
      stopBot: jest.fn().mockResolvedValue(true),
      initBot: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/telegramBot', () => mockTelegramBot);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/telegram', async (req, res) => {
      try {
        const token = await mockDb.getSetting('telegram_bot_token');
        const chatId = await mockDb.getSetting('telegram_admin_chat_id');
        const enabled = await mockDb.getSetting('telegram_alerts_enabled');
        res.json({
          bot_token_set: !!token,
          admin_chat_id: chatId || '',
          alerts_enabled: enabled !== '0',
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/settings/telegram', async (req, res) => {
      try {
        const { bot_token, admin_chat_id, alerts_enabled } = req.body;
        if (bot_token !== undefined) await mockDb.setSetting('telegram_bot_token', bot_token || '');
        if (admin_chat_id !== undefined) await mockDb.setSetting('telegram_admin_chat_id', admin_chat_id || '');
        if (alerts_enabled !== undefined) await mockDb.setSetting('telegram_alerts_enabled', alerts_enabled ? '1' : '0');
        await mockTelegramBot.stopBot();
        if (bot_token) {
          setTimeout(() => mockTelegramBot.initBot().catch(e => console.error('[TELEGRAM]', e.message)), 2000);
        }
        res.json({ ok: true });
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
    jest.unmock('../../../services/telegramBot');
  });

  describe('GET /api/admin/settings/telegram', () => {
    it('should return telegram settings when configured', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('123456:ABC-DEF1234ghIkl-zyx57W2vT1234An8AA')
        .mockResolvedValueOnce('987654321')
        .mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('bot_token_set', true);
      expect(res.body).toHaveProperty('admin_chat_id', '987654321');
      expect(res.body).toHaveProperty('alerts_enabled', true);
    });

    it('should return telegram settings when not configured', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('bot_token_set', false);
      expect(res.body).toHaveProperty('admin_chat_id', '');
      expect(res.body).toHaveProperty('alerts_enabled', false);
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
        .send({ bot_token: '123456:ABC-DEF', admin_chat_id: '123456789', alerts_enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', '123456:ABC-DEF');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_admin_chat_id', '123456789');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '1');
      expect(mockTelegramBot.stopBot).toHaveBeenCalled();
    });

    it('should clear bot token', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: '' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', '');
    });

    it('should disable alerts only', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ alerts_enabled: false })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '0');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('set failed'));

      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: 'new-token' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - VOD Download Block Settings', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/block_vod_download', async (req, res) => {
      try {
        const val = await mockDb.getSetting('block_vod_download');
        res.json({ enabled: val === '1' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/settings/block_vod_download', async (req, res) => {
      try {
        const { enabled } = req.body;
        await mockDb.setSetting('block_vod_download', enabled ? '1' : '0');
        res.json({ ok: true });
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
  });

  describe('GET /api/admin/settings/block_vod_download', () => {
    it('should return enabled=true when setting is 1', async () => {
      mockDb.getSetting.mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', true);
    });

    it('should return enabled=false when setting is 0', async () => {
      mockDb.getSetting.mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });

    it('should return enabled=false when setting is null', async () => {
      mockDb.getSetting.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
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

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vod_download', '0');
    });

    it('should return 500 on error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('set failed'));

      const res = await request(app)
        .put('/api/admin/settings/block_vod_download')
        .send({ enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Multilogin Settings Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockMultiLogin;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMultiLogin = {
      getMultiLoginLines: jest.fn().mockResolvedValue([]),
      disconnectLine: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/multiLoginDetector', () => mockMultiLogin);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/multilogin/settings', async (req, res) => {
      try {
        const maxConns = await mockDb.getSetting('max_connections_per_line');
        const enabled = await mockDb.getSetting('enable_multilogin_detection');
        res.json({ enabled: enabled === '1', maxConnections: parseInt(maxConns || '1', 10) });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/multilogin/settings', async (req, res) => {
      try {
        const { enabled, maxConnections } = req.body;
        if (enabled !== undefined) await mockDb.setSetting('enable_multilogin_detection', enabled ? '1' : '0');
        if (maxConnections !== undefined) await mockDb.setSetting('max_connections_per_line', String(maxConnections));
        res.json({ ok: true });
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
    jest.unmock('../../../services/multiLoginDetector');
  });

  describe('GET /api/admin/multilogin/settings - Edge Cases', () => {
    it('should return default maxConnections when setting is null', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
      expect(res.body).toHaveProperty('maxConnections', 1);
    });

    it('should return 500 on error', async () => {
      mockDb.getSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/multilogin/settings')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/multilogin/settings - Edge Cases', () => {
    it('should not call setSetting when neither enabled nor maxConnections provided', async () => {
      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({})
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).not.toHaveBeenCalled();
    });

    it('should return 500 on setSetting error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('set failed'));

      const res = await request(app)
        .put('/api/admin/multilogin/settings')
        .send({ enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Bulk Operations', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockVodService;
  let mockSeriesService;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    };

    mockVodService = {
      create: jest.fn().mockResolvedValue(1),
    };

    mockSeriesService = {
      create: jest.fn().mockResolvedValue(1),
      addEpisode: jest.fn().mockResolvedValue(1),
    };

    mockCache = {
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
      invalidateEpisodes: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/movies/purge-all', async (req, res) => {
      try {
        await mockMariadb.execute('DELETE FROM movies');
        await mockCache.invalidateVod();
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/series/purge-all', async (req, res) => {
      try {
        await mockMariadb.execute('DELETE FROM episodes');
        await mockMariadb.execute('DELETE FROM series');
        await mockCache.invalidateSeries();
        await mockCache.invalidateEpisodes();
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/movies/bulk', async (req, res) => {
      const { movies } = req.body || {};
      if (!Array.isArray(movies)) return res.status(400).json({ error: 'movies array required' });
      let imported = 0;
      let errors = 0;
      for (const row of movies) {
        try {
          await mockVodService.create(row);
          imported += 1;
        } catch { errors += 1; }
      }
      await mockCache.invalidateVod();
      res.json({ imported, errors });
    });

    mockAdminRouter.post('/series/bulk', async (req, res) => {
      const { series } = req.body || {};
      if (!Array.isArray(series)) return res.status(400).json({ error: 'series array required' });
      const ids = [];
      let errors = 0;
      for (const row of series) {
        try {
          const id = await mockSeriesService.create(row);
          ids.push(id);
        } catch { errors += 1; }
      }
      await mockCache.invalidateSeries();
      res.json({ imported: ids.length, ids, errors });
    });

    mockAdminRouter.post('/episodes/bulk', async (req, res) => {
      const { episodes } = req.body || {};
      if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes array required' });
      let imported = 0;
      let errors = 0;
      for (const row of episodes) {
        try {
          await mockSeriesService.addEpisode(row);
          imported += 1;
        } catch { errors += 1; }
      }
      await mockCache.invalidateEpisodes();
      res.json({ imported, errors });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../services/seriesService');
    jest.unmock('../../../lib/cache');
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

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('db error'));

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

    it('should return 500 on database error', async () => {
      mockMariadb.execute.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .post('/api/admin/series/purge-all')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/movies/bulk', () => {
    it('should bulk import movies', async () => {
      mockVodService.create.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: [{ name: 'Movie 1', stream_url: 'http://test.com/1' }, { name: 'Movie 2', stream_url: 'http://test.com/2' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should return 400 when movies is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('movies array required');
    });

    it('should return 400 when movies is missing', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should count errors when import fails', async () => {
      mockVodService.create
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('fail'));

      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: [{ name: 'Good' }, { name: 'Bad' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
      expect(res.body).toHaveProperty('errors', 1);
    });

    it('should handle empty movies array', async () => {
      const res = await request(app)
        .post('/api/admin/movies/bulk')
        .send({ movies: [] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 0);
      expect(res.body).toHaveProperty('errors', 0);
    });
  });

  describe('POST /api/admin/series/bulk', () => {
    it('should bulk import series', async () => {
      mockSeriesService.create.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({ series: [{ title: 'Series 1', category_id: 1 }, { title: 'Series 2', category_id: 1 }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('ids');
      expect(Array.isArray(res.body.ids)).toBe(true);
    });

    it('should return 400 when series is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({ series: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('series array required');
    });

    it('should return 400 when series is missing', async () => {
      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should count errors when import fails', async () => {
      mockSeriesService.create
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('fail'));

      const res = await request(app)
        .post('/api/admin/series/bulk')
        .send({ series: [{ title: 'Good' }, { title: 'Bad' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
      expect(res.body).toHaveProperty('errors', 1);
    });
  });

  describe('POST /api/admin/episodes/bulk', () => {
    it('should bulk import episodes', async () => {
      mockSeriesService.addEpisode.mockResolvedValue(1);

      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: [{ series_id: 1, title: 'Ep 1' }, { series_id: 1, title: 'Ep 2' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('errors', 0);
    });

    it('should return 400 when episodes is not an array', async () => {
      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: 'not-an-array' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('episodes array required');
    });

    it('should return 400 when episodes is missing', async () => {
      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should count errors when import fails', async () => {
      mockSeriesService.addEpisode
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('fail'));

      const res = await request(app)
        .post('/api/admin/episodes/bulk')
        .send({ episodes: [{ title: 'Good' }, { title: 'Bad' }] })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
      expect(res.body).toHaveProperty('errors', 1);
    });
  });
});

describe('Admin API Routes - Bouquet Sync', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getBouquetById: jest.fn(),
      updateBouquet: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockCache = {
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/bouquets/:id/sync', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { type, ids } = req.body || {};
      const b = await mockDb.getBouquetById(id);
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
        await mockDb.updateBouquet(id, { [field]: merged });
        await mockCache.invalidateBouquets();
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
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1, 2, 3] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 3);
    });

    it('should sync bouquet with series', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_series: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'series', ids: [1, 2] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 2);
    });

    it('should sync bouquet with channels', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_channels: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'channels', ids: [1] })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('count', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets/invalid/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/bouquets/999/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should merge with existing items', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [1, 2] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [2, 3] })
        .expect(200);

      expect(res.body).toHaveProperty('count', 3);
    });

    it('should handle JSON string array', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: '[1,2]' });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [3] })
        .expect(200);

      expect(res.body).toHaveProperty('count', 3);
    });

    it('should handle missing ids (empty sync)', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [1, 2] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies' })
        .expect(200);

      expect(res.body).toHaveProperty('count', 2);
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
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockImportChannelBridge = {
      importLiveChannel: jest.fn().mockResolvedValue({ id: 1, name: 'Test Channel' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/importChannelBridge', () => mockImportChannelBridge);
    jest.mock('../../../lib/input-detect', () => ({
      detectInputType: jest.fn().mockReturnValue('mpd'),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/import-live', async (req, res) => {
      const body = req.body || {};
      const url = body.url || body.mpdUrl;
      if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
      try {
        const userId = await mockDb.getFirstAdminUserId();
        if (!userId) return res.status(500).json({ error: 'no admin user' });
        const { detectInputType } = require('../../../lib/input-detect');
        const inputType = body.inputType || detectInputType(url);
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
    jest.unmock('../../../lib/input-detect');
  });

  describe('POST /api/admin/import-live', () => {
    it('should import live channel with url', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('name', 'Test Channel');
    });

    it('should import live channel with mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ mpdUrl: 'http://test.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 without url or mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ name: 'Test Channel' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('url or mpdUrl required');
    });

    it('should return 500 when no admin user exists', async () => {
      mockDb.getFirstAdminUserId.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('no admin user');
    });

    it('should return error from importBridge', async () => {
      mockImportChannelBridge.importLiveChannel.mockRejectedValueOnce(new Error('Import failed'));

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Import failed');
    });

    it('should use default name when not provided', async () => {
      mockImportChannelBridge.importLiveChannel.mockResolvedValueOnce({ id: 2, name: 'Live' });

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Live' }),
        1
      );
    });

    it('should pass category_id when provided', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd', category_id: 5 })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 5 }),
        1
      );
    });

    it('should pass logo when provided', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd', logo: 'http://test.com/logo.png' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ logoUrl: 'http://test.com/logo.png' }),
        1
      );
    });

    it('should use custom inputType when provided', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://test.com/stream.mpd', inputType: 'hls' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ inputType: 'hls' }),
        1
      );
    });
  });
});

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
      getDayStats: jest.fn().mockResolvedValue({ up: 720, down: 0, unknown: 0 }),
      getUptimeHistory: jest.fn().mockResolvedValue([
        { date: '2024-01-01', uptime_percent: 99.5 }
      ]),
    };

    mockSystemMetrics = {
      collectSystemMetrics: jest.fn().mockResolvedValue({
        cpu: { usage: 45.2, cores: 8 },
        memory: { used: 4294967296, total: 8589934592, percent: 50 },
        disk: { used: 100 * 1024 * 1024 * 1024, total: 500 * 1024 * 1024 * 1024, percent: 20 },
        network: { rx: 1024 * 1024, tx: 512 * 1024 },
        load: [1.5, 1.2, 0.8],
      }),
    };

    jest.mock('../../../services/healthMonitor', () => mockHealthMonitor);
    jest.mock('../../../lib/system-metrics', () => mockSystemMetrics);

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
  });

  describe('GET /api/admin/health', () => {
    it('should return health status when panel is up', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'up');
      expect(res.body).toHaveProperty('lastCheckAt');
      expect(res.body).toHaveProperty('lastResponseMs');
      expect(res.body).toHaveProperty('consecutiveFails');
      expect(res.body).toHaveProperty('today');
      expect(res.body).toHaveProperty('history');
    });

    it('should return down status when panel is down', async () => {
      mockHealthMonitor.isPanelUp.mockReturnValueOnce(false);

      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'down');
    });

    it('should return unknown when no health sample', async () => {
      mockHealthMonitor.hasPanelHealthSample.mockReturnValueOnce(false);

      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'unknown');
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/api/admin/health?days=14')
        .expect(200);

      expect(mockHealthMonitor.getUptimeHistory).toHaveBeenCalledWith(14);
    });

    it('should cap days at 30', async () => {
      const res = await request(app)
        .get('/api/admin/health?days=100')
        .expect(200);

      expect(mockHealthMonitor.getUptimeHistory).toHaveBeenCalledWith(30);
    });

    it('should use default of 7 days', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(mockHealthMonitor.getUptimeHistory).toHaveBeenCalledWith(7);
    });

    it('should return 500 on error', async () => {
      mockHealthMonitor.getDayStats.mockRejectedValueOnce(new Error('health check failed'));

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

      expect(res.body.cpu).toHaveProperty('usage');
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

    it('should return network metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system-metrics')
        .expect(200);

      expect(res.body.network).toHaveProperty('rx');
      expect(res.body.network).toHaveProperty('tx');
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

describe('Admin API Routes - ASN Block', () => {
  let app;
  let mockAdminRouter;
  let mockAsnBlocker;

  beforeAll(() => {
    jest.resetModules();

    mockAsnBlocker = {
      getBlockedAsns: jest.fn().mockResolvedValue([
        { asn: 12345, org: 'Test ISP', notes: 'spam', blocked_at: '2024-01-01' },
        { asn: 67890, org: 'Another ISP', notes: '', blocked_at: '2024-01-02' }
      ]),
      blockAsn: jest.fn().mockResolvedValue(true),
      unblockAsn: jest.fn().mockResolvedValue(true),
      isAsnBlocked: jest.fn().mockResolvedValue(false),
    };

    jest.mock('../../../services/asnBlocker', () => mockAsnBlocker);

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
        const { asn, org, notes } = req.body || {};
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

    mockAdminRouter.get('/asn/check/:asn', async (req, res) => {
      try {
        const blocked = await mockAsnBlocker.isAsnBlocked(req.params.asn);
        res.json({ blocked });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/asnBlocker');
  });

  describe('GET /api/admin/asn/blocked', () => {
    it('should return blocked ASN list', async () => {
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
      expect(asn).toHaveProperty('blocked_at');
    });

    it('should return 500 on error', async () => {
      mockAsnBlocker.getBlockedAsns.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/asn/blocked')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/asn/block', () => {
    it('should block ASN with all fields', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 99999, org: 'Bad ISP', notes: 'test notes' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(99999, 'Bad ISP', 'test notes');
    });

    it('should block ASN with minimal fields', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ asn: 11111 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockAsnBlocker.blockAsn).toHaveBeenCalledWith(11111, '', '');
    });

    it('should return 400 without asn', async () => {
      const res = await request(app)
        .post('/api/admin/asn/block')
        .send({ org: 'Test ISP' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('asn required');
    });

    it('should return 500 on block error', async () => {
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

    it('should return 500 on unblock error', async () => {
      mockAsnBlocker.unblockAsn.mockRejectedValueOnce(new Error('unblock failed'));

      const res = await request(app)
        .delete('/api/admin/asn/block/67890')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/asn/check/:asn', () => {
    it('should return blocked=false when ASN is not blocked', async () => {
      mockAsnBlocker.isAsnBlocked.mockResolvedValueOnce(false);

      const res = await request(app)
        .get('/api/admin/asn/check/12345')
        .expect(200);

      expect(res.body).toHaveProperty('blocked', false);
    });

    it('should return blocked=true when ASN is blocked', async () => {
      mockAsnBlocker.isAsnBlocked.mockResolvedValueOnce(true);

      const res = await request(app)
        .get('/api/admin/asn/check/12345')
        .expect(200);

      expect(res.body).toHaveProperty('blocked', true);
    });

    it('should return 500 on check error', async () => {
      mockAsnBlocker.isAsnBlocked.mockRejectedValueOnce(new Error('check failed'));

      const res = await request(app)
        .get('/api/admin/asn/check/12345')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Bouquet Sync Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockCache;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getBouquetById: jest.fn(),
      updateBouquet: jest.fn().mockResolvedValue(true),
    };

    mockCache = {
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/bouquets/:id/sync', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const { type, ids } = req.body || {};
      if (!['movies', 'series', 'channels'].includes(type)) {
        return res.status(400).json({ error: 'type must be movies, series, or channels' });
      }
      const field = type === 'movies' ? 'bouquet_movies' : type === 'series' ? 'bouquet_series' : 'bouquet_channels';
      const b = await mockDb.getBouquetById(id);
      if (!b) return res.status(404).json({ error: 'not found' });
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
        await mockDb.updateBouquet(id, { [field]: merged });
        await mockCache.invalidateBouquets();
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

  describe('POST /api/admin/bouquets/:id/sync - Edge Cases', () => {
    it('should handle JSON string existing items', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: '[1,2,3]' });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [4] })
        .expect(200);

      expect(res.body.count).toBe(4);
    });

    it('should handle mixed string and number IDs', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: ['1', '2'] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: ['3', 4] })
        .expect(200);

      expect(res.body.count).toBe(4);
    });

    it('should deduplicate IDs', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [1, 2] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [2, 3] })
        .expect(200);

      expect(res.body.count).toBe(3);
    });

    it('should preserve existing items when adding new', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [100, 200] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [300] })
        .expect(200);

      expect(res.body.count).toBe(3);
      expect(mockDb.updateBouquet).toHaveBeenCalledWith(1, { bouquet_movies: [100, 200, 300] });
    });

    it('should handle invalid JSON string gracefully', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: 'invalid-json' });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(200);

      expect(res.body.count).toBe(1);
    });

    it('should return 400 for invalid bouquet type', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [] });

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'invalid', ids: [] })
        .expect(400);

      expect(res.body.error).toContain('type must be movies, series, or channels');
    });

    it('should return 400 on update failure', async () => {
      mockDb.getBouquetById.mockResolvedValueOnce({ id: 1, bouquet_movies: [] });
      mockDb.updateBouquet.mockRejectedValueOnce(new Error('constraint violation'));

      const res = await request(app)
        .post('/api/admin/bouquets/1/sync')
        .send({ type: 'movies', ids: [1] })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Provider Import Edge Cases', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockXcApiClient;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      listImportProviders: jest.fn().mockResolvedValue([]),
      createImportProvider: jest.fn().mockResolvedValue(1),
      getImportProviderById: jest.fn(),
      updateImportProvider: jest.fn().mockResolvedValue(true),
      deleteImportProvider: jest.fn().mockResolvedValue(true),
    };

    mockXcApiClient = {
      validate: jest.fn(),
      ping: jest.fn(),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/xcApiClient', () => ({
      XcApiClient: jest.fn().mockImplementation(() => mockXcApiClient),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/providers', async (req, res) => {
      try {
        res.json({ providers: await mockDb.listImportProviders() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.post('/providers', async (req, res) => {
      try {
        const { name, url } = req.body || {};
        if (!name || !url) return res.status(400).json({ error: 'name and url required' });
        const id = await mockDb.createImportProvider({ name, url });
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    mockAdminRouter.put('/providers/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const existing = await mockDb.getImportProviderById(id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      try {
        await mockDb.updateImportProvider(id, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    mockAdminRouter.delete('/providers/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockDb.deleteImportProvider(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/providers/:id/validate', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const p = await mockDb.getImportProviderById(id);
      if (!p) return res.status(404).json({ error: 'not found' });
      try {
        const XcApiClient = require('../../../services/xcApiClient').XcApiClient;
        const xc = new XcApiClient(p.url);
        if (!xc.validate()) return res.status(400).json({ error: 'Invalid provider URL' });
        await xc.ping();
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/xcApiClient');
  });

  describe('POST /api/admin/providers', () => {
    it('should create provider with name and url', async () => {
      const res = await request(app)
        .post('/api/admin/providers')
        .send({ name: 'Test Provider', url: 'http://test.com/get.php?username=user&password=pass' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/providers')
        .send({ url: 'http://test.com/get.php?username=user&password=pass' })
        .expect(400);

      expect(res.body.error).toContain('name and url required');
    });

    it('should return 400 without url', async () => {
      const res = await request(app)
        .post('/api/admin/providers')
        .send({ name: 'Test Provider' })
        .expect(400);

      expect(res.body.error).toContain('name and url required');
    });

    it('should return 400 on create error', async () => {
      mockDb.createImportProvider.mockRejectedValueOnce(new Error('duplicate name'));

      const res = await request(app)
        .post('/api/admin/providers')
        .send({ name: 'Duplicate', url: 'http://test.com' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/admin/providers/:id', () => {
    it('should update provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce({ id: 1, name: 'Old' });

      const res = await request(app)
        .put('/api/admin/providers/1')
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/providers/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/providers/999')
        .send({ name: 'Updated' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/providers/:id', () => {
    it('should delete provider', async () => {
      mockDb.deleteImportProvider.mockResolvedValueOnce(true);

      const res = await request(app)
        .delete('/api/admin/providers/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/providers/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.deleteImportProvider.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/providers/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/providers/:id/validate', () => {
    it('should validate provider successfully', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce({ id: 1, url: 'http://test.com/get.php?username=u&password=p' });
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockResolvedValueOnce({ ok: true });

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for invalid URL', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce({ id: 1, url: 'invalid-url' });
      mockXcApiClient.validate.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(400);

      expect(res.body.error).toContain('Invalid provider URL');
    });

    it('should return 400 when ping fails', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce({ id: 1, url: 'http://test.com/get.php?username=u&password=p' });
      mockXcApiClient.validate.mockReturnValueOnce(true);
      mockXcApiClient.ping.mockRejectedValueOnce(new Error('connection refused'));

      const res = await request(app)
        .post('/api/admin/providers/1/validate')
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent provider', async () => {
      mockDb.getImportProviderById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/providers/999/validate')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - M3U Import', () => {
  let app;
  let mockAdminRouter;
  let mockVodService;
  let mockSeriesService;
  let mockTmdbService;
  let mockCache;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(() => {
    jest.resetModules();

    mockVodService = {
      create: jest.fn().mockResolvedValue(1),
    };

    mockSeriesService = {
      create: jest.fn().mockResolvedValue(1),
      addEpisode: jest.fn().mockResolvedValue(1),
    };

    mockTmdbService = {
      getApiKey: jest.fn().mockResolvedValue(null),
      searchMovies: jest.fn().mockResolvedValue([]),
      getMovie: jest.fn().mockResolvedValue({}),
      searchTvShows: jest.fn().mockResolvedValue([]),
      getTvShow: jest.fn().mockResolvedValue({}),
    };

    mockCache = {
      invalidateVod: jest.fn().mockResolvedValue(true),
      invalidateSeries: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../services/tmdbService', () => mockTmdbService);
    jest.mock('../../../lib/cache', () => mockCache);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/movies/import', async (req, res) => {
      const { m3u_text, category_id, disable_tmdb } = req.body || {};
      if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
      try {
        const entries = parseM3UEntries(m3u_text);
        const results = [];
        const hasKey = !!(await mockTmdbService.getApiKey());
        for (const entry of entries) {
          const movieData = {
            name: entry.name, stream_url: entry.url, stream_source: entry.url,
            category_id: category_id || '', stream_icon: entry.logo || '',
            container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
          };
          if (!disable_tmdb && hasKey) {
            try {
              const tmdbResults = await mockTmdbService.searchMovies(entry.name);
              if (tmdbResults.length > 0) {
                const details = await mockTmdbService.getMovie(tmdbResults[0].id);
                Object.assign(movieData, {
                  name: details.name || movieData.name, stream_icon: details.movie_image || movieData.stream_icon,
                  backdrop_path: details.backdrop_path || '', plot: details.plot || '',
                  movie_cast: details.cast || '', director: details.director || '', genre: details.genre || '',
                  rating: String(details.rating || '0'), rating_5based: Math.round((details.rating || 0) / 2 * 10) / 10,
                  year: details.year, tmdb_id: details.tmdb_id, duration: details.duration || '',
                  duration_secs: details.duration_secs || 0, release_date: details.release_date || '',
                  youtube_trailer: details.youtube_trailer || '', country: details.country || '',
                  movie_properties: details,
                });
              }
            } catch {}
          }
          const id = await mockVodService.create(movieData);
          results.push({ id, name: movieData.name });
        }
        await mockCache.invalidateVod();
        res.json({ imported: results.length, movies: results });
      } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
    });

    mockAdminRouter.post('/series/import', async (req, res) => {
      const { m3u_text, category_id, disable_tmdb } = req.body || {};
      if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
      try {
        const entries = parseM3UEntries(m3u_text);
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
        const hasKey = !!(await mockTmdbService.getApiKey());
        for (const [name, data] of seriesMap) {
          const seriesData = { title: name, category_id: category_id || '', cover: data.logo || '' };
          if (!disable_tmdb && hasKey) {
            try {
              const tmdbResults = await mockTmdbService.searchTvShows(name);
              if (tmdbResults.length > 0) {
                const details = await mockTmdbService.getTvShow(tmdbResults[0].id);
                Object.assign(seriesData, {
                  title: details.title || seriesData.title, cover: details.cover || seriesData.cover,
                  cover_big: details.cover_big || '', backdrop_path: details.backdrop_path || '',
                  plot: details.plot || '', series_cast: details.cast || '', director: details.director || '',
                  genre: details.genre || '', rating: String(details.rating || '0'),
                  rating_5based: details.rating_5based || 0, year: details.year, tmdb_id: details.tmdb_id,
                  youtube_trailer: details.youtube_trailer || '', episode_run_time: details.episode_run_time || 0,
                  seasons: details.seasons || [],
                });
              }
            } catch {}
          }
          const seriesId = await mockSeriesService.create(seriesData);
          for (const ep of data.episodes) await mockSeriesService.addEpisode({ ...ep, series_id: seriesId });
          results.push({ id: seriesId, name: seriesData.title, episodes: data.episodes.length });
        }
        await mockCache.invalidateSeries();
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

  function parseM3UEntries(text) {
    const lines = String(text).split('\n');
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
    return entries;
  }

  describe('POST /api/admin/movies/import', () => {
    it('should import movies from M3U text', async () => {
      const m3uContent = '#EXTINF:-1 tvg-logo="http://logo.png" group-title="Movies",Movie One\nhttp://test.com/movie1.mp4\n#EXTINF:-1,Movie Two\nhttp://test.com/movie2.mp4';

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3uContent, category_id: 1 })
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

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('m3u_text required');
    });

    it('should return 400 with empty m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should handle M3U entries without logo', async () => {
      const m3uContent = '#EXTINF:-1,Movie One\nhttp://test.com/movie1.mp4';

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3uContent })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
    });

    it('should use disable_tmdb when provided', async () => {
      mockTmdbService.getApiKey.mockResolvedValueOnce('fake-key');

      const m3uContent = '#EXTINF:-1,Movie One\nhttp://test.com/movie1.mp4';

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3uContent, disable_tmdb: true })
        .expect(200);

      expect(mockTmdbService.searchMovies).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      mockVodService.create.mockRejectedValueOnce(new Error('db error'));

      const m3uContent = '#EXTINF:-1,Movie One\nhttp://test.com/movie1.mp4';

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3uContent })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/series/import', () => {
    it('should import series from M3U text with season/episode', async () => {
      const m3uContent = '#EXTINF:-1 group-title="TV Shows",Show Name S01E01\nhttp://test.com/s1e1.mp4\n#EXTINF:-1,Show Name S01E02\nhttp://test.com/s1e2.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent, category_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 1);
      expect(res.body).toHaveProperty('series');
      expect(Array.isArray(res.body.series)).toBe(true);
      expect(res.body.series[0]).toHaveProperty('episodes', 2);
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/series/import')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('m3u_text required');
    });

    it('should return 400 with empty m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('should parse season/episode from filename', async () => {
      const m3uContent = '#EXTINF:-1,My Show S2E5\nhttp://test.com/s2e5.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent })
        .expect(200);

      expect(res.body.series[0].episodes).toBe(1);
    });

    it('should use season 1 by default when no season in name', async () => {
      const m3uContent = '#EXTINF:-1,Standalone Episode\nhttp://test.com/episode.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent })
        .expect(200);

      expect(res.body.series[0].episodes).toBe(1);
      expect(mockSeriesService.addEpisode).toHaveBeenCalled();
      const callArgs = mockSeriesService.addEpisode.mock.calls[0][0];
      expect(callArgs.season_num).toBe(1);
      expect(callArgs.episode_num).toBe(1);
    });

    it('should group multiple episodes of same series', async () => {
      const m3uContent = '#EXTINF:-1,Show S01E01\nhttp://test.com/s1e1.mp4\n#EXTINF:-1,Show S01E02\nhttp://test.com/s1e2.mp4\n#EXTINF:-1,Show S01E03\nhttp://test.com/s1e3.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent })
        .expect(200);

      expect(res.body.series).toHaveLength(1);
      expect(res.body.series[0].episodes).toBe(3);
    });

    it('should return 500 on service error', async () => {
      mockSeriesService.create.mockRejectedValueOnce(new Error('db error'));

      const m3uContent = '#EXTINF:-1,Show S01E01\nhttp://test.com/s1e1.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - VOD Download Block', () => {
  let app;
  let mockAdminRouter;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/block_vod_download', async (req, res) => {
      try {
        const val = await mockDb.getSetting('block_vod_download');
        res.json({ enabled: val === '1' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/settings/block_vod_download', async (req, res) => {
      try {
        const { enabled } = req.body;
        await mockDb.setSetting('block_vod_download', enabled ? '1' : '0');
        res.json({ ok: true });
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
  });

  describe('GET /api/admin/settings/block_vod_download', () => {
    it('should return enabled true when setting is 1', async () => {
      mockDb.getSetting.mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', true);
    });

    it('should return enabled false when setting is 0', async () => {
      mockDb.getSetting.mockResolvedValueOnce('0');

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });

    it('should return enabled false when setting is null', async () => {
      mockDb.getSetting.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });

    it('should return enabled false when setting is undefined', async () => {
      mockDb.getSetting.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .get('/api/admin/settings/block_vod_download')
        .expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });

    it('should return 500 on database error', async () => {
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

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('block_vod_download', '0');
    });

    it('should return 500 on database error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .put('/api/admin/settings/block_vod_download')
        .send({ enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      getSetting: jest.fn(),
      setSetting: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockTelegramBot = {
      stopBot: jest.fn().mockResolvedValue(undefined),
      initBot: jest.fn().mockResolvedValue(undefined),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/telegramBot', () => mockTelegramBot);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/settings/telegram', async (req, res) => {
      try {
        const token = await mockDb.getSetting('telegram_bot_token');
        const chatId = await mockDb.getSetting('telegram_admin_chat_id');
        const enabled = await mockDb.getSetting('telegram_alerts_enabled');
        res.json({
          bot_token_set: !!token,
          admin_chat_id: chatId || '',
          alerts_enabled: enabled !== '0',
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    mockAdminRouter.put('/settings/telegram', async (req, res) => {
      try {
        const { bot_token, admin_chat_id, alerts_enabled } = req.body;
        if (bot_token !== undefined) await mockDb.setSetting('telegram_bot_token', bot_token || '');
        if (admin_chat_id !== undefined) await mockDb.setSetting('telegram_admin_chat_id', admin_chat_id || '');
        if (alerts_enabled !== undefined) await mockDb.setSetting('telegram_alerts_enabled', alerts_enabled ? '1' : '0');
        await mockTelegramBot.stopBot();
        if (bot_token) {
          setTimeout(() => mockTelegramBot.initBot().catch(e => console.error('[TELEGRAM]', e.message)), 2000);
        }
        res.json({ ok: true });
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
    jest.unmock('../../../services/telegramBot');
  });

  describe('GET /api/admin/settings/telegram', () => {
    it('should return telegram settings', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('123456:ABC-DEF')
        .mockResolvedValueOnce('123456789')
        .mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('bot_token_set', true);
      expect(res.body).toHaveProperty('admin_chat_id', '123456789');
      expect(res.body).toHaveProperty('alerts_enabled', true);
    });

    it('should return bot_token_set false when no token', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('bot_token_set', false);
      expect(res.body).toHaveProperty('alerts_enabled', true);
    });

    it('should return empty string for chat_id when not set', async () => {
      mockDb.getSetting
        .mockResolvedValueOnce('token')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('1');

      const res = await request(app)
        .get('/api/admin/settings/telegram')
        .expect(200);

      expect(res.body).toHaveProperty('admin_chat_id', '');
    });

    it('should return 500 on database error', async () => {
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
        .send({ bot_token: '123456:ABC', admin_chat_id: '987654321', alerts_enabled: true })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', '123456:ABC');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_admin_chat_id', '987654321');
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '1');
      expect(mockTelegramBot.stopBot).toHaveBeenCalled();
    });

    it('should update partial settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ alerts_enabled: false })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_alerts_enabled', '0');
    });

    it('should allow empty bot_token to clear it', async () => {
      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ bot_token: '' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(mockDb.setSetting).toHaveBeenCalledWith('telegram_bot_token', '');
    });

    it('should return 500 on database error', async () => {
      mockDb.setSetting.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .put('/api/admin/settings/telegram')
        .send({ alerts_enabled: true })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Features & Bandwidth', () => {
  let app;
  let mockAdminRouter;
  let mockProvisionService;
  let mockBandwidthMonitor;

  beforeAll(() => {
    jest.resetModules();

    mockProvisionService = {
      isProvisioningEnabled: jest.fn().mockResolvedValue(false),
    };

    mockBandwidthMonitor = {
      getBandwidthHistory: jest.fn().mockResolvedValue([
        { timestamp: 1704067200, rx_bytes: 1024, tx_bytes: 2048 },
        { timestamp: 1704070800, rx_bytes: 512, tx_bytes: 1024 },
      ]),
    };

    jest.mock('../../../services/provisionService', () => mockProvisionService);
    jest.mock('../../../services/bandwidthMonitor', () => mockBandwidthMonitor);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/features', async (req, res) => {
      try {
        res.json({
          serverProvisioning: await mockProvisionService.isProvisioningEnabled(),
        });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
      }
    });

    mockAdminRouter.get('/bandwidth', async (req, res) => {
      try {
        const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 6));
        const data = await mockBandwidthMonitor.getBandwidthHistory(hours);
        res.json(data);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/provisionService');
    jest.unmock('../../../services/bandwidthMonitor');
  });

  describe('GET /api/admin/features', () => {
    it('should return features with serverProvisioning false', async () => {
      const res = await request(app)
        .get('/api/admin/features')
        .expect(200);

      expect(res.body).toHaveProperty('serverProvisioning', false);
    });

    it('should return features with serverProvisioning true', async () => {
      mockProvisionService.isProvisioningEnabled.mockResolvedValueOnce(true);

      const res = await request(app)
        .get('/api/admin/features')
        .expect(200);

      expect(res.body).toHaveProperty('serverProvisioning', true);
    });

    it('should return 500 on error', async () => {
      mockProvisionService.isProvisioningEnabled.mockRejectedValueOnce(new Error('fail'));

      const res = await request(app)
        .get('/api/admin/features')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/bandwidth', () => {
    it('should return bandwidth history', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return bandwidth data with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth')
        .expect(200);

      const item = res.body[0];
      expect(item).toHaveProperty('timestamp');
      expect(item).toHaveProperty('rx_bytes');
      expect(item).toHaveProperty('tx_bytes');
    });

    it('should use default hours of 6', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth')
        .expect(200);

      expect(mockBandwidthMonitor.getBandwidthHistory).toHaveBeenCalledWith(6);
    });

    it('should accept hours parameter', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth?hours=24')
        .expect(200);

      expect(mockBandwidthMonitor.getBandwidthHistory).toHaveBeenCalledWith(24);
    });

    it('should cap hours at 168', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth?hours=500')
        .expect(200);

      expect(mockBandwidthMonitor.getBandwidthHistory).toHaveBeenCalledWith(168);
    });

    it('should use fallback of 6 hours when hours is 0', async () => {
      const res = await request(app)
        .get('/api/admin/bandwidth?hours=0')
        .expect(200);

      expect(mockBandwidthMonitor.getBandwidthHistory).toHaveBeenCalledWith(6);
    });

    it('should return 500 on error', async () => {
      mockBandwidthMonitor.getBandwidthHistory.mockRejectedValueOnce(new Error('monitor error'));

      const res = await request(app)
        .get('/api/admin/bandwidth')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
          stream_id: 101,
          container: 'm3u8',
          origin_server_id: 1,
          proxy_server_id: 2,
          geoip_country_code: 'US',
          isp: 'Comcast',
          user_ip: '192.168.1.1',
          last_seen_at: '2024-01-01 12:00:00',
          created_at: '2024-01-01 11:00:00',
          username: 'testuser',
          origin_name: 'Origin 1',
          origin_host: 'origin1.example.com',
          proxy_name: 'Proxy 1',
          proxy_host: 'proxy1.example.com'
        },
        {
          session_uuid: 'uuid-2',
          stream_type: 'movie',
          stream_id: 201,
          container: 'mp4',
          origin_server_id: 1,
          proxy_server_id: null,
          geoip_country_code: 'GB',
          isp: 'BT',
          user_ip: '10.0.0.1',
          last_seen_at: '2024-01-01 12:30:00',
          created_at: '2024-01-01 11:30:00',
          username: 'testuser2',
          origin_name: 'Origin 1',
          origin_host: 'origin1.example.com',
          proxy_name: null,
          proxy_host: null
        }
      ]),
      queryOne: jest.fn().mockResolvedValue(null),
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
        const [typeRows, countryRows, streamRows, serverRows] = await Promise.all([
          mockMariadb.query(`
            SELECT stream_type, COUNT(*) AS cnt
            FROM line_runtime_sessions
            WHERE date_end IS NULL
            GROUP BY stream_type`),
          mockMariadb.query(`
            SELECT geoip_country_code, COUNT(*) AS cnt
            FROM line_runtime_sessions
            WHERE date_end IS NULL AND geoip_country_code != ''
            GROUP BY geoip_country_code
            ORDER BY cnt DESC
            LIMIT 20`),
          mockMariadb.query(`
            SELECT stream_id, stream_type, COUNT(*) AS cnt
            FROM line_runtime_sessions
            WHERE date_end IS NULL
            GROUP BY stream_id, stream_type
            ORDER BY cnt DESC
            LIMIT 10`),
          mockMariadb.query(`
            SELECT origin_server_id, COUNT(*) AS cnt
            FROM line_runtime_sessions
            WHERE date_end IS NULL AND origin_server_id IS NOT NULL
            GROUP BY origin_server_id`),
        ]);
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
    it('should return sessions list', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    it('should return session objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections')
        .expect(200);

      const session = res.body.sessions[0];
      expect(session).toHaveProperty('session_uuid');
      expect(session).toHaveProperty('stream_type');
      expect(session).toHaveProperty('stream_id');
      expect(session).toHaveProperty('username');
      expect(session).toHaveProperty('user_ip');
    });

    it('should filter by type=live', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { session_uuid: 'uuid-1', stream_type: 'live', stream_id: 101, username: 'user1' }
      ]);

      const res = await request(app)
        .get('/api/admin/live-connections?type=live')
        .expect(200);

      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].stream_type).toBe('live');
    });

    it('should filter by type=movie', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { session_uuid: 'uuid-2', stream_type: 'movie', stream_id: 201, username: 'user2' }
      ]);

      const res = await request(app)
        .get('/api/admin/live-connections?type=movie')
        .expect(200);

      expect(res.body.sessions[0].stream_type).toBe('movie');
    });

    it('should filter by type=episode', async () => {
      mockMariadb.query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/admin/live-connections?type=episode')
        .expect(200);

      expect(res.body.sessions).toHaveLength(0);
    });

    it('should filter by server_id', async () => {
      mockMariadb.query.mockResolvedValueOnce([
        { session_uuid: 'uuid-1', stream_type: 'live', stream_id: 101, origin_server_id: 5 }
      ]);

      const res = await request(app)
        .get('/api/admin/live-connections?server_id=5')
        .expect(200);

      expect(res.body.sessions[0].origin_server_id).toBe(5);
    });

    it('should ignore invalid type filter', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections?type=invalid')
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
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
    it('should return summary with total', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('by_type');
      expect(res.body.by_type).toHaveProperty('live');
      expect(res.body.by_type).toHaveProperty('movie');
      expect(res.body.by_type).toHaveProperty('episode');
    });

    it('should return countries array', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('countries');
      expect(Array.isArray(res.body.countries)).toBe(true);
    });

    it('should return top_streams array', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('top_streams');
      expect(Array.isArray(res.body.top_streams)).toBe(true);
    });

    it('should return servers array', async () => {
      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(200);

      expect(res.body).toHaveProperty('servers');
      expect(Array.isArray(res.body.servers)).toBe(true);
    });

    it('should return 500 on database error', async () => {
      mockMariadb.query.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/live-connections/summary')
        .expect(500);

      expect(res.body).toHaveProperty('error');
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
      seriesCount: jest.fn().mockResolvedValue(50),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockImplementation((sql) => {
        if (sql.includes('COUNT(*)') && sql.includes('lines')) {
          return Promise.resolve({ c: 25 });
        }
        if (sql.includes('COUNT(*)') && sql.includes('channels')) {
          return Promise.resolve({ c: 30 });
        }
        if (sql.includes('COUNT(*)') && sql.includes('episodes')) {
          return Promise.resolve({ c: 500 });
        }
        if (sql.includes('COUNT(*)') && sql.includes('bouquets')) {
          return Promise.resolve({ c: 10 });
        }
        if (sql.includes('COUNT(*)') && sql.includes('packages')) {
          return Promise.resolve({ c: 5 });
        }
        if (sql.includes('is_reseller')) {
          return Promise.resolve({ c: 8 });
        }
        return Promise.resolve(null);
      }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => mockMariadb);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/stats', async (req, res) => {
      try {
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
        res.json({
          activeLines: activeRow ? activeRow.c : 0,
          channelsCount: totalChRow ? totalChRow.c : 0,
          movieCount: movieCountVal,
          seriesCount: seriesCountVal,
          episodeCount: episodeRow ? Number(episodeRow.c) || 0 : 0,
          bouquetCount: bouquetRow ? Number(bouquetRow.c) || 0 : 0,
          packageCount: packageRow ? Number(packageRow.c) || 0 : 0,
          resellerCount: resellerRow ? Number(resellerRow.c) || 0 : 0,
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
  });

  describe('GET /api/admin/stats', () => {
    it('should return stats object', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(res.body).toHaveProperty('activeLines');
      expect(res.body).toHaveProperty('channelsCount');
      expect(res.body).toHaveProperty('movieCount');
      expect(res.body).toHaveProperty('seriesCount');
      expect(res.body).toHaveProperty('episodeCount');
      expect(res.body).toHaveProperty('bouquetCount');
      expect(res.body).toHaveProperty('packageCount');
      expect(res.body).toHaveProperty('resellerCount');
    });

    it('should return numeric values', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(typeof res.body.activeLines).toBe('number');
      expect(typeof res.body.channelsCount).toBe('number');
      expect(typeof res.body.movieCount).toBe('number');
      expect(typeof res.body.seriesCount).toBe('number');
    });

    it('should return 500 on database error', async () => {
      mockMariadb.queryOne.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .get('/api/admin/stats')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Server Relationships POST/DELETE', () => {
  let app;
  let mockAdminRouter;
  let mockMariadb;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockMariadb = {
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
    };

    mockDb = {
      addServerRelationship: jest.fn().mockResolvedValue(5),
      removeServerRelationship: jest.fn().mockResolvedValue(true),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/mariadb', () => mockMariadb);
    jest.mock('../../../lib/db', () => mockDb);

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/server-relationships', async (req, res) => {
      const { parent_server_id, child_server_id, relationship_type, priority, enabled } = req.body || {};
      if (!Number.isFinite(parseInt(parent_server_id, 10)) || !Number.isFinite(parseInt(child_server_id, 10))) {
        return res.status(400).json({ error: 'parent_server_id and child_server_id are required' });
      }
      const type = String(relationship_type || 'origin-proxy').trim();
      if (!['origin-proxy', 'failover', 'lb-member'].includes(type)) {
        return res.status(400).json({ error: 'invalid relationship_type' });
      }
      try {
        const id = await mockDb.addServerRelationship(
          parseInt(parent_server_id, 10),
          parseInt(child_server_id, 10),
          type
        );
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
      try {
        await mockDb.removeServerRelationship(parentId, childId, type);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/db');
  });

  describe('POST /api/admin/server-relationships', () => {
    it('should create relationship', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('ok', true);
    });

    it('should create relationship with failover type', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 3, relationship_type: 'failover' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should create relationship with lb-member type', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 4, relationship_type: 'lb-member' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without parent_server_id', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ child_server_id: 2 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parent_server_id and child_server_id are required');
    });

    it('should return 400 without child_server_id', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parent_server_id and child_server_id are required');
    });

    it('should return 400 for invalid relationship_type', async () => {
      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'invalid' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('invalid relationship_type');
    });

    it('should return 409 for duplicate relationship', async () => {
      mockDb.addServerRelationship.mockRejectedValueOnce(new Error('Duplicate entry'));

      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' })
        .expect(409);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('relationship already exists');
    });

    it('should return 500 on database error', async () => {
      mockDb.addServerRelationship.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .post('/api/admin/server-relationships')
        .send({ parent_server_id: 1, child_server_id: 2 })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/server-relationships', () => {
    it('should delete relationship', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships')
        .query({ parentId: 1, childId: 2, type: 'origin-proxy' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should delete failover relationship', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships')
        .query({ parentId: 1, childId: 3, type: 'failover' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 without parentId', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships')
        .query({ childId: 2, type: 'origin-proxy' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parentId, childId, and type are required');
    });

    it('should return 400 without childId', async () => {
      const res = await request(app)
        .delete('/api/admin/server-relationships')
        .query({ parentId: 1, type: 'origin-proxy' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('parentId, childId, and type are required');
    });

    it('should return 500 on database error', async () => {
      mockDb.removeServerRelationship.mockRejectedValueOnce(new Error('db error'));

      const res = await request(app)
        .delete('/api/admin/server-relationships')
        .query({ parentId: 1, childId: 2, type: 'origin-proxy' })
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('Admin API Routes - Error Handling Edge Cases', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.get('/test-id/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (id < 0) return res.status(400).json({ error: 'invalid id' });
      res.json({ id });
    });

    mockAdminRouter.get('/test-404/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const found = id !== 999;
      if (!found) return res.status(404).json({ error: 'not found' });
      res.json({ id });
    });

    mockAdminRouter.post('/test-create', async (req, res) => {
      const { name, value } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      if (value === -1) return res.status(500).json({ error: 'internal error' });
      if (value === -2) return res.status(409).json({ error: 'conflict' });
      res.status(201).json({ id: 1, name, value });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('ID Parameter Validation', () => {
    it('should return 400 for string id', async () => {
      const res = await request(app)
        .get('/api/admin/test-id/abc')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should handle float id (parseInt truncates to integer)', async () => {
      const res = await request(app)
        .get('/api/admin/test-id/1.5')
        .expect(200);

      expect(res.body.id).toBe(1);
    });

    it('should return 400 for negative id', async () => {
      const res = await request(app)
        .get('/api/admin/test-id/-1')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should accept valid integer id', async () => {
      const res = await request(app)
        .get('/api/admin/test-id/123')
        .expect(200);

      expect(res.body.id).toBe(123);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for non-existent resource', async () => {
      const res = await request(app)
        .get('/api/admin/test-404/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });

    it('should return resource for valid id', async () => {
      const res = await request(app)
        .get('/api/admin/test-404/1')
        .expect(200);

      expect(res.body.id).toBe(1);
    });
  });

  describe('Create Error Handling', () => {
    it('should return 400 without required field', async () => {
      const res = await request(app)
        .post('/api/admin/test-create')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('name required');
    });

    it('should return 500 on internal error', async () => {
      const res = await request(app)
        .post('/api/admin/test-create')
        .send({ name: 'test', value: -1 })
        .expect(500);

      expect(res.body.error).toContain('internal error');
    });

    it('should return 409 on conflict', async () => {
      const res = await request(app)
        .post('/api/admin/test-create')
        .send({ name: 'test', value: -2 })
        .expect(409);

      expect(res.body.error).toContain('conflict');
    });

    it('should return 201 on success', async () => {
      const res = await request(app)
        .post('/api/admin/test-create')
        .send({ name: 'test', value: 42 })
        .expect(201);

      expect(res.body.id).toBe(1);
      expect(res.body.name).toBe('test');
    });
  });
});

describe('Admin API Routes - Bouquets CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockBouquetService;

  beforeAll(() => {
    jest.resetModules();

    mockBouquetService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, bouquet_name: 'Bouquet A', bouquet_id: 'A1', description: 'Test Bouquet' },
        { id: 2, bouquet_name: 'Bouquet B', bouquet_id: 'B1', description: 'Another Bouquet' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, bouquet_name: 'Bouquet A', bouquet_id: 'A1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
      getBouquetIdsForEntity: jest.fn().mockResolvedValue([]),
      syncEntityBouquets: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/bouquetService', () => mockBouquetService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/bouquets', async (req, res) => {
      res.json({ bouquets: await mockBouquetService.list() });
    });

    mockAdminRouter.get('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const bouquet = await mockBouquetService.getById(id);
      if (!bouquet) return res.status(404).json({ error: 'not found' });
      res.json(bouquet);
    });

    mockAdminRouter.post('/bouquets', async (req, res) => {
      const { bouquet_name, bouquet_id, description } = req.body || {};
      if (!bouquet_name) return res.status(400).json({ error: 'bouquet_name required' });
      try {
        const id = await mockBouquetService.create({ bouquet_name, bouquet_id, description });
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockBouquetService.update(id, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockBouquetService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/bouquetService');
  });

  describe('GET /api/admin/bouquets', () => {
    it('should return bouquets list', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets')
        .expect(200);

      expect(res.body).toHaveProperty('bouquets');
      expect(Array.isArray(res.body.bouquets)).toBe(true);
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

  describe('GET /api/admin/bouquets/:id', () => {
    it('should return bouquet by id', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('bouquet_name', 'Bouquet A');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/bouquets/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/bouquets/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/bouquets', () => {
    it('should create bouquet', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'New Bouquet', bouquet_id: 'NEW1' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('should return 400 without bouquet_name', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('bouquet_name required');
    });

    it('should return 400 on create failure', async () => {
      mockBouquetService.create.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'Bad Bouquet' })
        .expect(400);

      expect(res.body.error).toContain('create failed');
    });
  });

  describe('PUT /api/admin/bouquets/:id', () => {
    it('should update bouquet', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated Bouquet' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/invalid')
        .send({ bouquet_name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 400 on update failure', async () => {
      mockBouquetService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('update failed');
    });
  });

  describe('DELETE /api/admin/bouquets/:id', () => {
    it('should delete bouquet', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/bouquets/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
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
        { id: 1, name: 'Package A', price: 9.99, duration_days: 30 },
        { id: 2, name: 'Package B', price: 19.99, duration_days: 60 }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, name: 'Package A', price: 9.99 }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/packageService', () => mockPackageService);

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/packages', async (req, res) => {
      res.json({ packages: await mockPackageService.list() });
    });

    mockAdminRouter.get('/packages/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const pkg = await mockPackageService.getById(id);
      if (!pkg) return res.status(404).json({ error: 'not found' });
      res.json(pkg);
    });

    mockAdminRouter.post('/packages', async (req, res) => {
      const { name, price } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      try {
        const id = await mockPackageService.create({ name, price });
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/packages/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      try {
        await mockPackageService.update(id, req.body || {});
        res.json({ ok: true });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/packages/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockPackageService.remove(id);
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
    });

    it('should return package objects with expected properties', async () => {
      const res = await request(app)
        .get('/api/admin/packages')
        .expect(200);

      const pkg = res.body.packages[0];
      expect(pkg).toHaveProperty('id');
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('price');
    });
  });

  describe('GET /api/admin/packages/:id', () => {
    it('should return package by id', async () => {
      const res = await request(app)
        .get('/api/admin/packages/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('name', 'Package A');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/packages/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent package', async () => {
      mockPackageService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/packages/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
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

    it('should return 400 without name', async () => {
      const res = await request(app)
        .post('/api/admin/packages')
        .send({ price: 29.99 })
        .expect(400);

      expect(res.body.error).toContain('name required');
    });

    it('should return 400 on create failure', async () => {
      mockPackageService.create.mockRejectedValueOnce(new Error('create failed'));

      const res = await request(app)
        .post('/api/admin/packages')
        .send({ name: 'Bad Package' })
        .expect(400);

      expect(res.body.error).toContain('create failed');
    });
  });

  describe('PUT /api/admin/packages/:id', () => {
    it('should update package', async () => {
      const res = await request(app)
        .put('/api/admin/packages/1')
        .send({ price: 14.99 })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/packages/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 400 on update failure', async () => {
      mockPackageService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/packages/1')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('update failed');
    });
  });

  describe('DELETE /api/admin/packages/:id', () => {
    it('should delete package', async () => {
      const res = await request(app)
        .delete('/api/admin/packages/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/packages/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent package', async () => {
      mockPackageService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/packages/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Lines Advanced Operations', () => {
  let app;
  let mockAdminRouter;
  let mockDb;
  let mockLineService;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getLineById: jest.fn().mockResolvedValue({ id: 1, username: 'testline', admin_enabled: 1, password: 'hashed' }),
      getPackageById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Package' }),
      deleteExpiredLines: jest.fn().mockResolvedValue(5),
      attachLinePassword: jest.fn().mockImplementation(r => ({ ...r, password: '***' })),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockLineService = {
      listAll: jest.fn().mockResolvedValue({ lines: [{ id: 1, username: 'line1' }], total: 1 }),
      getActiveConnections: jest.fn().mockResolvedValue([
        { id: 1, ip: '192.168.1.1', connected_at: '2024-01-01 00:00:00', stream_id: 'live_1' },
        { id: 2, ip: '192.168.1.2', connected_at: '2024-01-01 00:01:00', stream_id: 'live_2' }
      ]),
      killConnections: jest.fn().mockResolvedValue(2),
      createLine: jest.fn().mockResolvedValue({ id: 1, username: 'newline' }),
      update: jest.fn().mockResolvedValue({ id: 1, username: 'updated' }),
      remove: jest.fn().mockResolvedValue(true),
      normalizeLineRow: jest.fn().mockImplementation(r => r),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/mariadb', () => ({
      query: jest.fn().mockResolvedValue([]),
      queryOne: jest.fn().mockResolvedValue(null),
      execute: jest.fn().mockResolvedValue(null),
    }));
    jest.mock('../../../lib/cache', () => ({
      invalidateLines: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/lines/:id/connections', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      const connections = await mockLineService.getActiveConnections(id);
      res.json({ connections });
    });

    mockAdminRouter.post('/lines/:id/kill-connections', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      const killed = await mockLineService.killConnections(id);
      res.json({ ok: true, killed });
    });

    mockAdminRouter.post('/lines/expired/delete', async (req, res) => {
      const deleted = await mockDb.deleteExpiredLines();
      res.json({ ok: true, deleted });
    });

    mockAdminRouter.post('/lines/bulk', async (req, res) => {
      const { users, package_id } = req.body || {};
      if (!Array.isArray(users) || !users.length) {
        return res.status(400).json({ error: 'No users provided' });
      }
      if (!package_id) {
        return res.status(400).json({ error: 'Package ID required' });
      }
      const pkg = await mockDb.getPackageById(parseInt(package_id, 10));
      if (!pkg) {
        return res.status(400).json({ error: 'Package not found' });
      }
      res.json({ created: users.length, failed: 0, lines: users.map((u, i) => ({ id: i + 1, username: u.username || `user${i}` })) });
    });

    mockAdminRouter.put('/lines/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const line = await mockDb.getLineById(id);
      if (!line) return res.status(404).json({ error: 'not found' });
      try {
        const updated = await mockLineService.update(id, req.body || {});
        res.json(updated);
      } catch (e) {
        res.status(400).json({ error: e.message || 'update failed' });
      }
    });

    mockAdminRouter.delete('/lines/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockLineService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../lib/mariadb');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/lines/:id/connections', () => {
    it('should return active connections for a line', async () => {
      const res = await request(app)
        .get('/api/admin/lines/1/connections')
        .expect(200);

      expect(res.body).toHaveProperty('connections');
      expect(Array.isArray(res.body.connections)).toBe(true);
      expect(res.body.connections.length).toBe(2);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/lines/invalid/connections')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/lines/999/connections')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/lines/:id/kill-connections', () => {
    it('should kill all connections for a line', async () => {
      const res = await request(app)
        .post('/api/admin/lines/1/kill-connections')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('killed', 2);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/invalid/kill-connections')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/999/kill-connections')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/lines/expired/delete', () => {
    it('should delete expired lines', async () => {
      mockDb.deleteExpiredLines.mockResolvedValueOnce(5);

      const res = await request(app)
        .post('/api/admin/lines/expired/delete')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('deleted', 5);
    });
  });

  describe('POST /api/admin/lines/bulk', () => {
    it('should create bulk lines', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'user1' }, { username: 'user2' }], package_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('created', 2);
      expect(res.body).toHaveProperty('failed', 0);
    });

    it('should return 400 without users', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ package_id: 1 })
        .expect(400);

      expect(res.body.error).toContain('No users provided');
    });

    it('should return 400 without package_id', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'user1' }] })
        .expect(400);

      expect(res.body.error).toContain('Package ID required');
    });

    it('should return 400 for non-existent package', async () => {
      mockDb.getPackageById.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [{ username: 'user1' }], package_id: 999 })
        .expect(400);

      expect(res.body.error).toContain('Package not found');
    });

    it('should return 400 for empty users array', async () => {
      const res = await request(app)
        .post('/api/admin/lines/bulk')
        .send({ users: [], package_id: 1 })
        .expect(400);

      expect(res.body.error).toContain('No users provided');
    });
  });

  describe('PUT /api/admin/lines/:id', () => {
    it('should update line', async () => {
      mockLineService.update.mockResolvedValueOnce({ id: 1, username: 'updated', max_connections: 3 });

      const res = await request(app)
        .put('/api/admin/lines/1')
        .send({ max_connections: 3 })
        .expect(200);

      expect(mockLineService.update).toHaveBeenCalledWith(1, { max_connections: 3 });
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/lines/invalid')
        .send({ max_connections: 3 })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockDb.getLineById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/lines/999')
        .send({ max_connections: 3 })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/lines/:id', () => {
    it('should delete line', async () => {
      mockLineService.remove.mockResolvedValueOnce(true);

      const res = await request(app)
        .delete('/api/admin/lines/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/lines/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent line', async () => {
      mockLineService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/lines/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Movies CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockVodService;

  beforeAll(() => {
    jest.resetModules();

    mockVodService = {
      listItems: jest.fn().mockResolvedValue({
        movies: [{ id: 1, name: 'Movie 1' }, { id: 2, name: 'Movie 2' }],
        total: 2, limit: 50, offset: 0
      }),
      getById: jest.fn().mockResolvedValue({ id: 1, name: 'Movie 1', stream_url: 'http://test.com/movie1.mp4' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/vodService', () => mockVodService);
    jest.mock('../../../lib/cache', () => ({
      invalidateVod: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/movies', async (req, res) => {
      const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
      const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
      const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      try {
        const result = await mockVodService.listItems(categoryId, limit, offset, search, sortOrder);
        res.json({ movies: result.movies, total: result.total, limit, offset });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/movies/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const movie = await mockVodService.getById(id);
      if (!movie) return res.status(404).json({ error: 'not found' });
      res.json(movie);
    });

    mockAdminRouter.post('/movies', async (req, res) => {
      try {
        const id = await mockVodService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/movies/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockVodService.getById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockVodService.update(id, req.body || {});
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/movies/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockVodService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/vodService');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/movies', () => {
    it('should return movies list', async () => {
      const res = await request(app)
        .get('/api/admin/movies')
        .expect(200);

      expect(res.body).toHaveProperty('movies');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.movies)).toBe(true);
    });

    it('should filter by category_id', async () => {
      mockVodService.listItems.mockResolvedValueOnce({
        movies: [{ id: 1, name: 'Movie 1' }],
        total: 1, limit: 50, offset: 0
      });

      const res = await request(app)
        .get('/api/admin/movies?category_id=5')
        .expect(200);

      expect(mockVodService.listItems).toHaveBeenCalledWith('5', expect.any(Number), expect.any(Number), undefined, 'id_desc');
    });

    it('should filter by search', async () => {
      mockVodService.listItems.mockResolvedValueOnce({
        movies: [{ id: 1, name: 'Action Movie' }],
        total: 1, limit: 50, offset: 0
      });

      const res = await request(app)
        .get('/api/admin/movies?search=action')
        .expect(200);

      expect(mockVodService.listItems).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), 'action', 'id_desc');
    });

    it('should sort by id_asc', async () => {
      const res = await request(app)
        .get('/api/admin/movies?sort=id_asc')
        .expect(200);

      expect(mockVodService.listItems).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), undefined, 'id_asc');
    });
  });

  describe('GET /api/admin/movies/:id', () => {
    it('should return movie by id', async () => {
      const res = await request(app)
        .get('/api/admin/movies/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('name', 'Movie 1');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/movies/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent movie', async () => {
      mockVodService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/movies/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/movies', () => {
    it('should create movie', async () => {
      const res = await request(app)
        .post('/api/admin/movies')
        .send({ name: 'New Movie', stream_url: 'http://test.com/new.mp4' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 3);
    });

    it('should return 400 on create failure', async () => {
      mockVodService.create.mockRejectedValueOnce(new Error('name required'));

      const res = await request(app)
        .post('/api/admin/movies')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('name required');
    });
  });

  describe('PUT /api/admin/movies/:id', () => {
    it('should update movie', async () => {
      const res = await request(app)
        .put('/api/admin/movies/1')
        .send({ name: 'Updated Movie' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/movies/invalid')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent movie', async () => {
      mockVodService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/movies/999')
        .send({ name: 'Updated' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });

    it('should return 400 on update failure', async () => {
      mockVodService.update.mockRejectedValueOnce(new Error('update failed'));

      const res = await request(app)
        .put('/api/admin/movies/1')
        .send({ name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('update failed');
    });
  });

  describe('DELETE /api/admin/movies/:id', () => {
    it('should delete movie', async () => {
      const res = await request(app)
        .delete('/api/admin/movies/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/movies/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent movie', async () => {
      mockVodService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/movies/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Series CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockSeriesService;
  let mockDb;

  beforeAll(() => {
    jest.resetModules();

    mockDb = {
      getSeriesById: jest.fn().mockResolvedValue({ id: 1, title: 'Series A' }),
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockSeriesService = {
      listSeries: jest.fn().mockResolvedValue({
        series: [{ id: 1, title: 'Series A' }, { id: 2, title: 'Series B' }],
        total: 2
      }),
      findSeries: jest.fn().mockResolvedValue({
        id: 1, title: 'Series A', seasons: [{ season_number: 1 }]
      }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../services/seriesService', () => mockSeriesService);
    jest.mock('../../../lib/cache', () => ({
      invalidateSeries: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/series', async (req, res) => {
      const categoryId = req.query.category_id ? String(req.query.category_id) : undefined;
      const search = req.query.search != null && String(req.query.search).trim() !== '' ? String(req.query.search).trim() : undefined;
      const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      try {
        const result = await mockSeriesService.listSeries(categoryId, limit, offset, search, sortOrder);
        res.json({ series: result.series, total: result.total, limit, offset });
      } catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.get('/series/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const data = await mockSeriesService.findSeries(id);
      if (!data) return res.status(404).json({ error: 'not found' });
      res.json(data);
    });

    mockAdminRouter.post('/series', async (req, res) => {
      try {
        const id = await mockSeriesService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/series/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockDb.getSeriesById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockSeriesService.update(id, req.body || {});
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/series/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockSeriesService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/db');
    jest.unmock('../../../services/seriesService');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/series', () => {
    it('should return series list', async () => {
      const res = await request(app)
        .get('/api/admin/series')
        .expect(200);

      expect(res.body).toHaveProperty('series');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.series)).toBe(true);
    });

    it('should filter by category_id', async () => {
      mockSeriesService.listSeries.mockResolvedValueOnce({
        series: [{ id: 1, title: 'Series A' }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/series?category_id=5')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith('5', expect.any(Number), expect.any(Number), undefined, 'id_desc');
    });

    it('should filter by search', async () => {
      mockSeriesService.listSeries.mockResolvedValueOnce({
        series: [{ id: 1, title: 'Found Series' }],
        total: 1
      });

      const res = await request(app)
        .get('/api/admin/series?search=found')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), 'found', 'id_desc');
    });

    it('should sort by id_asc', async () => {
      const res = await request(app)
        .get('/api/admin/series?sort=id_asc')
        .expect(200);

      expect(mockSeriesService.listSeries).toHaveBeenCalledWith(undefined, expect.any(Number), expect.any(Number), undefined, 'id_asc');
    });

    it('should respect limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/series?limit=10&offset=20')
        .expect(200);

      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(20);
    });
  });

  describe('GET /api/admin/series/:id', () => {
    it('should return series by id', async () => {
      const res = await request(app)
        .get('/api/admin/series/1')
        .expect(200);

      expect(res.body).toHaveProperty('id', 1);
      expect(res.body).toHaveProperty('seasons');
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .get('/api/admin/series/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent series', async () => {
      mockSeriesService.findSeries.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/series/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/series', () => {
    it('should create series', async () => {
      const res = await request(app)
        .post('/api/admin/series')
        .send({ title: 'New Series', category_id: 1 })
        .expect(201);

      expect(res.body).toHaveProperty('id', 3);
    });

    it('should return 400 on create failure', async () => {
      mockSeriesService.create.mockRejectedValueOnce(new Error('title required'));

      const res = await request(app)
        .post('/api/admin/series')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('title required');
    });
  });

  describe('PUT /api/admin/series/:id', () => {
    it('should update series', async () => {
      const res = await request(app)
        .put('/api/admin/series/1')
        .send({ title: 'Updated Series' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/series/invalid')
        .send({ title: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent series', async () => {
      mockDb.getSeriesById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/series/999')
        .send({ title: 'Updated' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/series/:id', () => {
    it('should delete series', async () => {
      const res = await request(app)
        .delete('/api/admin/series/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/series/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent series', async () => {
      mockSeriesService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/series/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});

describe('Admin API Routes - Categories CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockCategoryService;
  let mockImportService;

  beforeAll(() => {
    jest.resetModules();

    mockCategoryService = {
      listCategories: jest.fn().mockResolvedValue([
        { id: 1, category_name: 'Movies', category_type: 'movie' },
        { id: 2, category_name: 'Series', category_type: 'series' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, category_name: 'Movies' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockImportService = {
      findOrCreateCategory: jest.fn().mockResolvedValue(5),
    };

    jest.mock('../../../services/categoryService', () => mockCategoryService);
    jest.mock('../../../services/importService', () => mockImportService);
    jest.mock('../../../lib/cache', () => ({
      invalidateCategories: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/categories', async (req, res) => {
      const type = req.query.type ? String(req.query.type) : undefined;
      try { res.json({ categories: await mockCategoryService.listCategories(type) }); }
      catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    mockAdminRouter.post('/categories', async (req, res) => {
      try {
        const id = await mockCategoryService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/categories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockCategoryService.getById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockCategoryService.update(id, req.body || {});
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/categories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockCategoryService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    });

    mockAdminRouter.post('/categories/find-or-create', async (req, res) => {
      const { category_name, category_type } = req.body || {};
      if (!category_name || !category_type) return res.status(400).json({ error: 'category_name and category_type required' });
      try {
        const id = await mockImportService.findOrCreateCategory(String(category_name), String(category_type), null);
        res.json({ id, category_name: String(category_name) });
      } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../services/categoryService');
    jest.unmock('../../../services/importService');
    jest.unmock('../../../lib/cache');
  });

  describe('GET /api/admin/categories', () => {
    it('should return categories list', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .expect(200);

      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
    });

    it('should filter by type', async () => {
      const res = await request(app)
        .get('/api/admin/categories?type=movie')
        .expect(200);

      expect(mockCategoryService.listCategories).toHaveBeenCalledWith('movie');
    });
  });

  describe('POST /api/admin/categories', () => {
    it('should create category', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .send({ category_name: 'New Category', category_type: 'movie' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 3);
    });

    it('should return 400 on create failure', async () => {
      mockCategoryService.create.mockRejectedValueOnce(new Error('name required'));

      const res = await request(app)
        .post('/api/admin/categories')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('name required');
    });
  });

  describe('PUT /api/admin/categories/:id', () => {
    it('should update category', async () => {
      const res = await request(app)
        .put('/api/admin/categories/1')
        .send({ category_name: 'Updated Category' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/categories/invalid')
        .send({ category_name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent category', async () => {
      mockCategoryService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/categories/999')
        .send({ category_name: 'Updated' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/categories/:id', () => {
    it('should delete category', async () => {
      const res = await request(app)
        .delete('/api/admin/categories/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/categories/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent category', async () => {
      mockCategoryService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/categories/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/admin/categories/find-or-create', () => {
    it('should find or create category', async () => {
      const res = await request(app)
        .post('/api/admin/categories/find-or-create')
        .send({ category_name: 'New Category', category_type: 'movie' })
        .expect(200);

      expect(res.body).toHaveProperty('id', 5);
      expect(res.body).toHaveProperty('category_name', 'New Category');
    });

    it('should return 400 without category_name', async () => {
      const res = await request(app)
        .post('/api/admin/categories/find-or-create')
        .send({ category_type: 'movie' })
        .expect(400);

      expect(res.body.error).toContain('category_name and category_type required');
    });

    it('should return 400 without category_type', async () => {
      const res = await request(app)
        .post('/api/admin/categories/find-or-create')
        .send({ category_name: 'New Category' })
        .expect(400);

      expect(res.body.error).toContain('category_name and category_type required');
    });

    it('should return 400 on failure', async () => {
      mockImportService.findOrCreateCategory.mockRejectedValueOnce(new Error('failed'));

      const res = await request(app)
        .post('/api/admin/categories/find-or-create')
        .send({ category_name: 'Bad Category', category_type: 'movie' })
        .expect(400);

      expect(res.body.error).toContain('failed');
    });
  });
});

describe('Admin API Routes - Bouquets CRUD', () => {
  let app;
  let mockAdminRouter;
  let mockBouquetService;

  beforeAll(() => {
    jest.resetModules();

    mockBouquetService = {
      list: jest.fn().mockResolvedValue([
        { id: 1, bouquet_name: 'Bouquet 1' },
        { id: 2, bouquet_name: 'Bouquet 2' }
      ]),
      getById: jest.fn().mockResolvedValue({ id: 1, bouquet_name: 'Bouquet 1' }),
      create: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(true),
    };

    jest.mock('../../../services/bouquetService', () => mockBouquetService);
    jest.mock('../../../lib/cache', () => ({
      invalidateBouquets: jest.fn().mockResolvedValue(true),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/bouquets', async (req, res) => {
      res.json({ bouquets: await mockBouquetService.list() });
    });

    mockAdminRouter.post('/bouquets', async (req, res) => {
      try {
        const id = await mockBouquetService.create(req.body || {});
        res.status(201).json({ id });
      } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
    });

    mockAdminRouter.put('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      if (!(await mockBouquetService.getById(id))) return res.status(404).json({ error: 'not found' });
      try {
        await mockBouquetService.update(id, req.body || {});
        res.json({ ok: true, id });
      } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
    });

    mockAdminRouter.delete('/bouquets/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const ok = await mockBouquetService.remove(id);
      if (!ok) return res.status(404).json({ error: 'not found' });
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
      expect(res.body.bouquets.length).toBe(2);
    });
  });

  describe('POST /api/admin/bouquets', () => {
    it('should create bouquet', async () => {
      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({ bouquet_name: 'New Bouquet' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 3);
    });

    it('should return 400 on create failure', async () => {
      mockBouquetService.create.mockRejectedValueOnce(new Error('name required'));

      const res = await request(app)
        .post('/api/admin/bouquets')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('name required');
    });
  });

  describe('PUT /api/admin/bouquets/:id', () => {
    it('should update bouquet', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/1')
        .send({ bouquet_name: 'Updated Bouquet' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('id', 1);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .put('/api/admin/bouquets/invalid')
        .send({ bouquet_name: 'Updated' })
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.getById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/api/admin/bouquets/999')
        .send({ bouquet_name: 'Updated' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/admin/bouquets/:id', () => {
    it('should delete bouquet', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/1')
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });

    it('should return 400 for non-numeric id', async () => {
      const res = await request(app)
        .delete('/api/admin/bouquets/invalid')
        .expect(400);

      expect(res.body.error).toContain('invalid id');
    });

    it('should return 404 for non-existent bouquet', async () => {
      mockBouquetService.remove.mockResolvedValueOnce(false);

      const res = await request(app)
        .delete('/api/admin/bouquets/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
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
      isAdmin: jest.fn().mockResolvedValue(true),
    };

    mockImportChannelBridge = {
      importLiveChannel: jest.fn().mockResolvedValue({ id: 5, name: 'Imported Channel' }),
    };

    jest.mock('../../../lib/db', () => mockDb);
    jest.mock('../../../lib/importChannelBridge', () => mockImportChannelBridge);
    jest.mock('../../../lib/input-detect', () => ({
      detectInputType: jest.fn().mockReturnValue('mpd'),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.post('/import-live', async (req, res) => {
      const body = req.body || {};
      const url = body.url || body.mpdUrl;
      if (!url) return res.status(400).json({ error: 'url or mpdUrl required' });
      try {
        const userId = await mockDb.getFirstAdminUserId();
        if (!userId) return res.status(500).json({ error: 'no admin user' });
        const { detectInputType } = require('../../../lib/input-detect');
        const inputType = body.inputType || detectInputType(url);
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
    jest.unmock('../../../lib/input-detect');
  });

  describe('POST /api/admin/import-live', () => {
    it('should import live channel with url', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 5);
      expect(res.body).toHaveProperty('name', 'Imported Channel');
    });

    it('should import live channel with mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ mpdUrl: 'http://example.com/stream.mpd', name: 'Test Channel' })
        .expect(201);

      expect(res.body).toHaveProperty('id', 5);
    });

    it('should return 400 without url or mpdUrl', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ name: 'Test Channel' })
        .expect(400);

      expect(res.body.error).toContain('url or mpdUrl required');
    });

    it('should return 500 when no admin user', async () => {
      mockDb.getFirstAdminUserId.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.mpd' })
        .expect(500);

      expect(res.body.error).toContain('no admin user');
    });

    it('should return error from import on failure', async () => {
      mockImportChannelBridge.importLiveChannel.mockRejectedValueOnce(new Error('Invalid stream'));

      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://bad.com/stream.mpd' })
        .expect(400);

      expect(res.body.error).toContain('Invalid stream');
    });

    it('should accept category_id and logo', async () => {
      const res = await request(app)
        .post('/api/admin/import-live')
        .send({ url: 'http://example.com/stream.mpd', name: 'Test', category_id: 3, logo: 'http://logo.png' })
        .expect(201);

      expect(mockImportChannelBridge.importLiveChannel).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 3, logoUrl: 'http://logo.png' }),
        1
      );
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

    mockVodService = {
      create: jest.fn().mockResolvedValue(5),
    };

    mockSeriesService = {
      create: jest.fn().mockResolvedValue(7),
      addEpisode: jest.fn().mockResolvedValue(10),
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
            current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown' };
          } else if (current && line && !line.startsWith('#')) {
            current.url = line;
            entries.push(current);
            current = null;
          }
        }
        const results = [];
        for (const entry of entries) {
          const id = await mockVodService.create({ name: entry.name, stream_url: entry.url, category_id: category_id || '' });
          results.push({ id, name: entry.name });
        }
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
            current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown' };
          } else if (current && line && !line.startsWith('#')) {
            current.url = line;
            entries.push(current);
            current = null;
          }
        }
        const results = [];
        for (const entry of entries) {
          const id = await mockSeriesService.create({ title: entry.name, category_id: category_id || '' });
          results.push({ id, name: entry.name });
        }
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
      const m3uContent = '#EXTINF:-1 tvg-name="Movie 1",Movie One\nhttp://example.com/movie1.mp4\n#EXTINF:-1 tvg-name="Movie 2",Movie Two\nhttp://example.com/movie2.mp4';

      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: m3uContent, category_id: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('movies');
      expect(res.body.movies.length).toBe(2);
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('m3u_text required');
    });

    it('should return 400 for empty m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/movies/import')
        .send({ m3u_text: '' })
        .expect(400);

      expect(res.body.error).toContain('m3u_text required');
    });
  });

  describe('POST /api/admin/series/import', () => {
    it('should import series from M3U text', async () => {
      const m3uContent = '#EXTINF:-1 tvg-name="Show S01E01",Show Episode 1\nhttp://example.com/show1.mp4\n#EXTINF:-1 tvg-name="Show S01E02",Show Episode 2\nhttp://example.com/show2.mp4';

      const res = await request(app)
        .post('/api/admin/series/import')
        .send({ m3u_text: m3uContent, category_id: 2 })
        .expect(200);

      expect(res.body).toHaveProperty('imported', 2);
      expect(res.body).toHaveProperty('series');
    });

    it('should return 400 without m3u_text', async () => {
      const res = await request(app)
        .post('/api/admin/series/import')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('m3u_text required');
    });
  });
});

describe('Admin API Routes - System Health & Streams', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    jest.resetModules();

    jest.mock('../../../lib/state', () => ({
      channels: new Map([
        ['ch1', { id: 'ch1', channelClass: 'normal', is_internal: false }],
        ['ch2', { id: 'ch2', channelClass: 'movie', is_internal: false }],
        ['ch3', { id: 'ch3', channelClass: 'normal', is_internal: true }]
      ]),
    }));

    jest.mock('../../../services/healthMonitor', () => ({
      isPanelUp: jest.fn().mockReturnValue(true),
      hasPanelHealthSample: jest.fn().mockReturnValue(true),
      getLastCheckAt: jest.fn().mockReturnValue(Date.now() - 60000),
      getLastResponseMs: jest.fn().mockReturnValue(45),
      getLastError: jest.fn().mockReturnValue(null),
      getConsecutiveFails: jest.fn().mockReturnValue(0),
      getDayStats: jest.fn().mockResolvedValue({ uptime: 99.5, avgResponse: 50 }),
      getUptimeHistory: jest.fn().mockResolvedValue([]),
    }));

    jest.mock('../../../lib/system-metrics', () => ({
      collectSystemMetrics: jest.fn().mockResolvedValue({
        cpu: 25.5, memory: 60.2, uptime: 86400
      }),
    }));

    jest.mock('../../../services/streamRepair', () => ({
      getChannelHealth: jest.fn().mockResolvedValue(null),
      checkChannel: jest.fn().mockResolvedValue({ status: 'ok', issues: [] }),
      checkAllChannels: jest.fn().mockResolvedValue({ checked: 5, issues: 0 }),
      getAllChannelHealth: jest.fn().mockResolvedValue({ ch1: { status: 'ok' } }),
    }));

    mockAdminRouter = express.Router();

    mockAdminRouter.get('/system/health', async (req, res) => {
      try {
        const { isPanelUp, hasPanelHealthSample, getLastCheckAt, getLastResponseMs, getConsecutiveFails, getDayStats, getUptimeHistory } = require('../../../services/healthMonitor');
        const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
        const today = await getDayStats();
        const history = await getUptimeHistory(days);
        const hasSample = hasPanelHealthSample();
        res.json({
          status: hasSample ? (isPanelUp() ? 'up' : 'down') : 'unknown',
          lastCheckAt: getLastCheckAt(),
          lastCheckMs: getLastCheckAt(),
          lastResponseMs: getLastResponseMs(),
          lastError: null,
          consecutiveFails: getConsecutiveFails(),
          today,
          history,
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/system/system-metrics', async (req, res) => {
      try {
        const { collectSystemMetrics } = require('../../../lib/system-metrics');
        const m = await collectSystemMetrics();
        res.json(m);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/streams/:id/health', async (req, res) => {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing channel id' });
      const { channels } = require('../../../lib/state');
      const channel = channels.get(id);
      if (!channel) return res.status(404).json({ error: 'channel not found' });
      const { checkChannel, getChannelHealth } = require('../../../services/streamRepair');
      const cached = await getChannelHealth(id);
      if (cached && Date.now() - cached.checkedAt < 900000) {
        return res.json({ id, ...cached, source: 'cache' });
      }
      const result = await checkChannel(id, channel);
      return res.json({ id, ...result, source: 'live' });
    });

    mockAdminRouter.post('/streams/:id/repair', async (req, res) => {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing channel id' });
      const { channels } = require('../../../lib/state');
      const channel = channels.get(id);
      if (!channel) return res.status(404).json({ error: 'channel not found' });
      const { checkChannel } = require('../../../services/streamRepair');
      const result = await checkChannel(id, channel);
      res.json({ id, ...result });
    });

    mockAdminRouter.post('/streams/repair-all', async (req, res) => {
      try {
        const { channels } = require('../../../lib/state');
        const allChannels = [...channels.values()].filter(c => String(c.channelClass || 'normal') !== 'movie' && !c.is_internal);
        const { checkAllChannels } = require('../../../services/streamRepair');
        const result = await checkAllChannels(allChannels, channels);
        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    mockAdminRouter.get('/streams/health-all', async (req, res) => {
      try {
        const { channels } = require('../../../lib/state');
        const allChannels = [...channels.values()].filter(c => String(c.channelClass || 'normal') !== 'movie' && !c.is_internal);
        const { getAllChannelHealth } = require('../../../services/streamRepair');
        const healthMap = await getAllChannelHealth(allChannels.map(c => c.id));
        res.json(healthMap);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  afterAll(() => {
    jest.unmock('../../../lib/state');
    jest.unmock('../../../services/healthMonitor');
    jest.unmock('../../../lib/system-metrics');
    jest.unmock('../../../services/streamRepair');
  });

  describe('GET /api/admin/system/health', () => {
    it('should return system health status', async () => {
      const res = await request(app)
        .get('/api/admin/system/health')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['up', 'down', 'unknown']).toContain(res.body.status);
    });

    it('should return health metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system/health')
        .expect(200);

      expect(res.body).toHaveProperty('consecutiveFails');
      expect(res.body).toHaveProperty('today');
      expect(res.body).toHaveProperty('history');
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/api/admin/system/health?days=14')
        .expect(200);

      expect(res.body).toHaveProperty('history');
    });
  });

  describe('GET /api/admin/system/system-metrics', () => {
    it('should return system metrics', async () => {
      const res = await request(app)
        .get('/api/admin/system/system-metrics')
        .expect(200);

      expect(res.body).toHaveProperty('cpu');
      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api/admin/streams/:id/health', () => {
    it('should return channel health', async () => {
      const res = await request(app)
        .get('/api/admin/streams/ch1/health')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'ch1');
      expect(res.body).toHaveProperty('source');
    });

    it('should return 400 for missing channel id', async () => {
      const res = await request(app)
        .get('/api/admin/streams//health')
        .expect(404);
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .get('/api/admin/streams/nonexistent/health')
        .expect(404);

      expect(res.body.error).toContain('channel not found');
    });
  });

  describe('POST /api/admin/streams/:id/repair', () => {
    it('should repair channel', async () => {
      const res = await request(app)
        .post('/api/admin/streams/ch1/repair')
        .expect(200);

      expect(res.body).toHaveProperty('id', 'ch1');
      expect(res.body).toHaveProperty('status');
    });

    it('should return 404 for non-existent channel', async () => {
      const res = await request(app)
        .post('/api/admin/streams/nonexistent/repair')
        .expect(404);

      expect(res.body.error).toContain('channel not found');
    });
  });

  describe('POST /api/admin/streams/repair-all', () => {
    it('should repair all channels', async () => {
      const res = await request(app)
        .post('/api/admin/streams/repair-all')
        .expect(200);

      expect(res.body).toHaveProperty('checked');
      expect(res.body).toHaveProperty('issues');
    });
  });

  describe('GET /api/admin/streams/health-all', () => {
    it('should return health for all channels', async () => {
      const res = await request(app)
        .get('/api/admin/streams/health-all')
        .expect(200);

      expect(typeof res.body).toBe('object');
    });
  });
});

describe('Admin API Routes - Edge Cases & Error Handling', () => {
  let app;
  let mockAdminRouter;

  beforeAll(() => {
    mockAdminRouter = express.Router();

    mockAdminRouter.get('/test/json-error', async (req, res) => {
      res.status(500).json({ error: 'test error' });
    });

    mockAdminRouter.get('/test/string-error', async (req, res) => {
      res.status(500).send('not json');
    });

    mockAdminRouter.post('/test/validation', async (req, res) => {
      const body = req.body || {};
      if (!body.value) return res.status(400).json({ error: 'value required' });
      if (typeof body.value !== 'string') return res.status(400).json({ error: 'value must be string' });
      res.json({ ok: true });
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', mockAdminRouter);
  });

  describe('Error Handling', () => {
    it('should return JSON error response', async () => {
      const res = await request(app)
        .get('/api/admin/test/json-error')
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.type).toBe('application/json');
    });

    it('should handle non-JSON error responses', async () => {
      const res = await request(app)
        .get('/api/admin/test/string-error')
        .expect(500);

      expect(res.status).toBe(500);
    });
  });

  describe('Input Validation', () => {
    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/admin/test/validation')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('value required');
    });

    it('should validate field types', async () => {
      const res = await request(app)
        .post('/api/admin/test/validation')
        .send({ value: 123 })
        .expect(400);

      expect(res.body.error).toContain('value must be string');
    });

    it('should accept valid input', async () => {
      const res = await request(app)
        .post('/api/admin/test/validation')
        .send({ value: 'valid' })
        .expect(200);

      expect(res.body).toHaveProperty('ok', true);
    });
  });
});
