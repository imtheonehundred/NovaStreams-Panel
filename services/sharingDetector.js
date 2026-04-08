'use strict';

const { getClient } = require('../lib/redis');
const {
  SHARING_WINDOW_MS,
  SHARING_UNIQUE_IP_THRESHOLD,
} = require('../config/constants');

/**
 * Redis-backed account sharing detector.
 * Replaces the in-memory Map in securityService.js with a Redis-backed
 * implementation that works across multiple server instances.
 */

const SHARING_KEY_PREFIX = 'sharing:';

/**
 * Record IP activity for a user and check if sharing is detected.
 * @param {number|string} userId
 * @param {string} ip - IP address
 * @returns {{ flagged: boolean, uniqueIps: number }}
 */
async function recordAndCheck(userId, ip) {
  const redis = getClient();
  const key = `${SHARING_KEY_PREFIX}${userId}`;
  const now = Date.now();
  const windowStart = now - SHARING_WINDOW_MS;

  // Add the new IP with timestamp as a sorted set member
  // Score is timestamp for range queries
  await redis.zadd(key, now, `${ip}:${now}`);

  // Remove entries older than the sharing window
  await redis.zremrangebyscore(key, 0, windowStart);

  // Set expiry on the key to auto-cleanup
  await redis.expire(key, Math.ceil(SHARING_WINDOW_MS / 1000) + 60);

  // Count unique IPs in the window
  const entries = await redis.zrange(key, 0, -1);
  const uniqueIps = new Set(entries.map(e => e.split(':')[0]));

  const flagged = uniqueIps.size >= SHARING_UNIQUE_IP_THRESHOLD;
  return { flagged, uniqueIps: uniqueIps.size };
}

/**
 * Get sharing history for a user (for admin review).
 * @param {number|string} userId
 * @returns {Promise<string[]>} List of unique IPs in current window
 */
async function getSharingHistory(userId) {
  const redis = getClient();
  const key = `${SHARING_KEY_PREFIX}${userId}`;
  const now = Date.now();
  const windowStart = now - SHARING_WINDOW_MS;

  // Get all entries within window
  const entries = await redis.zrangebyscore(key, windowStart, now);
  const uniqueIps = [...new Set(entries.map(e => e.split(':')[0]))];
  return uniqueIps;
}

/**
 * Clear sharing history for a user (e.g., after manual review).
 * @param {number|string} userId
 */
async function clearHistory(userId) {
  const redis = getClient();
  const key = `${SHARING_KEY_PREFIX}${userId}`;
  await redis.del(key);
}

/**
 * Pub/sub channel for cross-instance sharing alerts.
 * When sharing is flagged on any instance, all instances receive it.
 */
const SHARING_ALERT_CHANNEL = 'sharing:alerts';

/**
 * Publish a sharing alert to all instances.
 * @param {number|string} userId
 * @param {number} uniqueIpCount
 */
async function publishAlert(userId, uniqueIpCount) {
  const redis = getClient();
  await redis.publish(SHARING_ALERT_CHANNEL, JSON.stringify({
    userId: String(userId),
    uniqueIps: uniqueIpCount,
    ts: Date.now(),
  }));
}

/**
 * Subscribe to sharing alerts from other instances.
 * @param {Function} handler - (userId, uniqueIpCount) => void
 * @returns {Function} Unsubscribe function
 */
function subscribeToAlerts(handler) {
  const redis = getClient();
  const subscriber = redis.duplicate();

  subscriber.subscribe(SHARING_ALERT_CHANNEL);
  subscriber.on('message', (channel, message) => {
    if (channel === SHARING_ALERT_CHANNEL) {
      try {
        const { userId, uniqueIps } = JSON.parse(message);
        handler(userId, uniqueIps);
      } catch {}
    }
  });

  return () => {
    subscriber.unsubscribe(SHARING_ALERT_CHANNEL);
    subscriber.disconnect();
  };
}

module.exports = {
  recordAndCheck,
  getSharingHistory,
  clearHistory,
  publishAlert,
  subscribeToAlerts,
};
