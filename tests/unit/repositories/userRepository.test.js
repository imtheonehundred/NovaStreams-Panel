'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn(),
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const bcrypt = require('bcryptjs');
const userRepo = require('../../../repositories/userRepository');

describe('User Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createUser', () => {
    it('should create user with hashed password', async () => {
      insert.mockResolvedValue(1);
      await userRepo.createUser('testuser', 'password123');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        ['testuser', 'hashed_password']
      );
    });
  });

  describe('findUserByUsername', () => {
    it('should find user by username with all fields', async () => {
      queryOne.mockResolvedValue({ id: 1, username: 'testuser' });
      const result = await userRepo.findUserByUsername('testuser');
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT id, username, password_hash, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, api_key, last_login, created_at FROM users WHERE username = ?',
        ['testuser']
      );
      expect(result.username).toBe('testuser');
    });
  });

  describe('findUserById', () => {
    it('should find user by id', async () => {
      queryOne.mockResolvedValue({ id: 1, username: 'testuser' });
      const result = await userRepo.findUserById(1);
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, last_login, created_at FROM users WHERE id = ?',
        [1]
      );
    });
  });

  describe('getAllUsers', () => {
    it('should get all users', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await userRepo.getAllUsers();
      expect(query).toHaveBeenCalledWith(
        'SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, last_login, created_at FROM users'
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('userCount', () => {
    it('should return total user count', async () => {
      queryOne.mockResolvedValue({ c: 50 });
      const result = await userRepo.userCount();
      expect(result).toBe(50);
    });
  });

  describe('verifyPassword', () => {
    it('should verify password using bcrypt', async () => {
      bcrypt.compare.mockResolvedValue(true);
      const result = await userRepo.verifyPassword({ password_hash: 'hashed' }, 'password123');
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed');
      expect(result).toBe(true);
    });
  });

  describe('updateUser', () => {
    it('should update allowed fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await userRepo.updateUser(1, { email: 'test@test.com', credits: 100 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE users');
    });

    it('should hash new password if provided', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await userRepo.updateUser(1, { password: 'newpassword' });
      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await userRepo.updateUser(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('touchUserLastLogin', () => {
    it('should update last_login timestamp', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await userRepo.touchUserLastLogin(1, 1000000);
      expect(execute).toHaveBeenCalledWith('UPDATE users SET last_login = ? WHERE id = ?', [1000000, 1]);
    });

    it('should use current time if no timestamp provided', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await userRepo.touchUserLastLogin(1);
      expect(execute).toHaveBeenCalled();
      const [, params] = execute.mock.calls[0];
      expect(typeof params[0]).toBe('number');
    });
  });

  describe('deleteUser', () => {
    it('should delete user by id', async () => {
      remove.mockResolvedValue(1);
      const result = await userRepo.deleteUser(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });

  describe('getUserGroup', () => {
    it('should return null if user not found', async () => {
      queryOne.mockResolvedValue(null);
      const result = await userRepo.getUserGroup(1);
      expect(result).toBeNull();
    });

    it('should return user group', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 5 })
        .mockResolvedValueOnce({ group_id: 5, group_name: 'Admins' });
      const result = await userRepo.getUserGroup(1);
      expect(result.group_name).toBe('Admins');
    });
  });

  describe('isAdmin', () => {
    it('should return true for admin group', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 5 })
        .mockResolvedValueOnce({ group_id: 5, is_admin: 1 });
      const result = await userRepo.isAdmin(1);
      expect(result).toBe(true);
    });

    it('should return false for non-admin group', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 5 })
        .mockResolvedValueOnce({ group_id: 5, is_admin: 0 });
      const result = await userRepo.isAdmin(1);
      expect(result).toBe(false);
    });

    it('should return null if user has no group', async () => {
      queryOne.mockResolvedValueOnce(null);
      const result = await userRepo.isAdmin(1);
      expect(result).toBeNull();
    });
  });

  describe('isReseller', () => {
    it('should return true for reseller group', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 5 })
        .mockResolvedValueOnce({ group_id: 5, is_reseller: 1 });
      const result = await userRepo.isReseller(1);
      expect(result).toBe(true);
    });

    it('should return false for non-reseller group', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 5 })
        .mockResolvedValueOnce({ group_id: 5, is_reseller: 0 });
      const result = await userRepo.isReseller(1);
      expect(result).toBe(false);
    });
  });
});
