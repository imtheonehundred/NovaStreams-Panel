'use strict';

/**
 * Central EventEmitter singleton for IPTV Panel real-time events.
 * Used by WebSocket server and webhook service to distribute
 * stream lifecycle and sharing detection events.
 */

const { EventEmitter } = require('events');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

// Typed event constants for stream lifecycle
const WS_EVENTS = {
  STREAM_STARTING: 'stream:starting',
  STREAM_RUNNING: 'stream:running',
  STREAM_EXITED: 'stream:exited',
  STREAM_STOPPED: 'stream:stopped',
  STREAM_ERROR: 'stream:error',
  STREAM_FATAL: 'stream:fatal',
  STREAM_RECOVERY_FAILED: 'stream:recovery_failed',
  STREAM_ZOMBIE: 'stream:zombie',
  SHARING_DETECTED: 'sharing:detected',
};

module.exports = { eventBus, WS_EVENTS };
