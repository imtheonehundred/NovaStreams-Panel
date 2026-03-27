const {
  USER_ACTIVITY_MAX_ENTRIES,
  USER_ACTIVITY_CLEANUP_INTERVAL_MS,
  ACTIVE_USER_TIMEOUT_MS,
} = require('../config/constants');

const channels = new Map();
const processes = new Map();
const runControllers = new Map();
const shadowProcesses = new Map();
const tsBroadcasts = new Map();
const userActivity = new Map();
const qoeRate = new Map();
let stabilityMonitor = null;

/**
 * BOUNDED USER ACTIVITY CLEANUP
 * Prevents memory leaks from orphaned userActivity entries.
 * Removes entries older than ACTIVE_USER_TIMEOUT_MS and evicts oldest
 * if the map exceeds USER_ACTIVITY_MAX_ENTRIES.
 */
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [uid, ts] of userActivity.entries()) {
    if (now - ts > ACTIVE_USER_TIMEOUT_MS) {
      userActivity.delete(uid);
      removed++;
    }
  }
  // Emergency LRU eviction if still over limit
  if (userActivity.size > USER_ACTIVITY_MAX_ENTRIES) {
    const entries = [...userActivity.entries()];
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - USER_ACTIVITY_MAX_ENTRIES);
    for (const [uid] of toRemove) {
      userActivity.delete(uid);
    }
  }
}, USER_ACTIVITY_CLEANUP_INTERVAL_MS);

module.exports = {
  channels,
  processes,
  runControllers,
  shadowProcesses,
  tsBroadcasts,
  userActivity,
  qoeRate,
  get stabilityMonitor() { return stabilityMonitor; },
  set stabilityMonitor(val) { stabilityMonitor = val; }
};
