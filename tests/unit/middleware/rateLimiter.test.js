'use strict';

function createResponse(resolve) {
  return {
    headersSent: false,
    locals: {},
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    append(name, value) {
      this.setHeader(name, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      resolve({ nextCalled: false, statusCode: this.statusCode, body });
      return this;
    },
    send(body) {
      resolve({ nextCalled: false, statusCode: this.statusCode, body });
      return this;
    },
    end(body) {
      resolve({ nextCalled: false, statusCode: this.statusCode, body });
      return this;
    },
  };
}

function runMiddleware(middleware, reqOverrides = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      ip: '203.0.113.10',
      method: 'GET',
      path: '/api/test',
      headers: {},
      body: {},
      session: {},
      app: { get: () => 1 },
      ...reqOverrides,
    };
    const res = createResponse(resolve);
    const next = () =>
      resolve({ nextCalled: true, statusCode: res.statusCode });

    try {
      const result = middleware(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

describe('Rate Limiter Middleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowLocalNoRateLimit = process.env.ALLOW_LOCAL_NO_RATELIMIT;
  const originalDevDisableAuthLimit = process.env.DEV_DISABLE_AUTH_LIMIT;

  let streamLimiter;
  let authLimiter;
  let adminLimiter;
  let apiKeyLimiter;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_LOCAL_NO_RATELIMIT;
    delete process.env.DEV_DISABLE_AUTH_LIMIT;
    jest.resetModules();
    ({
      streamLimiter,
      authLimiter,
      adminLimiter,
      apiKeyLimiter,
    } = require('../../../middleware/rateLimiter'));
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowLocalNoRateLimit === undefined) {
      delete process.env.ALLOW_LOCAL_NO_RATELIMIT;
    } else {
      process.env.ALLOW_LOCAL_NO_RATELIMIT = originalAllowLocalNoRateLimit;
    }
    if (originalDevDisableAuthLimit === undefined) {
      delete process.env.DEV_DISABLE_AUTH_LIMIT;
    } else {
      process.env.DEV_DISABLE_AUTH_LIMIT = originalDevDisableAuthLimit;
    }
  });

  describe('streamLimiter', () => {
    it('should be a function', () => {
      expect(typeof streamLimiter).toBe('function');
    });

    it('should have the right number of arguments (express middleware signature)', () => {
      expect(streamLimiter.length).toBeLessThanOrEqual(3);
    });
  });

  describe('authLimiter', () => {
    it('should be a function', () => {
      expect(typeof authLimiter).toBe('function');
    });

    it('should have the right number of arguments (express middleware signature)', () => {
      expect(authLimiter.length).toBeLessThanOrEqual(3);
    });
  });

  describe('adminLimiter', () => {
    it('should be a function', () => {
      expect(typeof adminLimiter).toBe('function');
    });

    it('should have the right number of arguments (express middleware signature)', () => {
      expect(adminLimiter.length).toBeLessThanOrEqual(3);
    });

    it('rate-limits unauthenticated requests by IP', async () => {
      let result;
      for (let i = 0; i <= 200; i++) {
        result = await runMiddleware(adminLimiter, {
          ip: '198.51.100.20',
          session: {},
        });
      }
      expect(result.statusCode).toBe(429);
      expect(result.nextCalled).toBe(false);
    });

    it('only skips localhost when explicitly enabled', async () => {
      process.env.ALLOW_LOCAL_NO_RATELIMIT = '1';
      let result;
      for (let i = 0; i <= 200; i++) {
        result = await runMiddleware(adminLimiter, {
          ip: '127.0.0.1',
          session: {},
        });
      }
      expect(result.nextCalled).toBe(true);
    });
  });

  describe('apiKeyLimiter', () => {
    it('skips requests that do not include an API key header', async () => {
      let result;
      for (let i = 0; i <= 100; i++) {
        result = await runMiddleware(apiKeyLimiter, {
          ip: '198.51.100.30',
          headers: {},
        });
      }
      expect(result.nextCalled).toBe(true);
    });

    it('rate-limits requests when an API key is present', async () => {
      let result;
      for (let i = 0; i <= 100; i++) {
        result = await runMiddleware(apiKeyLimiter, {
          ip: '198.51.100.31',
          headers: { 'x-api-key': 'abcdef1234567890' },
        });
      }
      expect(result.statusCode).toBe(429);
      expect(result.nextCalled).toBe(false);
    });
  });
});
