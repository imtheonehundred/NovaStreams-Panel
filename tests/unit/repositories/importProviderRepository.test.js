'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');
const importProviderRepository = require('../../../repositories/importProviderRepository');

describe('importProviderRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureImportProvidersTable', () => {
    it('should execute CREATE TABLE statement', async () => {
      execute.mockResolvedValue({});

      await importProviderRepository.ensureImportProvidersTable();

      expect(execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS import_providers'));
    });
  });

  describe('listImportProviders', () => {
    it('should return parsed providers', async () => {
      const rows = [
        { id: 1, name: 'Provider 1', movie_categories: '["cat1"]' },
        { id: 2, name: 'Provider 2', movie_categories: null },
      ];
      query.mockResolvedValue(rows);

      const result = await importProviderRepository.listImportProviders();

      expect(result).toHaveLength(2);
      expect(result[0].movie_categories).toEqual(['cat1']);
      expect(result[1].movie_categories).toEqual([]);
    });
  });

  describe('getImportProviderById', () => {
    it('should return parsed provider', async () => {
      const row = { id: 1, name: 'Provider', movie_categories: '["cat1"]' };
      queryOne.mockResolvedValue(row);

      const result = await importProviderRepository.getImportProviderById(1);

      expect(result.id).toBe(1);
      expect(result.movie_categories).toEqual(['cat1']);
    });

    it('should return null when not found', async () => {
      queryOne.mockResolvedValue(null);

      const result = await importProviderRepository.getImportProviderById(999);

      expect(result).toBeNull();
    });
  });

  describe('createImportProvider', () => {
    it('should create provider with all fields', async () => {
      insert.mockResolvedValue(5);

      const result = await importProviderRepository.createImportProvider({
        name: 'Test Provider',
        url: 'http://example.com',
        bouquet_id: 3,
        update_frequency: 60,
        last_updated: 123456,
        movie_categories: ['cat1', 'cat2'],
        series_categories: ['ser1'],
        live_categories: ['live1'],
      });

      expect(result).toBe(5);
      expect(insert).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO import_providers'),
        ['Test Provider', 'http://example.com', 3, 60, 123456, '["cat1","cat2"]', '["ser1"]', '["live1"]']
      );
    });

    it('should use defaults for optional fields', async () => {
      insert.mockResolvedValue(1);

      await importProviderRepository.createImportProvider({
        url: 'http://example.com',
      });

      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        ['Provider', 'http://example.com', 0, 0, 0, '[]', '[]', '[]']
      );
    });

    it('should throw error for missing url', async () => {
      await expect(importProviderRepository.createImportProvider({ name: 'Test' }))
        .rejects.toThrow('url required');
    });

    it('should handle non-array categories', async () => {
      insert.mockResolvedValue(1);

      await importProviderRepository.createImportProvider({
        url: 'http://example.com',
        movie_categories: 'not-array',
      });

      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['[]'])
      );
    });
  });

  describe('updateImportProvider', () => {
    it('should update all provided fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await importProviderRepository.updateImportProvider(1, {
        name: 'Updated Name',
        url: 'http://new.com',
        bouquet_id: 5,
        update_frequency: 120,
        last_updated: 999,
        movie_categories: ['new_cat'],
        series_categories: ['new_ser'],
        live_categories: ['new_live'],
      });

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE import_providers SET'),
        expect.arrayContaining(['Updated Name', 'http://new.com', 5, 120, 999, '["new_cat"]', '["new_ser"]', '["new_live"]', 1])
      );
    });

    it('should not execute when no fields provided', async () => {
      await importProviderRepository.updateImportProvider(1, {});

      expect(execute).not.toHaveBeenCalled();
    });

    it('should update only name', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await importProviderRepository.updateImportProvider(1, { name: 'Only Name' });

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('name = ?'),
        expect.arrayContaining(['Only Name', 1])
      );
    });
  });

  describe('deleteImportProvider', () => {
    it('should delete provider by id', async () => {
      remove.mockResolvedValue(true);

      const result = await importProviderRepository.deleteImportProvider(1);

      expect(remove).toHaveBeenCalledWith('DELETE FROM import_providers WHERE id = ?', [1]);
      expect(result).toBe(true);
    });
  });
});
