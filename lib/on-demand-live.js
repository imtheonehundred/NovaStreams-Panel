'use strict';

const { channels, processes } = require('./state');

let startChannelImpl = null;
const pendingStarts = new Map();

const WAIT_MS = Math.min(
  300000,
  Math.max(5000, parseInt(process.env.ON_DEMAND_START_WAIT_MS || '120000', 10) || 120000)
);

function registerStartChannel(fn) {
  startChannelImpl = fn;
}

async function waitUntilRunningOrError(channelId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ch = channels.get(channelId);
    if (!ch) return;
    const st = String(ch.status || '').toLowerCase();
    if (st === 'running') return;
    if (st === 'error') {
      throw new Error(ch.error || 'Channel start failed');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const ch = channels.get(channelId);
  const st = String(ch && ch.status).toLowerCase();
  if (st !== 'running') {
    throw new Error((ch && ch.error) || 'Timeout waiting for stream');
  }
}

/**
 * Start FFmpeg via the panel engine (server.js startChannel) if the channel is stopped.
 * Used for on-demand MPEG-TS attach, API playback, and any path that must match admin behavior.
 * Deduplicates concurrent starts; waits if status is already starting.
 */
async function ensureChannelStarted(channelId) {
  const ch = channels.get(channelId);
  if (!ch) throw new Error('Channel not found');

  if (pendingStarts.has(channelId)) {
    await pendingStarts.get(channelId);
    const c = channels.get(channelId);
    const st = String(c && c.status).toLowerCase();
    if (st === 'running') return;
    if (st === 'error') throw new Error(c.error || 'Channel start failed');
    throw new Error((c && c.error) || 'Stream failed to start');
  }

  let st = String(ch.status || '').toLowerCase();
  if (st === 'running') return;

  if (st === 'starting' || processes.has(channelId)) {
    await waitUntilRunningOrError(channelId, WAIT_MS);
    return;
  }

  const fn = startChannelImpl;
  if (typeof fn !== 'function') {
    throw new Error('Channel start is not initialized');
  }

  const fresh = channels.get(channelId);
  const run = (async () => {
    await fn(channelId, fresh);
  })();
  const wrapped = run.finally(() => pendingStarts.delete(channelId));
  pendingStarts.set(channelId, wrapped);
  await wrapped;

  const c2 = channels.get(channelId);
  st = String(c2 && c2.status).toLowerCase();
  if (st === 'error') throw new Error(c2.error || 'Channel start failed');
  if (st === 'starting') {
    await waitUntilRunningOrError(channelId, WAIT_MS);
    return;
  }
  if (st !== 'running') {
    throw new Error((c2 && c2.error) || 'Stream failed to start');
  }
}

/**
 * Start FFmpeg for on-demand channels when the first authenticated client connects.
 */
async function ensureOnDemandStreamIfNeeded(channelId) {
  const ch = channels.get(channelId);
  if (!ch || !ch.on_demand) return;
  await ensureChannelStarted(channelId);
}

module.exports = {
  registerStartChannel,
  ensureOnDemandStreamIfNeeded,
  /** Same engine as panel /attach — use for API playback instead of streamManager.startChannel */
  ensurePlaybackChannelReady: ensureChannelStarted,
};
