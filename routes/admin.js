'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { cacheMiddleware, keys, TTL, invalidateVod, invalidateSeries, invalidateCategories, invalidateBouquets, invalidateSettings, invalidateLines, invalidateEpisodes } = require('../lib/cache');
const lineService = require('../services/lineService');
const serverService = require('../services/serverService');
const provisionService = require('../services/provisionService');
const streamManager = require('../services/streamManager');
const categoryService = require('../services/categoryService');
const bouquetService = require('../services/bouquetService');
const packageService = require('../services/packageService');
const vodService = require('../services/vodService');
const seriesService = require('../services/seriesService');
const epgService = require('../services/epgService');
const tmdbService = require('../services/tmdbService');
const importService = require('../services/importService');
const dbService = require('../services/dbService');
const { XcApiClient } = require('../services/xcApiClient');
const importChannelBridge = require('../lib/importChannelBridge');
const { channels, processes } = require('../lib/state');
const { query, queryOne, execute } = require('../lib/mariadb');
const streamingSettings = require('../lib/streaming-settings');
const { csrfProtection } = require('../middleware/csrf');

const adminSystem = require('./admin.system');
const adminSystemDb = require('./admin.system.db');
const adminAccessCodes = require('./admin.accessCodes');
const adminCategories = require('./admin.categories');
const adminBouquets = require('./admin.bouquets');
const adminPackages = require('./admin.packages');
const adminMovies = require('./admin.movies');
const adminSeries = require('./admin.series');
const adminEpisodes = require('./admin.episodes');
const adminEpgs = require('./admin.epg');
const adminTmdb = require('./admin.tmdb');
const adminUsers = require('./admin.users');
const adminLines = require('./admin.lines');
const adminResellers = require('./admin.resellers');
const adminResellerExpiryMedia = require('./admin.resellerExpiryMedia');
const adminServers = require('./admin.servers');
const adminConnections = require('./admin.connections');
const adminServerRelationships = require('./admin.serverRelationships');
const adminBackups = require('./admin.backups');
const adminSettings = require('./admin.settings');
const adminActivity = require('./admin.activity');
const adminSecurity = require('./admin.security');
const adminStats = require('./admin.stats');
const adminNetworkSecurity = require('./admin.networkSecurity');
const adminPlex = require('./admin.plex');
const adminProviders = require('./admin.providers');
const adminM3UImport = require('./admin.m3uImport');
const adminEpgAssign = require('./admin.epgAssign');
const adminVodDownload = require('./admin.vodDownload');
const adminTelegram = require('./admin.telegram');
const adminRbac = require('./admin.rbac');
const adminTmdbResync = require('./admin.tmdbResync');
const adminChannels = require('./admin.channels');
const adminFeatures = require('./admin.features');
const adminBulkOperations = require('./admin.bulkOperations');
const adminBouquetSync = require('./admin.bouquetSync');

const router = express.Router();

// Internal health check — used by healthMonitor, must be BEFORE auth middleware
router.get('/health-check', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

function clearPanelUserSession(req, { preserveGateway = true } = {}) {
  if (!req.session) return;
  req.session.userId = null;
  if (!preserveGateway) {
    req.session.portalRole = null;
    req.session.accessCode = null;
    req.session.accessCodeId = null;
  }
}

async function validateAdminAccessCodeSession(req) {
  const session = req.session || null;
  if (typeof dbApi.getAccessCodeById !== 'function') {
    return session && session.portalRole === 'admin' ? { id: session.accessCodeId || null, role: 'admin', enabled: 1 } : null;
  }
  if (!session || !session.accessCodeId || !session.portalRole) {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  const row = await dbApi.getAccessCodeById(session.accessCodeId);
  const enabled = row && (row.enabled === true || row.enabled === 1 || Number(row.enabled) === 1);
  if (!row || !enabled || row.role !== 'admin' || session.portalRole !== 'admin') {
    clearPanelUserSession(req, { preserveGateway: false });
    return null;
  }
  if (session.accessCode !== row.code) session.accessCode = row.code;
  return row;
}

async function adminAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  try {
    const accessCode = await validateAdminAccessCodeSession(req);
    if (!accessCode) return res.status(403).json({ error: 'access code invalid' });
    const user = await dbApi.findUserById(req.session.userId);
    if (!user || Number(user.status) !== 1) return res.status(403).json({ error: 'account disabled' });
    const isAdmin = await dbApi.isAdmin(req.session.userId);
    if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    return next();
  } catch (e) {
    return res.status(500).json({ error: e.message || 'auth failed' });
  }
}
router.use(adminAuth);
// CSRF protection for state-changing requests (POST/PUT/DELETE/PATCH)
router.use(csrfProtection);

router.use(adminFeatures);
router.use(adminSystem);
router.use(adminServers);
router.use(adminConnections);
router.use(adminServerRelationships);
router.use(adminBackups);

function parseLimitOffset(q) {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return { limit, offset };
}

function parseBoolInt(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1' || value === 1) return 1;
  return 0;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// ─── Users ──────────────────────────────────────────────────────────
router.use(adminUsers);

// ─── Access Codes ────────────────────────────────────────────────────
router.use(adminAccessCodes);

// ─── System / Database Manager ───────────────────────────────────────
router.use('/system', adminSystemDb);

// ─── Lines ──────────────────────────────────────────────────────────
router.use(adminLines);

// ─── Categories ─────────────────────────────────────────────────────
router.use(adminCategories);

// ─── Import providers & Xtream import ───────────────────────────────
router.use(adminProviders);

// ─── Channels ───────────────────────────────────────────────────────
router.use(adminChannels);

router.use(adminBulkOperations);
router.use(adminBouquetSync);

// ─── Bouquets ───────────────────────────────────────────────────────
router.use(adminBouquets);

// ─── Packages ───────────────────────────────────────────────────────
router.use(adminPackages);

// ─── Movies ─────────────────────────────────────────────────────────
router.use(adminMovies);

// ─── Series ─────────────────────────────────────────────────────────
router.use(adminSeries);

// ─── Episodes ───────────────────────────────────────────────────────
router.use(adminEpisodes);

// ─── EPG ────────────────────────────────────────────────────────────
router.use(adminEpgs);

// ─── Settings ───────────────────────────────────────────────────────
router.use(adminSettings);

// ─── Resellers ──────────────────────────────────────────────────────
router.use(adminResellers);

// ─── Reseller Expiry Media ─────────────────────────────────────────
router.use(adminResellerExpiryMedia);

// ─── Logs / Activity / Channels ─────────────────────────────────────
router.use(adminActivity);

// ─── Security ───────────────────────────────────────────────────────
router.use(adminSecurity);

// ─── TMDb Proxy ─────────────────────────────────────────────────────
router.use(adminTmdb);

// ─── M3U Import helpers ─────────────────────────────────────────────
router.use(adminM3UImport);

// ─── Dashboard Stats ────────────────────────────────────────────────
router.use(adminStats);

// ─── RBAC ────────────────────────────────────────────────────────────
router.use(adminRbac);

// ─── ASN Blocking ─────────────────────────────────────────────────
router.use(adminNetworkSecurity);

// ─── TMDB Re-sync ─────────────────────────────────────────────────
router.use('/tmdb', adminTmdbResync);

// ─── Mass EPG Assignment ──────────────────────────────────────────
router.use(adminEpgAssign);

// ─── VOD Download Block ──────────────────────────────────────────
router.use(adminVodDownload);

// ─── Plex Watch Status ────────────────────────────────────────────
router.use(adminPlex);

// ─── Telegram Bot Settings ────────────────────────────────────
router.use(adminTelegram);

// ─── Stream URL Signing (block_vod_download) ────────────────────
// Apply in playback middleware based on setting

module.exports = router;
