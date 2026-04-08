'use strict';

jest.mock('../../../lib/db', () => ({
  listCategories: jest.fn(),
  listMovies: jest.fn(),
  listSeries: jest.fn(),
  listEpisodes: jest.fn(),
  getBouquetsByIds: jest.fn(),
}));

jest.mock('../../../services/lineService', () => ({
  getLineBouquetIds: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getChannelsForBouquets: jest.fn(),
  getMoviesForBouquets: jest.fn(),
  getSeriesForBouquets: jest.fn(),
}));

jest.mock('../../../services/categoryService', () => ({
  getById: jest.fn(),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
}));

const dbApi = require('../../../lib/db');
const lineService = require('../../../services/lineService');
const bouquetService = require('../../../services/bouquetService');
const categoryService = require('../../../services/categoryService');
const { channels } = require('../../../lib/state');
const { generatePlaylist } = require('../../../services/playlistService');

describe('playlistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
  });

  describe('generatePlaylist', () => {
    it('should generate basic m3u playlist', async () => {
      const line = { username: 'testuser', password: 'testpass' };
      const options = { type: 'm3u', output: 'ts' };

      lineService.getLineBouquetIds.mockReturnValue([]);
      bouquetService.getChannelsForBouquets.mockResolvedValue([]);
      bouquetService.getMoviesForBouquets.mockResolvedValue([]);
      bouquetService.getSeriesForBouquets.mockResolvedValue([]);
      dbApi.listCategories.mockResolvedValue([]);
      channels.set('1', { id: '1', name: 'Live 1', channelClass: 'normal' });

      const result = await generatePlaylist(line, options);

      expect(result).toContain('#EXTM3U');
      expect(result).toContain('testuser');
      expect(result).toContain('testpass');
    });

    it('should generate m3u_plus playlist with epg', async () => {
      const line = { username: 'testuser', password: 'testpass' };
      const options = { type: 'm3u_plus', output: 'ts', baseUrl: 'http://example.com' };

      lineService.getLineBouquetIds.mockReturnValue([]);
      bouquetService.getChannelsForBouquets.mockResolvedValue([]);
      bouquetService.getMoviesForBouquets.mockResolvedValue([]);
      bouquetService.getSeriesForBouquets.mockResolvedValue([]);
      dbApi.listCategories.mockResolvedValue([]);
      channels.set('1', { id: '1', name: 'Live 1', channelClass: 'normal' });

      const result = await generatePlaylist(line, options);

      expect(result).toContain('#EXTM3U');
      expect(result).toContain('url-tvg="http://example.com/api/xtream/xmltv.php');
    });

    it('should filter by key (live/movie/series)', async () => {
      const line = { username: 'testuser', password: 'testpass' };
      const options = { type: 'm3u', key: 'movie' };

      lineService.getLineBouquetIds.mockReturnValue([]);
      bouquetService.getChannelsForBouquets.mockResolvedValue([]);
      bouquetService.getMoviesForBouquets.mockResolvedValue([]);
      bouquetService.getSeriesForBouquets.mockResolvedValue([]);
      dbApi.listCategories.mockResolvedValue([]);
      dbApi.listMovies.mockResolvedValue({ movies: [] });

      const result = await generatePlaylist(line, options);

      expect(result).toContain('#EXTM3U');
    });

    it('should use custom resolveBaseUrl function', async () => {
      const line = { username: 'testuser', password: 'testpass' };
      const options = {
        type: 'm3u',
        resolveBaseUrl: jest.fn().mockResolvedValue('http://customserver.com'),
      };

      lineService.getLineBouquetIds.mockReturnValue([]);
      bouquetService.getChannelsForBouquets.mockResolvedValue([]);
      bouquetService.getMoviesForBouquets.mockResolvedValue([]);
      bouquetService.getSeriesForBouquets.mockResolvedValue([]);
      dbApi.listCategories.mockResolvedValue([]);

      await generatePlaylist(line, options);

      expect(options.resolveBaseUrl).toHaveBeenCalled();
    });

    it('should strip trailing slash from baseUrl', async () => {
      const line = { username: 'testuser', password: 'testpass' };
      const options = { type: 'm3u', baseUrl: 'http://example.com///' };

      lineService.getLineBouquetIds.mockReturnValue([]);
      bouquetService.getChannelsForBouquets.mockResolvedValue([]);
      bouquetService.getMoviesForBouquets.mockResolvedValue([]);
      bouquetService.getSeriesForBouquets.mockResolvedValue([]);
      dbApi.listCategories.mockResolvedValue([]);
      channels.set('1', { id: '1', name: 'Live 1', channelClass: 'normal' });

      const result = await generatePlaylist(line, options);

      expect(result).toContain('http://example.com/');
    });
  });
});
