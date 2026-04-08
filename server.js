require('dotenv').config();

const { error: logError, info: serverLog } = require('./services/logger');
const { ConflictError } = require('./lib/errors');

const REQUIRED_ENV_VARS = [
  'SESSION_SECRET',
  'LINE_PASSWORD_SECRET',
  'STREAM_SECRET',
  'DB_PASSWORD',
];
for (const key of REQUIRED_ENV_VARS) {
  if (!String(process.env[key] || '').trim()) {
    logError('Missing required environment variable', { key });
    process.exit(1);
  }
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs');
const { PassThrough } = require('stream');
const treeKill = require('tree-kill');
const { csrfProtection } = require('./middleware/csrf');
const { securityHeaders } = require('./middleware/securityHeaders');
const {
  streamLimiter,
  authLimiter,
  adminLimiter,
  apiKeyLimiter,
} = require('./middleware/rateLimiter');

const {
  buildFfmpegArgs,
  buildFfprobeArgs,
  needsTranscode,
  buildMergedHeaders,
  buildNginxDualCopyFfmpegArgs,
} = require('./lib/ffmpeg-args');
const dbApi = require('./lib/db');
const { seedDefaults } = require('./scripts/seed');
const mariadb = require('./lib/mariadb');
const redis = require('./lib/redis');
const { startCrons } = require('./lib/crons');
const { createPanelAccess } = require('./lib/panel-access');
const { parseExtractionDump } = require('./lib/parse-extraction');
const importChannelBridge = require('./lib/importChannelBridge');
const {
  detectInputType,
  resolveEffectiveInputType,
} = require('./lib/input-detect');
const { collectSystemMetrics } = require('./lib/system-metrics');
const { createStabilityMonitor } = require('./lib/stability-monitor');
const streamingSettings = require('./lib/streaming-settings');
const {
  appendPrebufferChunk,
  clearPrebuffer,
  snapshotPrebuffer,
  waitForPrebuffer,
} = require('./lib/ts-prebuffer');
const onDemandLive = require('./lib/on-demand-live');
const { initializeDbBoot } = require('./lib/boot/db');
const { registerBootRoutes, formatDuration } = require('./lib/boot/routes');
const { createStreamingBoot } = require('./lib/boot/streaming');
const { startBootJobs } = require('./lib/boot/jobs');
const {
  AUTH_BRUTE_FORCE_PATHS,
  buildSessionOptions,
} = require('./lib/panel-session');
const fetch = require('node-fetch');
const bouquetService = require('./services/bouquetService');
const lineService = require('./services/lineService');
const securityService = require('./services/securityService');
const serverService = require('./services/serverService');
const { eventBus, WS_EVENTS } = require('./services/eventBus');
const { createWsServer } = require('./services/wsServer');
const { applyStabilityFix } = require('./services/stabilityService');
const createIdleKillService = require('./services/idleKillService');
const {
  clamp,
  computeQoeScore,
  computeFinalScore,
  fetchTextWithTimeout,
  parseMpdInfo,
  parseHlsInfo,
  preDetectSource,
  channelRuntimeInfo,
  mergeChannelOptions,
  normalizeSourceQueue,
  activeSourceUrl,
  isMovieChannel,
  isInternalChannel,
  sourceTitleFromUrl,
  channelSources,
  mpegtsMultiConflict,
  parseHeadersMaybe,
  normalizeHex32,
  createImportedChannelFactory,
} = require('./services/channelConfig');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
let MAX_FFMPEG_PROCESSES = parseInt(process.env.MAX_FFMPEG_PROCESSES, 10) || 0;
/** `node` (default): FFmpeg stdout pipe for MPEG-TS / local streams dir for HLS. `nginx`: HLS on disk under IPTV_DISK_ROOT; MPEG-TS via FFmpeg pipe + Node (no live/*.ts file). */
const STREAMING_MODE = (process.env.STREAMING_MODE || 'node').toLowerCase();
const IPTV_DISK_ROOT =
  process.env.IPTV_DISK_ROOT || path.join(__dirname, 'iptv-media');
const sessionStore = new RedisStore({ client: redis.getSessionStoreClient() });
const sessionMiddleware = session(
  buildSessionOptions({
    sessionSecret: SESSION_SECRET,
    isProduction: IS_PRODUCTION,
    store: sessionStore,
  })
);
app.set('trust proxy', 1);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .filter(Boolean);
const corsOptions = {
  credentials: true,
};
if (IS_PRODUCTION) {
  corsOptions.origin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : false;
} else {
  corsOptions.origin = ['http://localhost', 'http://127.0.0.1'];
}
app.use(cors(corsOptions));
securityHeaders(app);
app.use(sessionMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(AUTH_BRUTE_FORCE_PATHS, authLimiter);
app.use('/api', adminLimiter);

const WATERMARKS_DIR = path.join(__dirname, 'watermarks');

const hlsIdle = require('./lib/hlsIdle');

function ensureTsBroadcast(id) {
  let b = tsBroadcasts.get(id);
  if (!b) {
    b = { consumers: new Set(), sessionBytes: 0 };
    tsBroadcasts.set(id, b);
  }
  return b;
}

function broadcastTsData(id, chunk) {
  const b = tsBroadcasts.get(id);
  if (!b || !chunk || chunk.length === 0) return;
  const ch = channels.get(id);
  if (streamingSettings.isPrebufferEnabled()) {
    appendPrebufferChunk(
      b,
      chunk,
      streamingSettings.getEffectivePrebufferMaxBytes(ch)
    );
  }
  b.sessionBytes += chunk.length;
  for (const c of b.consumers) {
    if (!c.destroyed && c.writable) c.write(chunk);
  }
}

// In-memory channel store (loaded from SQLite; runtime status/hlsUrl live here)
const {
  channels,
  processes,
  runControllers,
  shadowProcesses,
  tsBroadcasts,
  userActivity,
  qoeRate,
} = require('./lib/state');

const streamingBoot = createStreamingBoot({
  path,
  fs,
  rootDir: __dirname,
  IPTV_DISK_ROOT,
  STREAMING_MODE,
  createStabilityMonitor,
  channels,
  tsBroadcasts,
  persistChannel,
  dbApi,
  applyStabilityFix,
  restartWithSeamlessIfPossible,
});
const {
  ensureDirs,
  isMpegtsPipeOutput,
  activeStreamSlot,
  streamDirFor,
  startStabilityService,
} = streamingBoot;
ensureDirs();

// FFmpeg lifecycle service - extracted to reduce god-file complexity
const createFfmpegLifecycle = require('./services/ffmpegLifecycleService');
const ffmpegLifecycle = createFfmpegLifecycle({
  dbApi,
  hlsIdle,
  onDemandLive,
  eventBus,
  WS_EVENTS,
  path,
  fs,
  treeKill,
  spawn,
  PassThrough,
  PORT,
  STREAMING_MODE,
  IPTV_DISK_ROOT,
  MAX_FFMPEG_PROCESSES,
  streamingSettings,
  buildFfmpegArgs,
  buildNginxDualCopyFfmpegArgs,
  needsTranscode,
  activeSourceUrl,
  isMovieChannel,
  isInternalChannel,
  resolveEffectiveInputType,
  channelSources,
  sourceTitleFromUrl,
  channelRuntimeInfo,
  fetchTextWithTimeout,
  parseMpdInfo,
  parseHlsInfo,
  preDetectSource,
  mergeChannelOptions,
  normalizeSourceQueue,
  normalizeHex32,
  mpegtsMultiConflict,
  appendPrebufferChunk,
  clearPrebuffer,
  waitForPrebuffer,
  snapshotPrebuffer,
  applyStabilityFix,
  rootDir: __dirname,
});

const { syncAccessCodeSession, requireAuth, requireAdminAuth, requireApiKey } =
  createPanelAccess({
    dbApi,
    userActivity,
    apiKeyLimiter,
  });

const ALLOW_ADMIN_PREVIEW_UNSIGNED_TS = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_ADMIN_PREVIEW_UNSIGNED_TS || '').toLowerCase()
);

/** Dev/local: allow MPEG-TS without token when the TCP peer is loopback (VLC on same machine). Use socket address only — not req.ip (avoids X-Forwarded-For spoofing). */
const ALLOW_LOCAL_UNSIGNED_TS = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_LOCAL_UNSIGNED_TS || '').toLowerCase()
);

async function restartWithSeamlessIfPossible(id, channel) {
  return ffmpegLifecycle.restartWithSeamlessIfPossible(id, channel);
}

async function persistChannel(id) {
  const ch = channels.get(id);
  if (!ch || !ch.userId) return;
  try {
    await dbApi.updateChannelRow(id, ch.userId, ch, ch.version);
  } catch (error) {
    if (error instanceof ConflictError) {
      if (Number.isFinite(Number(error.currentVersion))) {
        ch.version = Number(error.currentVersion);
      }
      serverLog('channel_persist_conflict', {
        id,
        currentVersion: error.currentVersion,
      });
      return;
    }
    throw error;
  }
}

const createImportedChannel = createImportedChannelFactory({
  channels,
  rootDir: __dirname,
  watermarksDir: WATERMARKS_DIR,
  uuidv4,
  fs,
});

importChannelBridge.setChannelImportHandler(createImportedChannel);

registerBootRoutes({
  app,
  express,
  rootDir: __dirname,
  mariadb,
  redis,
  streamLimiter,
  csrfProtection,
  dbApi,
  channels,
  qoeRate,
  processes,
  tsBroadcasts,
  userActivity,
  syncAccessCodeSession,
  requireAuth,
  requireAdminAuth,
  requireApiKey,
  serverService,
  securityService,
  lineService,
  bouquetService,
  hlsIdle,
  onDemandLive,
  streamingSettings,
  fetch,
  fetchTextWithTimeout,
  buildMergedHeaders,
  waitForPrebuffer,
  snapshotPrebuffer,
  buildFfprobeArgs,
  detectInputType,
  resolveEffectiveInputType,
  parseExtractionDump,
  createImportedChannel,
  applyStabilityFix,
  restartWithSeamlessIfPossible,
  persistChannel,
  collectSystemMetrics,
  channelRuntimeInfo,
  clamp,
  computeQoeScore,
  computeFinalScore,
  mergeChannelOptions,
  normalizeSourceQueue,
  normalizeHex32,
  parseHeadersMaybe,
  mpegtsMultiConflict,
  activeSourceUrl,
  activeStreamSlot,
  ensureTsBroadcast,
  stopChannel,
  startChannel: (id, ch) => ffmpegLifecycle.startChannel(id, ch),
  PassThrough,
  spawn,
  fs,
  uuidv4,
  WATERMARKS_DIR,
  STREAMING_MODE,
  ALLOW_ADMIN_PREVIEW_UNSIGNED_TS,
  ALLOW_LOCAL_UNSIGNED_TS,
  isMovieChannel,
  isInternalChannel,
  isMpegtsPipeOutput,
  getMaxFfmpegProcesses: () => MAX_FFMPEG_PROCESSES,
  setMaxFfmpegProcesses: (value) => {
    MAX_FFMPEG_PROCESSES = value;
  },
  formatDuration,
});

// ========================
// Restream Engine
// ========================

function stopChannel(id) {
  return ffmpegLifecycle.stopChannel(id);
}

// ========================
// Cleanup on exit
// ========================
const FORCE_KILL_TIMEOUT_MS = 5000;

async function gracefulShutdown(signal) {
  serverLog('shutdown_start', { signal });
  // First pass: SIGTERM to allow graceful cleanup
  const killPromise = new Promise((resolve) => {
    let killed = 0;
    const total = processes.size + shadowProcesses.size;
    if (total === 0) return resolve();

    const checkDone = () => {
      if (++killed >= total) resolve();
    };

    processes.forEach((proc) => {
      try {
        treeKill(proc.pid, 'SIGTERM', checkDone);
      } catch (e) {
        checkDone();
      }
    });
    shadowProcesses.forEach((proc) => {
      try {
        treeKill(proc.pid, 'SIGTERM', checkDone);
      } catch (e) {
        checkDone();
      }
    });
    // Safety fallback if processes don't exit
    setTimeout(() => {
      processes.forEach((proc) => {
        try {
          treeKill(proc.pid, 'SIGKILL');
        } catch (e) {}
      });
      shadowProcesses.forEach((proc) => {
        try {
          treeKill(proc.pid, 'SIGKILL');
        } catch (e) {}
      });
      resolve();
    }, FORCE_KILL_TIMEOUT_MS);
  });

  await killPromise;
  try {
    await redis.disconnect();
  } catch {}
  try {
    await mariadb.closePool();
  } catch {}
  serverLog('shutdown_complete', { signal });
  setTimeout(() => process.exit(0), 100);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Global exception handlers for uncaught errors
process.on('uncaughtException', (err) => {
  serverLog('uncaught_exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException').then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  serverLog('unhandled_rejection', {
    reason: String(reason),
    promise: promise ? String(promise) : undefined,
  });
  if (IS_PRODUCTION) {
    gracefulShutdown('unhandledRejection').then(() => process.exit(1));
  }
});

// ========================
// Start server
// ========================
async function boot() {
  await initializeDbBoot({
    mariadb,
    redis,
    seedDefaults,
    streamingSettings,
    dbApi,
    channels,
    ffmpegLifecycle,
    isMovieChannel,
    isInternalChannel,
    getMaxFfmpegProcesses: () => MAX_FFMPEG_PROCESSES,
    processes,
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ========================================
   IPTV Panel (MariaDB + Redis)
   Running on http://0.0.0.0:${PORT}
  ========================================
    `);
    startBootJobs({
      startCrons,
      createWsServer,
      sessionMiddleware,
      eventBus,
      createIdleKillService,
      server,
      wsDeps: {
        channels,
        processes,
        userActivity,
        collectSystemMetrics,
        dbApi,
        maxFFmpegProcesses: MAX_FFMPEG_PROCESSES,
        formatDuration,
        channelRuntimeInfo,
      },
      idleKillDeps: {
        channels,
        hlsIdle,
        stopChannel,
        streamingSettings,
        STREAMING_MODE,
      },
    });
  });
}

boot().catch((err) => {
  console.error('[BOOT] Fatal error:', err);
  process.exit(1);
});

startStabilityService();
