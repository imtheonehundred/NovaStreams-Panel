'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const dbApi = require('../../../lib/db');
const tmdbService = require('../../../services/tmdbService');

describe('tmdbService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TMDB_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.TMDB_API_KEY;
  });

  describe('getApiKey', () => {
    it('should return api key from settings', async () => {
      dbApi.getSetting.mockResolvedValue('my-tmdb-key');

      const result = await tmdbService.getApiKey();

      expect(result).toBe('my-tmdb-key');
    });
  });

  describe('getLang', () => {
    it('should return language from settings', async () => {
      dbApi.getSetting.mockResolvedValue('es');

      const result = await tmdbService.getLang();

      expect(result).toBe('es');
    });

    it('should default to en', async () => {
      dbApi.getSetting.mockResolvedValue(null);

      const result = await tmdbService.getLang();

      expect(result).toBe('en');
    });
  });

  describe('tmdbFetch', () => {
    it('should throw error when api key not configured', async () => {
      dbApi.getSetting.mockResolvedValue(null);

      await expect(tmdbService.tmdbFetch('/test')).rejects.toThrow('TMDb API key not configured');
    });

    it('should fetch with correct parameters', async () => {
      dbApi.getSetting.mockResolvedValue('test-key');
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 1 }),
      });

      await tmdbService.tmdbFetch('/test', { param1: 'value1' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          timeout: 8000,
        })
      );
    });

    it('should throw error on non-ok response', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(tmdbService.tmdbFetch('/test')).rejects.toThrow('TMDb API error 404');
    });
  });

  describe('searchMovies', () => {
    it('should return formatted movie results', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [
            {
              id: 1,
              title: 'Test Movie',
              original_title: 'Original Title',
              release_date: '2023-05-15',
              overview: 'A test movie',
              poster_path: '/poster.jpg',
              backdrop_path: '/backdrop.jpg',
              vote_average: 7.5,
              popularity: 100,
            },
          ],
        }),
      });

      const result = await tmdbService.searchMovies('test');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        title: 'Test Movie',
        original_title: 'Original Title',
        year: 2023,
        release_date: '2023-05-15',
        overview: 'A test movie',
        vote_average: 7.5,
        popularity: 100,
      });
      expect(result[0].poster_path).toContain('image.tmdb.org');
    });

    it('should return empty array when no results', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      });

      const result = await tmdbService.searchMovies('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('searchTvShows', () => {
    it('should return formatted tv show results', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [
            {
              id: 1,
              name: 'Test Show',
              original_name: 'Original Show',
              first_air_date: '2023-01-01',
              overview: 'A test show',
              poster_path: '/poster.jpg',
              backdrop_path: '/backdrop.jpg',
              vote_average: 8.0,
            },
          ],
        }),
      });

      const result = await tmdbService.searchTvShows('test');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        name: 'Test Show',
        original_name: 'Original Show',
        year: 2023,
        first_air_date: '2023-01-01',
        overview: 'A test show',
        vote_average: 8.0,
      });
    });
  });

  describe('getMovie', () => {
    it('should fetch and build movie properties', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 1,
          title: 'Test Movie',
          original_title: 'Original',
          overview: 'Overview',
          poster_path: '/poster.jpg',
          backdrop_path: '/backdrop.jpg',
          runtime: 120,
          release_date: '2023-05-15',
          genres: [{ name: 'Action' }, { name: 'Drama' }],
          credits: {
            cast: [{ name: 'Actor 1' }, { name: 'Actor 2' }],
            crew: [{ job: 'Director', name: 'Director 1' }],
          },
          videos: {
            results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123' }],
          },
        }),
      });

      const result = await tmdbService.getMovie(1);

      expect(result.tmdb_id).toBe(1);
      expect(result.name).toBe('Test Movie');
      expect(result.plot).toBe('Overview');
      expect(result.genre).toBe('Action, Drama');
      expect(result.cast).toBe('Actor 1, Actor 2');
      expect(result.director).toBe('Director 1');
      expect(result.trailer).toContain('youtube.com');
    });
  });

  describe('getTvShow', () => {
    it('should fetch and build series properties', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 1,
          name: 'Test Show',
          original_name: 'Original',
          overview: 'Overview',
          poster_path: '/poster.jpg',
          backdrop_path: '/backdrop.jpg',
          seasons: [
            { season_number: 1, episode_count: 10 },
          ],
          credits: {
            cast: [{ name: 'Actor 1' }],
            crew: [{ job: 'Director', name: 'Director 1' }],
          },
          videos: {
            results: [],
          },
        }),
      });

      const result = await tmdbService.getTvShow(1);

      expect(result.tmdb_id).toBe(1);
      expect(result.name).toBe('Test Show');
      expect(result.plot).toBe('Overview');
    });
  });

  describe('getSeason', () => {
    it('should return formatted season data', async () => {
      dbApi.getSetting.mockResolvedValueOnce('test-key');
      dbApi.getSetting.mockResolvedValueOnce('en');
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          season_number: 1,
          name: 'Season 1',
          overview: 'First season',
          poster_path: '/season1.jpg',
          episodes: [
            {
              episode_number: 1,
              name: 'Episode 1',
              overview: 'First episode',
              still_path: '/still1.jpg',
              air_date: '2023-01-01',
              vote_average: 8.0,
              runtime: 45,
            },
          ],
        }),
      });

      const result = await tmdbService.getSeason(1, 1);

      expect(result.season_number).toBe(1);
      expect(result.name).toBe('Season 1');
      expect(result.episodes).toHaveLength(1);
      expect(result.episodes[0].episode_number).toBe(1);
      expect(result.episodes[0].still_path).toContain('image.tmdb.org');
    });
  });

  describe('extractCast', () => {
    it('should extract cast names', () => {
      const credits = {
        cast: [{ name: 'Actor 1' }, { name: 'Actor 2' }, { name: 'Actor 3' }],
      };

      const result = tmdbService.extractCast(credits, 2);

      expect(result).toBe('Actor 1, Actor 2');
    });

    it('should return empty string for missing credits', () => {
      expect(tmdbService.extractCast(null)).toBe('');
      expect(tmdbService.extractCast({})).toBe('');
    });
  });

  describe('extractDirector', () => {
    it('should extract director names', () => {
      const credits = {
        crew: [
          { job: 'Director', name: 'Director 1' },
          { job: 'Producer', name: 'Producer 1' },
          { job: 'Director', name: 'Director 2' },
        ],
      };

      const result = tmdbService.extractDirector(credits);

      expect(result).toBe('Director 1, Director 2');
    });

    it('should return empty string when no director', () => {
      expect(tmdbService.extractDirector({ crew: [] })).toBe('');
      expect(tmdbService.extractDirector(null)).toBe('');
    });
  });

  describe('extractGenres', () => {
    it('should extract genre names', () => {
      const genres = [{ name: 'Action' }, { name: 'Drama' }, { name: 'Comedy' }];

      const result = tmdbService.extractGenres(genres);

      expect(result).toBe('Action, Drama, Comedy');
    });

    it('should return empty string for non-array', () => {
      expect(tmdbService.extractGenres(null)).toBe('');
      expect(tmdbService.extractGenres('not array')).toBe('');
    });
  });

  describe('extractTrailer', () => {
    it('should return YouTube trailer URL', () => {
      const videos = {
        results: [
          { site: 'YouTube', type: 'Trailer', key: 'abc123' },
          { site: 'YouTube', type: 'Teaser', key: 'def456' },
        ],
      };

      const result = tmdbService.extractTrailer(videos);

      expect(result).toBe('https://www.youtube.com/watch?v=abc123');
    });

    it('should return first YouTube video if no trailer', () => {
      const videos = {
        results: [
          { site: 'YouTube', type: 'Clip', key: 'ghi789' },
        ],
      };

      const result = tmdbService.extractTrailer(videos);

      expect(result).toBe('https://www.youtube.com/watch?v=ghi789');
    });

    it('should return empty string for no YouTube videos', () => {
      const videos = { results: [{ site: 'Vimeo', type: 'Trailer', key: 'abc' }] };

      const result = tmdbService.extractTrailer(videos);

      expect(result).toBe('');
    });

    it('should return empty string for missing results', () => {
      expect(tmdbService.extractTrailer(null)).toBe('');
      expect(tmdbService.extractTrailer({})).toBe('');
    });
  });

  describe('buildMovieProperties', () => {
    it('should build complete movie properties object', () => {
      const m = {
        id: 1,
        title: 'Test Movie',
        original_title: 'Original',
        overview: 'Overview',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        runtime: 120,
        release_date: '2023-05-15',
        genres: [{ name: 'Action' }],
        credits: {
          cast: [{ name: 'Actor' }],
          crew: [{ job: 'Director', name: 'Director' }],
        },
        videos: { results: [] },
      };

      const result = tmdbService.buildMovieProperties(m);

      expect(result.tmdb_id).toBe(1);
      expect(result.name).toBe('Test Movie');
      expect(result.duration_secs).toBe(7200);
      expect(result.genre).toBe('Action');
    });
  });
});
