'use strict';

jest.mock('../../../lib/db', () => ({
  createUser: jest.fn(),
  findUserByUsername: jest.fn(),
  findUserById: jest.fn(),
  getAllUsers: jest.fn(),
  verifyPassword: jest.fn(),
  getUserMeta: jest.fn(),
  setUserMeta: jest.fn(),
  listUserMetaMap: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const userService = require('../../../services/userService');

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create a user and set meta', async () => {
      dbApi.createUser.mockResolvedValue(1);
      dbApi.getUserMeta.mockResolvedValue(null);
      dbApi.setUserMeta.mockResolvedValue({ status: 'active', expiresAt: null, maxConnections: 3 });

      const userId = await userService.createUser('testuser', 'password123');

      expect(userId).toBe(1);
      expect(dbApi.createUser).toHaveBeenCalledWith('testuser', 'password123');
      expect(dbApi.setUserMeta).toHaveBeenCalledWith(1, { status: 'active', expiresAt: null, maxConnections: 3 });
    });

    it('should pass meta to setMeta', async () => {
      dbApi.createUser.mockResolvedValue(2);
      dbApi.getUserMeta.mockResolvedValue(null);
      dbApi.setUserMeta.mockResolvedValue({ status: 'active', expiresAt: null, maxConnections: 5 });

      await userService.createUser('admin', 'pass', { status: 'active', maxConnections: 5 });

      expect(dbApi.createUser).toHaveBeenCalledWith('admin', 'pass');
      expect(dbApi.setUserMeta).toHaveBeenCalledWith(2, { status: 'active', expiresAt: null, maxConnections: 5 });
    });
  });

  describe('getMeta', () => {
    it('should return default meta for unknown user', async () => {
      dbApi.getUserMeta.mockResolvedValue(null);
      const meta = await userService.getMeta(999);
      expect(meta).toEqual({ status: 'active', expiresAt: null, maxConnections: 3 });
    });
  });

  describe('getUserByUsername', () => {
    it('should return null if user not found', async () => {
      dbApi.findUserByUsername.mockResolvedValue(null);

      const user = await userService.getUserByUsername('unknown');

      expect(user).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('should return null if user not found', async () => {
      dbApi.findUserById.mockResolvedValue(null);

      const user = await userService.getUserById(999);

      expect(user).toBeNull();
    });
  });

  describe('verifyCredentials', () => {
    it('should return null if user not found', async () => {
      dbApi.findUserByUsername.mockResolvedValue(null);

      const user = await userService.verifyCredentials('unknown', 'password');

      expect(user).toBeNull();
    });

    it('should return null if password is wrong', async () => {
      dbApi.findUserByUsername.mockResolvedValue({ id: 1, username: 'testuser' });
      dbApi.verifyPassword.mockResolvedValue(false);

      const user = await userService.verifyCredentials('testuser', 'wrongpassword');

      expect(user).toBeNull();
    });
  });

  describe('isUserAllowed', () => {
    it('should return ok false if user is null', () => {
      const result = userService.isUserAllowed(null);
      expect(result).toEqual({ ok: false, reason: 'user_not_found' });
    });

    it('should return ok false if user is banned', () => {
      const user = { meta: { status: 'banned' } };
      const result = userService.isUserAllowed(user);
      expect(result).toEqual({ ok: false, reason: 'banned' });
    });

    it('should return ok false if user is expired', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const user = { meta: { status: 'active', expiresAt: past } };
      const result = userService.isUserAllowed(user);
      expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('should return ok true for active non-expired user', () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const user = { meta: { status: 'active', expiresAt: future } };
      const result = userService.isUserAllowed(user);
      expect(result).toEqual({ ok: true });
    });

    it('should return ok true for user without meta', () => {
      const result = userService.isUserAllowed({});
      expect(result).toEqual({ ok: true });
    });
  });

  describe('listUsers', () => {
    it('should return all users with meta', async () => {
      dbApi.getAllUsers.mockResolvedValue([
        { id: 1, username: 'user1' },
        { id: 2, username: 'user2' },
      ]);
      dbApi.listUserMetaMap.mockResolvedValue(new Map([[1, { status: 'active', maxConnections: 5 }]]));

      const users = await userService.listUsers();

      expect(users).toHaveLength(2);
      expect(users[0]).toHaveProperty('username', 'user1');
      expect(users[0]).toHaveProperty('meta');
    });
  });
});
