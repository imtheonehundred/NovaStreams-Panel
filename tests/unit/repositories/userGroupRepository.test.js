'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const userGroupRepo = require('../../../repositories/userGroupRepository');

describe('User Group Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listUserGroups', () => {
    it('should list all user groups', async () => {
      query.mockResolvedValue([{ group_id: 1, group_name: 'Admins' }]);
      const result = await userGroupRepo.listUserGroups();
      expect(query).toHaveBeenCalledWith('SELECT * FROM user_groups ORDER BY group_id');
      expect(result).toHaveLength(1);
    });
  });

  describe('getUserGroupById', () => {
    it('should get user group by id', async () => {
      queryOne.mockResolvedValue({ group_id: 1, group_name: 'Admins' });
      const result = await userGroupRepo.getUserGroupById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM user_groups WHERE group_id = ?', [1]);
      expect(result.group_name).toBe('Admins');
    });
  });

  describe('createUserGroup', () => {
    it('should insert user group and return id', async () => {
      insert.mockResolvedValue(42);
      const data = {
        group_name: 'Resellers',
        is_admin: 0,
        is_reseller: 1,
      };
      const result = await userGroupRepo.createUserGroup(data);
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(42);
    });
  });

  describe('updateUserGroup', () => {
    it('should update user group fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await userGroupRepo.updateUserGroup(1, { group_name: 'Updated', is_admin: 1 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE user_groups');
    });

    it('should do nothing if no fields provided', async () => {
      await userGroupRepo.updateUserGroup(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteUserGroup', () => {
    it('should delete user group by id', async () => {
      remove.mockResolvedValue(1);
      const result = await userGroupRepo.deleteUserGroup(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM user_groups WHERE group_id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});
