const streamManager = require('./streamManager');

const viewers = new Map();
const STOP_DELAY_MS = 20000; // 20s grace period

function ensure(channelId) {
  if (!viewers.has(channelId)) {
    viewers.set(channelId, { count: 0, timer: null });
  }
  return viewers.get(channelId);
}

function cancelTimer(entry) {
  if (entry && entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function increment(channelId) {
  const entry = ensure(channelId);
  cancelTimer(entry);
  entry.count += 1;
  return entry.count;
}

function decrement(channelId) {
  const entry = ensure(channelId);
  entry.count = Math.max(0, entry.count - 1);
  if (entry.count === 0) {
    cancelTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.count === 0) {
        streamManager.stopChannel(channelId);
      }
    }, STOP_DELAY_MS);
  }
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

module.exports = {
  increment,
  decrement,
  getCount,
  getAll,
};
