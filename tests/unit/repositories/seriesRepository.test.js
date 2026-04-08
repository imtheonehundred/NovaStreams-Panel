'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../lib/mysql-datetime', () => ({
  clampPagination: jest.fn(({ limit = 20, offset = 0 } = {}) => ({ limit, offset })),
  sanitizeReleaseDate: jest.fn(v => v || null),
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const seriesRepo = require('../../../repositories/seriesRepository');

describe('Series Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listSeries', () => {
    it('should list series with pagination', async () => {
      queryOne.mockResolvedValue({ c: 10 });
      query.mockResolvedValue([{ id: 1, title: 'Series 1' }]);
      const result = await seriesRepo.listSeries(null, 20, 0, null, 'id_desc');
      expect(result.series).toHaveLength(1);
      expect(result.total).toBe(10);
    });

    it('should filter by category_id', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await seriesRepo.listSeries(1, 20, 0, null, 'id_desc');
      expect(query).toHaveBeenCalled();
    });

    it('should filter by search term', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await seriesRepo.listSeries(null, 20, 0, 'test', 'id_desc');
      expect(query).toHaveBeenCalled();
    });

    it('should use ASC order when sortOrder is id_asc', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await seriesRepo.listSeries(null, 20, 0, null, 'id_asc');
      const sql = query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY id ASC');
    });
  });

  describe('getSeriesById', () => {
    it('should get series by id', async () => {
      queryOne.mockResolvedValue({ id: 1, title: 'Test Series' });
      const result = await seriesRepo.getSeriesById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM series WHERE id = ?', [1]);
      expect(result.title).toBe('Test Series');
    });
  });

  describe('seriesCount', () => {
    it('should return total series count', async () => {
      queryOne.mockResolvedValue({ c: 42 });
      const result = await seriesRepo.seriesCount();
      expect(result).toBe(42);
    });
  });

  describe('createSeries', () => {
    it('should insert series and return id', async () => {
      insert.mockResolvedValue(42);
      const data = {
        title: 'New Series',
        category_id: '5',
      };
      const result = await seriesRepo.createSeries(data);
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(42);
    });
  });

  describe('updateSeriesRow', () => {
    it('should update series fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await seriesRepo.updateSeriesRow(1, { title: 'Updated', year: 2025 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE series');
    });

    it('should parse stream_server_id as integer', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await seriesRepo.updateSeriesRow(1, { stream_server_id: '5' });
      expect(execute).toHaveBeenCalled();
    });

    it('should update JSON fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await seriesRepo.updateSeriesRow(1, { seasons: [{ season: 1 }] });
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await seriesRepo.updateSeriesRow(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteSeries', () => {
    it('should delete series episodes and series', async () => {
      execute.mockResolvedValue({ affectedRows: 5 });
      remove.mockResolvedValue(1);
      const result = await seriesRepo.deleteSeries(1);
      expect(execute).toHaveBeenCalledWith('DELETE FROM episodes WHERE series_id = ?', [1]);
      expect(remove).toHaveBeenCalledWith('DELETE FROM series WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});
