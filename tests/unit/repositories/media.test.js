'use strict';

const {
  listMovies,
  getMovieById,
  movieCount,
  createMovie,
  updateMovie,
  deleteMovie,
} = require('../../../repositories/movieRepository');

const {
  listSeries,
  getSeriesById,
  seriesCount,
  createSeries,
  updateSeriesRow,
  deleteSeries,
} = require('../../../repositories/seriesRepository');

const {
  listEpisodes,
  listAllEpisodes,
  getEpisodeById,
  createEpisode,
  updateEpisode,
  deleteEpisode,
  getEffectiveEpisodeServerId,
} = require('../../../repositories/episodeRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');

describe('Movie Repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('listMovies', () => {
    it('should return movies with default pagination', async () => {
      const mockMovies = [{ id: 1, name: 'Movie 1' }];
      queryOne.mockResolvedValue({ c: 1 });
      query.mockResolvedValue(mockMovies);
      const result = await listMovies(null, 50, 0);
      expect(result.movies).toEqual(mockMovies);
      expect(result.total).toBe(1);
    });

    it('should filter by category and search', async () => {
      queryOne.mockResolvedValue({ c: 0 });
      query.mockResolvedValue([]);
      await listMovies(5, 20, 10, 'search term');
      expect(query).toHaveBeenCalled();
      const callArgs = query.mock.calls[0];
      expect(callArgs[0]).toContain('category_id = ?');
      expect(callArgs[0]).toContain('name LIKE ?');
    });
  });

  describe('getMovieById', () => {
    it('should return movie by id', async () => {
      const mockMovie = { id: 1, name: 'Test Movie' };
      queryOne.mockResolvedValue(mockMovie);
      const result = await getMovieById(1);
      expect(result).toEqual(mockMovie);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM movies WHERE id = ?', [1]);
    });
  });

  describe('movieCount', () => {
    it('should return count of movies', async () => {
      queryOne.mockResolvedValue({ c: 42 });
      const result = await movieCount();
      expect(result).toBe(42);
    });
  });

  describe('createMovie', () => {
    it('should insert movie with all fields', async () => {
      insert.mockResolvedValue(1);
      const data = {
        name: 'New Movie',
        stream_url: 'http://example.com/movie.mpd',
        category_id: '1',
        stream_icon: 'http://example.com/icon.jpg',
        rating: '8.5',
        plot: 'A great movie',
        stream_server_id: 2,
      };
      const result = await createMovie(data);
      expect(result).toBe(1);
      expect(insert).toHaveBeenCalled();
      const callArgs = insert.mock.calls[0][1];
      expect(callArgs[0]).toBe('New Movie');
    });
  });

  describe('updateMovie', () => {
    it('should update movie fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateMovie(1, { name: 'Updated Name', rating: '9.0' });
      expect(execute).toHaveBeenCalled();
      const callArgs = execute.mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE movies SET');
      expect(callArgs[0]).toContain('`name` = ?');
    });
  });

  describe('deleteMovie', () => {
    it('should delete movie by id', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteMovie(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM movies WHERE id = ?', [1]);
    });
  });
});

describe('Series Repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('listSeries', () => {
    it('should return series with pagination', async () => {
      const mockSeries = [{ id: 1, title: 'Series 1' }];
      queryOne.mockResolvedValue({ c: 1 });
      query.mockResolvedValue(mockSeries);
      const result = await listSeries(null, 50, 0);
      expect(result.series).toEqual(mockSeries);
      expect(result.total).toBe(1);
    });
  });

  describe('getSeriesById', () => {
    it('should return series by id', async () => {
      const mockSeries = { id: 1, title: 'Test Series' };
      queryOne.mockResolvedValue(mockSeries);
      const result = await getSeriesById(1);
      expect(result).toEqual(mockSeries);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM series WHERE id = ?', [1]);
    });
  });

  describe('seriesCount', () => {
    it('should return count of series', async () => {
      queryOne.mockResolvedValue({ c: 15 });
      const result = await seriesCount();
      expect(result).toBe(15);
    });
  });

  describe('createSeries', () => {
    it('should insert series with all fields', async () => {
      insert.mockResolvedValue(1);
      const data = {
        title: 'New Series',
        category_id: '1',
        cover: 'http://example.com/cover.jpg',
        stream_server_id: 2,
      };
      const result = await createSeries(data);
      expect(result).toBe(1);
      expect(insert).toHaveBeenCalled();
    });
  });

  describe('updateSeriesRow', () => {
    it('should update series fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateSeriesRow(1, { title: 'Updated Title' });
      expect(execute).toHaveBeenCalled();
      const callArgs = execute.mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE series SET');
    });
  });

  describe('deleteSeries', () => {
    it('should delete series episodes then series', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteSeries(1);
      expect(execute).toHaveBeenCalledWith('DELETE FROM episodes WHERE series_id = ?', [1]);
      expect(remove).toHaveBeenCalledWith('DELETE FROM series WHERE id = ?', [1]);
    });
  });
});

describe('Episode Repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('listEpisodes', () => {
    it('should return episodes for series', async () => {
      const mockEpisodes = [{ id: 1, title: 'Episode 1' }];
      query.mockResolvedValue(mockEpisodes);
      const result = await listEpisodes(1);
      expect(result).toEqual(mockEpisodes);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, series_id'),
        [1]
      );
    });
  });

  describe('listAllEpisodes', () => {
    it('should return all episodes with pagination', async () => {
      queryOne.mockResolvedValue({ c: 1 });
      query.mockResolvedValue([{ id: 1 }]);
      const result = await listAllEpisodes({ limit: 50, offset: 0 });
      expect(result.episodes).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by series_id and search', async () => {
      queryOne.mockResolvedValue({ c: 0 });
      query.mockResolvedValue([]);
      await listAllEpisodes({ series_id: 1, search: 'pilot' });
      expect(query).toHaveBeenCalled();
    });
  });

  describe('getEpisodeById', () => {
    it('should return episode by id', async () => {
      const mockEpisode = { id: 1, title: 'Test Episode' };
      queryOne.mockResolvedValue(mockEpisode);
      const result = await getEpisodeById(1);
      expect(result).toEqual(mockEpisode);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM episodes WHERE id = ?', [1]);
    });
  });

  describe('createEpisode', () => {
    it('should insert episode with all fields', async () => {
      insert.mockResolvedValue(1);
      const data = {
        series_id: 1,
        season_num: 1,
        episode_num: 1,
        title: 'Pilot',
        stream_url: 'http://example.com/episode.mpd',
        stream_server_id: 2,
      };
      const result = await createEpisode(data);
      expect(result).toBe(1);
      expect(insert).toHaveBeenCalled();
    });
  });

  describe('updateEpisode', () => {
    it('should update episode fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateEpisode(1, { title: 'Updated Title' });
      expect(execute).toHaveBeenCalled();
      const callArgs = execute.mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE episodes SET');
    });
  });

  describe('deleteEpisode', () => {
    it('should delete episode by id', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteEpisode(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM episodes WHERE id = ?', [1]);
    });
  });

  describe('getEffectiveEpisodeServerId', () => {
    it('should return episode server_id when set', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 5, series_id: 1 })
        .mockResolvedValueOnce(null);
      const result = await getEffectiveEpisodeServerId(1);
      expect(result).toBe(5);
    });

    it('should fall back to series server_id', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 1 })
        .mockResolvedValueOnce({ stream_server_id: 3 });
      const result = await getEffectiveEpisodeServerId(1);
      expect(result).toBe(3);
    });

    it('should fall back to default_stream_server_id setting', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 1 })
        .mockResolvedValueOnce({ stream_server_id: 0 })
        .mockResolvedValueOnce({ value: '7' });
      const result = await getEffectiveEpisodeServerId(1);
      expect(result).toBe(7);
    });

    it('should return 0 when no servers set', async () => {
      queryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 1 })
        .mockResolvedValueOnce({ stream_server_id: 0 })
        .mockResolvedValueOnce(null);
      const result = await getEffectiveEpisodeServerId(1);
      expect(result).toBe(0);
    });
  });
});
