'use strict';

jest.mock('../../../lib/db', () => ({
  listBouquets: jest.fn(),
  getBouquetById: jest.fn(),
  createBouquet: jest.fn(),
  updateBouquet: jest.fn(),
  deleteBouquet: jest.fn(),
  getBouquetsByIds: jest.fn(),
}));

jest.mock('../../../lib/cache', () => ({
  invalidateBouquets: jest.fn().mockResolvedValue(undefined),
}));

const dbApi = require('../../../lib/db');
const bouquetService = require('../../../services/bouquetService');

describe('BouquetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should return parsed bouquets', async () => {
      const rows = [
        { id: 1, name: 'Bouquet 1', bouquet_channels: '[1,2]' },
        { id: 2, name: 'Bouquet 2', bouquet_channels: '[3,4]' },
      ];
      dbApi.listBouquets.mockResolvedValue(rows);

      const result = await bouquetService.list();

      expect(result).toHaveLength(2);
      expect(result[0].bouquet_channels).toEqual([1, 2]);
    });
  });

  describe('getById', () => {
    it('should return parsed bouquet', async () => {
      const row = { id: 1, name: 'Bouquet 1', bouquet_channels: '[1,2]' };
      dbApi.getBouquetById.mockResolvedValue(row);

      const result = await bouquetService.getById(1);

      expect(result.bouquet_channels).toEqual([1, 2]);
    });

    it('should return null if not found', async () => {
      dbApi.getBouquetById.mockResolvedValue(null);

      const result = await bouquetService.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create bouquet', async () => {
      dbApi.createBouquet.mockResolvedValue(1);

      const result = await bouquetService.create({ name: 'New Bouquet' });

      expect(result).toBe(1);
      expect(dbApi.createBouquet).toHaveBeenCalledWith({ name: 'New Bouquet' });
    });

    it('should create empty bouquet', async () => {
      dbApi.createBouquet.mockResolvedValue(1);

      await bouquetService.create();

      expect(dbApi.createBouquet).toHaveBeenCalledWith({});
    });
  });

  describe('update', () => {
    it('should update bouquet', async () => {
      dbApi.updateBouquet.mockResolvedValue({ id: 1, name: 'Updated' });

      await bouquetService.update(1, { name: 'Updated' });

      expect(dbApi.updateBouquet).toHaveBeenCalledWith(1, { name: 'Updated' });
    });
  });

  describe('remove', () => {
    it('should delete bouquet', async () => {
      dbApi.deleteBouquet.mockResolvedValue(1);

      await bouquetService.remove(1);

      expect(dbApi.deleteBouquet).toHaveBeenCalledWith(1);
    });
  });

  describe('getChannelsForBouquets', () => {
    it('should return channel ids for bouquets', async () => {
      dbApi.getBouquetsByIds.mockResolvedValue([
        { bouquet_channels: '[1,2]' },
      ]);

      const result = await bouquetService.getChannelsForBouquets([1]);

      expect(dbApi.getBouquetsByIds).toHaveBeenCalledWith([1]);
      expect(result).toContain('1');
      expect(result).toContain('2');
    });
  });

  describe('getMoviesForBouquets', () => {
    it('should return movie ids for bouquets', async () => {
      dbApi.getBouquetsByIds.mockResolvedValue([
        { bouquet_movies: '[100]' },
      ]);

      const result = await bouquetService.getMoviesForBouquets([1]);

      expect(result).toContain('100');
    });
  });

  describe('getSeriesForBouquets', () => {
    it('should return series ids for bouquets', async () => {
      dbApi.getBouquetsByIds.mockResolvedValue([
        { bouquet_series: '[10]' },
      ]);

      const result = await bouquetService.getSeriesForBouquets([1]);

      expect(result).toContain('10');
    });
  });

  describe('getBouquetIdsForEntity', () => {
    it('should return empty array for invalid entityType', async () => {
      const result = await bouquetService.getBouquetIdsForEntity('invalid', 1);
      expect(result).toEqual([]);
    });

    it('should find bouquets containing entity', async () => {
      dbApi.listBouquets.mockResolvedValue([
        { id: 1, bouquet_movies: [100] },
        { id: 2, bouquet_movies: [200] },
        { id: 3, bouquet_movies: [100, 200] },
      ]);

      const result = await bouquetService.getBouquetIdsForEntity('movies', 100);

      expect(result).toContain(1);
      expect(result).toContain(3);
      expect(result).not.toContain(2);
    });
  });

  describe('getBouquetIdsMapForChannels', () => {
    it('should return map of channel to bouquet ids', async () => {
      dbApi.listBouquets.mockResolvedValue([
        { id: 1, bouquet_channels: ['ch1', 'ch2'] },
        { id: 2, bouquet_channels: ['ch2', 'ch3'] },
      ]);

      const result = await bouquetService.getBouquetIdsMapForChannels(['ch1', 'ch2', 'ch3']);

      expect(result.get('ch1')).toEqual([1]);
      expect(result.get('ch2')).toEqual([1, 2]);
      expect(result.get('ch3')).toEqual([2]);
    });

    it('should handle empty channel list', async () => {
      dbApi.listBouquets.mockResolvedValue([]);

      const result = await bouquetService.getBouquetIdsMapForChannels([]);

      expect(result.size).toBe(0);
    });
  });
});
