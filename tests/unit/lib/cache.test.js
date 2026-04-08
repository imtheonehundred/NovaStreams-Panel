'use strict';

const cache = require('../../../lib/cache');

describe('Cache Library', () => {
  describe('keys', () => {
    describe('vodList', () => {
      it('should generate correct key for all categories', () => {
        expect(cache.keys.vodList(undefined, 1, 10)).toBe('vod:list:all:1:10');
        expect(cache.keys.vodList(null, 1, 10)).toBe('vod:list:all:1:10');
      });

      it('should generate correct key for specific category', () => {
        expect(cache.keys.vodList('cat123', 2, 25)).toBe('vod:list:cat123:2:25');
      });
    });

    describe('vodDetail', () => {
      it('should generate correct key', () => {
        expect(cache.keys.vodDetail(123)).toBe('vod:detail:123');
        expect(cache.keys.vodDetail('abc')).toBe('vod:detail:abc');
      });
    });

    describe('seriesList', () => {
      it('should generate correct key for all categories', () => {
        expect(cache.keys.seriesList(undefined, 1, 10)).toBe('series:list:all:1:10');
      });

      it('should generate correct key for specific category', () => {
        expect(cache.keys.seriesList('cat456', 3, 50)).toBe('series:list:cat456:3:50');
      });
    });

    describe('seriesDetail', () => {
      it('should generate correct key', () => {
        expect(cache.keys.seriesDetail(789)).toBe('series:detail:789');
      });
    });

    describe('liveList', () => {
      it('should generate correct key for all bouquets', () => {
        expect(cache.keys.liveList(undefined)).toBe('live:list:all');
        expect(cache.keys.liveList(null)).toBe('live:list:all');
      });

      it('should generate correct key for specific bouquet', () => {
        expect(cache.keys.liveList('bouquet123')).toBe('live:list:bouquet123');
      });
    });

    describe('categories', () => {
      it('should generate correct key for all types', () => {
        expect(cache.keys.categories(undefined)).toBe('categories:all');
        expect(cache.keys.categories(null)).toBe('categories:all');
      });

      it('should generate correct key for specific type', () => {
        expect(cache.keys.categories('vod')).toBe('categories:vod');
        expect(cache.keys.categories('series')).toBe('categories:series');
        expect(cache.keys.categories('live')).toBe('categories:live');
      });
    });

    describe('bouquets', () => {
      it('should return correct key', () => {
        expect(cache.keys.bouquets()).toBe('bouquets:all');
      });
    });

    describe('settings', () => {
      it('should return correct key', () => {
        expect(cache.keys.settings()).toBe('settings:all');
      });
    });

    describe('epgChannel', () => {
      it('should generate correct key', () => {
        expect(cache.keys.epgChannel('ch1')).toBe('epg:channel:ch1');
      });
    });

    describe('linesList', () => {
      it('should generate correct key for all members', () => {
        expect(cache.keys.linesList(undefined, 1, 50)).toBe('lines:list:all:1:50');
      });

      it('should generate correct key for specific member', () => {
        expect(cache.keys.linesList('member123', 2, 25)).toBe('lines:list:member123:2:25');
      });
    });

    describe('episodesList', () => {
      it('should generate correct key with all options', () => {
        const opts = { series_id: 's1', search: 'test', page: 1, limit: 50 };
        expect(cache.keys.episodesList(opts)).toBe('episodes:list:s1:test:1:50');
      });

      it('should handle missing options', () => {
        const opts = {};
        expect(cache.keys.episodesList(opts)).toBe('episodes:list:all::0:50');
      });
    });
  });

  describe('TTL', () => {
    it('should have all TTL values defined', () => {
      expect(cache.TTL).toHaveProperty('VOD_LIST');
      expect(cache.TTL).toHaveProperty('VOD_DETAIL');
      expect(cache.TTL).toHaveProperty('SERIES_LIST');
      expect(cache.TTL).toHaveProperty('SERIES_DETAIL');
      expect(cache.TTL).toHaveProperty('LIVE_LIST');
      expect(cache.TTL).toHaveProperty('CATEGORIES');
      expect(cache.TTL).toHaveProperty('BOUQUETS');
      expect(cache.TTL).toHaveProperty('SETTINGS');
      expect(cache.TTL).toHaveProperty('EPG');
      expect(cache.TTL).toHaveProperty('LINES_LIST');
      expect(cache.TTL).toHaveProperty('EPISODES_LIST');
    });

    it('should have numeric TTL values', () => {
      Object.values(cache.TTL).forEach(ttl => {
        expect(typeof ttl).toBe('number');
        expect(ttl).toBeGreaterThan(0);
      });
    });
  });

  describe('cacheMiddleware', () => {
    it('should be a function', () => {
      expect(typeof cache.cacheMiddleware).toBe('function');
    });

    it('should return a middleware function', () => {
      const middleware = cache.cacheMiddleware(() => 'test-key', 60);
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3);
    });
  });

  describe('invalidation functions', () => {
    it('should have all invalidation functions', () => {
      expect(typeof cache.invalidateVod).toBe('function');
      expect(typeof cache.invalidateSeries).toBe('function');
      expect(typeof cache.invalidateLive).toBe('function');
      expect(typeof cache.invalidateCategories).toBe('function');
      expect(typeof cache.invalidateBouquets).toBe('function');
      expect(typeof cache.invalidateSettings).toBe('function');
      expect(typeof cache.invalidateLines).toBe('function');
      expect(typeof cache.invalidateEpisodes).toBe('function');
      expect(typeof cache.invalidateAll).toBe('function');
    });
  });
});
