'use strict';

jest.mock('../../../lib/db', () => ({
  listCategories: jest.fn(),
  getMovieById: jest.fn(),
  createMovie: jest.fn(),
  updateMovie: jest.fn(),
  deleteMovie: jest.fn(),
  listMovies: jest.fn(),
  movieCount: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getBouquetIdsForEntity: jest.fn(),
  syncEntityBouquets: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const bouquetService = require('../../../services/bouquetService');
const vodService = require('../../../services/vodService');

describe('VodService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listCategories', () => {
    it('should return mapped categories', async () => {
      const rows = [
        { id: 1, category_name: 'Action', category_type: 'movie', parent_id: 0, cat_order: 1, is_adult: 0 },
      ];
      dbApi.listCategories.mockResolvedValue(rows);

      const result = await vodService.listCategories();

      expect(result[0].id).toBe('1');
      expect(result[0].name).toBe('Action');
      expect(dbApi.listCategories).toHaveBeenCalledWith('movie');
    });
  });

  describe('listItems', () => {
    it('should return parsed movies', async () => {
      dbApi.listMovies.mockResolvedValue({
        movies: [
          { name: 'Movie 1', stream_icon: 'icon1', container_extension: 'mp4' },
        ],
        total: 1,
      });

      const result = await vodService.listItems(null, 50, 0);

      expect(result.movies).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should handle result with total key', async () => {
      dbApi.listMovies.mockResolvedValue({
        movies: [],
        total: 0,
      });

      const result = await vodService.listItems();

      expect(result.total).toBe(0);
    });
  });

  describe('getById', () => {
    it('should return movie with bouquet_ids', async () => {
      const row = { id: 1, name: 'Test Movie' };
      dbApi.getMovieById.mockResolvedValue(row);
      bouquetService.getBouquetIdsForEntity.mockResolvedValue([1, 2]);

      const result = await vodService.getById(1);

      expect(result.bouquet_ids).toEqual([1, 2]);
      expect(bouquetService.getBouquetIdsForEntity).toHaveBeenCalledWith('movies', 1);
    });

    it('should return null if movie not found', async () => {
      dbApi.getMovieById.mockResolvedValue(null);

      const result = await vodService.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create movie and sync bouquets', async () => {
      dbApi.createMovie.mockResolvedValue(1);

      const result = await vodService.create({ name: 'New Movie', bouquet_ids: [1, 2] });

      expect(result).toBe(1);
      expect(dbApi.createMovie).toHaveBeenCalled();
      expect(bouquetService.syncEntityBouquets).toHaveBeenCalledWith('movies', 1, [1, 2]);
    });

    it('should handle empty bouquet_ids', async () => {
      dbApi.createMovie.mockResolvedValue(1);

      await vodService.create({ name: 'New Movie' });

      expect(bouquetService.syncEntityBouquets).toHaveBeenCalledWith('movies', 1, []);
    });
  });

  describe('update', () => {
    it('should update movie and sync bouquets if bouquet_ids provided', async () => {
      dbApi.updateMovie.mockResolvedValue();

      await vodService.update(1, { name: 'Updated', bouquet_ids: [1] });

      expect(dbApi.updateMovie).toHaveBeenCalledWith(1, { name: 'Updated' });
      expect(bouquetService.syncEntityBouquets).toHaveBeenCalledWith('movies', 1, [1]);
    });

    it('should update without syncing if bouquet_ids not provided', async () => {
      dbApi.updateMovie.mockResolvedValue();

      await vodService.update(1, { name: 'Updated' });

      expect(dbApi.updateMovie).toHaveBeenCalled();
      expect(bouquetService.syncEntityBouquets).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete movie', async () => {
      dbApi.deleteMovie.mockResolvedValue(1);

      await vodService.remove(1);

      expect(dbApi.deleteMovie).toHaveBeenCalledWith(1);
    });
  });

  describe('count', () => {
    it('should return movie count', async () => {
      dbApi.movieCount.mockResolvedValue(42);

      const result = await vodService.count();

      expect(result).toBe(42);
    });
  });

  describe('findById', () => {
    it('should return same as getById', async () => {
      dbApi.getMovieById.mockResolvedValue({ id: 1, name: 'Test' });

      const result = await vodService.findById(1);

      expect(result.id).toBe(1);
    });
  });
});
