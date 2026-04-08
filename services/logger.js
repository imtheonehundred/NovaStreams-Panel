'use strict';

const winston = require('winston');

const { combine, timestamp, json, errors, printf } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set([
  'password',
  'current_password',
  'new_password',
  'line_password',
  'api_key',
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'stream_token',
]);

function redactString(value) {
  return String(value)
    .replace(
      /(password|current_password|new_password|line_password|api_key|stream_token|token|authorization|cookie|set-cookie)\s*[:=]\s*([^\s,;]+)/gi,
      `$1=${REDACTED}`
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, `$1${REDACTED}`)
    .replace(
      /([?&](?:token|password|api_key|username|line_password)=)[^&\s]+/gi,
      `$1${REDACTED}`
    );
}

function redactValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = SENSITIVE_KEYS.has(String(key).toLowerCase())
      ? REDACTED
      : redactValue(item, seen);
  }
  seen.delete(value);
  return next;
}

function redactArgs(args) {
  return args.map((arg) => redactValue(arg));
}

const redactionFormat = winston.format((info) => redactValue(info));

// Console format for development
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
});

// JSON format for production (structured logging for aggregators)
const prodFormat = combine(
  redactionFormat(),
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  json()
);

// Development uses colorized console output; production uses JSON
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction
    ? prodFormat
    : combine(redactionFormat(), timestamp(), devFormat),
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

  console.log = (...args) => logger.info(...redactArgs(args));
  console.warn = (...args) => logger.warn(...redactArgs(args));
  console.error = (...args) => {
    // Preserve stack traces from Error objects
    const formatted = args.map((a) => (a instanceof Error ? a.stack : a));
    logger.error(...redactArgs(formatted));
  };
}

module.exports = {
  logger,
  log: (level, ...args) => logger.log(level, ...redactArgs(args)),
  logStreamEvent,
  withContext,
  // Re-export levels for convenience
  error: (...args) => logger.error(...redactArgs(args)),
  warn: (...args) => logger.warn(...redactArgs(args)),
  info: (...args) => logger.info(...redactArgs(args)),
  debug: (...args) => logger.debug(...redactArgs(args)),
};
