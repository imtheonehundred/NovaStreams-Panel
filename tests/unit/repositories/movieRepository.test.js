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
const movieRepo = require('../../../repositories/movieRepository');

describe('Movie Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listMovies', () => {
    it('should list movies with pagination', async () => {
      queryOne.mockResolvedValue({ c: 10 });
      query.mockResolvedValue([{ id: 1, name: 'Movie 1' }]);
      const result = await movieRepo.listMovies(null, 20, 0, null, 'id_desc');
      expect(result.movies).toHaveLength(1);
      expect(result.total).toBe(10);
    });

    it('should filter by category_id', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await movieRepo.listMovies(1, 20, 0, null, 'id_desc');
      expect(query).toHaveBeenCalled();
    });

    it('should filter by search term', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await movieRepo.listMovies(null, 20, 0, 'action', 'id_desc');
      expect(query).toHaveBeenCalled();
    });

    it('should use ASC order when sortOrder is id_asc', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      query.mockResolvedValue([]);
      await movieRepo.listMovies(null, 20, 0, null, 'id_asc');
      const sql = query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY id ASC');
    });
  });

  describe('getMovieById', () => {
    it('should get movie by id', async () => {
      queryOne.mockResolvedValue({ id: 1, name: 'Test Movie' });
      const result = await movieRepo.getMovieById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM movies WHERE id = ?', [1]);
      expect(result.name).toBe('Test Movie');
    });
  });

  describe('movieCount', () => {
    it('should return total movie count', async () => {
      queryOne.mockResolvedValue({ c: 100 });
      const result = await movieRepo.movieCount();
      expect(result).toBe(100);
    });
  });

  describe('createMovie', () => {
    it('should insert movie and return id', async () => {
      insert.mockResolvedValue(42);
      const data = {
        name: 'New Movie',
        stream_url: 'http://example.com/stream.m3u8',
      };
      const result = await movieRepo.createMovie(data);
      expect(insert).toHaveBeenCalled();
      expect(result).toBe(42);
    });
  });

  describe('updateMovie', () => {
    it('should update movie fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await movieRepo.updateMovie(1, { name: 'Updated', year: 2025 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE movies');
    });

    it('should parse stream_server_id as integer', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await movieRepo.updateMovie(1, { stream_server_id: '5' });
      expect(execute).toHaveBeenCalled();
    });

    it('should update JSON fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await movieRepo.updateMovie(1, { movie_properties: { hd: true } });
      expect(execute).toHaveBeenCalled();
    });

    it('should do nothing if no fields provided', async () => {
      await movieRepo.updateMovie(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteMovie', () => {
    it('should delete movie by id', async () => {
      remove.mockResolvedValue(1);
      const result = await movieRepo.deleteMovie(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM movies WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});
