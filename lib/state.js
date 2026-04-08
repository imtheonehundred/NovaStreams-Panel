const {
  USER_ACTIVITY_MAX_ENTRIES,
  USER_ACTIVITY_CLEANUP_INTERVAL_MS,
  ACTIVE_USER_TIMEOUT_MS,
} = require('../config/constants');

// Private Maps - accessible only through getter/setter functions
// but exported as actual Maps for backward compatibility
const channels = new Map();
const processes = new Map();
const runControllers = new Map();
const shadowProcesses = new Map();
const tsBroadcasts = new Map();
const userActivity = new Map();
const qoeRate = new Map();
let stabilityMonitor = null;

// ---------- Channels ----------
function getChannel(id) {
  return channels.get(id);
}

function setChannel(id, ch) {
  channels.set(id, ch);
}

function deleteChannel(id) {
  channels.delete(id);
}

function hasChannel(id) {
  return channels.has(id);
}

function getChannelCount() {
  return channels.size;
}

function getAllChannels() {
  return [...channels.values()];
}

function getAllChannelIds() {
  return [...channels.keys()];
}

function forEachChannel(fn) {
  channels.forEach(fn);
}

// ---------- Processes ----------
function getProcess(id) {
  return processes.get(id);
}

function setProcess(id, p) {
  processes.set(id, p);
}

function deleteProcess(id) {
  processes.delete(id);
}

function hasProcess(id) {
  return processes.has(id);
}

function getProcessCount() {
  return processes.size;
}

function getAllProcesses() {
  return [...processes.values()];
}

function getAllProcessIds() {
  return [...processes.keys()];
}

function forEachProcess(fn) {
  processes.forEach(fn);
}

// ---------- Run Controllers ----------
function getRunController(id) {
  return runControllers.get(id);
}

function setRunController(id, c) {
  runControllers.set(id, c);
}

function deleteRunController(id) {
  runControllers.delete(id);
}

function hasRunController(id) {
  return runControllers.has(id);
}

function getAllRunControllers() {
  return [...runControllers.values()];
}

function getAllRunControllerIds() {
  return [...runControllers.keys()];
}

// ---------- Shadow Processes ----------
function getShadowProcess(id) {
  return shadowProcesses.get(id);
}

function setShadowProcess(id, p) {
  shadowProcesses.set(id, p);
}

function deleteShadowProcess(id) {
  shadowProcesses.delete(id);
}

function hasShadowProcess(id) {
  return shadowProcesses.has(id);
}

function getAllShadowProcesses() {
  return [...shadowProcesses.values()];
}

// ---------- TS Broadcasts ----------
function getTsBroadcast(id) {
  return tsBroadcasts.get(id);
}

function setTsBroadcast(id, b) {
  tsBroadcasts.set(id, b);
}

function deleteTsBroadcast(id) {
  tsBroadcasts.delete(id);
}

function hasTsBroadcast(id) {
  return tsBroadcasts.has(id);
}

function getAllTsBroadcasts() {
  return [...tsBroadcasts.values()];
}

// ---------- User Activity ----------
function getUserActivity(uid) {
  return userActivity.get(uid);
}

function setUserActivity(uid, ts) {
  userActivity.set(uid, ts);
}

function deleteUserActivity(uid) {
  userActivity.delete(uid);
}

function hasUserActivity(uid) {
  return userActivity.has(uid);
}

function getAllUserActivities() {
  return [...userActivity.entries()];
}

// ---------- QoE Rate ----------
function getQoeRate(channelId) {
  return qoeRate.get(channelId);
}

function setQoeRate(channelId, rate) {
  qoeRate.set(channelId, rate);
}

function deleteQoeRate(channelId) {
  qoeRate.delete(channelId);
}

function hasQoeRate(channelId) {
  return qoeRate.has(channelId);
}

function getAllQoeRates() {
  return [...qoeRate.entries()];
}

/**
 * BOUNDED USER ACTIVITY CLEANUP
 * Prevents memory leaks from orphaned userActivity entries.
 * Removes entries older than ACTIVE_USER_TIMEOUT_MS and evicts oldest
 * if the map exceeds USER_ACTIVITY_MAX_ENTRIES.
 */
const userActivityCleanupTimer = setInterval(() => {
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

if (typeof userActivityCleanupTimer.unref === 'function') {
  userActivityCleanupTimer.unref();
}

module.exports = {
  // New getter/setter API - preferred way to access state
  getChannel,
  setChannel,
  deleteChannel,
  hasChannel,
  getChannelCount,
  getAllChannels,
  getAllChannelIds,
  forEachChannel,

  getProcess,
  setProcess,
  deleteProcess,
  hasProcess,
  getProcessCount,
  getAllProcesses,
  getAllProcessIds,
  forEachProcess,

  getRunController,
  setRunController,
  deleteRunController,
  hasRunController,
  getAllRunControllers,
  getAllRunControllerIds,

  getShadowProcess,
  setShadowProcess,
  deleteShadowProcess,
  hasShadowProcess,
  getAllShadowProcesses,

  getTsBroadcast,
  setTsBroadcast,
  deleteTsBroadcast,
  hasTsBroadcast,
  getAllTsBroadcasts,

  getUserActivity,
  setUserActivity,
  deleteUserActivity,
  hasUserActivity,
  getAllUserActivities,

  getQoeRate,
  setQoeRate,
  deleteQoeRate,
  hasQoeRate,
  getAllQoeRates,

  // Backward-compatible Map exports (for existing consumers)
  // These are the actual Maps - use getter/setter API for new code
  channels,
  processes,
  runControllers,
  shadowProcesses,
  tsBroadcasts,
  userActivity,
  qoeRate,

  // Stability monitor
  get stabilityMonitor() { return stabilityMonitor; },
  set stabilityMonitor(val) { stabilityMonitor = val; },
};
