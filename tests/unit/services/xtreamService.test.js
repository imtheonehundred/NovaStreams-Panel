'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

jest.mock('../../../lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue('OK'),
  getClient: jest.fn(() => ({
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  })),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
  processes: new Map(),
}));

jest.mock('../../../services/lineService', () => ({
  getLineBouquetIds: jest.fn(),
  getUserInfo: jest.fn(),
}));

jest.mock('../../../services/categoryService', () => ({
  listCategories: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getChannelsForBouquets: jest.fn(),
  getMoviesForBouquets: jest.fn(),
  getSeriesForBouquets: jest.fn(),
}));

jest.mock('../../../services/vodService', () => ({
  listItems: jest.fn(),
  getById: jest.fn(),
}));

jest.mock('../../../services/seriesService', () => ({
  listSeries: jest.fn(),
  findSeries: jest.fn(),
}));

jest.mock('../../../services/epgService', () => ({
  getEpgForChannel: jest.fn(),
  getShortEpg: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const vodService = require('../../../services/vodService');
const seriesService = require('../../../services/seriesService');
const epgService = require('../../../services/epgService');
const lineService = require('../../../services/lineService');
const categoryService = require('../../../services/categoryService');
const { channels } = require('../../../lib/state');
const xtreamService = require('../../../services/xtreamService');

describe('xtreamService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
  });

  describe('serverInfo', () => {
    it('should return server info from settings', async () => {
      dbApi.getSetting
        .mockResolvedValueOnce('example.com')
        .mockResolvedValueOnce('8080')
        .mockResolvedValueOnce('https');

      const req = { get: jest.fn() };
      const result = await xtreamService.serverInfo(req);

      expect(result.url).toBe('example.com');
      expect(result.port).toBe('8080');
      expect(result.server_protocol).toBe('https');
    });

    it('should use host header when domain not set', async () => {
      dbApi.getSetting.mockResolvedValue(null);
      const req = { get: jest.fn().mockReturnValue('dynamic.com:8080') };
      const result = await xtreamService.serverInfo(req);

      expect(result.url).toBe('dynamic.com');
    });

    it('should include timestamp fields', async () => {
      dbApi.getSetting.mockResolvedValue(null);
      const req = { get: jest.fn().mockReturnValue('localhost') };

      const result = await xtreamService.serverInfo(req);

      expect(result.timestamp_now).toBeDefined();
      expect(result.time_now).toBeDefined();
      expect(result.timezone).toBe('UTC');
    });
  });

  describe('userInfo', () => {
    it('should delegate to lineService.getUserInfo', async () => {
      const mockUserInfo = { id: 1, username: 'test' };
      lineService.getUserInfo.mockResolvedValue(mockUserInfo);

      const result = await xtreamService.userInfo({ id: 1 });

      expect(lineService.getUserInfo).toHaveBeenCalledWith({ id: 1 });
      expect(result).toEqual(mockUserInfo);
    });
  });

  describe('liveCategories', () => {
    it('should return empty array when no channels', async () => {
      lineService.getLineBouquetIds.mockReturnValue([]);

      const result = await xtreamService.liveCategories({});

      expect(result).toEqual([]);
    });

    it('should return categories for allowed channels', async () => {
      channels.set('1', { id: '1', category_id: '10', channelClass: 'normal' });
      channels.set('2', { id: '2', category_id: '10', channelClass: 'normal' });
      lineService.getLineBouquetIds.mockReturnValue([]);
      categoryService.listCategories.mockResolvedValue([
        { id: '10', category_name: 'Sports' },
      ]);

      const result = await xtreamService.liveCategories({});

      expect(result).toHaveLength(1);
      expect(result[0].category_name).toBe('Sports');
    });

    it('should filter out adult categories', async () => {
      channels.set('1', { id: '1', category_id: '1', channelClass: 'normal' });
      channels.set('2', { id: '2', category_id: '2', channelClass: 'normal' });
      lineService.getLineBouquetIds.mockReturnValue([]);
      categoryService.listCategories.mockResolvedValue([
        { id: '1', category_name: 'Sports' },
        { id: '2', category_name: 'XXX Adult' },
      ]);

      const result = await xtreamService.liveCategories({});

      expect(result).toHaveLength(1);
      expect(result[0].category_name).toBe('Sports');
    });

    it('should skip movie and internal channels', async () => {
      channels.set('1', { id: '1', category_id: '10', channelClass: 'normal' });
      channels.set('2', { id: '2', category_id: '10', channelClass: 'movie' });
      channels.set('3', { id: '3', category_id: '10', is_internal: true });
      lineService.getLineBouquetIds.mockReturnValue([]);
      categoryService.listCategories.mockResolvedValue([
        { id: '10', category_name: 'Mixed' },
      ]);

      const result = await xtreamService.liveCategories({});

      expect(result).toHaveLength(1);
    });
  });

  describe('liveStreams', () => {
    it('should return empty array when no channels', async () => {
      lineService.getLineBouquetIds.mockReturnValue([]);

      const result = await xtreamService.liveStreams({});

      expect(result).toEqual([]);
    });

    it('should return formatted stream entries', async () => {
      channels.set('1', {
        id: '1',
        name: 'Channel 1',
        stream_icon: 'http://logo.png',
        category_id: '10',
        channelClass: 'normal',
      });
      lineService.getLineBouquetIds.mockReturnValue([]);
      categoryService.listCategories.mockResolvedValue([]);

      const result = await xtreamService.liveStreams({});

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Channel 1');
    });
  });

  describe('vodCategories', () => {
    it('should return categories from categoryService', async () => {
      const categories = [
        { id: '1', category_name: 'Movies' },
        { id: '2', category_name: 'Documentaries' },
      ];
      categoryService.listCategories.mockResolvedValue(categories);
      vodService.listItems.mockResolvedValue({
        movies: [
          { id: 10, category_id: '1' },
          { id: 11, category_id: '2' },
        ],
      });

      const result = await xtreamService.vodCategories({});

      expect(result).toHaveLength(2);
      expect(categoryService.listCategories).toHaveBeenCalledWith('movie');
    });
  });

  describe('seriesCategories', () => {
    it('should return categories from categoryService', async () => {
      const categories = [
        { id: '1', category_name: 'TV Shows' },
      ];
      categoryService.listCategories.mockResolvedValue(categories);
      seriesService.listSeries.mockResolvedValue({
        series: [{ id: 100, category_id: '1' }],
      });

      const result = await xtreamService.seriesCategories({});

      expect(result).toHaveLength(1);
      expect(categoryService.listCategories).toHaveBeenCalledWith('series');
    });
  });

  describe('filterByCategoryId', () => {
    it('should return items matching category', () => {
      const items = [
        { category_id: '1', name: 'Item 1' },
        { category_id: '2', name: 'Item 2' },
        { category_id: '1', name: 'Item 3' },
      ];

      const result = xtreamService.filterByCategoryId(items, '1');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Item 1');
    });

    it('should return all items when categoryId is null', () => {
      const items = [
        { category_id: '1', name: 'Item 1' },
        { category_id: '2', name: 'Item 2' },
      ];

      const result = xtreamService.filterByCategoryId(items, null);

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no matches', () => {
      const items = [
        { category_id: '1', name: 'Item 1' },
      ];

      const result = xtreamService.filterByCategoryId(items, '99');

      expect(result).toHaveLength(0);
    });
  });

  describe('liveInfo', () => {
    it('should return stream info for channel', () => {
      channels.set('1', {
        id: '1',
        name: 'Test Channel',
        stream_icon: 'http://logo.png',
        category_id: '5',
      });

      const result = xtreamService.liveInfo('1');

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Channel');
    });

    it('should return null for non-existent channel', () => {
      const result = xtreamService.liveInfo('999');
      expect(result).toBeNull();
    });
  });

  describe('simpleDataTable', () => {
    it('should return data table structure', async () => {
      epgService.getEpgForChannel.mockResolvedValue([
        { id: 1, title: 'Program 1', description: 'Desc', start: 1000, stop: 2000, lang: 'en' },
      ]);

      const result = await xtreamService.simpleDataTable(1);

      expect(result).toHaveProperty('epg_listings');
      expect(result.epg_listings).toHaveLength(1);
    });
  });
});
