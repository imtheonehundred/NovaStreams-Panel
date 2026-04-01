'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

jest.mock('../../../lib/redis', () => ({
  cacheGet: jest.fn(async () => null),
  cacheSet: jest.fn(async () => undefined),
}));

jest.mock('../../../services/lineService', () => ({
  getLineBouquetIds: jest.fn(() => []),
  getUserInfo: jest.fn(async () => ({ auth: 1 })),
}));

jest.mock('../../../services/categoryService', () => ({
  listCategories: jest.fn(async () => []),
}));

jest.mock('../../../services/bouquetService', () => ({
  getChannelsForBouquets: jest.fn(async () => []),
  getMoviesForBouquets: jest.fn(async () => []),
  getSeriesForBouquets: jest.fn(async () => []),
}));

jest.mock('../../../services/vodService', () => ({
  listItems: jest.fn(async () => ({ movies: [] })),
  getById: jest.fn(),
}));

jest.mock('../../../services/seriesService', () => ({
  listSeries: jest.fn(async () => ({ series: [] })),
  findSeries: jest.fn(),
}));

jest.mock('../../../services/epgService', () => ({
  getShortEpg: jest.fn(),
  getEpgForChannel: jest.fn(),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
}));

const categoryService = require('../../../services/categoryService');
const vodService = require('../../../services/vodService');
const { channels } = require('../../../lib/state');
const xtreamService = require('../../../services/xtreamService');

describe('xtreamService LB milestone behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channels.clear();
    channels.set('10', {
      name: 'Live 10',
      category_id: 1,
      logoUrl: 'logo.png',
      epgChannelId: 'epg10',
      sortOrder: 1,
    });
    categoryService.listCategories.mockResolvedValue([{ id: 1, category_name: 'Live', is_adult: 0 }]);
  });

  it('keeps live direct_source empty in Xtream catalog rows', async () => {
    const rows = await xtreamService.liveStreams({ id: 1, username: 'alice' });

    expect(rows).toHaveLength(1);
    expect(rows[0].direct_source).toBe('');
  });

  it('keeps VOD direct_source empty in Xtream catalog rows', async () => {
    vodService.listItems.mockResolvedValue({
      movies: [{ id: 22, name: 'Movie 22', category_id: 2, container_extension: 'mp4', stream_icon: 'poster.png', rating: 7 }],
    });

    const rows = await xtreamService.vodStreams({ id: 1, username: 'alice' }, null, 1, 50);

    expect(rows).toHaveLength(1);
    expect(rows[0].direct_source).toBe('');
  });
});
