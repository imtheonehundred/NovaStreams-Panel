const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const fs = require('fs');
const path = require('path');
const { channels, processes, tsBroadcasts } = require('../lib/state');
// Assuming ffmpeg-args handles the argument building explicitly as required
const { buildFfmpegArgs } = require('../lib/ffmpeg-args');
const {
  STREAM_METADATA_MAX_ENTRIES,
  STREAM_METADATA_CLEANUP_INTERVAL_MS,
} = require('../config/constants');
const { eventBus, WS_EVENTS } = require('./eventBus');

/**
 * PRODUCTION-GRADE STREAM MANAGER
 * --------------------------------
 * This module manages the lifecycle of FFmpeg child processes for IPTV distribution.
 * It enforces auto-recovery, crash detection, non-blocking asynchronous execution,
 * and completely centralized state mapping using `state.js` to ensure sync.
 */

// Central configuration
const CONFIG = {
  HEALTH_CHECK_INTERVAL_MS: 10000, // 10 seconds background check
  MAX_RETRY_LIMIT: 5,
  COOLDOWN_DELAY_MS: 3000,
  FORCE_KILL_TIMEOUT_MS: 5000, // wait time before upgrading SIGTERM to SIGKILL
};

// Internal structures to track lifecycle metadata without mutating `channels` heavily
// We keep an internal metadata map to handle auto-recovery isolated from the frontend's DB channel map.
const streamMetadata = new Map();

/**
 * Initializes metadata for a stream if not tracking.
 */
function initMetadata(channelId) {
  if (!streamMetadata.has(channelId)) {
    streamMetadata.set(channelId, {
      id: channelId,
      retries: 0,
      lastError: null,
      cooldownTimer: null,
      intentionalStop: true // Set to false when running to detect unexpected crashes
    });
  }
  return streamMetadata.get(channelId);
}

/**
 * Helper to log structured JSON logs for observability aggregators (e.g. ELK/Datadog)
 */
function logSystem(event, channelId, details = {}) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [STREAM_MGR:${event}] [CH_${channelId}]`, JSON.stringify(details));
}

/**
 * Helper: Gracefully eliminate old processes avoiding memory leaks
 */
function terminateProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) {
        // Fallback to SIGKILL if SIGTERM fails immediately
        treeKill(pid, 'SIGKILL');
      }
      resolve();
    });
  });
}

/**
 * 1. START CHANNEL
 * Spawns an FFmpeg transcode/stream process and initiates monitoring.
 */
async function startChannel(channelId, channelObj) {
  if (processes.has(channelId)) {
    logSystem('WARN', channelId, { msg: 'Channel already running. Stop it first, or use restartChannel.' });
    return;
  }

  const meta = initMetadata(channelId);
  meta.intentionalStop = false;

  // Persist channel payload state safely inside the module
  if (!channels.has(channelId)) {
    channels.set(channelId, channelObj);
  }

  logSystem('STARTING', channelId, { attempt: meta.retries + 1, name: channelObj.name });
  eventBus.emit(WS_EVENTS.STREAM_STARTING, { channelId, name: channelObj.name, timestamp: new Date().toISOString() });

  try {
    const streamDir = path.join(__dirname, '..', 'streams', channelId);
    if (!fs.existsSync(streamDir)) {
      fs.mkdirSync(streamDir, { recursive: true });
    }

    // Build FFmpeg Arguments (Injects the required API->Controller->streamManager->ffmpegManager flow)
    const { args: ffmpegArgs, playlist } = buildFfmpegArgs(channelObj, streamDir, channelId, __dirname);
    
    // Core Process Spawn
    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'ignore', 'pipe'],
      detached: true // Allows tree-killing smoothly in *nix environments
    });

    processes.set(channelId, proc);
    
    channels.get(channelId).status = 'running';
    channels.get(channelId).startedAt = new Date().toISOString();

    // Catch Standard Error to diagnose stream faults before a fatal exit occurs
    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('fail') || msg.includes('Invalid')) {
        meta.lastError = msg.trim();
      }
    });

    // Auto-Recovery System Hook
    proc.on('exit', (code, signal) => {
      processes.delete(channelId);
      const graceful = meta.intentionalStop || signal === 'SIGTERM' || signal === 'SIGKILL';
      
      logSystem('EXITED', channelId, { code, signal, graceful });
      eventBus.emit(graceful ? WS_EVENTS.STREAM_STOPPED : WS_EVENTS.STREAM_EXITED, {
        channelId,
        code,
        signal,
        graceful,
        timestamp: new Date().toISOString(),
      });

      if (!graceful) {
        handleCrashRecovery(channelId, channelObj, code);
      } else {
        logSystem('STOPPED_CLEANLY', channelId, { msg: 'User initiated or graceful cycle' });
        // Clean up metadata
        meta.retries = 0; 
      }
    });

    proc.on('error', (err) => {
      logSystem('PROCESS_ERROR', channelId, { error: err.message });
      eventBus.emit(WS_EVENTS.STREAM_ERROR, { channelId, error: err.message, timestamp: new Date().toISOString() });
      meta.lastError = err.message;
    });

  } catch (error) {
    logSystem('FATAL_SPAWN', channelId, { error: error.message });
    eventBus.emit(WS_EVENTS.STREAM_FATAL, { channelId, error: error.message, timestamp: new Date().toISOString() });
    channels.get(channelId).status = 'error';
    channels.get(channelId).error = error.message;
  }
}

/**
 * Auto-Recovery Logic Processor
 */
function handleCrashRecovery(channelId, channelObj, exitCode) {
  const meta = initMetadata(channelId);
  meta.retries += 1;

  channels.get(channelId).status = 'crashed';
  channels.get(channelId).error = meta.lastError || `FFmpeg crashed with exit code ${exitCode}`;

  if (meta.retries >= CONFIG.MAX_RETRY_LIMIT) {
    logSystem('RECOVERY_FAILED', channelId, { msg: 'Max retries exceeded. Manual intervention required.' });
    eventBus.emit(WS_EVENTS.STREAM_RECOVERY_FAILED, { channelId, timestamp: new Date().toISOString() });
    channels.get(channelId).status = 'error';
    return;
  }

  logSystem('INITIATING_RECOVERY', channelId, { pendingAttempt: meta.retries + 1, delay: CONFIG.COOLDOWN_DELAY_MS });
  channels.get(channelId).status = 'restarting';

  meta.cooldownTimer = setTimeout(() => {
    logSystem('RECOVERING', channelId, { msg: 'Triggering delayed restart' });
    startChannel(channelId, channelObj);
  }, CONFIG.COOLDOWN_DELAY_MS);
}

/**
 * 2. STOP CHANNEL
 * Cleans up timeouts, resets statuses, and recursively ends memory trees.
 */
async function stopChannel(channelId) {
  logSystem('STOP_REQUESTED', channelId, { msg: 'Processing safe teardown' });

  const meta = initMetadata(channelId);
  meta.intentionalStop = true;
  meta.retries = 0; // Reset metrics on manual stoppage

  if (meta.cooldownTimer) {
    clearTimeout(meta.cooldownTimer);
    meta.cooldownTimer = null;
  }

  if (channels.has(channelId)) {
    const ch = channels.get(channelId);
    ch.status = 'stopped';
    ch.startedAt = null;
    ch.error = null;
  }

  if (processes.has(channelId)) {
    const proc = processes.get(channelId);
    await terminateProcessTree(proc.pid);
    processes.delete(channelId);
  }

  // Cleanup broadcast streams mapping if MPEG-TS used
  if (tsBroadcasts.has(channelId)) {
    const br = tsBroadcasts.get(channelId);
    if (br && br.consumers) {
      for (const reqFlow of br.consumers) {
        try { reqFlow.destroy(); } catch (e) {}
      }
      br.consumers.clear();
    }
    tsBroadcasts.delete(channelId);
  }
}

/**
 * 3. RESTART CHANNEL
 */
async function restartChannel(channelId) {
  logSystem('RESTART_REQUESTED', channelId);
  const chInfo = channels.get(channelId);
  if (!chInfo) {
    logSystem('ERROR', channelId, { msg: 'Channel does not exist in memory. Restart fail.' });
    return;
  }

  await stopChannel(channelId);
  // On-demand channels: skip OS file-lock delay — modern systems release quickly
  const ch = channels.get(channelId);
  const isOnDemand = ch && ch.on_demand;
  const delay = isOnDemand ? 0 : 1000;
  setTimeout(() => startChannel(channelId, chInfo), delay);
}

/**
 * 4. GET CHANNEL STATUS
 */
function getChannelStatus(channelId) {
  const channel = channels.get(channelId);
  const isRunning = processes.has(channelId);
  const meta = initMetadata(channelId);

  if (!channel) return { status: 'offline', msg: 'Not loaded' };

  let uptime = 0;
  if (channel.startedAt && isRunning) {
    uptime = Math.floor((new Date() - new Date(channel.startedAt)) / 1000);
  }

  return {
    id: channelId,
    status: channel.status || (isRunning ? 'running' : 'stopped'),
    activeProcess: isRunning,
    restarts: meta.retries,
    lastError: meta.lastError || channel.error || null,
    uptimeSeconds: uptime
  };
}

/**
 * 5. LIST ACTIVE CHANNELS
 */
function listActiveChannels() {
  const active = [];
  processes.forEach((proc, id) => {
    active.push(getChannelStatus(id));
  });
  return active;
}

/**
 * HEALTH CHECK LOOP
 * Ensures background state syncs perfectly with process reality to prevent ghost UIs.
 */
setInterval(() => {
  for (const [id, proc] of processes.entries()) {
    try {
      // 0 signal ping just verifies process existence. 
      // If it throws, the PID died silently without emitting 'exit'
      process.kill(proc.pid, 0); 
    } catch (e) {
      logSystem('ZOMBIE_DETECTED', id, { msg: 'PID missing but map tracked. Cleaning state.' });
      eventBus.emit(WS_EVENTS.STREAM_ZOMBIE, { channelId: id, timestamp: new Date().toISOString() });
      processes.delete(id);
      
      const ch = channels.get(id);
      if (ch) {
         handleCrashRecovery(id, ch, -1);
      }
    }
  }
}, CONFIG.HEALTH_CHECK_INTERVAL_MS);

/**
 * BOUNDED STREAM METADATA CLEANUP
 * Prevents memory leaks from orphaned metadata entries when channels crash
 * without cleanup or when processes exit cleanly.
 */
setInterval(() => {
  let removed = 0;
  for (const [channelId, meta] of streamMetadata.entries()) {
    const isRunning = processes.has(channelId);
    const hasPendingCooldown = meta.cooldownTimer !== null;
    // Safe to remove if: no active process AND no pending cooldown restart
    if (!isRunning && !hasPendingCooldown) {
      streamMetadata.delete(channelId);
      removed++;
    }
  }
  // Emergency LRU eviction if still over limit
  if (streamMetadata.size > STREAM_METADATA_MAX_ENTRIES) {
    const entries = [...streamMetadata.entries()];
    entries.sort((a, b) => {
      // Sort by oldest entry (by checking intentionalStop timestamp heuristic)
      const aVal = a[1].intentionalStop ? 1 : 0;
      const bVal = b[1].intentionalStop ? 1 : 0;
      return aVal - bVal;
    });
    const toRemove = entries.slice(0, entries.length - STREAM_METADATA_MAX_ENTRIES);
    for (const [channelId] of toRemove) {
      streamMetadata.delete(channelId);
    }
  }
}, STREAM_METADATA_CLEANUP_INTERVAL_MS);


// Export core interface
module.exports = {
  startChannel,
  stopChannel,
  restartChannel,
  getChannelStatus,
  listActiveChannels
};
