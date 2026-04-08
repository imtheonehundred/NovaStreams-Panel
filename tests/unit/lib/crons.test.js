'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
  updateMovie: jest.fn(),
  updateSeriesRow: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../services/epgService', () => ({
  refreshAllSources: jest.fn(),
  refreshFromUrl: jest.fn(),
}));

jest.mock('../../../services/importService', () => ({
  runAllScheduledImports: jest.fn(),
}));

jest.mock('../../../services/dbService', () => ({
  optimizeDatabase: jest.fn(),
}));

jest.mock('../../../services/backupService', () => ({
  initBackupTable: jest.fn(),
  createBackup: jest.fn(),
}));

jest.mock('node-fetch', () => jest.fn());

const { fetchTmdbMovieMeta, fetchTmdbTvMeta } = require('../../../lib/crons');

describe('Crons Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchTmdbMovieMeta', () => {
    it('should fetch and format movie metadata', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Test plot',
          genres: [{ name: 'Action' }, { name: 'Drama' }],
          backdrop_path: '/backdrop.jpg',
          vote_average: 8.5,
          release_date: '2024-05-15',
          credits: {
            cast: [{ name: 'Actor 1' }, { name: 'Actor 2' }],
            crew: [{ job: 'Director', name: 'Director Name' }],
          },
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');

      expect(result.plot).toBe('Test plot');
      expect(result.genre).toBe('Action, Drama');
      expect(result.backdrop_path).toBe('https://image.tmdb.org/t/p/w780/backdrop.jpg');
      expect(result.rating).toBe('8.5');
      expect(result.rating_5based).toBe(4.25);
      expect(result.year).toBe(2024);
      expect(result.director).toBe('Director Name');
      expect(result.movie_cast).toBe('Actor 1, Actor 2');
    });

    it('should throw on HTTP error', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchTmdbMovieMeta(123, 'api-key', 'en')).rejects.toThrow('TMDb movie HTTP 404');
    });

    it('should handle missing credits', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: 0,
          release_date: '',
          credits: {},
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');

      expect(result.director).toBe('');
      expect(result.movie_cast).toBe('');
    });

    it('should handle co-director job title', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: 5.0,
          release_date: '2020-01-01',
          credits: {
            cast: [],
            crew: [{ job: 'Co-Director', name: 'Co-Director Name' }],
          },
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');
      expect(result.director).toBe('Co-Director Name');
    });

    it('should handle missing vote_average', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: null,
          release_date: '2020-01-01',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');
      expect(result.rating).toBe('0');
      expect(result.rating_5based).toBe(0);
    });

    it('should handle empty overview', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: '',
          genres: [],
          vote_average: 6.0,
          release_date: '2020-01-01',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');
      expect(result.plot).toBe('');
    });

    it('should handle cast limit', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: 6.0,
          release_date: '2020-01-01',
          credits: {
            cast: [
              { name: 'Actor 1' },
              { name: 'Actor 2' },
              { name: 'Actor 3' },
              { name: 'Actor 4' },
              { name: 'Actor 5' },
              { name: 'Actor 6' },
              { name: 'Actor 7' },
              { name: 'Actor 8' },
              { name: 'Actor 9' },
              { name: 'Actor 10' },
              { name: 'Actor 11' },
              { name: 'Actor 12' },
            ],
            crew: [],
          },
        }),
      });

      const result = await fetchTmdbMovieMeta(123, 'api-key', 'en');
      const actors = result.movie_cast.split(', ');
      expect(actors.length).toBeLessThanOrEqual(10);
    });
  });

  describe('fetchTmdbTvMeta', () => {
    it('should fetch and format TV series metadata', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'TV plot',
          genres: [{ name: 'Comedy' }],
          backdrop_path: '/tv_backdrop.jpg',
          vote_average: 7.0,
          first_air_date: '2023-01-10',
          credits: {
            cast: [{ name: 'TV Actor' }],
            crew: [{ job: 'Director', name: 'TV Director' }],
          },
        }),
      });

      const result = await fetchTmdbTvMeta(456, 'api-key', 'en');

      expect(result.plot).toBe('TV plot');
      expect(result.genre).toBe('Comedy');
      expect(result.rating).toBe('7');
      expect(result.rating_5based).toBe(3.5);
      expect(result.year).toBe(2023);
      expect(result.series_cast).toBe('TV Actor');
    });

    it('should throw on HTTP error', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(fetchTmdbTvMeta(456, 'api-key', 'en')).rejects.toThrow('TMDb TV HTTP 500');
    });

    it('should handle missing first_air_date', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: 8.0,
          first_air_date: '',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbTvMeta(456, 'api-key', 'en');
      expect(result.year).toBeNull();
    });

    it('should use backdrop_url for full URLs', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [],
          vote_average: 6.0,
          first_air_date: '2020-01-01',
          backdrop_path: 'https://example.com/backdrop.jpg',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbTvMeta(456, 'api-key', 'en');
      expect(result.backdrop_path).toBe('https://example.com/backdrop.jpg');
    });

    it('should handle null genres', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: null,
          vote_average: 5.0,
          first_air_date: '2020-01-01',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbTvMeta(456, 'api-key', 'en');
      expect(result.genre).toBe('');
    });

    it('should filter falsey genre names', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          overview: 'Plot',
          genres: [{ name: '' }, { name: 'Drama' }, { name: null }],
          vote_average: 6.0,
          first_air_date: '2020-01-01',
          credits: { cast: [], crew: [] },
        }),
      });

      const result = await fetchTmdbTvMeta(456, 'api-key', 'en');
      expect(result.genre).toBe('Drama');
    });
  });

  describe('helper functions (through module structure)', () => {
    it('module exports fetchTmdbMovieMeta and fetchTmdbTvMeta', () => {
      expect(typeof fetchTmdbMovieMeta).toBe('function');
      expect(typeof fetchTmdbTvMeta).toBe('function');
    });
  });
});
