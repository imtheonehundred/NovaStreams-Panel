'use strict';

/**
 * Centralized constants for the IPTV Panel.
 * All magic numbers should be defined here.
 * Replace inline values with references to this module.
 */

// ─── Server ───────────────────────────────────────────────────────────────

module.exports = {
  // Server
  DEFAULT_PORT: 3000,
  SESSION_MAX_AGE_MS: 7 * 24 * 3600 * 1000, // 7 days

  // File upload
  MAX_WATERMARK_SIZE_BYTES: 3 * 1024 * 1024, // 3MB

  // Channel ID validation
  CHANNEL_ID_REGEX: /^[a-f0-9]{8}$/i,

  // Access code gateway
  ACCESS_CODE_REGEX: /^[A-Za-z0-9_-]{3,128}$/,
  RESERVED_GATEWAY_SEGMENTS: new Set([
    'api', 'streams', 'live', 'drm', 'get.php', 'css', 'js', 'assets',
    'watermarks', 'logs', 'favicon.ico',
  ]),

  // ─── Stream Processing ─────────────────────────────────────────────────

  // PassThrough high water mark for TS broadcast
  TS_BROADCAST_HIGH_WATER_MARK: 64 * 1024, // 64KB

  // Idle kill delay for on-demand streams (both TS and HLS)
  IDLE_KILL_DELAY_MS: 60000, // 60 seconds

  // HLS idle poll interval
  HLS_IDLE_POLL_INTERVAL_MS: 15000, // 15 seconds

  // Safe restart delay (allows OS to release file locks)
  SAFE_RESTART_DELAY_MS: 1000, // 1 second

  // Playlist poll attempts (150 * 100ms = 15s total)
  PLAYLIST_POLL_ATTEMPTS: 150,
  PLAYLIST_POLL_INTERVAL_MS: 100,

  // Pipe poll attempts (200 * 50ms = 10s total)
  PIPE_POLL_ATTEMPTS: 200,
  PIPE_POLL_INTERVAL_MS: 50,

  // ─── FFmpeg ───────────────────────────────────────────────────────────

  // FFprobe
  FFPROBE_ANALYZEDURATION: 3000000,
  FFPROBE_PROBESIZE: 3000000,
  FFPROBE_TIMEOUT_MS: 15000,

  // Source fetch timeouts
  MPD_FETCH_TIMEOUT_MS: 3500,
  HLS_FETCH_TIMEOUT_MS: 2500,

  // HLS targetDuration threshold for forced transcode
  HLS_TARGET_DURATION_THRESHOLD: 6,

  // Valid x264 presets
  VALID_X264_PRESETS: ['ultrafast', 'veryfast', 'fast', 'medium'],

  // Audio bitrate bounds (kbps)
  AUDIO_BITRATE_MAX_K: 320,
  AUDIO_BITRATE_MIN_K: 64,

  // HLS segment seconds
  HLS_SEGMENT_SECONDS_MAX: 12,
  HLS_SEGMENT_SECONDS_MIN: 2,
  HLS_SEGMENT_SECONDS_DEFAULT: 2,

  // Low CPU profile uses longer segments
  HLS_SEGMENT_SECONDS_LOW_CPU: 8,

  // HLS playlist size
  HLS_PLAYLIST_SIZE_MAX: 100,
  HLS_PLAYLIST_SIZE_MIN: 0,

  // FFmpeg retry settings
  MAX_RECONNECT_MAX: 100,
  MAX_RECONNECT_MIN: 0,
  MAX_RECONNECT_DEFAULT: 0,

  RETRY_DELAY_SEC_MAX: 300,
  RETRY_DELAY_SEC_MIN: 1,
  RETRY_DELAY_SEC_DEFAULT: 5,

  // FFmpeg max retries per channel
  FFMPEG_MAX_RETRY_LIMIT: 5,
  FFMPEG_COOLDOWN_DELAY_MS: 3000,
  FFMPEG_FORCE_KILL_TIMEOUT_MS: 5000,
  FFMPEG_HEALTH_CHECK_INTERVAL_MS: 10000,

  // HLS buffer delay (seconds)
  HLS_BUFFER_DELAY_SEC_MAX: 600,
  HLS_BUFFER_DELAY_SEC_MIN: 5,
  HLS_BUFFER_DELAY_SEC_DEFAULT: 30,

  // FPS threshold
  FPS_THRESHOLD_MAX: 100,
  FPS_THRESHOLD_MIN: 1,
  FPS_THRESHOLD_DEFAULT: 90,

  // Default probesize for on-demand
  DEFAULT_PROBESIZE: 1500000,

  // Valid video encoders
  VALID_VIDEO_ENCODERS: ['cpu_x264', 'apple', 'nvidia', 'intel', 'amd'],

  // Valid performance profiles
  VALID_PERFORMANCE_PROFILES: ['balanced', 'low_cpu_stable', 'low_low_low'],

  // Watermark opacity
  WATERMARK_OPACITY_MAX: 1,
  WATERMARK_OPACITY_MIN: 0.05,

  // ─── QoE ─────────────────────────────────────────────────────────────

  // QoE startup thresholds (ms)
  QOE_STARTUP_CRITICAL_MS: 8000,
  QOE_STARTUP_WARNING_MS: 4000,

  // QoE score penalties
  QOE_BUFFER_PENALTY_PER_EVENT: 5,
  QOE_ERROR_PENALTY: 20,
  QOE_LATENCY_PENALTY_PER_100MS: 1,

  // QoE EMA smoothing
  QOE_EMA_ALPHA: 0.2,

  // QoE weights for final score
  QOE_WEIGHT: 0.7,
  QOE_SERVER_WEIGHT: 0.3,

  // QoE history limits
  QOE_HISTORY_LIMIT_MAX: 200,
  QOE_HISTORY_LIMIT_MIN: 10,
  QOE_HISTORY_LIMIT_DEFAULT: 60,

  // QoE report rate limit (ms)
  QOE_REPORT_RATE_LIMIT_MS: 2000,

  // ─── Agent ───────────────────────────────────────────────────────────

  AGENT_RATE_LIMIT_WINDOW_MS: 60000,
  AGENT_RATE_LIMIT_MAX: 60,

  // ─── Active User ─────────────────────────────────────────────────────

  ACTIVE_USER_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes

  // Stream metadata map cleanup (bounded to prevent memory leaks)
  STREAM_METADATA_MAX_ENTRIES: 5000,
  STREAM_METADATA_CLEANUP_INTERVAL_MS: 60000, // 1 minute

  // User activity map cleanup (bounded to prevent memory leaks)
  USER_ACTIVITY_MAX_ENTRIES: 10000,
  USER_ACTIVITY_CLEANUP_INTERVAL_MS: 60000, // 1 minute

  // ─── Database ────────────────────────────────────────────────────────

  DB_CONNECTION_LIMIT: 20,
  DB_CHARSET: 'utf8mb4',
  DB_TIMEZONE: '+00:00',

  // ─── Redis ───────────────────────────────────────────────────────────

  REDIS_MAX_RETRIES_PER_REQUEST: 3,
  REDIS_MAX_RETRY_BACKOFF_MS: 2000,
  REDIS_RETRY_BACKOFF_MULTIPLIER: 200,
  REDIS_MAX_RETRIES: 10,

  // ─── Rate Limiting ───────────────────────────────────────────────────

  // Stream endpoints
  STREAM_RATE_WINDOW_MS: 60000,     // 1 minute
  STREAM_RATE_MAX: 100,             // requests per window per IP

  // Auth endpoints
  AUTH_RATE_WINDOW_MS: 300000,      // 5 minutes
  AUTH_RATE_MAX: 10,                // requests per window per IP

  // Admin API
  ADMIN_RATE_WINDOW_MS: 60000,      // 1 minute
  ADMIN_RATE_MAX: 200,              // requests per window per session

  // ─── Security ────────────────────────────────────────────────────────

  // Anti-brute-force (from securityService CONFIG)
  BRUTEFORCE_WINDOW_SEC: 600,       // 10 minutes
  BRUTEFORCE_MAX_ATTEMPTS: 10,

  // Auth flood
  AUTH_FLOOD_WINDOW_SEC: 300,       // 5 minutes
  AUTH_FLOOD_LIMIT: 10,

  // IP threshold for multi-IP detection
  IP_WINDOW_MS: 60000,               // 1 minute
  IP_THRESHOLD: 3,                   // unique IPs within window to flag

  // Account sharing detection
  SHARING_WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours
  SHARING_UNIQUE_IP_THRESHOLD: 3,

  // Playback token TTL (seconds)
  PLAYBACK_TOKEN_TTL_SEC: 45,
  PLAYBACK_TOKEN_TTL_LEGACY_SEC: 3600,

  // ─── Pagination ─────────────────────────────────────────────────────

  DEFAULT_PAGE_LIMIT: 50,
  MAX_PAGE_LIMIT: 100,

  // ─── Release Date ───────────────────────────────────────────────────

  RELEASE_DATE_MAX_LEN: 255,
};
