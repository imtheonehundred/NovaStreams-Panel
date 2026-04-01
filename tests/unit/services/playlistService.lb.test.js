'use strict';

jest.mock('../../../lib/db', () => ({
  listMovies: jest.fn(),
  listSeries: jest.fn(),
  listEpisodes: jest.fn(),
  listCategories: jest.fn(),
  getBouquetsByIds: jest.fn(),
}));

jest.mock('../../../services/lineService', () => ({
  getLineBouquetIds: jest.fn(() => []),
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
const categoryService = require('../../../services/categoryService');
const { channels } = require('../../../lib/state');
const playlistService = require('../../../services/playlistService');

describe('playlistService LB asset resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
    channels.set('100', {
      name: 'Live 100',
      category_id: 1,
      sortOrder: 1,
      logoUrl: 'live.png',
      epgChannelId: 'epg100',
    });
    dbApi.listMovies.mockResolvedValue({
      movies: [{ id: 200, name: 'Movie 200', category_id: 2, stream_icon: 'movie.png', container_extension: 'mp4' }],
    });
    dbApi.listSeries.mockResolvedValue({
      series: [{ id: 300, title: 'Series 300', category_id: 3, cover: 'series.png' }],
    });
    dbApi.listEpisodes.mockResolvedValue([{ id: 301, title: 'Episode 1', season_num: 1, episode_num: 1, container_extension: 'mp4' }]);
    dbApi.listCategories.mockResolvedValue([
      { id: 1, category_name: 'Live' },
      { id: 2, category_name: 'Movies' },
      { id: 3, category_name: 'Series' },
    ]);
    categoryService.getById.mockImplementation(async (id) => ({ id, category_name: `Cat ${id}` }));
  });

  it('builds per-asset URLs through resolveAssetBaseUrl', async () => {
    const resolveAssetBaseUrl = jest.fn(async (assetType, assetId) => `http://${assetType}-${assetId}.example`);
    const line = { username: 'alice', password: 'secret' };

    const body = await playlistService.generatePlaylist(line, {
      type: 'm3u_plus',
      output: 'ts',
      baseUrl: 'http://panel.example',
      resolveBaseUrl: async () => 'http://panel.example',
      resolveAssetBaseUrl,
    });

    expect(resolveAssetBaseUrl).toHaveBeenCalledWith('live', '100');
    expect(resolveAssetBaseUrl).toHaveBeenCalledWith('movie', 200);
    expect(resolveAssetBaseUrl).toHaveBeenCalledWith('episode', 301);
    expect(body).toContain('http://live-100.example/live/alice/secret/100.ts');
    expect(body).toContain('http://movie-200.example/movie/alice/secret/200.mp4');
    expect(body).toContain('http://episode-301.example/series/alice/secret/301.mp4');
  });

  it('uses publicBaseUrl from canonical selector for assigned-server path', async () => {
    // Simulates what routes/playlist.js resolveAssetBaseUrl does:
    // calls serverService.selectServer() and uses selected.publicBaseUrl
    const resolveAssetBaseUrl = jest.fn(async (assetType, assetId) => {
      if (assetType === 'live') return 'http://lb-server.example';
      if (assetType === 'movie') return 'http://movie-server.example';
      if (assetType === 'episode') return 'http://episode-server.example';
      return 'http://fallback.example';
    });
    const line = { username: 'bob', password: 'pass' };

    const body = await playlistService.generatePlaylist(line, {
      type: 'm3u_plus',
      output: 'ts',
      baseUrl: 'http://panel.example',
      resolveBaseUrl: async () => 'http://panel.example',
      resolveAssetBaseUrl,
    });

    // All stream URLs must use the per-asset publicBaseUrl returned by the canonical selector
    expect(body).toContain('http://lb-server.example/live/bob/pass/100.ts');
    expect(body).toContain('http://movie-server.example/movie/bob/pass/200.mp4');
    expect(body).toContain('http://episode-server.example/series/bob/pass/301.mp4');
    // Panel baseUrl must NOT appear in stream paths (only in header/tag references)
    expect(body).not.toContain('http://panel.example/live/');
    expect(body).not.toContain('http://panel.example/movie/');
    expect(body).not.toContain('http://panel.example/series/');
  });

  it('uses fallback baseUrl when selector returns empty publicBaseUrl', async () => {
    const resolveAssetBaseUrl = jest.fn(async () => '');
    const line = { username: 'carol', password: 'word' };

    const body = await playlistService.generatePlaylist(line, {
      type: 'm3u_plus',
      output: 'ts',
      baseUrl: 'http://panel.example',
      resolveBaseUrl: async () => 'http://panel.example',
      resolveAssetBaseUrl,
    });

    // When selector returns empty string, stream URLs use the fallback baseUrl from resolveBaseUrl
    expect(body).toContain('http://panel.example/live/carol/word/100.ts');
    expect(body).toContain('http://panel.example/movie/carol/word/200.mp4');
    expect(body).toContain('http://panel.example/series/carol/word/301.mp4');
  });

  it('emits m3u8 output format with selector-driven baseUrl', async () => {
    const resolveAssetBaseUrl = jest.fn(async (assetType) => {
      if (assetType === 'live') return 'https://hls-server.example';
      return 'https://hls-server.example';
    });
    const line = { username: 'dave', password: 'secret' };

    const body = await playlistService.generatePlaylist(line, {
      type: 'm3u_plus',
      output: 'm3u8',
      baseUrl: 'http://panel.example',
      resolveBaseUrl: async () => 'http://panel.example',
      resolveAssetBaseUrl,
    });

    expect(resolveAssetBaseUrl).toHaveBeenCalled();
    // m3u8 output uses /live/{user}/{pass}/{id}.m3u8 path in playlist (TS output wraps it)
    expect(body).toContain('https://hls-server.example/live/dave/secret/100.m3u8');
    expect(body).toContain('https://hls-server.example/movie/dave/secret/200.m3u8');
  });
});
