'use strict';

const streamingSettings = require('./streaming-settings');

/**
 * In-memory ring of recent MPEG-TS chunks for instant client attach (no disk).
 * Chunks are trimmed from the front when total size exceeds maxBytes.
 * Enable/size/on-demand thresholds come from streaming-settings (DB + env fallback).
 */

function appendPrebufferChunk(b, chunk, maxBytes) {
  if (!streamingSettings.isPrebufferEnabled() || !b || !chunk || chunk.length === 0 || !maxBytes) return;
  if (!b.prebufferChunks) b.prebufferChunks = [];
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  b.prebufferChunks.push(buf);
  b.prebufferBytes = (b.prebufferBytes || 0) + buf.length;

  while (b.prebufferBytes > maxBytes && b.prebufferChunks.length > 0) {
    const first = b.prebufferChunks[0];
    const needDrop = b.prebufferBytes - maxBytes;
    if (first.length <= needDrop) {
      b.prebufferChunks.shift();
      b.prebufferBytes -= first.length;
    } else {
      b.prebufferChunks[0] = first.subarray(needDrop);
      b.prebufferBytes -= needDrop;
      break;
    }
  }
}

function clearPrebuffer(b) {
  if (!b) return;
  b.prebufferChunks = [];
  b.prebufferBytes = 0;
}

function snapshotPrebuffer(b) {
  if (!b || !b.prebufferChunks || b.prebufferChunks.length === 0) return Buffer.alloc(0);
  return Buffer.concat(b.prebufferChunks);
}

function waitForPrebuffer(b, minBytes, maxWaitMs) {
  if (!b || minBytes <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const deadline = Date.now() + maxWaitMs;
    function tick() {
      if ((b.prebufferBytes || 0) >= minBytes || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 20);
    }
    tick();
  });
}

module.exports = {
  appendPrebufferChunk,
  clearPrebuffer,
  snapshotPrebuffer,
  waitForPrebuffer,
};
