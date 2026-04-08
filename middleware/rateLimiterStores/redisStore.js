'use strict';

const { getClient } = require('../../lib/redis');

const PREFIX = 'ratelimit:';

function getRedisStore() {
  return {
    async increment(key, windowMs) {
      const client = getClient();
      const redisKey = `${PREFIX}${key}`;
      const windowSec = Math.ceil(windowMs / 1000);

      const multi = client.multi();
      multi.incr(redisKey);
      multi.expire(redisKey, windowSec);
      const results = await multi.exec();

      const count = results[0][1];
      return { totalHits: count };
    },

    async decrement(key) {
      const client = getClient();
      const redisKey = `${PREFIX}${key}`;
      await client.decr(redisKey);
    },

    async resetKey(key) {
      const client = getClient();
      const redisKey = `${PREFIX}${key}`;
      await client.del(redisKey);
    },

    async get(key) {
      const client = getClient();
      const redisKey = `${PREFIX}${key}`;

      const count = await client.get(redisKey);
      return { totalHits: count ? parseInt(count, 10) : 0 };
    },
  };
}

module.exports = { getRedisStore };
