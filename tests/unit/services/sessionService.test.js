'use strict';

const mockTokenStore = new Map();
const mockUserSessions = new Map();

function mockGetSessionSet(key) {
  if (!mockUserSessions.has(key)) mockUserSessions.set(key, new Map());
  return mockUserSessions.get(key);
}

jest.mock('../../../lib/redis', () => ({
  getClient: jest.fn(() => ({
    get: jest.fn(async (key) => mockTokenStore.has(key) ? mockTokenStore.get(key) : null),
    setex: jest.fn(async (key, _ttl, value) => { mockTokenStore.set(key, value); return 'OK'; }),
    del: jest.fn(async (key) => { mockTokenStore.delete(key); return 1; }),
    zadd: jest.fn(async (key, score, member) => { mockGetSessionSet(key).set(String(member), Number(score)); return 1; }),
    zrange: jest.fn(async (key) => [...mockGetSessionSet(key).entries()].sort((a, b) => a[1] - b[1]).map(([member]) => member)),
    zrem: jest.fn(async (key, ...members) => {
      const set = mockGetSessionSet(key);
      let removed = 0;
      for (const member of members) {
        if (set.delete(String(member))) removed++;
      }
      return removed;
    }),
  })),
}));

jest.mock('../../../services/userService', () => ({
  getUserById: jest.fn(),
  isUserAllowed: jest.fn(() => ({ ok: true })),
}));

const userService = require('../../../services/userService');

describe('SessionService', () => {
  const sessionService = require('../../../services/sessionService');

  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenStore.clear();
    mockUserSessions.clear();
  });

  describe('issueToken', () => {
    it('should issue a token for valid user', async () => {
      const user = { id: 1, meta: { maxConnections: 3 } };

      const result = await sessionService.issueToken(user, 'stream1', '127.0.0.1');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');
      expect(result.token).toHaveLength(48);
    });

    it('should use default maxConnections if not specified', async () => {
      const user = { id: 2, meta: {} };

      const result = await sessionService.issueToken(user, 'stream1', '127.0.0.1');

      expect(result).toHaveProperty('token');
    });
  });

  describe('validateToken', () => {
    it('should return null for unknown token', async () => {
      const result = await sessionService.validateToken('unknown-token', '127.0.0.1');
      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const user = { id: 1, meta: { maxConnections: 3 } };
      const { token } = await sessionService.issueToken(user, 'stream1', '127.0.0.1', -1);

      const result = await sessionService.validateToken(token, '127.0.0.1');
      expect(result).toBeNull();
    });

    it('should resolve a valid redis-backed token', async () => {
      const user = { id: 1, meta: { maxConnections: 3 } };
      userService.getUserById.mockResolvedValue({ id: 1, username: 'user1', meta: user.meta });
      const { token } = await sessionService.issueToken(user, 'stream1', '127.0.0.1');

      const result = await sessionService.validateToken(token, '127.0.0.1');

      expect(result).toHaveProperty('user.id', 1);
      expect(result).toHaveProperty('channelId', 'stream1');
    });
  });

  describe('endSession', () => {
    it('should end an existing session', async () => {
      const user = { id: 1, meta: { maxConnections: 3 } };
      const { token } = await sessionService.issueToken(user, 'stream1', '127.0.0.1');

      await sessionService.endSession(token);

      const result = await sessionService.validateToken(token, '127.0.0.1');
      expect(result).toBeNull();
    });

    it('should not throw for unknown token', async () => {
      await expect(sessionService.endSession('unknown-token')).resolves.toBeUndefined();
    });
  });

  describe('canOpenConnection', () => {
    it('should return true if under max connections', async () => {
      const user = { id: 1, meta: { maxConnections: 3 } };

      await expect(sessionService.canOpenConnection(user)).resolves.toBe(true);
    });

    it('should return false if at max connections', async () => {
      const user = { id: 1, meta: { maxConnections: 1 } };
      await sessionService.issueToken(user, 'stream1', '127.0.0.1');

      await expect(sessionService.canOpenConnection(user)).resolves.toBe(false);
    });
  });

  describe('getActive', () => {
    it('should return 0 for unknown user', async () => {
      await expect(sessionService.getActive(999)).resolves.toBe(0);
    });
  });

  describe('decActive', () => {
    it('should not go below 0', async () => {
      await sessionService.decActive(999, 'unknown');
      await expect(sessionService.getActive(999)).resolves.toBe(0);
    });
  });
});
