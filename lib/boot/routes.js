'use strict';

const path = require('path');
const registerPortalRoutes = require('../../routes/registerPortalRoutes');
const registerLocalStreamRoutes = require('../../routes/registerLocalStreamRoutes');
const internalApiRoutes = require('../../routes/internal-api');
const movieChannelRoutes = require('../../routes/movie-channels');

function registerHealthRoutes({ app, mariadb, redis }) {
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';
    try {
      await mariadb.queryOne('SELECT 1 AS ok');
    } catch (error) {
      dbStatus = 'unreachable';
      res.status(503).json({
        status: 'error',
        uptime: Math.floor(process.uptime()),
        db: dbStatus,
        redis: redisStatus,
        error: error.message,
      });
      return;
    }

    try {
      await redis.getClient().ping();
    } catch (error) {
      redisStatus = 'unreachable';
      res.status(503).json({
        status: 'error',
        uptime: Math.floor(process.uptime()),
        db: dbStatus,
        redis: redisStatus,
        error: error.message,
      });
      return;
    }

    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      db: dbStatus,
      redis: redisStatus,
    });
  });

  app.get('/readyz', async (_req, res) => {
    try {
      await mariadb.queryOne('SELECT 1 AS ok');
      try {
        await redis.getClient().ping();
      } catch (redisError) {
        return res.status(503).json({
          ok: false,
          db: true,
          redis: false,
          error: redisError.message,
        });
      }
      return res.json({ ok: true, db: true, redis: true });
    } catch (dbError) {
      return res.status(503).json({
        ok: false,
        db: false,
        redis: false,
        error: dbError.message,
      });
    }
  });
}

function registerBootRoutes({
  app,
  express,
  rootDir,
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
  startChannel,
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
  getMaxFfmpegProcesses,
  setMaxFfmpegProcesses,
  formatDuration,
}) {
  const playlistRoutes = require('../../routes/playlist');
  app.get('/get.php', playlistRoutes.handleGet);
  app.get('/', (req, res) => {
    if (req.query.username && req.query.password) {
      return playlistRoutes.handleGet(req, res);
    }
    return res
      .status(403)
      .type('text/plain')
      .send('Access denied. Use your access code URL.');
  });

  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      (req.path === '/index.html' ||
        req.path === '/reseller' ||
        req.path === '/reseller.html')
    ) {
      return res
        .status(403)
        .type('text/plain')
        .send('Access denied. Use your access code URL.');
    }
    return next();
  });

  registerHealthRoutes({ app, mariadb, redis });

  registerPortalRoutes({
    app,
    dbApi,
    publicDir: path.join(rootDir, 'public'),
    syncAccessCodeSession,
  });

  const staticCacheOptions = { maxAge: '7d', etag: true };
  app.use(
    '/js/dist',
    express.static(path.join(rootDir, 'public/js/dist'), staticCacheOptions)
  );
  app.use(
    '/css',
    express.static(path.join(rootDir, 'public/css'), staticCacheOptions)
  );
  app.use(
    '/img',
    express.static(path.join(rootDir, 'public/img'), staticCacheOptions)
  );
  app.use(express.static(path.join(rootDir, 'public')));

  registerLocalStreamRoutes({
    app,
    express,
    rootDir,
    channels,
    tsBroadcasts,
    hlsIdle,
    securityService,
    buildMergedHeaders,
    fetchTextWithTimeout,
    fetch,
    activeSourceUrl,
    activeStreamSlot,
    resolveEffectiveInputType,
    ensureTsBroadcast,
    lineService,
    onDemandLive,
    streamingSettings,
    waitForPrebuffer,
    snapshotPrebuffer,
    stopChannel,
    PassThrough,
    STREAMING_MODE,
    ALLOW_ADMIN_PREVIEW_UNSIGNED_TS,
    ALLOW_LOCAL_UNSIGNED_TS,
    isMpegtsPipeOutput,
    isInternalChannel,
  });

  const agentRoutes = require('../../routes/agent')({ dbApi, serverService });
  app.use('/api', agentRoutes);

  const authRoutes = require('../../routes/auth');
  const playbackRoutes = require('../../routes/playback');
  const xtreamRoutes = require('../../routes/xtream');
  const adminRoutes = require('../../routes/admin');
  const resellerRoutes = require('../../routes/reseller');
  const channelRoutes = require('../../routes/channels');
  const transcodeRoutes = require('../../routes/transcode');
  const drmRoutes = require('../../routes/drm');

  app.use('/api/auth', authRoutes(dbApi, requireAuth));
  app.use('/api/playback', playbackRoutes);
  app.use('/api/xtream', xtreamRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/reseller', resellerRoutes);
  app.use('/api/client', require('../../routes/client'));

  app.use(
    '/api',
    internalApiRoutes({
      requireAuth,
      requireAdminAuth,
      requireApiKey,
      csrfProtection,
      dbApi,
      channels,
      qoeRate,
      processes,
      createImportedChannel,
      parseExtractionDump,
      securityService,
      detectInputType,
      resolveEffectiveInputType,
      buildFfprobeArgs,
      spawn,
      watermarksDir: WATERMARKS_DIR,
      getMaxFfmpegProcesses,
      setMaxFfmpegProcesses,
      applyStabilityFix,
      restartWithSeamlessIfPossible,
      persistChannel,
    })
  );

  app.use(
    '/api',
    channelRoutes({
      requireAuth,
      createImportedChannel,
      parseExtractionDump,
      channels,
      processes,
      tsBroadcasts,
      bouquetService,
      dbApi,
      isMovieChannel,
      isInternalChannel,
      serverService,
      STREAMING_MODE,
      hlsIdle,
      securityService,
      ALLOW_ADMIN_PREVIEW_UNSIGNED_TS,
      ALLOW_LOCAL_UNSIGNED_TS,
      restartWithSeamlessIfPossible,
      applyStabilityFix,
      persistChannel,
      qoeRate,
      clamp,
      computeQoeScore,
      computeFinalScore,
      startChannel,
      stopChannel,
      mergeChannelOptions,
      normalizeSourceQueue,
      resolveEffectiveInputType,
      normalizeHex32,
      WATERMARKS_DIR,
      mpegtsMultiConflict,
      rootDir,
      path,
      fs,
      uuidv4,
    })
  );

  const dashboardRoutes = require('../../routes/dashboard')({
    channels,
    processes,
    userActivity,
    collectSystemMetrics,
    dbApi,
    maxFFmpegProcesses: getMaxFfmpegProcesses,
    formatDuration,
    channelRuntimeInfo,
  });
  app.use('/api/dashboard', requireAuth, dashboardRoutes);

  app.use('/api', transcodeRoutes({ requireAuth, dbApi, channels }));
  app.use(
    '/api',
    drmRoutes({
      requireAuth,
      channels,
      tsBroadcasts,
      isInternalChannel,
      parseExtractionDump,
      normalizeHex32,
      parseHeadersMaybe,
      mergeChannelOptions,
      dbApi,
      uuidv4,
      startChannel,
      stopChannel,
      rootDir,
      path,
      fs,
    })
  );
  app.use(
    '/api',
    movieChannelRoutes({
      requireAuth,
      requireAdminAuth,
      csrfProtection,
      channels,
      processes,
      dbApi,
      startChannel,
      stopChannel,
      uuidv4,
      watermarksDir: WATERMARKS_DIR,
      rootDir,
    })
  );

  const streamRoutes = require('../../routes/stream');
  app.use(streamLimiter, streamRoutes);

  const systemRoutes = require('../../routes/system');
  app.use('/api', systemRoutes);

  const {
    errorHandler,
    notFoundHandler,
  } = require('../../middleware/errorHandler');
  app.use(notFoundHandler);
  app.use(errorHandler);
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

module.exports = {
  registerBootRoutes,
  registerHealthRoutes,
  formatDuration,
};
