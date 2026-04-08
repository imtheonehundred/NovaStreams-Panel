'use strict';

jest.mock('../../../lib/db', () => ({
  listCategories: jest.fn(),
  getCategoryById: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const categoryService = require('../../../services/categoryService');

describe('CategoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listCategories', () => {
    it('should list all categories for type', async () => {
      const categories = [
        { id: 1, name: 'Sports', category_type: 'live' },
        { id: 2, name: 'Movies', category_type: 'movie' },
      ];
      dbApi.listCategories.mockResolvedValue(categories);

      const result = await categoryService.listCategories('live');

      expect(result).toEqual(categories);
      expect(dbApi.listCategories).toHaveBeenCalledWith('live');
    });

    it('should list all categories without type filter', async () => {
      dbApi.listCategories.mockResolvedValue([]);

      await categoryService.listCategories();

      expect(dbApi.listCategories).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getById', () => {
    it('should return category by id', async () => {
      const category = { id: 1, name: 'Sports', category_type: 'live' };
      dbApi.getCategoryById.mockResolvedValue(category);

      const result = await categoryService.getById(1);

      expect(result).toEqual(category);
      expect(dbApi.getCategoryById).toHaveBeenCalledWith(1);
    });

    it('should return null if not found', async () => {
      dbApi.getCategoryById.mockResolvedValue(null);

      const result = await categoryService.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a category with valid type', async () => {
      dbApi.createCategory.mockResolvedValue(1);
      const data = { name: 'New Category', category_type: 'live' };

      const result = await categoryService.create(data);

      expect(result).toBe(1);
      expect(dbApi.createCategory).toHaveBeenCalledWith({ ...data, category_type: 'live' });
    });

    it('should throw for invalid category_type', async () => {
      const data = { name: 'Bad Category', category_type: 'invalid' };

      await expect(categoryService.create(data)).rejects.toThrow('category_type must be one of');
    });

    it('should default to live type', async () => {
      dbApi.createCategory.mockResolvedValue(1);
      const data = { name: 'Default Type' };

      await categoryService.create(data);

      expect(dbApi.createCategory).toHaveBeenCalledWith({ ...data, category_type: 'live' });
    });

    it('should accept all valid types', async () => {
      dbApi.createCategory.mockResolvedValue(1);
      const validTypes = ['live', 'movie', 'series', 'radio'];

      for (const type of validTypes) {
        await categoryService.create({ name: type, category_type: type });
      }

      expect(dbApi.createCategory).toHaveBeenCalledTimes(4);
    });
  });

  describe('update', () => {
    it('should update category', async () => {
      dbApi.updateCategory.mockResolvedValue({ id: 1, name: 'Updated' });
      const data = { name: 'Updated Name' };

      const result = await categoryService.update(1, data);

      expect(dbApi.updateCategory).toHaveBeenCalledWith(1, data);
    });

    it('should throw for invalid category_type in patch', async () => {
      const data = { category_type: 'invalid' };

      await expect(categoryService.update(1, data)).rejects.toThrow('category_type must be one of');
    });

    it('should allow update without category_type', async () => {
      dbApi.updateCategory.mockResolvedValue({ id: 1, name: 'Updated' });
      const data = { name: 'Updated Name' };

      await categoryService.update(1, data);

      expect(dbApi.updateCategory).toHaveBeenCalledWith(1, data);
    });
  });

  describe('remove', () => {
    it('should delete category', async () => {
      dbApi.deleteCategory.mockResolvedValue(1);

      await categoryService.remove(1);

      expect(dbApi.deleteCategory).toHaveBeenCalledWith(1);
    });
  });
});
