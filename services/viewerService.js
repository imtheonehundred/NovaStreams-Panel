/**
 * Viewer tracking service.
 *
 * Tracks concurrent viewer counts per channel for monitoring and analytics.
 * Does NOT control channel lifecycle - that is owned by server.js.
 *
 * This module previously had auto-stop behavior when viewer count dropped to zero,
 * but that overlapped with server.js runtime ownership and has been removed.
 */

const viewers = new Map();

function ensure(channelId) {
  if (!viewers.has(channelId)) {
    viewers.set(channelId, { count: 0 });
  }
  return viewers.get(channelId);
}

function increment(channelId) {
  const entry = ensure(channelId);
  entry.count += 1;
  return entry.count;
}

function decrement(channelId) {
  const entry = ensure(channelId);
  entry.count = Math.max(0, entry.count - 1);
  return entry.count;
}

function getCount(channelId) {
  return viewers.get(channelId)?.count || 0;
}

function getAll() {
  const result = {};
  viewers.forEach((v, k) => {
    result[k] = v.count;
  });
  return result;
}

function _resetForTests() {
  viewers.clear();
}

module.exports = {
  increment,
  decrement,
  getCount,
  getAll,
  _resetForTests,
};
