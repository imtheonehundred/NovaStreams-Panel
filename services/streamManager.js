const { channels, processes, tsBroadcasts } = require('../lib/state');
const { STREAM_METADATA_MAX_ENTRIES, STREAM_METADATA_CLEANUP_INTERVAL_MS } = require('../config/constants');
const { eventBus, WS_EVENTS } = require('./eventBus');
const dbApi = require('../lib/db');
const serverService = require('./serverService');

const CONFIG = {
  HEALTH_CHECK_INTERVAL_MS: 10000,
};

const streamMetadata = new Map();

function initMetadata(channelId) {
  if (!streamMetadata.has(channelId)) {
    streamMetadata.set(channelId, { id: channelId, retries: 0, lastError: null, cooldownTimer: null, intentionalStop: true });
  }
  return streamMetadata.get(channelId);
}

function logSystem(event, channelId, details = {}) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [STREAM_MGR:${event}] [CH_${channelId}]`, JSON.stringify(details));
}

function getChannelStatus(channelId) {
  const channel = channels.get(channelId);
  const isRunning = processes.has(channelId);
  const meta = initMetadata(channelId);
  if (!channel) return { status: 'offline', msg: 'Not loaded' };
  let uptime = 0;
  if (channel.startedAt && isRunning) {
    uptime = Math.floor((new Date() - new Date(channel.startedAt)) / 1000);
  }
  return { id: channelId, status: channel.status || (isRunning ? 'running' : 'stopped'), activeProcess: isRunning, restarts: meta.retries, lastError: meta.lastError || channel.error || null, uptimeSeconds: uptime };
}

function listActiveChannels() {
  const active = [];
  processes.forEach((proc, id) => { active.push(getChannelStatus(id)); });
  return active;
}

async function issueRemoteCommand({ serverId, commandType, streamType, streamId, placementId, payload, issuedByUserId }) {
  const SUPPORTED_TYPES = ['reload_proxy_config', 'restart_services', 'reboot_server'];
  const DE_SCOPED_TYPES = ['start_stream', 'stop_stream', 'restart_stream', 'probe_stream', 'sync_server_config', 'reconcile_runtime', 'reconcile_sessions', 'sync_proxy_upstream'];
  if (DE_SCOPED_TYPES.includes(commandType)) return { ok: false, reason: `command de-scoped in TARGET: ${commandType}` };
  if (!SUPPORTED_TYPES.includes(commandType)) return { ok: false, reason: `invalid command type: ${commandType}` };
  const check = await serverService.canIssueCommandToServer(serverId, commandType);
  if (!check.ok) return { ok: false, reason: check.reason };
  try {
    const cmdId = await dbApi.createServerCommand({ serverId, streamType: streamType || null, streamId: streamId != null ? String(streamId) : null, placementId: placementId || null, commandType, payload: payload || null, issuedByUserId: issuedByUserId || null });
    logSystem('REMOTE_COMMAND_ISSUED', null, { commandId: cmdId, serverId, commandType, streamType, streamId });
    return { ok: true, commandId: cmdId };
  } catch (err) {
    logSystem('REMOTE_COMMAND_ERROR', null, { serverId, commandType, error: err.message });
    return { ok: false, reason: err.message };
  }
}

async function startLiveOnRemote(channelId, serverId, issuedByUserId) {
  return { ok: false, reason: 'remote live runtime is de-scoped in TARGET' };
}

async function stopLiveOnRemote(channelId, serverId, issuedByUserId) {
  return { ok: false, reason: 'remote live runtime is de-scoped in TARGET' };
}

const streamHealthCheckTimer = setInterval(() => {
  for (const [id, proc] of processes.entries()) {
    try {
      process.kill(proc.pid, 0);
    } catch (e) {
      logSystem('ZOMBIE_DETECTED', id, { msg: 'PID missing but map tracked. Cleaning state.' });
      eventBus.emit(WS_EVENTS.STREAM_ZOMBIE, { channelId: id, timestamp: new Date().toISOString() });
      processes.delete(id);
    }
  }
}, CONFIG.HEALTH_CHECK_INTERVAL_MS);

if (typeof streamHealthCheckTimer.unref === 'function') streamHealthCheckTimer.unref();

const streamMetadataCleanupTimer = setInterval(() => {
  let removed = 0;
  for (const [channelId, meta] of streamMetadata.entries()) {
    const isRunning = processes.has(channelId);
    const hasPendingCooldown = meta.cooldownTimer !== null;
    if (!isRunning && !hasPendingCooldown) { streamMetadata.delete(channelId); removed++; }
  }
  if (streamMetadata.size > STREAM_METADATA_MAX_ENTRIES) {
    const entries = [...streamMetadata.entries()];
    entries.sort((a, b) => { const aVal = a[1].intentionalStop ? 1 : 0; const bVal = b[1].intentionalStop ? 1 : 0; return aVal - bVal; });
    const toRemove = entries.slice(0, entries.length - STREAM_METADATA_MAX_ENTRIES);
    for (const [channelId] of toRemove) streamMetadata.delete(channelId);
  }
}, STREAM_METADATA_CLEANUP_INTERVAL_MS);

if (typeof streamMetadataCleanupTimer.unref === 'function') streamMetadataCleanupTimer.unref();

module.exports = { getChannelStatus, listActiveChannels, issueRemoteCommand, startLiveOnRemote, stopLiveOnRemote };
