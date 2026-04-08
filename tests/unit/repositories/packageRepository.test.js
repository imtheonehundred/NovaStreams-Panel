'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const packageRepo = require('../../../repositories/packageRepository');

describe('Package Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPackages', () => {
    it('should list all packages', async () => {
      query.mockResolvedValue([{ id: 1, package_name: 'Basic' }]);
      const result = await packageRepo.listPackages();
      expect(query).toHaveBeenCalledWith('SELECT * FROM packages ORDER BY id');
      expect(result).toHaveLength(1);
    });
  });

  describe('getPackageById', () => {
    it('should get package by id', async () => {
      queryOne.mockResolvedValue({ id: 1, package_name: 'Basic' });
      const result = await packageRepo.getPackageById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM packages WHERE id = ?', [1]);
      expect(result.package_name).toBe('Basic');
    });
  });

  describe('createPackage', () => {
    it('should insert package and return id', async () => {
      insert.mockResolvedValue(42);
      const data = {
        package_name: 'Premium',
        is_trial: 1,
      };
      const result = await packageRepo.createPackage(data);
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(42);
    });
  });

  describe('updatePackage', () => {
    it('should update package fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await packageRepo.updatePackage(1, { package_name: 'Updated', max_connections: 10 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE packages');
    });

    it('should update JSON fields with stringified values', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await packageRepo.updatePackage(1, { groups: [1, 2], bouquets: [3] });
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await packageRepo.updatePackage(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deletePackage', () => {
    it('should delete package by id', async () => {
      remove.mockResolvedValue(1);
      const result = await packageRepo.deletePackage(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM packages WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});
