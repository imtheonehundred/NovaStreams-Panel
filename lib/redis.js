'use strict';

const Redis = require('ioredis');

let client = null;
let sessionStoreClient = null;

function getClient() {
  if (client) return client;
  client = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error('[Redis] Error:', err.message);
  });

  return client;
}

function getSessionStoreClient() {
  if (sessionStoreClient) return sessionStoreClient;
  const redis = getClient();
  sessionStoreClient = {
    async get(key) {
      return redis.get(key);
    },
    async set(key, value, options = undefined) {
      if (
        options &&
        options.expiration &&
        options.expiration.type === 'EX' &&
        Number.isFinite(Number(options.expiration.value))
      ) {
        return redis.set(key, value, 'EX', Number(options.expiration.value));
      }
      return redis.set(key, value);
    },
    async expire(key, ttlSeconds) {
      return redis.expire(key, ttlSeconds);
    },
    async del(keys) {
      if (Array.isArray(keys)) {
        if (!keys.length) return 0;
        return redis.del(...keys);
      }
      return redis.del(keys);
    },
    async mGet(keys) {
      if (!Array.isArray(keys) || !keys.length) return [];
      return redis.mget(...keys);
    },
    async *scanIterator(options = {}) {
      const match = options.MATCH || '*';
      const count = options.COUNT || 100;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          match,
          'COUNT',
          count
        );
        cursor = next;
        yield keys;
      } while (cursor !== '0');
    },
  };
  return sessionStoreClient;
}

async function connect() {
  const c = getClient();
  try {
    await c.connect();
    console.log('[Redis] Connected');
    return true;
  } catch (e) {
    if (e.message && e.message.includes('already')) return true;
    console.error('[Redis] Connection failed:', e.message);
    return false;
  }
}

async function cacheGet(key) {
  try {
    const val = await getClient().get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, data, ttl = 60) {
  try {
    await getClient().setex(key, ttl, JSON.stringify(data));
  } catch {
    /* ignore cache write failures */
  }
}

async function cacheDel(key) {
  try {
    await getClient().del(key);
  } catch {
    /* ignore */
  }
}

async function cacheInvalidate(prefix) {
  try {
    const c = getClient();
    let cursor = '0';
    do {
      const [next, keys] = await c.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        200
      );
      cursor = next;
      if (keys.length) await c.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* ignore */
  }
}

// Mutex lock for cron job overlap protection
async function acquireLock(key, ttlSeconds = 60) {
  try {
    const result = await getClient().set(key, '1', 'NX', 'EX', ttlSeconds);
    return result === 'OK';
  } catch {
    return false;
  }
}

async function releaseLock(key) {
  try {
    await getClient().del(key);
  } catch {
    /* ignore */
  }
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
    sessionStoreClient = null;
  }
}

module.exports = {
  getClient,
  getSessionStoreClient,
  connect,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheInvalidate,
  acquireLock,
  releaseLock,
  disconnect,
};
