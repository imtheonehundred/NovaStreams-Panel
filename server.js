require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieSession = require('cookie-session');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs');
const { PassThrough } = require('stream');
const multer = require('multer');
const treeKill = require('tree-kill');
const { csrfProtection } = require('./middleware/csrf');
const { securityHeaders } = require('./middleware/securityHeaders');
const { streamLimiter, authLimiter, adminLimiter } = require('./middleware/rateLimiter');

const {
  buildFfmpegArgs,
  buildFfprobeArgs,
  needsTranscode,
  buildMergedHeaders,
  buildNginxDualCopyFfmpegArgs,
} = require('./lib/ffmpeg-args');
const dbApi = require('./lib/db');
const mariadb = require('./lib/mariadb');
const redis = require('./lib/redis');
const { startCrons } = require('./lib/crons');
const { parseExtractionDump } = require('./lib/parse-extraction');
const importChannelBridge = require('./lib/importChannelBridge');
const { detectInputType, resolveEffectiveInputType } = require('./lib/input-detect');
const { collectSystemMetrics } = require('./lib/system-metrics');
const { rewriteMediaPlaylistDelayed } = require('./lib/hls-delay-playlist');
const { createStabilityMonitor } = require('./lib/stability-monitor');
const streamingSettings = require('./lib/streaming-settings');
const {
  appendPrebufferChunk,
  clearPrebuffer,
  snapshotPrebuffer,
  waitForPrebuffer,
} = require('./lib/ts-prebuffer');
const onDemandLive = require('./lib/on-demand-live');
const { AUTH_BRUTE_FORCE_PATHS, buildSessionCookieOptions } = require('./lib/panel-session');
const fetch = require('node-fetch');
const dbService = require('./services/dbService');
const bouquetService = require('./services/bouquetService');
const serverService = require('./services/serverService');
const { info: serverLog } = require('./services/logger');
const { eventBus, WS_EVENTS } = require('./services/eventBus');
const { createWsServer } = require('./services/wsServer');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
let MAX_FFMPEG_PROCESSES = parseInt(process.env.MAX_FFMPEG_PROCESSES, 10) || 0;
/** `node` (default): FFmpeg stdout pipe for MPEG-TS / local streams dir for HLS. `nginx`: HLS on disk under IPTV_DISK_ROOT; MPEG-TS via FFmpeg pipe + Node (no live/*.ts file). */
const STREAMING_MODE = (process.env.STREAMING_MODE || 'node').toLowerCase();
const IPTV_DISK_ROOT = process.env.IPTV_DISK_ROOT || path.join(__dirname, 'iptv-media');
app.set('trust proxy', 1);
if (!SESSION_SECRET) {
  if (IS_PRODUCTION) {
    throw new Error('SESSION_SECRET is required in production');
  }
  console.warn('[Security] SESSION_SECRET missing; using development fallback secret');
}
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
securityHeaders(app);
app.use(cookieSession(buildSessionCookieOptions({ sessionSecret: SESSION_SECRET, isProduction: IS_PRODUCTION })));
app.use(express.json({ limit: '10mb' }));
app.use(AUTH_BRUTE_FORCE_PATHS, authLimiter);
app.use('/api', adminLimiter);

const playlistRoutes = require('./routes/playlist');
app.get('/get.php', playlistRoutes.handleGet);
app.get('/', (req, res, next) => {
  if (req.query.username && req.query.password) {
    return playlistRoutes.handleGet(req, res);
  }
  return res.status(403).type('text/plain').send('Access denied. Use your access code URL.');
});

app.use((req, res, next) => {
  if (req.method === 'GET' && (req.path === '/index.html' || req.path === '/reseller' || req.path === '/reseller.html')) {
    return res.status(403).type('text/plain').send('Access denied. Use your access code URL.');
  }
  return next();
});

const RESERVED_GATEWAY_SEGMENTS = new Set([
  'api', 'streams', 'live', 'drm', 'get.php', 'css', 'js', 'assets', 'watermarks', 'logs', 'favicon.ico',
]);

const ADMIN_PORTAL_PAGE_SEGMENTS = new Set([
  'dashboard',
  'lines',
  'manage-users',
  'add-user',
  'line-form',
  'line-stats',
  'movies',
  'movie-import',
  'series',
  'series-form',
  'series-import',
  'episodes',
  'streams',
  'stream-import',
  'drm-streams',
  'add-channels',
  'manage-channels',
  'monitor-top-channels',
  'stream-import-tools',
  'providers',
  'import-users',
  'import-content',
  'categories',
  'categories-channels',
  'categories-movies',
  'categories-series',
  'bouquets',
  'packages',
  'transcode-profiles',
  'resellers',
  'registered-users',
  'add-registered-user',
  'registered-user-form',
  'member-groups',
  'member-group-form',
  'expiry-media',
  'expiry-media-edit',
  'users',
  'epg',
  'servers',
  'server-edit',
  'install-lb',
  'install-proxy',
  'manage-proxy',
  'server-order',
  'server-monitor',
  'bandwidth-monitor',
  'live-connections',
  'live-connections-map',
  'settings',
  'security',
  'monitor',
  'sharing',
  'backups',
  'plex',
  'logs',
  'access-codes',
  'db-manager',
]);

const RESELLER_PORTAL_PAGE_SEGMENTS = new Set([
  'dashboard',
  'lines',
  'profile',
  'line-form',
]);

function sendPortalShell(res, role) {
  if (role === 'reseller') {
    return res.sendFile(path.join(__dirname, 'public', 'reseller.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
}

function syncAccessCodeSession(req, row) {
  if (req.session && ((req.session.accessCodeId && req.session.accessCodeId !== row.id) || (req.session.portalRole && req.session.portalRole !== row.role))) {
    req.session.userId = null;
  }
  req.session.portalRole = row.role;
  req.session.accessCode = row.code;
  req.session.accessCodeId = row.id;
}

function clearPanelUserSession(req, { preserveGateway = true } = {}) {
  if (!req.session) return;
  req.session.userId = null;
  if (!preserveGateway) {
    req.session.portalRole = null;
    req.session.accessCode = null;
    req.session.accessCodeId = null;
  }
}

async function validatePanelAccessCodeSession(req, expectedRole = null) {
  const session = req.session || null;
  if (!session || !session.accessCodeId || !session.portalRole) {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  const row = await dbApi.getAccessCodeById(session.accessCodeId);
  const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
  if (!row || !enabled || row.role !== session.portalRole || (expectedRole && row.role !== expectedRole)) {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  if (session.accessCode !== row.code) session.accessCode = row.code;
  return row;
}

async function resolveAccessCodeGatewayRow(req, res, next) {
  const raw = String((req.params && req.params.accessCode) || '').replace(/\/+$/, '').trim();
  const code = raw;
  if (!code || RESERVED_GATEWAY_SEGMENTS.has(code)) {
    if (typeof next === 'function') next();
    return null;
  }
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(code)) {
    res.status(404).end();
    return null;
  }
  try {
    const row = await dbApi.getAccessCodeByCode(code);
    const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
    if (!row || !enabled) {
      res.status(403).type('text/plain').send('Invalid access code.');
      return null;
    }
    syncAccessCodeSession(req, row);
    return row;
  } catch (e) {
    res.status(500).type('text/plain').send(e.message || 'gateway error');
    return null;
  }
}

async function serveAccessCodeGateway(req, res, next) {
  const row = await resolveAccessCodeGatewayRow(req, res, next);
  if (!row) return;
  return sendPortalShell(res, row.role);
}

async function serveAccessCodePortalSubpage(req, res, next) {
  const page = String((req.params && req.params.page) || '').replace(/\/+$/, '').trim();
  const mayBePortalPage = ADMIN_PORTAL_PAGE_SEGMENTS.has(page) || RESELLER_PORTAL_PAGE_SEGMENTS.has(page);
  if (!mayBePortalPage) return next();

  const row = await resolveAccessCodeGatewayRow(req, res, next);
  if (!row) return;

  if (row.role === 'reseller') {
    if (!RESELLER_PORTAL_PAGE_SEGMENTS.has(page)) return next();
    return sendPortalShell(res, row.role);
  }

  if (!ADMIN_PORTAL_PAGE_SEGMENTS.has(page)) return next();
  return sendPortalShell(res, row.role);
}

async function resolveAdminAlias(req, res) {
  const row = await dbApi.getAccessCodeByCode('admin');
  const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
  if (row && enabled && row.role === 'admin') {
    syncAccessCodeSession(req, row);
    return row;
  }
  const allCodes = await dbApi.listAccessCodes();
  const fallback = allCodes.find((c) => {
    const ok = c && (c.enabled === true || c.enabled === 1 || Number(c.enabled) === 1);
    return ok && c.role === 'admin';
  });
  if (fallback) {
    syncAccessCodeSession(req, fallback);
    return fallback;
  }
  res.status(403).type('text/plain').send('Admin access code required. Create one in Access Codes settings.');
  return null;
}

async function serveAdminAliasGateway(req, res, next) {
  const row = await resolveAdminAlias(req, res);
  if (!row) return;
  return sendPortalShell(res, row.role);
}

async function serveAdminAliasSubpage(req, res, next) {
  const page = String((req.params && req.params.page) || '').replace(/\/+$/, '').trim();
  if (!ADMIN_PORTAL_PAGE_SEGMENTS.has(page)) return next();
  const row = await resolveAdminAlias(req, res);
  if (!row) return;
  return sendPortalShell(res, row.role);
}

// Must run before express.static so paths like /admin are never treated as static files
app.get('/admin/:page', serveAdminAliasSubpage);
app.get('/admin', serveAdminAliasGateway);
app.get('/:accessCode/:page', serveAccessCodePortalSubpage);
app.get('/:accessCode', serveAccessCodeGateway);

app.use(express.static(path.join(__dirname, 'public')));

const WATERMARKS_DIR = path.join(__dirname, 'watermarks');
const LOGS_DIR = path.join(__dirname, 'logs');

function ensureDirs() {
  [WATERMARKS_DIR, LOGS_DIR, path.join(__dirname, 'streams')].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (STREAMING_MODE === 'nginx') {
    const hlsRoot = path.join(IPTV_DISK_ROOT, 'hls');
    if (!fs.existsSync(hlsRoot)) fs.mkdirSync(hlsRoot, { recursive: true });
  }
}
ensureDirs();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, WATERMARKS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? ext : '.png'}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpeg|jpg)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only PNG or JPEG images'), ok);
  },
});

/** True when channel uses FFmpeg MPEG-TS to stdout (Node fan-out), including nginx copy mode with pipe:1. */
function isMpegtsPipeOutput(ch) {
  return !!(ch && ch.outputFormat === 'mpegts');
}

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
    appendPrebufferChunk(b, chunk, streamingSettings.getEffectivePrebufferMaxBytes(ch));
  }
  b.sessionBytes += chunk.length;
  for (const c of b.consumers) {
    if (!c.destroyed && c.writable) c.write(chunk);
  }
}

// MPEG-TS: ffmpeg writes to stdout; bytes are fanned out to HTTP clients (no stream.ts on disk).
const securityService = require('./services/securityService');

async function validateStreamRequest(req, res, channelId) {
  const token = req.query.token;
  const expires = req.query.expires;
  const sig = req.query.sig;
  const verdict = await securityService.validateStreamAccess({
    token: token && String(token),
    expires: expires && String(expires),
    sig: sig && String(sig),
    ip: req.ip,
    channelId,
  });
  if (!verdict.ok) {
    res.status(401).setHeader('Content-Type', 'text/plain').send('Unauthorized');
    return null;
  }
  return verdict;
}

function channelIdParamOk(id) {
  return /^[a-f0-9]{8}$/i.test(id);
}

/** Delayed HLS: rewrite media playlists (not master) so clients trail the ingest by N seconds. */
app.get('/streams/:channelId/:playlistFile', async (req, res, next) => {
  const id = req.params.channelId;
  const playlistFile = req.params.playlistFile;
  if (!channelIdParamOk(id)) return next();
  if (!playlistFile.endsWith('.m3u8')) return next();
  if (playlistFile === 'master.m3u8') return next();

  hlsIdle.touch(id);

  const ch = channels.get(id);
  if (!ch || ch.outputFormat !== 'hls' || ch.hlsIngestMode !== 'buffered') return next();

  const delay = parseInt(ch.hlsBufferDelaySec, 10) || 0;
  if (delay <= 0) return next();

  const srcUrl = activeSourceUrl(ch) || String(ch.mpdUrl || '').trim();
  if (resolveEffectiveInputType(srcUrl, ch.inputType || 'auto') !== 'hls') return next();

  const verdict = await validateStreamRequest(req, res, id);
  if (!verdict) return;

  const filePath = path.join(__dirname, 'streams', id, activeStreamSlot(ch), playlistFile);
  fs.readFile(filePath, 'utf8', (err, text) => {
    if (err || !text || !text.includes('#EXTINF:')) return next();
    const seg = Math.max(2, Math.min(12, parseInt(ch.hlsSegmentSeconds, 10) || 4));
    const out = rewriteMediaPlaylistDelayed(text, delay, seg);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(out);
  });
});

// Serve HLS streams
app.get('/streams/:channelId/:file', (req, res, next) => {
  const id = req.params.channelId;
  const file = req.params.file;
  if (!channelIdParamOk(id)) return next();
  if (!file || file.includes('..')) return next();
  const ch = channels.get(id);
  if (!ch || ch.outputFormat !== 'hls') return next();

  hlsIdle.touch(id);

  const slot = activeStreamSlot(ch);
  const filePath = path.join(__dirname, 'streams', id, slot, file);
  if (!fs.existsSync(filePath)) return next();

  if (filePath.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
  } else if (filePath.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(filePath);
});

function resolveProxyHeaders(channel) {
  return buildMergedHeaders(channel || {});
}

function rewritePlaylist(text, baseUrl, id) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    if (ln === '#EXT-X-ENDLIST') {
      continue;
    }
    if (/^#EXT-X-PLAYLIST-TYPE:VOD/i.test(ln)) {
      continue;
    }
    if (!ln || ln.startsWith('#')) {
      out.push(ln);
      continue;
    }
    let abs = '';
    try {
      abs = new URL(ln, baseUrl).toString();
    } catch {
      abs = ln;
    }
    if (/\.m3u8(\?|$)/i.test(abs)) {
      out.push(`/proxy/hls/${id}?u=${encodeURIComponent(abs)}`);
    } else {
      out.push(`/proxy/seg/${id}?u=${encodeURIComponent(abs)}`);
    }
  }
  return out.join('\n');
}

app.get('/proxy/hls/:id', async (req, res) => {
  const id = req.params.id;
  if (!channelIdParamOk(id)) return res.status(400).end();
  const ch = channels.get(id);
  const target = String(req.query.u || (ch && ch.mpdUrl) || '').trim();
  if (!target) return res.status(400).end();

  const headers = resolveProxyHeaders(ch || {});
  const text = await fetchTextWithTimeout(target, headers, 5000);
  if (!text || !text.includes('#EXTM3U')) {
    return res.status(502).send('Invalid playlist');
  }

  const body = rewritePlaylist(text, target, id);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(body);
});

app.get('/proxy/seg/:id', async (req, res) => {
  const id = req.params.id;
  if (!channelIdParamOk(id)) return res.status(400).end();
  const ch = channels.get(id);
  const target = String(req.query.u || '').trim();
  if (!target) return res.status(400).end();

  const headers = resolveProxyHeaders(ch || {});
  try {
    const r = await fetch(target, { headers });
    if (!r.ok || !r.body) {
      return res.status(502).end();
    }
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    r.body.pipe(res);
  } catch {
    res.status(502).end();
  }
});

// In-memory channel store (loaded from SQLite; runtime status/hlsUrl live here)
const { channels, processes, runControllers, shadowProcesses, tsBroadcasts, userActivity, qoeRate } = require('./lib/state');
let stabilityMonitor = null;

const ALLOW_ADMIN_PREVIEW_UNSIGNED_TS = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_ADMIN_PREVIEW_UNSIGNED_TS || '').toLowerCase()
);

/** Dev/local: allow MPEG-TS without token when the TCP peer is loopback (VLC on same machine). Use socket address only — not req.ip (avoids X-Forwarded-For spoofing). */
const ALLOW_LOCAL_UNSIGNED_TS = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_LOCAL_UNSIGNED_TS || '').toLowerCase()
);

function isDirectLoopbackClient(req) {
  const raw =
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    '';
  const s = String(raw).replace(/^::ffff:/i, '');
  return s === '127.0.0.1' || s === '::1';
}

function canLocalUnsignedTs(req) {
  return ALLOW_LOCAL_UNSIGNED_TS && isDirectLoopbackClient(req);
}

/** Same-origin panel preview only: no token if env set and session owns the channel (VLC will not send cookies). */
function canAdminPreviewUnsignedTs(req, channelId) {
  if (!ALLOW_ADMIN_PREVIEW_UNSIGNED_TS) return false;
  const uid = req.session && req.session.userId;
  if (!uid) return false;
  const ch = channels.get(channelId);
  return !!(ch && ch.userId === uid);
}

function canUnsignedTsPlayback(req, channelId) {
  if (canAdminPreviewUnsignedTs(req, channelId)) return true;
  if (canLocalUnsignedTs(req)) return true;
  return false;
}

/** FFmpeg stdout → broadcastTsData → HTTP (chunked). Used for node mode and nginx mode (no TS on disk). */
async function attachMpegTsClient(req, res, id) {
  if (!/^[a-f0-9]{8}$/i.test(id)) {
    return res.status(400).end();
  }
  let verdict;
  if (canUnsignedTsPlayback(req, id)) {
    verdict = { ok: true };
  } else {
    verdict = await validateStreamRequest(req, res, id);
    if (!verdict) return;
  }
  let ch = channels.get(id);
  if (!isMpegtsPipeOutput(ch)) {
    return res.status(404).setHeader('Content-Type', 'text/plain').send('Not an MPEG-TS channel');
  }
  if (ch && ch.on_demand) {
    try {
      await onDemandLive.ensureOnDemandStreamIfNeeded(id);
    } catch (e) {
      return res.status(503).setHeader('Content-Type', 'text/plain').send(e.message || 'Stream start failed');
    }
    ch = channels.get(id);
  }
  if (!ch || (ch.status !== 'running' && ch.status !== 'starting')) {
    return res.status(503).setHeader('Content-Type', 'text/plain').send('Stream not available');
  }
  if (STREAMING_MODE === 'nginx' && ch.nginxStreaming && ch.on_demand) {
    hlsIdle.touch(id);
  }
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Connection', 'keep-alive');
  try {
    req.socket.setNoDelay(true);
  } catch (e) {}
  const b = ensureTsBroadcast(id);
  if (b.idleTimer) {
    clearTimeout(b.idleTimer);
    b.idleTimer = null;
  }
  const odMin = streamingSettings.getEffectiveOnDemandMinBytes(ch);
  const odWait = streamingSettings.getOnDemandMaxWaitMs();
  if (streamingSettings.isPrebufferEnabled() && ch.on_demand && odMin > 0) {
    await waitForPrebuffer(b, odMin, odWait);
  }
  // 64KB highWaterMark: limit in-node buffering; TS bytes are copied straight from FFmpeg stdout to TCP.
  const consumer = new PassThrough({ highWaterMark: 64 * 1024 });
  if (streamingSettings.isPrebufferEnabled()) {
    const snap = snapshotPrebuffer(b);
    if (snap.length > 0) {
      consumer.write(snap);
    }
  }
  b.consumers.add(consumer);
  consumer.pipe(res);
  req.on('close', () => {
    b.consumers.delete(consumer);
    try {
      consumer.unpipe(res);
    } catch (e) {}
    consumer.destroy();
    const chNow = channels.get(id);
    if (b.consumers.size === 0 && chNow && chNow.on_demand && !streamingSettings.channelPreWarmEffective(chNow)) {
      b.idleTimer = setTimeout(() => {
        const bNow = tsBroadcasts.get(id);
        const chIdle = channels.get(id);
        if (bNow && bNow.consumers.size === 0 && chIdle && !streamingSettings.channelPreWarmEffective(chIdle)) {
          console.log(`[IDLE-KILL] On-demand TS channel ${id} idle for 30s, stopping.`);
          stopChannel(id);
        }
      }, 30000);
    }
  });
}

app.get('/streams/:channelId/stream.ts', async (req, res) => {
  return attachMpegTsClient(req, res, req.params.channelId);
});

app.get('/live/:streamId', async (req, res, next) => {
  const raw = String(req.params.streamId || '');
  const m = /^([a-f0-9]{8})\.ts$/i.exec(raw);
  if (!m) return next();
  return attachMpegTsClient(req, res, m[1]);
});

app.use('/streams', express.static(path.join(__dirname, 'streams'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

function activeStreamSlot(channel) {
  return channel && channel.streamSlot === 'b' ? 'b' : 'a';
}

function streamDirFor(id, slot) {
  return path.join(__dirname, 'streams', id, slot);
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function computeQoeScore(input) {
  let score = 100;
  const startup = Number(input.startup_ms) || 0;
  const bufferEvents = Number(input.buffer_events) || 0;
  const bufferMs = Number(input.buffer_duration_ms) || 0;
  const errors = Number(input.errors) || 0;
  const latency = Number(input.latency_ms) || 0;
  const playbackMs = Math.max(1, Number(input.playback_ms) || 1);
  const bufferRatio = clamp(bufferMs / playbackMs, 0, 1);

  if (startup > 8000) score -= 50;
  else if (startup > 4000) score -= 35;
  else if (startup > 2000) score -= 20;
  else if (startup > 1200) score -= 10;

  score -= Math.min(35, Math.round(bufferRatio * 100));
  score -= Math.min(25, bufferEvents * 8);
  score -= Math.min(30, errors * 20);

  if (latency > 8000) score -= 35;
  else if (latency > 4000) score -= 20;
  else if (latency > 2000) score -= 10;

  return { score: clamp(score, 0, 100), bufferRatio };
}

function computeFinalScore(serverScore, qoeScore) {
  const s = Number.isFinite(Number(serverScore)) ? Number(serverScore) : 100;
  const q = Number.isFinite(Number(qoeScore)) ? Number(qoeScore) : null;
  if (q == null) return Math.round(s);
  return Math.round(0.7 * q + 0.3 * s);
}

async function fetchTextWithTimeout(url, headers, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function parseMpdInfo(xml) {
  const out = { segmentSec: null, liveDelaySec: null, codecs: [] };
  const segTpl = xml.match(/SegmentTemplate[^>]*duration="(\d+)"[^>]*timescale="(\d+)"/i);
  if (segTpl) {
    const dur = parseInt(segTpl[1], 10);
    const ts = parseInt(segTpl[2], 10) || 1;
    if (dur && ts) out.segmentSec = dur / ts;
  }
  const delay = xml.match(/suggestedPresentationDelay="PT(\d+(?:\.\d+)?)S"/i);
  if (delay) out.liveDelaySec = parseFloat(delay[1]);
  const codecMatches = xml.match(/codecs="([^"]+)"/gi) || [];
  out.codecs = codecMatches.map((m) => m.replace(/codecs="/i, '').replace(/"/g, '')).slice(0, 6);
  return out;
}

function parseHlsInfo(text) {
  const out = { targetDuration: null, isVod: false };
  const m = text.match(/#EXT-X-TARGETDURATION:(\d+)/i);
  if (m) out.targetDuration = parseInt(m[1], 10);
  if (/^#EXT-X-PLAYLIST-TYPE:VOD/im.test(text) || /#EXT-X-ENDLIST/im.test(text)) {
    out.isVod = true;
  }
  return out;
}

async function preDetectSource(channel) {
  if (!channel || (channel.streamMode === 'vod' || isMovieChannel(channel))) return;
  if (channel.outputMode !== 'copy') return;
  const url = String(channel.mpdUrl || '').trim();
  if (!url) return;
  const inputType = resolveEffectiveInputType(url, channel.inputType);
  const headers = channel.headers || {};
  if (inputType === 'dash') {
    const xml = await fetchTextWithTimeout(url, headers, 3500);
    if (!xml) return;
    const info = parseMpdInfo(xml);
    const codecs = info.codecs.join(',');
    const isAvc = /avc1|h264/i.test(codecs);
    const isAac = /mp4a|aac/i.test(codecs);
    const longSeg = info.segmentSec && info.segmentSec > 4;
    if (!isAvc || !isAac || longSeg) {
      channel.outputMode = 'transcode';
      channel.x264Preset = 'ultrafast';
      channel.stabilityProfile = 'lag_fix';
    }
    channel.preDetect = { inputType, ...info };
  } else if (inputType === 'hls') {
    const text = await fetchTextWithTimeout(url, headers, 2500);
    if (!text) return;
    const info = parseHlsInfo(text);
    if (info.targetDuration && info.targetDuration > 6) {
      channel.outputMode = 'transcode';
      channel.x264Preset = 'ultrafast';
      channel.stabilityProfile = 'lag_fix';
    }
    channel.preDetect = { inputType, ...info };
  }
}

function applyStabilityFix(id, action, meta) {
  const channel = channels.get(id);
  if (!channel) return { ok: false, error: 'Channel not found' };

  const reason = meta && meta.reason ? meta.reason : action;
  const isRecover = action === 'recover';

  if (!channel.stabilityPrev) {
    channel.stabilityPrev = {
      outputMode: channel.outputMode,
      x264Preset: channel.x264Preset,
      stabilityProfile: channel.stabilityProfile || 'off',
    };
  }

  if (isRecover) {
    const prev = channel.stabilityPrev || {};
    channel.outputMode = prev.outputMode || channel.outputMode || 'copy';
    channel.x264Preset = prev.x264Preset || channel.x264Preset || 'veryfast';
    channel.stabilityProfile = prev.stabilityProfile || 'off';
    channel.stabilityPrev = null;
  } else {
    channel.outputMode = 'transcode';
    channel.x264Preset = 'ultrafast';
    channel.stabilityProfile = 'lag_fix';
  }

  channel.stabilityAction = reason;
  persistChannel(id);

  return { ok: true, channel };
}

async function restartWithSeamlessIfPossible(id, channel) {
  if (channel.outputFormat === 'hls' && channel.status === 'running') {
    const nextSlot = activeStreamSlot(channel) === 'a' ? 'b' : 'a';
    const ok = await seamlessSwitchChannel(id, channel, nextSlot);
    if (ok) return true;
  }
  await safeRestartChannel(id, channel);
  return false;
}

async function safeRestartChannel(id, channel) {
  stopChannel(id);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await startChannel(id, channel);
}

function requireAuth(req, res, next) {
  const uid = req.session && req.session.userId;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  validatePanelAccessCodeSession(req)
    .then((accessCode) => {
      if (!accessCode) {
        return res.status(403).json({ error: 'Access code invalid' });
      }
      req.userId = uid;
      userActivity.set(uid, Date.now());
      next();
    })
    .catch((e) => res.status(500).json({ error: e.message || 'auth failed' }));
}

async function requireAdminAuth(req, res, next) {
  const uid = req.session && req.session.userId;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const accessCode = await validatePanelAccessCodeSession(req, 'admin');
  if (!accessCode) return res.status(403).json({ error: 'Access code invalid' });
  const isAdmin = await dbApi.isAdmin(uid);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  req.userId = uid;
  next();
}

async function requireApiKey(req, res, next) {
  const h = req.headers.authorization || '';
  const k =
    req.headers['x-api-key'] ||
    (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : null);
  if (!k) {
    return res.status(401).json({ error: 'API key required (X-API-Key or Authorization: Bearer)' });
  }
  const row = await dbApi.resolveApiKey(k);
  if (!row) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.userId = row.user_id;
  next();
}

async function persistChannel(id) {
  const ch = channels.get(id);
  if (!ch || !ch.userId) return;
  await dbApi.updateChannelRow(id, ch.userId, ch);
}

async function loadChannelsFromDb() {
  const rows = await dbApi.listAllChannelRows();
  for (const row of rows) {
    const ch = JSON.parse(row.json_data);
    delete ch.tsDelivery;
    ch.userId = row.user_id;
    ch.id = row.id;
    ch.status = 'stopped';
    ch.hlsUrl = null;
    ch.error = null;
    ch.startedAt = null;
    ch.stabilityScore = Number.isFinite(Number(ch.stabilityScore)) ? Number(ch.stabilityScore) : 100;
    ch.stabilityStatus = ch.stabilityStatus || 'Stable';
    ch.stabilityLastChecked = ch.stabilityLastChecked || null;
    ch.stabilityMeta = ch.stabilityMeta || {};
    ch.autoFixEnabled = !!ch.autoFixEnabled;
    ch.stabilityProfile = ch.stabilityProfile === 'lag_fix' ? 'lag_fix' : 'off';
    ch.streamSlot = ch.streamSlot === 'b' ? 'b' : 'a';
    ch.qoeScore = Number.isFinite(Number(ch.qoeScore)) ? Number(ch.qoeScore) : 100;
    ch.qoeLastChecked = ch.qoeLastChecked || null;
    ch.qoeAvgStartupMs = Number.isFinite(Number(ch.qoeAvgStartupMs)) ? Number(ch.qoeAvgStartupMs) : 0;
    ch.qoeAvgBufferRatio = Number.isFinite(Number(ch.qoeAvgBufferRatio)) ? Number(ch.qoeAvgBufferRatio) : 0;
    ch.qoeAvgLatencyMs = Number.isFinite(Number(ch.qoeAvgLatencyMs)) ? Number(ch.qoeAvgLatencyMs) : 0;
    ch.finalStabilityScore = Number.isFinite(Number(ch.finalStabilityScore)) ? Number(ch.finalStabilityScore) : ch.stabilityScore;
    channels.set(row.id, ch);
  }
}

function formatDuration(s) {
  const sec = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function channelRuntimeInfo(ch) {
  if (!ch) return '';
  const parts = [];
  const mode = ch.outputMode === 'transcode' ? 'transcode' : 'copy';
  parts.push(mode);
  if (ch.outputFormat) parts.push(ch.outputFormat);
  if (Array.isArray(ch.renditions) && ch.renditions.length) parts.push(ch.renditions.join(','));
  return parts.join(' / ');
}

function defaultWatermark() {
  return { enabled: false, file: null, position: 'br', scale: 0.12, opacity: 1 };
}

/** Merge encoding options from request body with existing channel (PUT) or defaults (POST). */
async function mergeChannelOptions(existing, body) {
  const wm = {
    ...defaultWatermark(),
    ...(existing && existing.watermark ? existing.watermark : {}),
    ...(body.watermark && typeof body.watermark === 'object' ? body.watermark : {}),
  };
  if (wm.file) wm.file = path.basename(String(wm.file));

  let renditions = body.renditions !== undefined ? body.renditions : existing && existing.renditions;
  if (!Array.isArray(renditions) || renditions.length === 0) {
    renditions = ['1080p'];
  }

  const outputMode =
    body.outputMode !== undefined
      ? body.outputMode === 'transcode'
        ? 'transcode'
        : 'copy'
      : existing && existing.outputMode
        ? existing.outputMode
        : 'copy';

  const inputType =
    body.inputType !== undefined
      ? String(body.inputType || '').toLowerCase()
      : existing && existing.inputType
        ? String(existing.inputType || '').toLowerCase()
        : detectInputType(body.mpdUrl || (existing && existing.mpdUrl));
  const inputTypeSafe = ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(inputType)
    ? inputType
    : 'auto';

  const renditionMode =
    body.renditionMode !== undefined
      ? body.renditionMode === 'multi'
        ? 'multi'
        : 'single'
      : existing && existing.renditionMode
        ? existing.renditionMode
        : 'single';

  const presetIn =
    body.x264Preset !== undefined ? body.x264Preset : existing && existing.x264Preset;
  const x264Preset = ['ultrafast', 'veryfast', 'fast', 'medium'].includes(presetIn)
    ? presetIn
    : 'veryfast';

  const ab =
    body.audioBitrateK !== undefined ? body.audioBitrateK : existing && existing.audioBitrateK;
  const audioBitrateK = Math.min(320, Math.max(64, parseInt(ab, 10) || 128));

  const seg =
    body.hlsSegmentSeconds !== undefined
      ? body.hlsSegmentSeconds
      : existing && existing.hlsSegmentSeconds;
  const hlsSegmentSeconds = Math.min(12, Math.max(2, parseInt(seg, 10) || 4));

  const pls =
    body.hlsPlaylistSize !== undefined ? body.hlsPlaylistSize : existing && existing.hlsPlaylistSize;
  const plsN = parseInt(pls, 10);
  const hlsPlaylistSize =
    Number.isFinite(plsN) ? Math.min(1000, Math.max(0, plsN)) : 10;

  const streamMode =
    body.streamMode !== undefined
      ? body.streamMode === 'vod'
        ? 'vod'
        : 'live'
      : existing && existing.streamMode
        ? existing.streamMode
        : 'live';

  const vt = body.videoTrack !== undefined ? body.videoTrack : existing && existing.videoTrack;
  const videoTrack = parseInt(vt, 10);
  const at = body.audioTrack !== undefined ? body.audioTrack : existing && existing.audioTrack;
  const audioTrack = parseInt(at, 10);
  const st = body.subtitleTrack !== undefined ? body.subtitleTrack : existing && existing.subtitleTrack;
  const subtitleTrack = parseInt(st, 10);

  const httpProxy =
    body.httpProxy !== undefined
      ? String(body.httpProxy || '').trim() || null
      : existing && existing.httpProxy
        ? existing.httpProxy
        : null;

  const userAgent =
    body.userAgent !== undefined ? String(body.userAgent || '') : existing && existing.userAgent
      ? existing.userAgent
      : '';

  const referer =
    body.referer !== undefined ? String(body.referer || '') : existing && existing.referer
      ? existing.referer
      : '';

  const customFfmpegArgs =
    body.customFfmpegArgs !== undefined
      ? String(body.customFfmpegArgs || '')
      : existing && existing.customFfmpegArgs
        ? existing.customFfmpegArgs
        : '';

  const mr = body.maxRetries !== undefined ? body.maxRetries : existing && existing.maxRetries;
  const maxRetries = Math.min(100, Math.max(0, parseInt(mr, 10) || 0));

  const rd = body.retryDelaySec !== undefined ? body.retryDelaySec : existing && existing.retryDelaySec;
  const retryDelaySec = Math.min(300, Math.max(1, parseInt(rd, 10) || 5));

  const so = body.sortOrder !== undefined ? body.sortOrder : existing && existing.sortOrder;
  const sortOrder = parseInt(so, 10);
  const sortOrderN = Number.isFinite(sortOrder) ? sortOrder : 0;

  const logoUrl =
    body.logoUrl !== undefined ? String(body.logoUrl || '').trim() : existing && existing.logoUrl
      ? existing.logoUrl
      : '';

  const epgChannelId =
    body.epgChannelId !== undefined
      ? String(body.epgChannelId || '').trim()
      : existing && existing.epgChannelId
        ? existing.epgChannelId
        : '';

  const outputFormat =
    body.outputFormat !== undefined
      ? body.outputFormat === 'mpegts'
        ? 'mpegts'
        : 'hls'
      : existing && existing.outputFormat
        ? existing.outputFormat
        : 'hls';

  const rawQueue =
    body.sourceQueue !== undefined
      ? body.sourceQueue
      : existing && existing.sourceQueue
        ? existing.sourceQueue
        : [];
  const sourceQueue = normalizeSourceQueue(rawQueue);

  const sampleUrl =
    String(body.mpdUrl || (existing && existing.mpdUrl) || '').trim() || (sourceQueue[0] || '');

  const hlsInRaw =
    body.hlsIngestMode !== undefined ? body.hlsIngestMode : existing && existing.hlsIngestMode;
  let hlsIngestMode = String(hlsInRaw || 'direct').toLowerCase() === 'buffered' ? 'buffered' : 'direct';

  const delayRaw =
    body.hlsBufferDelaySec !== undefined
      ? body.hlsBufferDelaySec
      : existing && existing.hlsBufferDelaySec;
  let hlsBufferDelaySec = parseInt(delayRaw, 10);
  if (!Number.isFinite(hlsBufferDelaySec)) hlsBufferDelaySec = 30;
  hlsBufferDelaySec = Math.min(600, Math.max(5, hlsBufferDelaySec));

  const effInputForHls = resolveEffectiveInputType(sampleUrl, inputTypeSafe);
  if (outputFormat !== 'hls' || effInputForHls !== 'hls') {
    hlsIngestMode = 'direct';
  }


  const hlsProxyRaw =
    body.hlsProxyMode !== undefined
      ? !!body.hlsProxyMode
      : existing && existing.hlsProxyMode !== undefined
        ? !!existing.hlsProxyMode
        : true;
  const hlsProxyMode = effInputForHls === 'hls' ? hlsProxyRaw : false;

  const gen_timestamps = body.gen_timestamps !== undefined ? !!body.gen_timestamps
    : existing && existing.gen_timestamps !== undefined ? !!existing.gen_timestamps : true;

  const read_native = body.read_native !== undefined ? !!body.read_native
    : existing && existing.read_native !== undefined ? !!existing.read_native : false;

  const minimalIngest =
    body.minimalIngest !== undefined
      ? !!body.minimalIngest
      : existing && existing.minimalIngest !== undefined
        ? !!existing.minimalIngest
        : existing == null
          ? true
          : false;

  const stream_all = body.stream_all !== undefined ? !!body.stream_all
    : existing && existing.stream_all !== undefined ? !!existing.stream_all : false;

  const allow_record = body.allow_record !== undefined ? !!body.allow_record
    : existing && existing.allow_record !== undefined ? !!existing.allow_record : true;

  const fps_restart = body.fps_restart !== undefined ? !!body.fps_restart
    : existing && existing.fps_restart !== undefined ? !!existing.fps_restart : false;

  const fpsThRaw = body.fps_threshold !== undefined ? body.fps_threshold
    : existing && existing.fps_threshold;
  const fps_threshold = Math.min(100, Math.max(1, parseInt(fpsThRaw, 10) || 90));

  const custom_sid = body.custom_sid !== undefined ? String(body.custom_sid || '').trim()
    : existing && existing.custom_sid ? existing.custom_sid : '';

  const probRaw = body.probesize_ondemand !== undefined ? body.probesize_ondemand
    : existing && existing.probesize_ondemand;
  const probesize_ondemand = Math.max(0, parseInt(probRaw, 10) || 1500000);

  const delayRawMin = body.delay_minutes !== undefined ? body.delay_minutes
    : existing && existing.delay_minutes;
  const delay_minutes = Math.max(0, parseInt(delayRawMin, 10) || 0);

  const notes = body.notes !== undefined ? String(body.notes || '')
    : existing && existing.notes ? existing.notes : '';

  const join_sub_category_ids = (() => {
    const raw = body.join_sub_category_ids !== undefined
      ? body.join_sub_category_ids
      : existing && existing.join_sub_category_ids !== undefined
        ? existing.join_sub_category_ids
        : existing && existing.joinSubCategoryIds !== undefined
          ? existing.joinSubCategoryIds
          : [];
    return Array.isArray(raw)
      ? raw.map((value) => parseInt(value, 10)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
  })();

  const on_demand = body.on_demand !== undefined ? !!body.on_demand
    : existing && existing.on_demand !== undefined ? !!existing.on_demand : false;

  const preWarm =
    body.preWarm !== undefined
      ? !!body.preWarm
      : existing && existing.preWarm !== undefined
        ? !!existing.preWarm
        : false;

  let prebuffer_size_mb =
    body.prebuffer_size_mb !== undefined && body.prebuffer_size_mb !== null && body.prebuffer_size_mb !== ''
      ? parseFloat(body.prebuffer_size_mb, 10)
      : existing && existing.prebuffer_size_mb !== undefined && existing.prebuffer_size_mb !== null
        ? parseFloat(existing.prebuffer_size_mb, 10)
        : null;
  if (prebuffer_size_mb !== null && (!Number.isFinite(prebuffer_size_mb) || prebuffer_size_mb <= 0)) {
    prebuffer_size_mb = null;
  }

  let ingest_style_override = '';
  if (body.ingest_style_override !== undefined) {
    ingest_style_override = String(body.ingest_style_override || '').trim().toLowerCase();
  } else if (existing && existing.ingest_style_override !== undefined) {
    ingest_style_override = String(existing.ingest_style_override || '').trim().toLowerCase();
  }
  if (ingest_style_override && !['webapp', 'xc', 'safe'].includes(ingest_style_override)) {
    ingest_style_override = '';
  }

  const restart_on_edit = body.restart_on_edit !== undefined ? !!body.restart_on_edit
    : existing && existing.restart_on_edit !== undefined ? !!existing.restart_on_edit : false;

  const epg_offset = body.epg_offset !== undefined ? parseInt(body.epg_offset, 10) || 0
    : existing && existing.epg_offset !== undefined ? existing.epg_offset : 0;

  const epg_source_id = body.epg_source_id !== undefined
    ? Math.max(0, parseInt(body.epg_source_id, 10) || 0)
    : existing && existing.epg_source_id !== undefined
      ? Math.max(0, parseInt(existing.epg_source_id, 10) || 0)
      : 0;

  const epg_language = body.epg_language !== undefined
    ? String(body.epg_language || '').trim().toLowerCase()
    : existing && existing.epg_language
      ? String(existing.epg_language || '').trim().toLowerCase()
      : '';

  const category_id = body.category_id !== undefined ? (body.category_id || null)
    : existing && existing.category_id !== undefined ? existing.category_id : null;

  const direct_source = body.direct_source !== undefined
    ? !!body.direct_source
    : existing && existing.direct_source !== undefined
      ? !!existing.direct_source
      : false;

  const protect_stream = body.protect_stream !== undefined
    ? !!body.protect_stream
    : existing && existing.protect_stream !== undefined
      ? !!existing.protect_stream
      : false;

  const custom_map_query = body.custom_map_query !== undefined
    ? String(body.custom_map_query || '').trim()
    : existing && existing.custom_map_query
      ? String(existing.custom_map_query || '').trim()
      : '';

  const custom_map_entries = (() => {
    const raw = body.custom_map_entries !== undefined
      ? body.custom_map_entries
      : existing && existing.custom_map_entries !== undefined
        ? existing.custom_map_entries
        : [];
    return Array.isArray(raw)
      ? raw
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            return {
              type: String(entry.type || 'Manual').trim() || 'Manual',
              info: String(entry.info || '').trim(),
            };
          }
          const info = String(entry || '').trim();
          return info ? { type: 'Manual', info } : null;
        })
        .filter((entry) => entry && entry.info)
      : [];
  })();

  const restart_days = body.restart_days !== undefined
    ? String(body.restart_days || '').trim()
    : existing && existing.restart_days
      ? String(existing.restart_days || '').trim()
      : '';

  const restart_time = body.restart_time !== undefined
    ? String(body.restart_time || '').trim()
    : existing && existing.restart_time
      ? String(existing.restart_time || '').trim()
      : '';

  const timeshift_server_id = body.timeshift_server_id !== undefined
    ? Math.max(0, parseInt(body.timeshift_server_id, 10) || 0)
    : existing && existing.timeshift_server_id !== undefined
      ? Math.max(0, parseInt(existing.timeshift_server_id, 10) || 0)
      : 0;

  const timeshift_days = body.timeshift_days !== undefined
    ? Math.max(0, parseInt(body.timeshift_days, 10) || 0)
    : existing && existing.timeshift_days !== undefined
      ? Math.max(0, parseInt(existing.timeshift_days, 10) || 0)
      : 0;

  const veIn =
    body.videoEncoder !== undefined ? String(body.videoEncoder || '').toLowerCase() : existing && existing.videoEncoder;
  const videoEncoder = ['cpu_x264', 'apple', 'nvidia', 'intel', 'amd'].includes(veIn) ? veIn : 'cpu_x264';

  const perfIn =
    body.performanceProfile !== undefined
      ? String(body.performanceProfile || '').toLowerCase()
      : existing && existing.performanceProfile;
  const performanceProfile = ['balanced', 'low_cpu_stable', 'low_low_low'].includes(perfIn)
    ? perfIn
    : 'balanced';

  const stabilityIn =
    body.stabilityProfile !== undefined
      ? String(body.stabilityProfile || '').toLowerCase()
      : existing && existing.stabilityProfile;
  const stabilityProfile = stabilityIn === 'lag_fix' ? 'lag_fix' : 'off';

  const autoFixEnabled =
    body.autoFixEnabled !== undefined
      ? !!body.autoFixEnabled
      : existing && existing.autoFixEnabled
        ? true
        : false;

  const hlsSegDefault =
    performanceProfile === 'low_low_low' ? 8 : performanceProfile === 'low_cpu_stable' ? 6 : hlsSegmentSeconds;
  const hlsSegmentSecondsEff = Math.min(12, Math.max(2, parseInt(hlsSegDefault, 10) || 4));

  if (wm.opacity !== undefined && wm.opacity !== null && wm.opacity !== '') {
    const op = parseFloat(wm.opacity);
    wm.opacity = Number.isFinite(op) ? Math.min(1, Math.max(0.05, op)) : 1;
  } else if (existing && existing.watermark && existing.watermark.opacity !== undefined) {
    wm.opacity = existing.watermark.opacity;
  } else {
    wm.opacity = 1;
  }

  const tpIdRaw = body.transcode_profile_id !== undefined ? body.transcode_profile_id
    : existing && existing.transcode_profile_id;
  const transcode_profile_id = tpIdRaw ? parseInt(tpIdRaw, 10) || null : null;

  const stream_server_id = body.stream_server_id !== undefined
    ? (() => {
        const n = parseInt(body.stream_server_id, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })()
    : existing && existing.stream_server_id != null
      ? (() => {
          const n = parseInt(existing.stream_server_id, 10);
          return Number.isFinite(n) && n > 0 ? n : 0;
        })()
      : 0;

  let effOutputMode = outputMode;
  let effVideoEncoder = videoEncoder;
  let effX264Preset = x264Preset;
  let effRenditionMode = renditionMode;
  let effRenditions = renditions;
  let effAudioBitrateK = audioBitrateK;
  let effHlsSegmentSeconds = hlsSegmentSecondsEff;
  let effHlsPlaylistSize = hlsPlaylistSize;

  if (transcode_profile_id) {
    try {
      const tp = await dbApi.getTranscodeProfile(transcode_profile_id);
      if (tp) {
        effOutputMode = tp.output_mode || 'copy';
        effVideoEncoder = tp.video_encoder || 'cpu_x264';
        effX264Preset = tp.x264_preset || 'veryfast';
        effRenditionMode = tp.rendition_mode || 'single';
        try { effRenditions = JSON.parse(tp.renditions || '["1080p"]'); } catch { effRenditions = ['1080p']; }
        effAudioBitrateK = tp.audio_bitrate_k || 128;
        effHlsSegmentSeconds = tp.hls_segment_seconds || 4;
        effHlsPlaylistSize = tp.hls_playlist_size || 10;
      }
    } catch (e) { console.error('[mergeChannelOptions] Failed to load transcode profile:', e.message); }
  }

  return {
    inputType: inputTypeSafe,
    outputMode: effOutputMode,
    renditionMode: effRenditionMode,
    renditions: effRenditions,
    watermark: wm,
    x264Preset: effX264Preset,
    videoEncoder: effVideoEncoder,
    performanceProfile,
    stabilityProfile,
    autoFixEnabled,
    audioBitrateK: effAudioBitrateK,
    hlsSegmentSeconds: effHlsSegmentSeconds,
    hlsPlaylistSize: effHlsPlaylistSize,
    streamMode,
    videoTrack: Number.isFinite(videoTrack) && videoTrack >= 0 ? videoTrack : -1,
    audioTrack: Number.isFinite(audioTrack) && audioTrack >= 0 ? audioTrack : -1,
    subtitleTrack: Number.isFinite(subtitleTrack) && subtitleTrack >= 0 ? subtitleTrack : -1,
    httpProxy,
    userAgent,
    referer,
    customFfmpegArgs,
    maxRetries,
    retryDelaySec,
    sortOrder: sortOrderN,
    logoUrl,
    epgChannelId,
    outputFormat,
    sourceQueue,
    hlsIngestMode,
    hlsBufferDelaySec,
    hlsProxyMode,
    gen_timestamps,
    read_native,
    minimalIngest,
    stream_all,
    allow_record,
    fps_restart,
    fps_threshold,
    custom_sid,
    probesize_ondemand,
    delay_minutes,
    notes,
    join_sub_category_ids,
    on_demand,
    preWarm,
    prebuffer_size_mb,
    ingest_style_override: ingest_style_override || null,
    restart_on_edit,
    epg_offset,
    epg_source_id,
    epg_language,
    category_id,
    direct_source,
    protect_stream,
    custom_map_query,
    custom_map_entries,
    restart_days,
    restart_time,
    timeshift_server_id,
    timeshift_days,
    transcode_profile_id,
    stream_server_id,
  };
}

function normalizeSourceQueue(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  const s = String(input || '').trim();
  if (!s) return [];
  return [...new Set(s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean))];
}

function channelSources(channel) {
  const q = normalizeSourceQueue(channel && channel.sourceQueue);
  if (q.length > 0) return q;
  const single = String((channel && channel.mpdUrl) || '').trim();
  return single ? [single] : [];
}

function activeSourceUrl(channel) {
  const list = channelSources(channel);
  if (list.length === 0) return '';
    const idx = Number.isFinite(channel && channel.sourceIndex) ? parseInt(channel.sourceIndex, 10) : 0;
  const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.min(list.length - 1, idx)) : 0;
  return list[safeIdx];
}

function isMovieChannel(ch) {
  return String(ch && ch.channelClass || 'normal') === 'movie';
}

function isInternalChannel(ch) {
  return !!(ch && ch.is_internal);
}

function normalizeMovieUrls(input) {
  const list = normalizeSourceQueue(input);
  return list.filter((u) => /\.(mp4|mkv|m3u8|ts)(\?|$)/i.test(u) || /^(udp|srt):\/\//i.test(u));
}

function parseM3uMovieImport(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const urls = [];
  let firstName = '';
  let firstLogo = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      if (!firstName) {
        const m1 = line.match(/tvg-name="([^"]+)"/i);
        const m2 = line.match(/,(.+)$/);
        firstName = (m1 && m1[1]) || (m2 && m2[1] ? m2[1].trim() : '') || '';
      }
      if (!firstLogo) {
        const l = line.match(/tvg-logo="([^"]+)"/i);
        firstLogo = (l && l[1]) || '';
      }
      continue;
    }
    if (/^https?:\/\//i.test(line) && /\.(mp4|mkv|m3u8|ts)(\?|$)/i.test(line)) {
      urls.push(line);
    }
  }
  return {
    urls: [...new Set(urls)],
    firstName: firstName || 'Imported Movies',
    firstLogo: firstLogo || '',
  };
}

function sourceTitleFromUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const raw = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
    const clean = raw
      .replace(/\.(mpd|m3u8|mp4|mkv|ts)$/i, '')
      .replace(/[-_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || u.hostname || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function mpegtsMultiConflict(extra) {
  const rends = Array.isArray(extra.renditions) ? extra.renditions : ['1080p'];
  return extra.outputFormat === 'mpegts' && extra.renditionMode === 'multi' && rends.length > 1;
}

function parseHeadersMaybe(headersIn) {
  let headers = headersIn || {};
  if (typeof headers === 'string') {
    try {
      headers = JSON.parse(headers);
    } catch {
      headers = {};
    }
  }
  if (!headers || typeof headers !== 'object') headers = {};
  return headers;
}

function normalizeHex32(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim().toLowerCase().replace(/^0x/, '').replace(/-/g, '');
  return /^[a-f0-9]{32}$/.test(s) ? s : '';
}

async function createImportedChannel(bodyIn, userId) {
  const body = { ...(bodyIn || {}) };
  body.headers = parseHeadersMaybe(body.headers);
  if (body.userAgent) body.headers['User-Agent'] = body.userAgent;
  if (body.referer) body.headers['Referer'] = body.referer;

  const name =
    body.name ||
    body.nameHint ||
    (body.pageUrl ? String(body.pageUrl).split('/').filter(Boolean).pop() : null) ||
    'Imported channel';

  const mpdUrl = body.mpdUrl;
  const inputType = ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(body.inputType)
    ? body.inputType
    : detectInputType(mpdUrl);
  const kid = normalizeHex32(body.kid);
  const key = normalizeHex32(body.key);
  if (!mpdUrl) {
    const err = new Error('mpdUrl is required');
    err.statusCode = 400;
    throw err;
  }
  const effectiveIn = resolveEffectiveInputType(mpdUrl, inputType);
  if (effectiveIn === 'dash' && (!kid || !key)) {
    const err = new Error('For DASH input, kid and key are required (32-hex expected)');
    err.statusCode = 400;
    throw err;
  }

  const id = uuidv4().substring(0, 8);
  const extra = await mergeChannelOptions(null, body);

  // Guard against conflicting keys for same source/KID.
  // If we already have a channel with same MPD+KID but different key,
  // reject auto-import to avoid corrupted output.
  for (const [, ch] of channels.entries()) {
    if (ch.userId !== userId) continue;
    if (String(ch.mpdUrl || '') !== String(mpdUrl)) continue;
    if (normalizeHex32(ch.kid) !== kid) continue;
    if (normalizeHex32(ch.key) && normalizeHex32(ch.key) !== key) {
      const err = new Error(
        'Conflicting key detected for same MPD/KID. Existing channel uses a different key; import blocked to avoid corrupted stream.'
      );
      err.statusCode = 409;
      throw err;
    }
  }

  if (extra.watermark.enabled && extra.watermark.file) {
    const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
    if (!fs.existsSync(wmPath)) {
      const err = new Error('Watermark file not found; disable watermark or upload it first.');
      err.statusCode = 400;
      throw err;
    }
  }
  if (extra.outputMode === 'copy' && extra.watermark.enabled) {
    const err = new Error('Watermark requires transcode.');
    err.statusCode = 400;
    throw err;
  }
  if (mpegtsMultiConflict(extra)) {
    const err = new Error('MPEG-TS supports one program stream only. Use HLS for multi-bitrate.');
    err.statusCode = 400;
    throw err;
  }

  const channel = {
    name,
    mpdUrl,
    inputType,
    headers: body.headers || {},
    kid,
    key,
    pssh: body.pssh || '',
    type: body.type || 'WIDEVINE',
    ...extra,
    channelClass: 'normal',
    is_internal: false,
    status: 'stopped',
    createdAt: new Date().toISOString(),
    hlsUrl: null,
    error: null,
    viewers: 0,
    startedAt: null,
    stabilityScore: 100,
    stabilityStatus: 'Stable',
    stabilityLastChecked: null,
    stabilityMeta: {},
    autoFixEnabled: extra.autoFixEnabled || false,
    stabilityProfile: extra.stabilityProfile || 'off',
    streamSlot: 'a',
    qoeScore: 100,
    qoeLastChecked: null,
    qoeAvgStartupMs: 0,
    qoeAvgBufferRatio: 0,
    qoeAvgLatencyMs: 0,
    finalStabilityScore: 100,
    userId,
  };
  channel.id = id;
  channels.set(id, channel);
  await dbApi.insertChannel(id, userId, channel);

  const streamDir = path.join(__dirname, 'streams', id);
  if (!fs.existsSync(streamDir)) {
    fs.mkdirSync(streamDir, { recursive: true });
  }

  const { userId: _uid, ...pub } = channel;
  return { id, channel: pub };
}

importChannelBridge.setChannelImportHandler(createImportedChannel);

// ========================
// API Routes
// ========================

const agentRoutes = require('./routes/agent')({ dbApi, serverService });
app.use('/api', agentRoutes);

/**
 * Extract the best stream URL from a movie row.
 * Mirrors the logic in routes/stream.js:getSourceUrls().
 */
function getSourceUrlFromRow(row) {
  if (row.stream_source) {
    try {
      const parsed = JSON.parse(row.stream_source);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = String(parsed[0] || '').trim();
        if (first) return first;
      }
    } catch {}
  }
  return String(row.stream_url || '').trim();
}

/**
 * Extract the best stream URL from an episode row.
 */
function getSourceUrlFromEpisodeRow(ep) {
  if (ep.stream_source) {
    try {
      const parsed = JSON.parse(ep.stream_source);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = String(parsed[0] || '').trim();
        if (first) return first;
      }
    } catch {}
  }
  return String(ep.stream_url || '').trim();
}

/**
 * Phase 5 — Node streaming validation endpoint.
 *
 * The node's agent calls this when it receives a movie/episode streaming request
 * from a redirected client. It validates the HMAC signature and the embedded token,
 * then returns the source URL and container type so the agent can stream the content.
 *
 * This keeps all auth logic on the panel while allowing the node to act as
 * the byte-serving origin for movies and episodes.
 *
 * Query params:
 *   token  — AES-encoded stream token from buildNodeStreamRedirectUrl
 *   expires — token expiry timestamp (ms)
 *   sig    — HMAC signature of token+expires
 *   asset  — 'movie' or 'episode'
 *   id     — movie id or episode id
 *
 * Response:
 *   { ok: true, streamId, container, sourceUrl, lineId }
 *   { ok: false, error: string }
 */
app.get('/api/stream/node-validate', async (req, res) => {
  const { token, expires, sig, asset, id } = req.query;
  if (!token || !expires || !sig || !asset || !id) {
    return res.status(400).json({ ok: false, error: 'missing parameters' });
  }
  if (asset === 'live') {
    return res.status(410).json({ ok: false, error: 'live node validation is de-scoped in TARGET' });
  }
  const channelId = `${asset}:${id}`;
  const verdict = await securityService.validateStreamAccess({
    token: String(token),
    expires: String(expires),
    sig: String(sig),
    ip: req.ip,
    channelId,
  });
  if (!verdict.ok) {
    return res.status(401).json({ ok: false, error: verdict.error || 'unauthorized' });
  }
  // Get source URL for the asset
  let sourceUrl = '';
  let container = 'mp4';
  let lineId = verdict.session ? verdict.session.user.id : (verdict.lineUserId || null);
  if (asset === 'movie') {
    const movieId = parseInt(id, 10);
    const row = await dbApi.getMovieById(movieId);
    if (row) {
      sourceUrl = getSourceUrlFromRow(row);
      container = row.container_extension || 'mp4';
    }
  } else if (asset === 'episode') {
    const episodeId = parseInt(id, 10);
    const ep = await dbApi.getEpisodeById(episodeId);
    if (ep) {
      sourceUrl = getSourceUrlFromEpisodeRow(ep);
      container = ep.container_extension || 'mp4';
    }
  }
  if (!sourceUrl) {
    return res.status(404).json({ ok: false, error: 'source not found' });
  }
  res.json({ ok: true, streamId: String(id), container, sourceUrl, lineId });
});

// API-key validation endpoint for browser extensions
app.get('/api/extension/ping', requireApiKey, async (req, res) => {
  const u = await dbApi.findUserById(req.userId);
  res.json({
    ok: true,
    user: u ? { id: u.id, username: u.username } : null,
    ts: Date.now(),
  });
});


const authRoutes = require("./routes/auth");
const playbackRoutes = require("./routes/playback");
const xtreamRoutes = require("./routes/xtream");
const adminRoutes = require("./routes/admin");
const resellerRoutes = require("./routes/reseller");
const channelRoutes = require('./routes/channels');
const transcodeRoutes = require('./routes/transcode');
const drmRoutes = require('./routes/drm');

app.use("/api/auth", authRoutes(dbApi, requireAuth));
app.use("/api/playback", playbackRoutes);
app.use("/api/xtream", xtreamRoutes);
app.use(xtreamRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reseller", resellerRoutes);
app.use("/api/client", require('./routes/client'));

app.get('/api/system/db-status', requireAdminAuth, async (_req, res) => {
  try { res.json(await dbService.getDatabaseStatus()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

app.get('/api/system/db-performance', requireAdminAuth, async (_req, res) => {
  try { res.json(await dbService.getDatabasePerformance()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

app.get('/api/system/db-live', requireAdminAuth, async (_req, res) => {
  try { res.json(await dbService.getDatabaseLive()); }
  catch (e) { res.status(500).json({ error: e.message || 'failed' }); }
});

app.post('/api/system/db-optimize', requireAdminAuth, csrfProtection, async (_req, res) => {
  try { res.json(await dbService.optimizeDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'optimize failed' }); }
});

app.post('/api/system/db-repair', requireAdminAuth, csrfProtection, async (_req, res) => {
  try { res.json(await dbService.repairDatabase({ source: 'api' })); }
  catch (e) { res.status(400).json({ error: e.message || 'repair failed' }); }
});


/** Import channel via API key (browser extension). */
app.post('/api/extension/import', requireApiKey, async (req, res) => {
  let body = { ...(req.body || {}) };
  if (body.rawText) {
    const parsed = parseExtractionDump(body.rawText);
    delete body.rawText;
    body = { ...parsed, ...body };
  }
  try {
    const created = await createImportedChannel(body, req.userId);
    res.json({ id: created.id, ...created.channel });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Import failed' });
  }
});

/** Import channel from raw extraction text directly in panel (session auth). */
app.use('/api', channelRoutes({
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
  rootDir: __dirname,
  path,
  fs,
  uuidv4,
}));

app.get('/api/watermarks', requireAuth, (req, res) => {
  try {
    const files = fs.existsSync(WATERMARKS_DIR)
      ? fs.readdirSync(WATERMARKS_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f))
      : [];
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/watermarks', requireAuth, csrfProtection, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ filename: req.file.filename });
  });
});


app.post('/api/qoe/report', async (req, res) => {
  const body = req.body || {};
  const channelId = String(body.channel_id || '').trim();
  if (!channelId || !channels.has(channelId)) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const ch = channels.get(channelId);

  const key = `${req.ip || 'ip'}:${channelId}`;
  const now = Date.now();
  const last = qoeRate.get(key) || 0;
  if (now - last < 4000) {
    return res.status(429).json({ error: 'Too many reports' });
  }
  qoeRate.set(key, now);

  const startup_ms = clamp(parseInt(body.startup_ms, 10) || 0, 0, 60000);
  const buffer_events = clamp(parseInt(body.buffer_events, 10) || 0, 0, 1000);
  const buffer_duration_ms = clamp(parseInt(body.buffer_duration_ms, 10) || 0, 0, 600000);
  const errors = clamp(parseInt(body.errors, 10) || 0, 0, 100);
  const latency_ms = clamp(parseInt(body.latency_ms, 10) || 0, 0, 60000);
  const bitrate_switches = clamp(parseInt(body.bitrate_switches, 10) || 0, 0, 1000);
  const dropped_frames = clamp(parseInt(body.dropped_frames, 10) || 0, 0, 100000);
  const playback_ms = clamp(parseInt(body.playback_ms, 10) || 0, 1, 600000);

  const qoe = computeQoeScore({
    startup_ms,
    buffer_events,
    buffer_duration_ms,
    errors,
    latency_ms,
    playback_ms,
  });

  await dbApi.insertQoeMetric({
    channel_id: channelId,
    user_id: ch.userId,
    startup_ms,
    buffer_events,
    buffer_duration_ms,
    errors,
    latency_ms,
    bitrate_switches,
    dropped_frames,
    playback_ms,
    qoe_score: qoe.score,
  });

  const prev = await dbApi.getQoeAgg(channelId, ch.userId);
  const alpha = 0.2;
  const avgStartup = prev ? prev.avg_startup_ms * (1 - alpha) + startup_ms * alpha : startup_ms;
  const avgBufRatio = prev ? prev.avg_buffer_ratio * (1 - alpha) + qoe.bufferRatio * alpha : qoe.bufferRatio;
  const avgLatency = prev ? prev.avg_latency_ms * (1 - alpha) + latency_ms * alpha : latency_ms;
  const finalScore = computeFinalScore(ch.stabilityScore, qoe.score);
  const agg = {
    last_qoe_at: new Date().toISOString(),
    qoe_score: qoe.score,
    final_score: finalScore,
    avg_startup_ms: avgStartup,
    avg_buffer_ratio: avgBufRatio,
    avg_latency_ms: avgLatency,
  };
  await dbApi.upsertQoeAgg(channelId, ch.userId, agg);

  ch.qoeScore = qoe.score;
  ch.qoeLastChecked = agg.last_qoe_at;
  ch.qoeAvgStartupMs = avgStartup;
  ch.qoeAvgBufferRatio = avgBufRatio;
  ch.qoeAvgLatencyMs = avgLatency;
  ch.finalStabilityScore = finalScore;
  persistChannel(channelId);

  if (ch.autoFixEnabled && ch.stabilityScore >= 85 && qoe.score < 60) {
    applyStabilityFix(channelId, 'degrade', { reason: 'client_qoe' });
    if (ch.status === 'running') {
      setTimeout(() => {
        restartWithSeamlessIfPossible(channelId, ch).catch(() => {});
      }, 200);
    }
  }

  res.json({ ok: true, qoe_score: qoe.score, final_score: finalScore });
});

app.get('/api/movie-channels', requireAuth, (req, res) => {
  const list = [];
  channels.forEach((ch, id) => {
    if (ch.userId !== req.userId) return;
    if (!isMovieChannel(ch)) return;
    const { userId, ...rest } = ch;
    list.push({ id, ...rest, pid: processes.has(id) ? processes.get(id).pid : null });
  });
  list.sort((a, b) => {
    const d = (a.sortOrder || 0) - (b.sortOrder || 0);
    return d !== 0 ? d : String(a.name || '').localeCompare(String(b.name || ''));
  });
  res.json(list);
});

// Dashboard metrics (live)
// Mount dashboard routes (replaces inline /api/dashboard/metrics handler)
const dashboardRoutes = require('./routes/dashboard')({
  channels, processes, userActivity, collectSystemMetrics,
  dbApi, maxFFmpegProcesses: MAX_FFMPEG_PROCESSES, formatDuration,
  channelRuntimeInfo,
});
app.use('/api/dashboard', requireAuth, dashboardRoutes);

// Auto-detect input type from URL (explicit "auto" resolves from URL)
app.get('/api/input/detect', requireAuth, (req, res) => {
  const url = String(req.query.url || '');
  const selected = String(req.query.selected || 'auto').toLowerCase();
  const detected = detectInputType(url);
  const effective = resolveEffectiveInputType(url, selected);
  res.json({
    detected,
    effective,
    selected: ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(selected) ? selected : 'auto',
  });
});

// Probe source (ffprobe) — same headers / DRM as playback
app.post('/api/probe', requireAuth, csrfProtection, (req, res) => {
  const body = req.body || {};
  if (!body.mpdUrl) {
    return res.status(400).json({ error: 'mpdUrl is required' });
  }
  const ch = {
    mpdUrl: body.mpdUrl,
    inputType: body.inputType
      ? String(body.inputType).toLowerCase()
      : detectInputType(body.mpdUrl),
    headers: body.headers || {},
    kid: body.kid,
    key: body.key,
    userAgent: body.userAgent,
    referer: body.referer,
    httpProxy: body.httpProxy,
    streamMode: body.streamMode === 'vod' ? 'vod' : 'live',
  };
  const args = buildFfprobeArgs(ch);
  const pr = spawn('ffprobe', args);
  let stdout = '';
  let stderr = '';
  pr.stdout.on('data', (d) => {
    stdout += d;
  });
  pr.stderr.on('data', (d) => {
    stderr += d;
  });
  pr.on('error', (e) => {
    res.status(500).json({ error: e.message });
  });
  pr.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: stderr || 'ffprobe failed', code, stderr });
    }
    try {
      const json = JSON.parse(stdout);
      res.json(json);
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse ffprobe JSON', stderr, stdout });
    }
  });
});

// FFmpeg process limits
app.get('/api/settings/ffmpeg-limits', requireAuth, (_req, res) => {
  res.json({
    max_processes: MAX_FFMPEG_PROCESSES || 0,
    current_processes: processes.size,
    unlimited: MAX_FFMPEG_PROCESSES === 0,
  });
});

app.put('/api/settings/ffmpeg-limits', requireAuth, csrfProtection, (req, res) => {
  const { max_processes } = req.body;
  const val = parseInt(max_processes, 10);
  if (!Number.isFinite(val) || val < 0) {
    return res.status(400).json({ error: 'max_processes must be a non-negative integer (0 = unlimited)' });
  }
  MAX_FFMPEG_PROCESSES = val;
  console.log(`[CONFIG] MAX_FFMPEG_PROCESSES set to ${val || 'unlimited'}`);
  res.json({
    max_processes: MAX_FFMPEG_PROCESSES,
    current_processes: processes.size,
    unlimited: MAX_FFMPEG_PROCESSES === 0,
  });
});

// ─── Transcode Profiles API ──────────────────────────────────────────

app.use('/api', transcodeRoutes({ requireAuth, dbApi, channels }));
app.use('/api', drmRoutes({
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
  rootDir: __dirname,
  path,
  fs,
}));

app.get('/drm/:id/stream.ts', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{8}$/i.test(id)) return res.status(400).end();
  const ch = channels.get(id);
  if (!ch || !isInternalChannel(ch)) return res.status(404).send('Not found');
  if (ch.status !== 'running' && ch.status !== 'starting') {
    return res.status(503).send('Stream not available');
  }
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Connection', 'keep-alive');
  try { req.socket.setNoDelay(true); } catch {}
  const b = ensureTsBroadcast(id);
  if (b.idleTimer) { clearTimeout(b.idleTimer); b.idleTimer = null; }
  const consumer = new PassThrough({ highWaterMark: 64 * 1024 });
  b.consumers.add(consumer);
  consumer.pipe(res);
  req.on('close', () => {
    b.consumers.delete(consumer);
    try { consumer.unpipe(res); } catch {}
    consumer.destroy();
  });
});

app.post('/api/movie-channels', requireAuth, csrfProtection, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const urls = normalizeMovieUrls(req.body.urls);
  if (!name || urls.length === 0) {
    return res.status(400).json({ error: 'name and at least one mp4/mkv url are required' });
  }
  const extra = await mergeChannelOptions(null, req.body || {});
  if (extra.outputMode === 'copy' && extra.watermark && extra.watermark.enabled) {
    return res.status(400).json({ error: 'Watermark on movies requires transcode mode' });
  }
  if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
    const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
    if (!fs.existsSync(wmPath)) {
      return res.status(400).json({ error: 'Watermark file not found. Upload/select a valid file.' });
    }
  }
  const id = uuidv4().substring(0, 8);
  const channel = {
    name,
    type: 'MOVIE',
    mpdUrl: urls[0],
    sourceQueue: urls,
    sourceIndex: 0,
    channelClass: 'movie',
    movieLoop: req.body.movieLoop === false ? false : true,
    inputType: 'auto',
    outputMode: 'copy',
    outputFormat: 'hls',
    renditionMode: 'single',
    renditions: ['1080p'],
    streamMode: 'live',
    headers: {},
    kid: '',
    key: '',
    pssh: '',
    watermark: defaultWatermark(),
    x264Preset: 'veryfast',
    videoEncoder: 'cpu_x264',
    performanceProfile: 'balanced',
    audioBitrateK: 128,
    hlsSegmentSeconds: 4,
    hlsPlaylistSize: 10,
    videoTrack: 0,
    audioTrack: 0,
    subtitleTrack: -1,
    httpProxy: null,
    userAgent: '',
    referer: '',
    customFfmpegArgs: '',
    maxRetries: 0,
    retryDelaySec: 5,
    sortOrder: 0,
    logoUrl: '',
    epgChannelId: '',
    status: 'stopped',
    createdAt: new Date().toISOString(),
    hlsUrl: null,
    error: null,
    viewers: 0,
    startedAt: null,
    userId: req.userId,
    stabilityScore: 100,
    stabilityStatus: 'Stable',
    stabilityLastChecked: null,
    stabilityMeta: {},
    autoFixEnabled: false,
    stabilityProfile: 'off',
    streamSlot: 'a',
    qoeScore: 100,
    qoeLastChecked: null,
    qoeAvgStartupMs: 0,
    qoeAvgBufferRatio: 0,
    qoeAvgLatencyMs: 0,
    finalStabilityScore: 100,
    ...extra,
    sourceQueue: urls,
    mpdUrl: urls[0],
    streamMode: 'live',
    inputType: 'auto',
  };
  channels.set(id, channel);
  await dbApi.insertChannel(id, req.userId, channel);
  const streamDir = path.join(__dirname, 'streams', id);
  if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });
  const { userId, ...pub } = channel;
  res.json({ id, ...pub });
});

app.post('/api/movie-channels/import', requireAuth, csrfProtection, async (req, res) => {
  const parsed = parseM3uMovieImport(req.body && req.body.rawText);
  const urls = normalizeMovieUrls(parsed.urls);
  const name = String((req.body && req.body.name) || parsed.firstName || '').trim();
  if (!name || urls.length === 0) {
    return res
      .status(400)
      .json({ error: 'No valid mp4/mkv/m3u8/ts URLs found in pasted text, or name is missing.' });
  }
  const extra = await mergeChannelOptions(null, req.body || {});
  if (extra.outputMode === 'copy' && extra.watermark && extra.watermark.enabled) {
    return res.status(400).json({ error: 'Watermark on movies requires transcode mode' });
  }
  if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
    const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
    if (!fs.existsSync(wmPath)) {
      return res.status(400).json({ error: 'Watermark file not found. Upload/select a valid file.' });
    }
  }
  const id = uuidv4().substring(0, 8);
  const channel = {
    name,
    type: 'MOVIE',
    mpdUrl: urls[0],
    sourceQueue: urls,
    sourceIndex: 0,
    channelClass: 'movie',
    movieLoop: req.body && req.body.movieLoop === false ? false : true,
    inputType: 'auto',
    outputMode: 'copy',
    outputFormat: 'hls',
    renditionMode: 'single',
    renditions: ['1080p'],
    streamMode: 'live',
    headers: {},
    kid: '',
    key: '',
    pssh: '',
    watermark: defaultWatermark(),
    x264Preset: 'veryfast',
    videoEncoder: 'cpu_x264',
    performanceProfile: 'balanced',
    audioBitrateK: 128,
    hlsSegmentSeconds: 4,
    hlsPlaylistSize: 10,
    videoTrack: 0,
    audioTrack: 0,
    subtitleTrack: -1,
    httpProxy: null,
    userAgent: '',
    referer: '',
    customFfmpegArgs: '',
    maxRetries: 0,
    retryDelaySec: 5,
    sortOrder: 0,
    logoUrl: parsed.firstLogo || '',
    epgChannelId: '',
    status: 'stopped',
    createdAt: new Date().toISOString(),
    hlsUrl: null,
    error: null,
    viewers: 0,
    startedAt: null,
    userId: req.userId,
    stabilityScore: 100,
    stabilityStatus: 'Stable',
    stabilityLastChecked: null,
    stabilityMeta: {},
    autoFixEnabled: false,
    stabilityProfile: 'off',
    streamSlot: 'a',
    qoeScore: 100,
    qoeLastChecked: null,
    qoeAvgStartupMs: 0,
    qoeAvgBufferRatio: 0,
    qoeAvgLatencyMs: 0,
    finalStabilityScore: 100,
    ...extra,
    sourceQueue: urls,
    mpdUrl: urls[0],
    streamMode: 'live',
    inputType: 'auto',
  };
  channels.set(id, channel);
  await dbApi.insertChannel(id, req.userId, channel);
  const streamDir = path.join(__dirname, 'streams', id);
  if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });
  const { userId, ...pub } = channel;
  res.json({ id, ...pub, importedCount: urls.length });
});

app.put('/api/movie-channels/:id', requireAuth, csrfProtection, async (req, res) => {
  const { id } = req.params;
  const channel = channels.get(id);
  if (!channel || channel.userId !== req.userId || !isMovieChannel(channel)) {
    return res.status(404).json({ error: 'Movie channel not found' });
  }
  if (channel.status === 'running') {
    return res.status(400).json({ error: 'Stop the movie channel first before editing' });
  }
  const name = String(req.body.name || '').trim();
  const urls = normalizeMovieUrls(req.body.urls);
  if (!name || urls.length === 0) {
    return res.status(400).json({ error: 'name and at least one mp4/mkv url are required' });
  }
  const extra = await mergeChannelOptions(channel, req.body || {});
  if (extra.outputMode === 'copy' && extra.watermark && extra.watermark.enabled) {
    return res.status(400).json({ error: 'Watermark on movies requires transcode mode' });
  }
  if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
    const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
    if (!fs.existsSync(wmPath)) {
      return res.status(400).json({ error: 'Watermark file not found. Upload/select a valid file.' });
    }
  }
  Object.assign(channel, {
    ...extra,
    name,
    mpdUrl: urls[0],
    sourceQueue: urls,
    sourceIndex: 0,
    movieLoop: req.body.movieLoop === false ? false : true,
    streamMode: 'live',
    inputType: 'auto',
  });
  await dbApi.updateChannelRow(id, req.userId, channel);
  const { userId, ...pub } = channel;
  res.json({ id, ...pub });
});

app.delete('/api/movie-channels/:id', requireAuth, csrfProtection, async (req, res) => {
  const { id } = req.params;
  const channel = channels.get(id);
  if (!channel || channel.userId !== req.userId || !isMovieChannel(channel)) {
    return res.status(404).json({ error: 'Movie channel not found' });
  }
  stopChannel(id);
  channels.delete(id);
  await dbApi.deleteChannelRow(id, req.userId);
  const streamDir = path.join(__dirname, 'streams', id);
  if (fs.existsSync(streamDir)) fs.rmSync(streamDir, { recursive: true, force: true });
  res.json({ success: true });
});

app.post('/api/movie-channels/:id/start', requireAuth, csrfProtection, async (req, res) => {
  const { id } = req.params;
  const channel = channels.get(id);
  if (!channel || channel.userId !== req.userId || !isMovieChannel(channel)) {
    return res.status(404).json({ error: 'Movie channel not found' });
  }
  if (channel.status === 'running') return res.json({ message: 'Already running', hlsUrl: channel.hlsUrl });
  try {
    await startChannel(id, channel);
    res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movie-channels/:id/stop', requireAuth, csrfProtection, (req, res) => {
  const { id } = req.params;
  const channel = channels.get(id);
  if (!channel || channel.userId !== req.userId || !isMovieChannel(channel)) {
    return res.status(404).json({ error: 'Movie channel not found' });
  }
  stopChannel(id);
  res.json({ id, status: 'stopped' });
});

app.post('/api/movie-channels/:id/restart', requireAuth, csrfProtection, async (req, res) => {
  const { id } = req.params;
  const channel = channels.get(id);
  if (!channel || channel.userId !== req.userId || !isMovieChannel(channel)) {
    return res.status(404).json({ error: 'Movie channel not found' });
  }
  stopChannel(id);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    await startChannel(id, channel);
    res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Restream Engine
// ========================

function waitForPlaylistReady(outPath, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (fs.existsSync(outPath)) {
        clearInterval(t);
        return resolve(true);
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        return resolve(false);
      }
    }, 300);
  });
}

async function startShadowChannel(id, channel, slot) {
  const streamDir = streamDirFor(id, slot);
  if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });
  fs.readdirSync(streamDir).forEach((f) => fs.unlinkSync(path.join(streamDir, f)));

  const runChannel = { ...channel, streamSlot: slot };
  const built = buildFfmpegArgs(runChannel, streamDir, id, __dirname);
  const { args: ffmpegArgs, playlist } = built;
  const outFilePath = path.join(streamDir, playlist);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  shadowProcesses.set(id, ffmpeg);

  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('close', () => {
    shadowProcesses.delete(id);
  });

  const ready = await waitForPlaylistReady(outFilePath, 12000);
  return { ffmpeg, playlist, ready };
}

async function seamlessSwitchChannel(id, channel, newSlot) {
  if (channel.outputFormat !== 'hls') return false;
  const shadow = await startShadowChannel(id, channel, newSlot);
  if (!shadow.ready) {
    try {
      shadow.ffmpeg.kill('SIGTERM');
    } catch {}
    return false;
  }

  const oldProc = processes.get(id);
  channel.streamSlot = newSlot;
  persistChannel(id);

  processes.set(id, shadow.ffmpeg);
  shadowProcesses.delete(id);

  if (oldProc) {
    try {
      oldProc.kill('SIGTERM');
    } catch {}
  }
  return true;
}

// Local restartChannel using server.js's own stopChannel/startChannel
// Note: streamManager no longer exports lifecycle functions
function restartChannel(id) {
  stopChannel(id);
  const ch = channels.get(id);
  if (ch) {
    startChannel(id, ch);
  }
}

async function startChannel(id, channel) {
  if (MAX_FFMPEG_PROCESSES > 0 && processes.size >= MAX_FFMPEG_PROCESSES) {
    throw new Error(`Server at capacity: ${processes.size}/${MAX_FFMPEG_PROCESSES} FFmpeg processes running`);
  }
  const baseStreamDir = path.join(__dirname, 'streams', id);
  channel.streamSlot = activeStreamSlot(channel);
  const streamDir = streamDirFor(id, channel.streamSlot);
  const logFile = path.join(__dirname, 'logs', `${id}.log`);
  const decryptionKey = `${channel.kid}:${channel.key}`;

  if (!channel.preDetectDoneAt && channel.outputMode === 'copy') {
    // Fire-and-forget: detect async, fix if needed — don't block FFmpeg spawn
    preDetectSource(channel).then(() => {
      // preDetectSource synchronously sets channel.outputMode = 'transcode' if issue found
      if (channel.outputMode === 'transcode') {
        setTimeout(() => {
          const ch = channels.get(id);
          if (ch && ch.status === 'running') restartChannel(id);
        }, 500);
      }
      channel.preDetectDoneAt = new Date().toISOString();
      persistChannel(id).catch(() => {});
    }).catch(() => {
      channel.preDetectDoneAt = new Date().toISOString();
      persistChannel(id).catch(() => {});
    });
  }

  const maxReconnect = Math.min(100, Math.max(0, parseInt(channel.maxRetries, 10) || 0));
  const delaySec = Math.min(300, Math.max(1, parseInt(channel.retryDelaySec, 10) || 5));
  let reconnectDone = 0;
  let movieSourceFailCount = 0;
  const controller = { cancelled: false, timers: new Set() };
  runControllers.set(id, controller);

  if (!fs.existsSync(baseStreamDir)) fs.mkdirSync(baseStreamDir, { recursive: true });
  if (fs.existsSync(streamDir)) {
    fs.readdirSync(streamDir).forEach((f) => fs.unlinkSync(path.join(streamDir, f)));
  } else {
    fs.mkdirSync(streamDir, { recursive: true });
  }

  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  let logClosed = false;
  logStream.on('error', (err) => {
    // Prevent process crash on double-close/write-after-end races.
    logClosed = true;
    console.error(`[${id}] log stream error:`, err.message);
  });
  logStream.on('close', () => {
    logClosed = true;
  });

  function writeLog(line) {
    if (logClosed || logStream.destroyed || logStream.writableEnded) return;
    try {
      logStream.write(line);
    } catch {
      logClosed = true;
    }
  }

  function closeLog() {
    if (logClosed || logStream.destroyed || logStream.writableEnded) return;
    try {
      logStream.end();
    } catch {
      logClosed = true;
    }
  }

  writeLog(`[${new Date().toISOString()}] Starting channel: ${channel.name}\n`);
  writeLog(`[${new Date().toISOString()}] MPD URL: ${activeSourceUrl(channel)}\n`);
  writeLog(`[${new Date().toISOString()}] Decryption Key: ${decryptionKey}\n`);
  writeLog(`[${new Date().toISOString()}] Mode: ${channel.outputMode}, transcode: ${needsTranscode(channel)}, stream: ${channel.streamMode || 'live'}\n`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let playlistTimer = null;

    function scheduleSpawn(delayMs) {
      const t = setTimeout(() => {
        controller.timers.delete(t);
        spawnOnce();
      }, delayMs);
      controller.timers.add(t);
    }

    function waitForOutputFile(outPath, isMpegts) {
      if (playlistTimer) clearInterval(playlistTimer);
      let attempts = 0;
      playlistTimer = setInterval(() => {
        attempts++;
        let ready = false;
        if (fs.existsSync(outPath)) {
          if (isMpegts) {
            try {
              ready = fs.statSync(outPath).size > 0;
            } catch {
              ready = false;
            }
          } else {
            ready = true;
          }
        }
        if (ready) {
          clearInterval(playlistTimer);
          playlistTimer = null;
          if (!settled) {
            settled = true;
            channel.status = 'running';
            if (!channel.startedAt) channel.startedAt = new Date().toISOString();
            eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
            resolve();
          }
        } else if (attempts >= 150) {
          clearInterval(playlistTimer);
          playlistTimer = null;
          if (!settled) {
            settled = true;
            channel.status = 'running';
            if (!channel.startedAt) channel.startedAt = new Date().toISOString();
            eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
            resolve();
          }
        }
      }, 20);
    }

    function waitForPipeMpegts(pipeId) {
      if (playlistTimer) clearInterval(playlistTimer);
      let attempts = 0;
      playlistTimer = setInterval(() => {
        attempts++;
        const sess = tsBroadcasts.get(pipeId)?.sessionBytes || 0;
        // One TS packet (188 B) = stream is flowing; poll fast for low startup latency.
        if (sess >= 188) {
          clearInterval(playlistTimer);
          playlistTimer = null;
          if (!settled) {
            settled = true;
            channel.status = 'running';
            if (!channel.startedAt) channel.startedAt = new Date().toISOString();
            eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
            resolve();
          }
        } else if (attempts >= 200) {
          clearInterval(playlistTimer);
          playlistTimer = null;
          if (!settled) {
            settled = true;
            channel.status = 'running';
            if (!channel.startedAt) channel.startedAt = new Date().toISOString();
            eventBus.emit(WS_EVENTS.STREAM_RUNNING, { channelId: id });
            resolve();
          }
        }
      }, 20);
    }

    function spawnOnce() {
      if (controller.cancelled || !channels.has(id)) {
        closeLog();
        if (!settled) {
          settled = true;
          reject(new Error('Channel start cancelled'));
        }
        return;
      }
      if (reconnectDone > 0) {
        writeLog(`\n\n--- [RECONNECT ${reconnectDone}/${maxReconnect}] after ${delaySec}s ---\n\n`);
      }

      let sourceUrl = activeSourceUrl(channel);
      if (!sourceUrl) {
        channel.status = 'error';
        channel.error = 'No input source URL configured';
        closeLog();
        if (!settled) {
          settled = true;
          reject(new Error(channel.error));
        }
        return;
      }
      const srcList = channelSources(channel);
      const idx = parseInt(channel.sourceIndex, 10);
      const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.min(srcList.length - 1, idx)) : 0;
      channel.sourceIndex = safeIdx;
      channel.nowPlayingTitle = sourceTitleFromUrl(sourceUrl);
      channel.nowPlayingIndex = safeIdx + 1;
      channel.nowPlayingTotal = srcList.length;
      channel.mpdUrl = sourceUrl;
      const runChannel = { ...channel, mpdUrl: sourceUrl };
      if (runChannel.hlsProxyMode && resolveEffectiveInputType(sourceUrl, runChannel.inputType) === 'hls') {
        const enc = encodeURIComponent(sourceUrl);
        runChannel.mpdUrl = `http://127.0.0.1:${PORT}/proxy/hls/${id}?u=${enc}`;
      }
      let usePipe = isMpegtsPipeOutput(runChannel);
      if (usePipe) {
        const b = ensureTsBroadcast(id);
        b.sessionBytes = 0;
        clearPrebuffer(b);
      }
      let built;
      let ffmpegArgs;
      let playlist;
      let outFilePath;
      let isMpegtsOut;
      try {
        if (
          STREAMING_MODE === 'nginx' &&
          !needsTranscode(runChannel) &&
          !isMovieChannel(channel) &&
          !isInternalChannel(channel)
        ) {
          built = buildNginxDualCopyFfmpegArgs(runChannel, id, IPTV_DISK_ROOT);
          ffmpegArgs = built.args;
          playlist = built.playlist;
          outFilePath = built.hlsPath;
          channel.hlsUrl = built.hlsUrl;
          if (built.tsUrl) channel.liveTsUrl = built.tsUrl;
          else delete channel.liveTsUrl;
          channel.nginxStreaming = true;
          isMpegtsOut = false;
        } else {
          built = buildFfmpegArgs(runChannel, streamDir, id, __dirname);
          ffmpegArgs = built.args;
          playlist = built.playlist;
          outFilePath = path.join(streamDir, playlist);
          isMpegtsOut = playlist === 'stream.ts';
          if (isMpegtsOut) channel.hlsUrl = built.hlsUrl;
          else channel.hlsUrl = `/streams/${id}/${playlist}`;
          channel.nginxStreaming = false;
          delete channel.liveTsUrl;
        }
      } catch (e) {
        channel.status = 'error';
        channel.error = e.message;
        writeLog(`\n[ERROR] ${e.message}\n`);
        closeLog();
        if (!settled) {
          settled = true;
          reject(e);
        }
        return;
      }

      console.log(`[${id}] FFmpeg:`, ffmpegArgs.join(' '));
      writeLog(`[${new Date().toISOString()}] Source URL: ${sourceUrl}\n`);
      if (channel.nginxStreaming) {
        writeLog(
          `[${new Date().toISOString()}] Nginx mode: HLS on disk (${IPTV_DISK_ROOT})${
            built.tsUrl ? '; MPEG-TS via Node stdout pipe (no .ts file)' : ''
          }\n`
        );
      } else if (isMpegtsOut) {
        writeLog(`[${new Date().toISOString()}] MPEG-TS: stdout pipe (no disk file)\n`);
      }
      writeLog(`[${new Date().toISOString()}] FFmpeg args: ffmpeg ${ffmpegArgs.join(' ')}\n\n`);

      if (reconnectDone === 0) {
        if (usePipe) waitForPipeMpegts(id);
        else waitForOutputFile(outFilePath, false);
      }

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', usePipe ? 'pipe' : 'ignore', 'pipe'],
      });

      processes.set(id, ffmpeg);
      channel.status = 'starting';
      channel.error = null;

      ffmpeg.stdout.on('data', (data) => {
        if (processes.get(id) !== ffmpeg) return;
        if (usePipe) broadcastTsData(id, data);
      });

      if (!channel.streamInfo) channel.streamInfo = {};

      ffmpeg.stderr.on('data', (data) => {
        if (processes.get(id) !== ffmpeg) return;
        const msg = data.toString();
        writeLog(msg);
        if (msg.includes('Opening') || msg.includes('Output #0') || msg.includes('Output #1')) {
          channel.status = 'running';
          if (!channel.startedAt) channel.startedAt = new Date().toISOString();
        }

        const vMatch = msg.match(/Stream\s+#\d+:\d+.*Video:\s+(\w+).+?(\d{2,5})x(\d{2,5})/);
        if (vMatch && !channel.streamInfo._vDone) {
          channel.streamInfo.video_codec = vMatch[1];
          channel.streamInfo.width = parseInt(vMatch[2], 10);
          channel.streamInfo.height = parseInt(vMatch[3], 10);
          channel.streamInfo._vDone = true;
        }
        const fpsMatch = msg.match(/(\d+(?:\.\d+)?)\s+fps/);
        if (fpsMatch && !channel.streamInfo._fpsDone) {
          channel.streamInfo.fps = parseFloat(fpsMatch[1]);
          channel.streamInfo._fpsDone = true;
        }
        const aMatch = msg.match(/Stream\s+#\d+:\d+.*Audio:\s+(\w+)/);
        if (aMatch && !channel.streamInfo._aDone) {
          channel.streamInfo.audio_codec = aMatch[1];
          channel.streamInfo._aDone = true;
        }

        const brMatch = msg.match(/bitrate=\s*([\d.]+)kbits\/s/);
        if (brMatch) channel.streamInfo.bitrate = Math.round(parseFloat(brMatch[1]));
        const speedMatch = msg.match(/speed=\s*([\d.]+)x/);
        if (speedMatch) channel.streamInfo.speed = parseFloat(speedMatch[1]);
        const progFps = msg.match(/fps=\s*([\d.]+)/);
        if (progFps) channel.streamInfo.current_fps = parseFloat(progFps[1]);
      });

      ffmpeg.on('error', (err) => {
        if (processes.get(id) !== ffmpeg) {
          if (controller.cancelled && !settled) {
            settled = true;
            closeLog();
            if (runControllers.get(id) === controller) runControllers.delete(id);
            reject(new Error('Channel start cancelled'));
          }
          return;
        }
        console.error(`[${id}] FFmpeg error:`, err.message);
        writeLog(`\n[ERROR] ${err.message}\n`);
        channel.status = 'error';
        channel.error = err.message;
        processes.delete(id);
        if (!settled) {
          settled = true;
          closeLog();
          runControllers.delete(id);
          reject(err);
        }
      });

      ffmpeg.on('close', (code) => {
        if (processes.get(id) !== ffmpeg) {
          closeLog();
          if (controller.cancelled && !settled) {
            settled = true;
            if (runControllers.get(id) === controller) runControllers.delete(id);
            reject(new Error('Channel start cancelled'));
          }
          return;
        }
        console.log(`[${id}] FFmpeg exited with code ${code}`);
        writeLog(`\n[EXIT] FFmpeg exited with code ${code}\n`);
        processes.delete(id);

        if (channel.status === 'stopped') {
          runControllers.delete(id);
          closeLog();
          return;
        }

        if (code !== 0 && reconnectDone < maxReconnect) {
          reconnectDone++;
          if (isMovieChannel(channel)) movieSourceFailCount++;
          channel.status = 'starting';
          channel.error = null;
          scheduleSpawn(delaySec * 1000);
          return;
        }

        const srcList = channelSources(channel);
        let outBytes = 0;
        if (isMpegtsPipeOutput(channel)) {
          outBytes = tsBroadcasts.get(id)?.sessionBytes || 0;
        } else {
          try {
            outBytes = fs.existsSync(outFilePath) ? fs.statSync(outFilePath).size : 0;
          } catch {
            outBytes = 0;
          }
        }
        const emptyOutput = outBytes < 188 * 20; // <20 TS packets: effectively empty stream
        if (isMovieChannel(channel) && (code !== 0 || emptyOutput)) {
          movieSourceFailCount++;
          if (movieSourceFailCount <= 2) {
            channel.status = 'starting';
            channel.error = null;
            writeLog(
              `\n[RETRY] Movie source retry ${movieSourceFailCount}/2 (code=${code}, out=${outBytes} bytes)\n\n`
            );
            scheduleSpawn(1200);
            return;
          }
          movieSourceFailCount = 0;
        } else {
          movieSourceFailCount = 0;
        }
        if (code === 0 && (channel.streamMode === 'vod' || isMovieChannel(channel)) && srcList.length > 1) {
          if (isMovieChannel(channel) && channel.movieLoop === false) {
            channel.status = 'stopped';
            channel.startedAt = null;
            channel.error = null;
            persistChannel(id);
            closeLog();
            return;
          }
          const idx = parseInt(channel.sourceIndex, 10);
          const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.min(srcList.length - 1, idx)) : 0;
          channel.sourceIndex = (safeIdx + 1) % srcList.length;
          channel.status = 'starting';
          channel.error = null;
          reconnectDone = 0;
          writeLog(
            `\n[NEXT] Switching to movie ${channel.sourceIndex + 1}/${srcList.length}: ${srcList[channel.sourceIndex]}\n\n`
          );
          persistChannel(id);
          scheduleSpawn(1000);
          return;
        }

        if (code !== 0) {
          channel.status = 'error';
          channel.error = `FFmpeg exited with code ${code}`;
        } else {
          channel.status = 'stopped';
          channel.startedAt = null;
        }
        persistChannel(id);
        runControllers.delete(id);
        closeLog();
      });
    }

    spawnOnce();
  });
}

onDemandLive.registerStartChannel(startChannel);

function stopChannel(id) {
  const channel = channels.get(id);
  if (channel) {
    channel.status = 'stopped';
    channel.error = null;
    channel.startedAt = null;
    channel.nowPlayingTitle = null;
    channel.nowPlayingIndex = null;
    channel.nowPlayingTotal = null;
    persistChannel(id);
  }
  const br = tsBroadcasts.get(id);
  if (br) {
    for (const c of br.consumers) {
      try {
        c.destroy();
      } catch (e) {}
    }
    br.consumers.clear();
    tsBroadcasts.delete(id);
  }
  const ctl = runControllers.get(id);
  if (ctl) {
    ctl.cancelled = true;
    for (const t of ctl.timers) {
      clearTimeout(t);
    }
    ctl.timers.clear();
    runControllers.delete(id);
  }

  if (processes.has(id)) {
    const proc = processes.get(id);
    try {
      treeKill(proc.pid, 'SIGTERM', (err) => {
        if (err) {
          try {
            proc.kill('SIGTERM');
          } catch (e) {}
        }
      });
      setTimeout(() => {
        try {
          treeKill(proc.pid, 'SIGKILL');
          proc.kill('SIGKILL');
        } catch (e) {}
      }, 5000);
    } catch (e) {
      console.error(`Error stopping ${id}:`, e.message);
    }
    processes.delete(id);
  }
  if (shadowProcesses.has(id)) {
    const proc = shadowProcesses.get(id);
    try {
      treeKill(proc.pid, 'SIGTERM', (err) => {
        if (err) {
          try {
            proc.kill('SIGTERM');
          } catch (e) {}
        }
      });
    } catch (e) {}
    shadowProcesses.delete(id);
  }
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

    const checkDone = () => { if (++killed >= total) resolve(); };

    processes.forEach((proc) => {
      try { treeKill(proc.pid, 'SIGTERM', checkDone); } catch (e) { checkDone(); }
    });
    shadowProcesses.forEach((proc) => {
      try { treeKill(proc.pid, 'SIGTERM', checkDone); } catch (e) { checkDone(); }
    });
    // Safety fallback if processes don't exit
    setTimeout(() => {
      processes.forEach((proc) => {
        try { treeKill(proc.pid, 'SIGKILL'); } catch (e) {}
      });
      shadowProcesses.forEach((proc) => {
        try { treeKill(proc.pid, 'SIGKILL'); } catch (e) {}
      });
      resolve();
    }, FORCE_KILL_TIMEOUT_MS);
  });

  await killPromise;
  try { await redis.disconnect(); } catch {}
  try { await mariadb.closePool(); } catch {}
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
  serverLog('unhandled_rejection', { reason: String(reason) });
  // Don't shutdown on unhandled rejection - just log it
});

// ========================
// Xtream-style line streaming (M3U / live / movie / series)
// ========================
const streamRoutes = require('./routes/stream');
// Apply rate limiting to public playback routes (skip localhost for development)
app.use(streamLimiter, streamRoutes);

// Mount system routes (health, db-status, agent heartbeat) - after inline routes so they take precedence
const systemRoutes = require('./routes/system');
app.use('/api', systemRoutes);

// ========================
// Error handling (must be after all routes)
// ========================
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler);
app.use(errorHandler);

// ========================
// Start server
// ========================
async function boot() {
  const dbOk = await mariadb.testConnection();
  if (!dbOk) {
    console.error('[BOOT] MariaDB connection failed – check .env / DB_* settings');
    process.exit(1);
  }
  console.log('[BOOT] MariaDB connected');

  const redisOk = await redis.connect();
  if (redisOk) {
    console.log('[BOOT] Redis connected');
  } else {
    console.warn('[BOOT] Redis connection failed – some features may not work correctly');
  }

  await dbApi.seedDefaults();
  await streamingSettings.refreshStreamingSettings(dbApi);
  streamingSettings.startPeriodicRefresh(dbApi, 45000);
  await loadChannelsFromDb();

  let preWarmBootCount = 0;
  for (const [id, ch] of channels.entries()) {
    if (!streamingSettings.channelPreWarmEffective(ch) || ch.on_demand) continue;
    if (ch.userId == null) continue;
    if (isMovieChannel(ch) || isInternalChannel(ch)) continue;
    if (ch.status === 'running') continue;
    try {
      await startChannel(id, ch);
      preWarmBootCount++;
      if (MAX_FFMPEG_PROCESSES > 0 && processes.size >= MAX_FFMPEG_PROCESSES) {
        console.warn('[BOOT] preWarm: MAX_FFMPEG_PROCESSES reached; remaining preWarm channels not started');
        break;
      }
    } catch (e) {
      console.error(`[BOOT] preWarm start failed ${id}:`, e.message);
    }
  }
  if (preWarmBootCount > 0) {
    console.log(`[BOOT] preWarm: started ${preWarmBootCount} channel(s) at boot`);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ========================================
   IPTV Panel (MariaDB + Redis)
   Running on http://0.0.0.0:${PORT}
  ========================================
    `);
    startCrons();

    // Init Telegram bot (lazy start after crons)
    setTimeout(() => {
      const { initBot } = require('./services/telegramBot');
      initBot().catch(e => console.error('[TELEGRAM] Init error:', e.message));
    }, 5000);

    // Init WebSocket server for real-time dashboard
    const wsServer = createWsServer({
      eventBus,
      deps: { channels, processes, userActivity, collectSystemMetrics, dbApi, maxFFmpegProcesses: MAX_FFMPEG_PROCESSES, formatDuration, channelRuntimeInfo },
    });
    wsServer.init();
    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws' || req.url.startsWith('/ws?')) {
        wsServer.handleUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });

    // Init webhook service for stream/sharing alerts
    const { init: initWebhooks } = require('./services/webhookService');
    initWebhooks({ eventBus });

    setInterval(() => {
      const now = Date.now();
      channels.forEach((ch, id) => {
        if (!ch.on_demand) return;
        if (streamingSettings.channelPreWarmEffective(ch)) return;
        if (ch.status !== 'running') return;
        // Node MPEG-TS fan-out: idle is handled by /streams/.../stream.ts consumer count.
        if (ch.outputFormat === 'mpegts' && !(STREAMING_MODE === 'nginx' && ch.nginxStreaming)) return;
        const lastAccess = hlsIdle.get(id);
        if (lastAccess && (now - lastAccess) > 30000) {
          console.log(`[IDLE-KILL] On-demand channel ${id} idle for 30s, stopping.`);
          hlsIdle.delete(id);
          stopChannel(id);
        }
      });
    }, 15000);
  });
}

boot().catch(err => {
  console.error('[BOOT] Fatal error:', err);
  process.exit(1);
});

function startStabilityService() {
  if (stabilityMonitor) return;
  stabilityMonitor = createStabilityMonitor({
    getChannels: () => [...channels.keys()],
    getChannelById: (id) => channels.get(id),
    streamDirFor: (id) => {
      const ch = channels.get(id);
      return streamDirFor(id, activeStreamSlot(ch));
    },
    isMpegtsPipeOutput,
    tsBroadcasts,
    persistChannel,
    dbApi,
    intervalMs: 5000,
    batchSize: 40,
    onAutoFix: (id, action) => {
      const channel = channels.get(id);
      if (!channel) return;
      if (action === 'degrade') {
        if (channel.outputMode === 'transcode' && channel.stabilityProfile === 'lag_fix') return;
        applyStabilityFix(id, 'degrade', { reason: 'auto' });
      } else if (action === 'recover') {
        if (channel.stabilityProfile !== 'lag_fix') return;
        applyStabilityFix(id, 'recover', { reason: 'auto' });
      }
      if (channel.status === 'running') {
        setTimeout(() => {
          restartWithSeamlessIfPossible(id, channel).catch(() => {});
        }, 250);
      }
    },
  });
}

startStabilityService();
