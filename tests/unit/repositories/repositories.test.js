'use strict';

const {
  getSetting,
  setSetting,
  getAllSettings,
} = require('../../../repositories/settingsRepository');

const {
  createUser,
  findUserByUsername,
  findUserById,
  getAllUsers,
  userCount,
  verifyPassword,
  updateUser,
  touchUserLastLogin,
  deleteUser,
  getUserGroup,
  isAdmin,
  isReseller,
} = require('../../../repositories/userRepository');

const {
  listUserGroups,
  getUserGroupById,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
} = require('../../../repositories/userGroupRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');
const bcrypt = require('bcryptjs');

describe('Settings Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getSetting', () => {
    it('should return value when key exists', async () => {
      queryOne.mockResolvedValue({ value: 'test_value' });
      const result = await getSetting('some_key');
      expect(result).toBe('test_value');
      expect(queryOne).toHaveBeenCalledWith('SELECT `value` FROM settings WHERE `key` = ?', ['some_key']);
    });

    it('should return empty string when key does not exist', async () => {
      queryOne.mockResolvedValue(null);
      const result = await getSetting('nonexistent');
      expect(result).toBe('');
    });
  });

  describe('setSetting', () => {
    it('should insert or update setting', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await setSetting('key', 'value');
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        ['key', 'value']
      );
    });
  });

  describe('getAllSettings', () => {
    it('should return settings as key-value object', async () => {
      query.mockResolvedValue([
        { key: 'setting1', value: 'value1' },
        { key: 'setting2', value: 'value2' },
      ]);
      const result = await getAllSettings();
      expect(result).toEqual({ setting1: 'value1', setting2: 'value2' });
    });
  });
});

describe('User Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createUser', () => {
    it('should hash password and insert user', async () => {
      bcrypt.hash.mockResolvedValue('hashed_password');
      insert.mockResolvedValue(1);
      await createUser('testuser', 'password123');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        ['testuser', 'hashed_password']
      );
    });
  });

  describe('findUserByUsername', () => {
    it('should query user by username', async () => {
      const mockUser = { id: 1, username: 'test', password_hash: 'hash' };
      queryOne.mockResolvedValue(mockUser);
      const result = await findUserByUsername('test');
      expect(result).toEqual(mockUser);
      expect(queryOne).toHaveBeenCalled();
    });
  });

  describe('findUserById', () => {
    it('should query user by id', async () => {
      const mockUser = { id: 1, username: 'test' };
      queryOne.mockResolvedValue(mockUser);
      const result = await findUserById(1);
      expect(result).toEqual(mockUser);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      bcrypt.compare.mockResolvedValue(true);
      const result = await verifyPassword({ password_hash: 'hash' }, 'password123');
      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hash');
    });

    it('should return false for incorrect password', async () => {
      bcrypt.compare.mockResolvedValue(false);
      const result = await verifyPassword({ password_hash: 'hash' }, 'wrong');
      expect(result).toBe(false);
    });
  });

  describe('getUserGroup', () => {
    it('should return user group for valid user', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 1 })
        .mockResolvedValueOnce({ group_id: 1, is_admin: 1, is_reseller: 0 });
      const result = await getUserGroup(1);
      expect(result).toEqual({ group_id: 1, is_admin: 1, is_reseller: 0 });
    });

    it('should return null for nonexistent user', async () => {
      queryOne.mockResolvedValueOnce(null);
      const result = await getUserGroup(999);
      expect(result).toBeNull();
    });
  });

  describe('isAdmin', () => {
    it('should return true for admin user', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 1 })
        .mockResolvedValueOnce({ group_id: 1, is_admin: 1 });
      const result = await isAdmin(1);
      expect(result).toBe(true);
    });

    it('should return false for non-admin user', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 2 })
        .mockResolvedValueOnce({ group_id: 2, is_admin: 0 });
      const result = await isAdmin(2);
      expect(result).toBe(false);
    });
  });

  describe('isReseller', () => {
    it('should return true for reseller user', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 1 })
        .mockResolvedValueOnce({ group_id: 1, is_reseller: 1 });
      const result = await isReseller(1);
      expect(result).toBe(true);
    });

    it('should return false for non-reseller user', async () => {
      queryOne
        .mockResolvedValueOnce({ member_group_id: 2 })
        .mockResolvedValueOnce({ group_id: 2, is_reseller: 0 });
      const result = await isReseller(2);
      expect(result).toBe(false);
    });
  });

  describe('deleteUser', () => {
    it('should delete user by id', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteUser(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [1]);
    });
  });
});

describe('UserGroup Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listUserGroups', () => {
    it('should return all user groups ordered by group_id', async () => {
      const mockGroups = [{ group_id: 1 }, { group_id: 2 }];
      query.mockResolvedValue(mockGroups);
      const result = await listUserGroups();
      expect(result).toEqual(mockGroups);
      expect(query).toHaveBeenCalledWith('SELECT * FROM user_groups ORDER BY group_id');
    });
  });

  describe('getUserGroupById', () => {
    it('should return user group by id', async () => {
      const mockGroup = { group_id: 1, group_name: 'Admins' };
      queryOne.mockResolvedValue(mockGroup);
      const result = await getUserGroupById(1);
      expect(result).toEqual(mockGroup);
    });
  });

  describe('createUserGroup', () => {
    it('should create user group with defaults', async () => {
      insert.mockResolvedValue(1);
      await createUserGroup({});
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO user_groups (group_name, is_admin, is_reseller, allowed_pages) VALUES (?, ?, ?, ?)',
        ['New Group', 0, 0, '[]']
      );
    });

    it('should create user group with provided values', async () => {
      insert.mockResolvedValue(2);
      await createUserGroup({ group_name: 'Resellers', is_admin: 0, is_reseller: 1 });
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO user_groups (group_name, is_admin, is_reseller, allowed_pages) VALUES (?, ?, ?, ?)',
        ['Resellers', 0, 1, '[]']
      );
    });
  });

  describe('updateUserGroup', () => {
    it('should update user group fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateUserGroup(1, { group_name: 'Updated Name', is_admin: 1 });
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await updateUserGroup(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteUserGroup', () => {
    it('should delete user group by id', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteUserGroup(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM user_groups WHERE group_id = ?', [1]);
    });
  });
});