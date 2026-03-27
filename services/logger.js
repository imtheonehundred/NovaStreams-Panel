'use strict';

const winston = require('winston');

const { combine, timestamp, json, errors, printf } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

// Console format for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
});

// JSON format for production (structured logging for aggregators)
const prodFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  json()
);

// Development uses colorized console output; production uses JSON
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : combine(timestamp(), devFormat),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

// ─── Stream Manager helper ────────────────────────────────────────────────

/**
 * Log a stream management event. Used by services/streamManager.js.
 * @param {string} event - Event name (STARTING, STOPPED, EXITED, CRASHED, etc.)
 * @param {string} channelId - Channel identifier
 * @param {object} details - Additional context
 */
function logStreamEvent(event, channelId, details = {}) {
  logger.info(`[STREAM_MGR:${event}] [CH_${channelId}]`, details);
}

// ─── Request context helper ───────────────────────────────────────────────

/**
 * Creates a child logger with request context.
 * Call with reqId, userId, etc. to attach to all logs in a request chain.
 * @param {object} context - { reqId, userId, channelId, ... }
 * @returns {winston.Logger} Child logger
 */
function withContext(context) {
  return logger.child(context);
}

// ─── Replace global console.log ───────────────────────────────────────────

// Replace console.log/error/warn in production so nothing slips through
if (isProduction) {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;

  console.log = (...args) => logger.info(args.join(' '));
  console.warn = (...args) => logger.warn(args.join(' '));
  console.error = (...args) => {
    // Preserve stack traces from Error objects
    const formatted = args.map(a => a instanceof Error ? a.stack : a);
    logger.error(formatted.join(' '));
  };
}

module.exports = {
  logger,
  logStreamEvent,
  withContext,
  // Re-export levels for convenience
  error: (...args) => logger.error(...args),
  warn: (...args) => logger.warn(...args),
  info: (...args) => logger.info(...args),
  debug: (...args) => logger.debug(...args),
};
