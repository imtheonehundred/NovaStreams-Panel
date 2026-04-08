'use strict';

jest.mock('../../../lib/db', () => ({
  getSeriesById: jest.fn(),
  listEpisodes: jest.fn(),
  createSeries: jest.fn(),
  updateSeriesRow: jest.fn(),
  deleteSeries: jest.fn(),
  listSeries: jest.fn(),
  createEpisode: jest.fn(),
  updateEpisode: jest.fn(),
  deleteEpisode: jest.fn(),
  seriesCount: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getBouquetIdsForEntity: jest.fn(),
  syncEntityBouquets: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const bouquetService = require('../../../services/bouquetService');
const seriesService = require('../../../services/seriesService');

describe('SeriesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listSeries', () => {
    it('should return parsed series list', async () => {
      dbApi.listSeries.mockResolvedValue({
        series: [{ id: 1, title: 'Series 1' }],
        total: 1,
      });

      const result = await seriesService.listSeries();

      expect(result.series).toHaveLength(1);
      expect(result.series[0].name).toBe('Series 1');
    });
  });

  describe('findSeries', () => {
    it('should return series with seasons and bouquet_ids', async () => {
      const series = { id: 1, title: 'My Series' };
      const episodes = [
        { episode_num: 1, season_num: 1, info_json: '{}' },
      ];
      dbApi.getSeriesById.mockResolvedValue(series);
      dbApi.listEpisodes.mockResolvedValue(episodes);
      bouquetService.getBouquetIdsForEntity.mockResolvedValue([1]);

      const result = await seriesService.findSeries(1);

      expect(result.bouquet_ids).toEqual([1]);
      expect(result.seasons).toHaveLength(1);
      expect(result.episodesBySeason).toHaveProperty('1');
    });

    it('should return null if series not found', async () => {
      dbApi.getSeriesById.mockResolvedValue(null);

      const result = await seriesService.findSeries(999);

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create series and sync bouquets', async () => {
      dbApi.createSeries.mockResolvedValue(1);

      const result = await seriesService.create({ title: 'New Series', bouquet_ids: [1, 2] });

      expect(result).toBe(1);
      expect(bouquetService.syncEntityBouquets).toHaveBeenCalledWith('series', 1, [1, 2]);
    });
  });

  describe('update', () => {
    it('should update series and sync bouquets if bouquet_ids provided', async () => {
      dbApi.updateSeriesRow.mockResolvedValue();

      await seriesService.update(1, { title: 'Updated', bouquet_ids: [1] });

      expect(dbApi.updateSeriesRow).toHaveBeenCalled();
      expect(bouquetService.syncEntityBouquets).toHaveBeenCalledWith('series', 1, [1]);
    });
  });

  describe('remove', () => {
    it('should delete series', async () => {
      dbApi.deleteSeries.mockResolvedValue(1);

      await seriesService.remove(1);

      expect(dbApi.deleteSeries).toHaveBeenCalledWith(1);
    });
  });

  describe('addEpisode', () => {
    it('should create episode', async () => {
      dbApi.createEpisode.mockResolvedValue(1);

      const result = await seriesService.addEpisode({ episode_num: 1, season_num: 1 });

      expect(result).toBe(1);
    });
  });

  describe('updateEpisode', () => {
    it('should update episode', async () => {
      dbApi.updateEpisode.mockResolvedValue();

      await seriesService.updateEpisode(1, { episode_num: 2 });

      expect(dbApi.updateEpisode).toHaveBeenCalledWith(1, { episode_num: 2 });
    });
  });

  describe('removeEpisode', () => {
    it('should delete episode', async () => {
      dbApi.deleteEpisode.mockResolvedValue(1);

      await seriesService.removeEpisode(1);

      expect(dbApi.deleteEpisode).toHaveBeenCalledWith(1);
    });
  });

  describe('count', () => {
    it('should return series count', async () => {
      dbApi.seriesCount.mockResolvedValue(42);

      const result = await seriesService.count();

      expect(result).toBe(42);
    });
  });
});
