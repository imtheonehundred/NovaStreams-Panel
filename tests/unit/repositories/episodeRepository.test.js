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
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const episodeRepo = require('../../../repositories/episodeRepository');

describe('Episode Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listEpisodes', () => {
    it('should list episodes for a series', async () => {
      query.mockResolvedValue([{ id: 1, series_id: 1 }]);
      const result = await episodeRepo.listEpisodes(1);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [1]
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('listAllEpisodes', () => {
    it('should list all episodes with pagination', async () => {
      queryOne.mockResolvedValue({ c: 10 });
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await episodeRepo.listAllEpisodes({ limit: 20, offset: 0 });
      expect(result.episodes).toHaveLength(2);
      expect(result.total).toBe(10);
    });

    it('should filter by series_id', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await episodeRepo.listAllEpisodes({ series_id: 1 });
      expect(query).toHaveBeenCalled();
    });

    it('should filter by search term', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await episodeRepo.listAllEpisodes({ search: 'pilot' });
      expect(query).toHaveBeenCalled();
    });
  });

  describe('getEpisodeById', () => {
    it('should get episode by id', async () => {
      queryOne.mockResolvedValue({ id: 1, title: 'Pilot' });
      const result = await episodeRepo.getEpisodeById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM episodes WHERE id = ?', [1]);
      expect(result.title).toBe('Pilot');
    });
  });

  describe('createEpisode', () => {
    it('should insert episode and return id', async () => {
      insert.mockResolvedValue(42);
      const data = {
        series_id: 1,
        season_num: 2,
        episode_num: 3,
        title: 'Episode 3',
        stream_url: 'http://example.com/stream.m3u8',
      };
      const result = await episodeRepo.createEpisode(data);
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(42);
    });
  });

  describe('updateEpisode', () => {
    it('should update episode fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await episodeRepo.updateEpisode(1, { title: 'Updated', season_num: 2 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE episodes');
    });

    it('should parse stream_server_id as integer', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await episodeRepo.updateEpisode(1, { stream_server_id: '5' });
      expect(execute).toHaveBeenCalled();
    });

    it('should set stream_server_id to 0 for invalid values', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await episodeRepo.updateEpisode(1, { stream_server_id: 'invalid' });
      expect(execute).toHaveBeenCalled();
    });

    it('should update JSON fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await episodeRepo.updateEpisode(1, { info: { plot: 'New' } });
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await episodeRepo.updateEpisode(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteEpisode', () => {
    it('should delete episode by id', async () => {
      remove.mockResolvedValue(1);
      const result = await episodeRepo.deleteEpisode(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM episodes WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });

  describe('getEffectiveEpisodeServerId', () => {
    it('should return episode server_id if set', async () => {
      queryOne.mockResolvedValue({ stream_server_id: 5, series_id: 1 });
      const result = await episodeRepo.getEffectiveEpisodeServerId(1);
      expect(result).toBe(5);
    });

    it('should fall back to series server_id', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 1 })
        .mockResolvedValueOnce({ stream_server_id: 3 });
      const result = await episodeRepo.getEffectiveEpisodeServerId(1);
      expect(result).toBe(3);
    });

    it('should fall back to default_stream_server_id setting', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 1 })
        .mockResolvedValueOnce({ stream_server_id: 0 })
        .mockResolvedValueOnce({ value: '7' });
      const result = await episodeRepo.getEffectiveEpisodeServerId(1);
      expect(result).toBe(7);
    });

    it('should return 0 if no server found', async () => {
      queryOne.mockResolvedValue(null);
      const result = await episodeRepo.getEffectiveEpisodeServerId(1);
      expect(result).toBe(0);
    });
  });
});
