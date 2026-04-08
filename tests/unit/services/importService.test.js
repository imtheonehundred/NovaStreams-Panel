'use strict';

jest.mock('../../../lib/db', () => ({
  listCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  getBouquetsByIds: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
}));

jest.mock('../../../services/xcApiClient', () => ({
  XcApiClient: jest.fn(),
  parseProviderUrl: jest.fn(),
}));

jest.mock('../../../services/vodService', () => ({
  importXcMovie: jest.fn(),
  importM3uMovie: jest.fn(),
}));

jest.mock('../../../services/seriesService', () => ({
  importXcSeries: jest.fn(),
  importM3uSeries: jest.fn(),
}));

jest.mock('../../../lib/importChannelBridge', () => ({
  importChannels: jest.fn(),
  updateChannelFromXc: jest.fn(),
  updateChannelFromM3u: jest.fn(),
}));

jest.mock('../../../lib/input-detect', () => ({
  detectInputType: jest.fn(),
}));

jest.mock('../../../lib/cache', () => ({
  invalidateVod: jest.fn(),
  invalidateSeries: jest.fn(),
  invalidateBouquets: jest.fn(),
  invalidateEpisodes: jest.fn(),
}));

const dbApi = require('../../../lib/db');
const { parseM3UEntries, findOrCreateCategory } = require('../../../services/importService');

describe('importService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseM3UEntries', () => {
    it('should parse basic m3u entries', () => {
      const text = `#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" tvg-logo="http://logo.com/logo.png" group-title="Sports",Channel 1
http://stream1.com/live
#EXTINF:-1 tvg-id="ch2" tvg-name="Channel 2" group-title="News",Channel 2
http://stream2.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        name: 'Channel 1',
        group: 'Sports',
        logo: 'http://logo.com/logo.png',
        epgId: 'ch1',
        url: 'http://stream1.com/live',
      });
      expect(entries[1].name).toBe('Channel 2');
    });

    it('should handle entries without optional fields', () => {
      const text = `#EXTINF:-1,Channel Without Extras
http://stream.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Channel Without Extras');
      expect(entries[0].group).toBe('');
      expect(entries[0].logo).toBe('');
      expect(entries[0].epgId).toBe('');
    });

    it('should handle empty text', () => {
      expect(parseM3UEntries('')).toEqual([]);
      expect(parseM3UEntries('#EXTM3U\n\n')).toEqual([]);
    });

    it('should skip lines without url after EXTINF', () => {
      const text = `#EXTINF:-1,Channel
#EXTINF:-1,Another Channel
http://stream.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries).toHaveLength(1);
    });

    it('should skip comment lines', () => {
      const text = `#EXTINF:-1,Channel
http://stream.com/live
# This is a comment
#EXTINF:-1,Another Channel
http://another.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries).toHaveLength(2);
    });

    it('should handle names with commas', () => {
      const text = `#EXTINF:-1,Channel, With, Comma
http://stream.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries[0].name).toBe('Channel, With, Comma');
    });

    it('should handle empty group-title', () => {
      const text = `#EXTINF:-1 tvg-id="ch1" group-title="",Channel
http://stream.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries[0].group).toBe('');
    });

    it('should handle multiple spaces in group-title', () => {
      const text = `#EXTINF:-1 group-title="Sports  News",Channel
http://stream.com/live`;

      const entries = parseM3UEntries(text);

      expect(entries[0].group).toBe('Sports  News');
    });
  });

  describe('findOrCreateCategory', () => {
    it('should return existing category id', async () => {
      dbApi.listCategories.mockResolvedValue([{ id: 5, category_name: 'Sports', cat_order: 1 }]);

      const result = await findOrCreateCategory('Sports', 'live', 1);

      expect(result).toBe(5);
      expect(dbApi.createCategory).not.toHaveBeenCalled();
    });

    it('should update order if different', async () => {
      dbApi.listCategories.mockResolvedValue([{ id: 5, category_name: 'Sports', cat_order: 1 }]);

      await findOrCreateCategory('Sports', 'live', 3);

      expect(dbApi.updateCategory).toHaveBeenCalledWith(5, { cat_order: 3 });
    });

    it('should create new category if not found', async () => {
      dbApi.listCategories.mockResolvedValue([]);
      dbApi.createCategory.mockResolvedValue(10);

      const result = await findOrCreateCategory('New Category', 'live', 2);

      expect(result).toBe(10);
      expect(dbApi.createCategory).toHaveBeenCalledWith({
        category_type: 'live',
        category_name: 'New Category',
        cat_order: 2,
        parent_id: 0,
      });
    });

    it('should use 0 order if not specified', async () => {
      dbApi.listCategories.mockResolvedValue([]);
      dbApi.createCategory.mockResolvedValue(10);

      await findOrCreateCategory('New Category', 'live');

      expect(dbApi.createCategory).toHaveBeenCalledWith(expect.objectContaining({
        cat_order: 0,
      }));
    });
  });
});
