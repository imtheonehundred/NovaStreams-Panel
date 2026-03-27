'use strict';

const redis = require('./redis');

/**
 * Express middleware factory that caches JSON responses in Redis.
 * @param {Function} keyFn - (req) => string cache key
 * @param {number} ttl - seconds to cache (default 60)
 */
function cacheMiddleware(keyFn, ttl = 60) {
  return async (req, res, next) => {
    try {
      const key = keyFn(req);
      const cached = await redis.cacheGet(key);
      if (cached) {
        return res.json(cached);
      }
      const origJson = res.json.bind(res);
      res.json = (body) => {
        redis.cacheSet(key, body, ttl).catch(() => {});
        return origJson(body);
      };
      next();
    } catch {
      next();
    }
  };
}

// ─── Cache key builders ──────────────────────────────────────────────

const keys = {
  vodList: (catId, page, perPage) => `vod:list:${catId || 'all'}:${page}:${perPage}`,
  vodDetail: (id) => `vod:detail:${id}`,
  seriesList: (catId, page, perPage) => `series:list:${catId || 'all'}:${page}:${perPage}`,
  seriesDetail: (id) => `series:detail:${id}`,
  liveList: (bouquetHash) => `live:list:${bouquetHash || 'all'}`,
  categories: (type) => `categories:${type || 'all'}`,
  bouquets: () => 'bouquets:all',
  settings: () => 'settings:all',
  epgChannel: (channelId) => `epg:channel:${channelId}`,
  linesList: (memberId, page, perPage) => `lines:list:${memberId || 'all'}:${page}:${perPage}`,
  episodesList: (opts) => `episodes:list:${opts.series_id || 'all'}:${opts.search || ''}:${opts.page || 0}:${opts.limit || 50}`,
};

// ─── Cache TTLs (seconds) ────────────────────────────────────────────

const TTL = {
  VOD_LIST: 60,
  VOD_DETAIL: 120,
  SERIES_LIST: 60,
  SERIES_DETAIL: 120,
  LIVE_LIST: 30,
  CATEGORIES: 120,
  BOUQUETS: 120,
  SETTINGS: 300,
  EPG: 60,
  LINES_LIST: 30,
  EPISODES_LIST: 60,
};

// ─── Cache invalidation helpers ──────────────────────────────────────

async function invalidateVod() {
  await redis.cacheInvalidate('vod:');
}

async function invalidateSeries() {
  await redis.cacheInvalidate('series:');
}

async function invalidateLive() {
  await redis.cacheInvalidate('live:');
}

async function invalidateCategories() {
  await redis.cacheInvalidate('categories:');
}

async function invalidateBouquets() {
  await redis.cacheInvalidate('bouquets:');
}

async function invalidateSettings() {
  await redis.cacheInvalidate('settings:');
}

async function invalidateLines() {
  await redis.cacheInvalidate('lines:');
}

async function invalidateEpisodes() {
  await redis.cacheInvalidate('episodes:');
}

async function invalidateAll() {
  await Promise.all([
    invalidateVod(),
    invalidateSeries(),
    invalidateLive(),
    invalidateCategories(),
    invalidateBouquets(),
    invalidateSettings(),
    invalidateLines(),
    invalidateEpisodes(),
  ]);
}

module.exports = {
  cacheMiddleware,
  keys,
  TTL,
  invalidateVod,
  invalidateSeries,
  invalidateLive,
  invalidateCategories,
  invalidateBouquets,
  invalidateSettings,
  invalidateLines,
  invalidateEpisodes,
  invalidateAll,
};
