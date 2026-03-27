'use strict';

const Redis = require('ioredis');

let client = null;

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
  } catch { return null; }
}

async function cacheSet(key, data, ttl = 60) {
  try {
    await getClient().setex(key, ttl, JSON.stringify(data));
  } catch { /* ignore cache write failures */ }
}

async function cacheDel(key) {
  try {
    await getClient().del(key);
  } catch { /* ignore */ }
}

async function cacheInvalidate(prefix) {
  try {
    const c = getClient();
    let cursor = '0';
    do {
      const [next, keys] = await c.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await c.del(...keys);
    } while (cursor !== '0');
  } catch { /* ignore */ }
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = {
  getClient,
  connect,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheInvalidate,
  disconnect,
};
