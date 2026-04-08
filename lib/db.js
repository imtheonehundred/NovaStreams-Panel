'use strict';

const {
  query,
  queryOne,
  insert,
  update,
  remove,
  execute,
} = require('./mariadb');
const {
  toMysqlDatetimeUtc,
  sanitizeSqlParams,
  RELEASE_DATE_MAX_LEN,
  unixSecondsToMysqlDatetime,
  mysqlDatetimeToUnixSeconds,
} = require('./mysql-datetime');
const {
  hashApiKey,
  verifyApiKey,
  hashLinePassword,
  verifyLinePasswordHash,
  encryptLinePassword,
  decryptLinePassword,
} = require('./crypto');

const {
  getSetting,
  setSetting,
  getAllSettings,
} = require('../repositories/settingsRepository');

const {
  createUser,
  findUserByUsername,
  findUserById,
  getAllUsers,
  userCount,
  verifyPassword,
  updateUser,
  touchUserLastLogin,
  deleteUser,
  getUserGroup,
  isAdmin,
  isReseller,
  getFirstAdminUserId,
} = require('../repositories/userRepository');

const {
  ensureUserMetaTable,
  getUserMeta,
  setUserMeta,
  listUserMetaMap,
  migrateLegacyUserMetaFromJson,
} = require('../repositories/userMetaRepository');

const {
  listUserGroups,
  getUserGroupById,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
} = require('../repositories/userGroupRepository');

const {
  createLine,
  getLineById,
  getLineByUsername,
  getLineByAccessToken,
  listLines,
  lineCount,
  updateLine,
  ensureLinePasswordSecurityColumns,
  migrateLegacyLinePasswords,
  countIncompleteLinePasswordSecurityRows,
  dropLegacyLinePasswordColumnIfSafe,
  deleteLine,
  deleteExpiredLines,
  updateLineActivity,
  getActiveConnections,
  addLiveConnection,
  removeLiveConnection,
  clearStaleLiveConnections,
  countLiveConnections,
  writeActivityHistory,
} = require('../repositories/lineRepository');

const {
  insertChannel,
  updateChannelRow,
  deleteChannelRow,
  listChannelRowsForUser,
  listAllChannelRows,
  listAllLiveChannelIds,
  upsertChannelHealth,
  getChannelHealth,
  insertQoeMetric,
  getQoeHistory,
  getQoeAgg,
  upsertQoeAgg,
} = require('../repositories/channelRepository');

const {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../repositories/categoryRepository');

const {
  listBouquets,
  getBouquetById,
  getBouquetsByIds,
  createBouquet,
  updateBouquet,
  deleteBouquet,
} = require('../repositories/bouquetRepository');

const {
  listMovies,
  getMovieById,
  movieCount,
  createMovie,
  updateMovie,
  deleteMovie,
  listAllMovieStreamUrls,
  listAllMovieIds,
} = require('../repositories/movieRepository');

const {
  listSeries,
  getSeriesById,
  seriesCount,
  createSeries,
  updateSeriesRow,
  deleteSeries,
  listAllSeriesTitles,
  listAllSeriesIds,
} = require('../repositories/seriesRepository');

const {
  listEpisodes,
  listAllEpisodes,
  getEpisodeById,
  createEpisode,
  updateEpisode,
  deleteEpisode,
  getEffectiveEpisodeServerId,
} = require('../repositories/episodeRepository');

const {
  listPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
} = require('../repositories/packageRepository');

const {
  listEpgSources,
  createEpgSource,
  deleteEpgSource,
  updateEpgSourceTimestamp,
  clearEpgData,
  insertEpgProgram,
  insertEpgBatch,
  getEpgForChannel,
  getShortEpg,
  getAllEpgData,
} = require('../repositories/epgRepository');

const {
  listBlockedIps,
  addBlockedIp,
  removeBlockedIp,
  isIpBlocked,
  listBlockedUas,
  addBlockedUa,
  removeBlockedUa,
  isUaBlocked,
  listBlockedIsps,
  addBlockedIsp,
  removeBlockedIsp,
  recordAuthAttempt,
  getAuthAttempts,
  cleanOldAuthFlood,
} = require('../repositories/securityRepository');

const {
  addPanelLog,
  getPanelLogs,
} = require('../repositories/panelLogRepository');

const {
  insertAuditLog,
  listAuditLogs,
} = require('../repositories/auditLogRepository');

const {
  listOutputFormats,
  listStreamArguments,
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
} = require('../repositories/streamRepository');

const {
  ensureImportProvidersTable,
  listImportProviders,
  getImportProviderById,
  createImportProvider,
  updateImportProvider,
  deleteImportProvider,
} = require('../repositories/importProviderRepository');

const {
  listTranscodeProfiles,
  getTranscodeProfile,
  createTranscodeProfile,
  updateTranscodeProfile,
  deleteTranscodeProfile,
} = require('../repositories/transcodeRepository');

const {
  ensureAccessCodesTable,
  listAccessCodes,
  getAccessCodeByCode,
  getAccessCodeById,
  createAccessCode,
  updateAccessCode,
  deleteAccessCode,
  touchAccessCodeUsage,
} = require('../repositories/accessCodeRepository');

const {
  ensureServerRelationshipsTable,
  ensureStreamServerPlacementTable,
  ensureLineRuntimeSessionsTable,
  ensureServerCommandsTable,
  ensureServerAgentCredentialsTable,
  ensureServerProvisioningJobsTable,
  ensureStreamingServersTables,
  addServerRelationship,
  removeServerRelationship,
  getServerRelationships,
  getServerChildren,
  createPlacement,
  updatePlacementClients,
  getPlacement,
  getActivePlacementsForServer,
  upsertPlacementRuntimeState,
  setPlacementDesiredState,
  markPlacementStarting,
  markPlacementRunning,
  markPlacementStopped,
  markPlacementError,
  getPlacementByAsset,
  getPlacementsByServer,
  reportPlacementRuntimeFromNode,
  openRuntimeSession,
  touchRuntimeSession,
  closeRuntimeSession,
  listActiveRuntimeSessionsByServer,
  countActiveRuntimeSessionsByPlacement,
  countActiveRuntimeSessionsByServer,
  getFailoverRelationships,
  getProxyRelationships,
  getOriginServersForProxy,
  reconcilePlacementClients,
  reconcileAllPlacementClients,
  cleanStaleRuntimeSessions,
  createServerCommand,
  leaseServerCommands,
  markServerCommandRunning,
  markServerCommandSucceeded,
  markServerCommandFailed,
  expireStaleLeases,
  createServerAgentCredential,
  getActiveServerAgentCredential,
  getServerAgentCredentialForValidation,
  revokeServerAgentCredential,
  touchServerAgentCredential,
  rotateServerAgentCredential,
  getValidServerCredentials,
  revokeRotatingCredentials,
} = require('../repositories/serverRepository');

async function verifyLinePassword(lineRow, plain) {
  return await verifyLinePasswordHash(plain, lineRow && lineRow.password_hash);
}

function attachLinePassword(row) {
  if (!row) return null;
  const next = { ...row };
  next.password = decryptLinePassword(next.password_enc);
  return next;
}

// Repository functions now imported from repositories/
// Settings, Users, and User Groups are in repositories/

async function listResellerPackageOverrides(userId) {
  return await query(
    'SELECT id, user_id, package_id, trial_credits_override, official_credits_override, enabled FROM reseller_package_overrides WHERE user_id = ? ORDER BY package_id ASC',
    [userId]
  );
}

async function getResellerPackageOverride(userId, packageId) {
  return await queryOne(
    'SELECT id, user_id, package_id, trial_credits_override, official_credits_override, enabled FROM reseller_package_overrides WHERE user_id = ? AND package_id = ?',
    [userId, packageId]
  );
}

async function replaceResellerPackageOverrides(userId, rows) {
  await execute('DELETE FROM reseller_package_overrides WHERE user_id = ?', [
    userId,
  ]);
  for (const row of rows || []) {
    await execute(
      `INSERT INTO reseller_package_overrides (user_id, package_id, trial_credits_override, official_credits_override, enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        row.package_id,
        row.trial_credits_override != null ? row.trial_credits_override : null,
        row.official_credits_override != null
          ? row.official_credits_override
          : null,
        row.enabled !== undefined ? row.enabled : 1,
      ]
    );
  }
}

async function listResellerExpiryMediaServices(
  rawLimit = 50,
  rawOffset = 0,
  search = ''
) {
  const limit = Math.min(100, Math.max(1, parseInt(rawLimit, 10) || 50));
  const offset = Math.max(0, parseInt(rawOffset, 10) || 0);
  const term = `%${String(search || '').trim()}%`;
  const where = search ? 'WHERE u.username LIKE ? OR u.email LIKE ?' : '';
  const countSql = `SELECT COUNT(*) AS c FROM reseller_expiry_media_services s INNER JOIN users u ON u.id = s.user_id ${where}`;
  const rowsSql = `
    SELECT s.id, s.user_id, s.active, s.warning_window_days, s.repeat_interval_hours, s.created_at, s.updated_at,
           u.username, u.email,
           SUM(CASE WHEN i.scenario = 'expiring' THEN 1 ELSE 0 END) AS expiring_count,
           SUM(CASE WHEN i.scenario = 'expired' THEN 1 ELSE 0 END) AS expired_count
    FROM reseller_expiry_media_services s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN reseller_expiry_media_items i ON i.service_id = s.id
    ${where}
    GROUP BY s.id, s.user_id, s.active, s.warning_window_days, s.repeat_interval_hours, s.created_at, s.updated_at, u.username, u.email
    ORDER BY u.username ASC
    LIMIT ? OFFSET ?
  `;
  const totalRow = search
    ? await queryOne(countSql, [term, term])
    : await queryOne(countSql);
  const rows = search
    ? await query(rowsSql, [term, term, limit, offset])
    : await query(rowsSql, [limit, offset]);
  return { rows, total: totalRow ? Number(totalRow.c) || 0 : 0 };
}

async function getResellerExpiryMediaServiceById(id) {
  return await queryOne(
    `SELECT s.id, s.user_id, s.active, s.warning_window_days, s.repeat_interval_hours, s.created_at, s.updated_at,
            u.username, u.email
     FROM reseller_expiry_media_services s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [id]
  );
}

async function getResellerExpiryMediaServiceByUserId(userId) {
  return await queryOne(
    `SELECT s.id, s.user_id, s.active, s.warning_window_days, s.repeat_interval_hours, s.created_at, s.updated_at,
            u.username, u.email
     FROM reseller_expiry_media_services s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.user_id = ?`,
    [userId]
  );
}

async function createResellerExpiryMediaService(userId, data = {}) {
  const id = await insert(
    `INSERT INTO reseller_expiry_media_services (user_id, active, warning_window_days, repeat_interval_hours)
     VALUES (?, ?, ?, ?)`,
    [
      userId,
      data.active !== undefined ? data.active : 1,
      data.warning_window_days || 7,
      data.repeat_interval_hours || 6,
    ]
  );
  return await getResellerExpiryMediaServiceById(id);
}

async function updateResellerExpiryMediaService(id, data = {}) {
  const sets = [];
  const vals = [];
  for (const key of [
    'active',
    'warning_window_days',
    'repeat_interval_hours',
  ]) {
    if (data[key] !== undefined) {
      sets.push(`\`${key}\` = ?`);
      vals.push(data[key]);
    }
  }
  if (sets.length) {
    vals.push(id);
    await execute(
      `UPDATE reseller_expiry_media_services SET ${sets.join(', ')} WHERE id = ?`,
      vals
    );
  }
  return await getResellerExpiryMediaServiceById(id);
}

async function deleteResellerExpiryMediaService(id) {
  return await remove(
    'DELETE FROM reseller_expiry_media_services WHERE id = ?',
    [id]
  );
}

async function listResellerExpiryMediaItems(serviceId) {
  return await query(
    `SELECT id, service_id, scenario, country_code, media_type, media_url, sort_order
     FROM reseller_expiry_media_items WHERE service_id = ? ORDER BY scenario ASC, sort_order ASC, id ASC`,
    [serviceId]
  );
}

async function replaceResellerExpiryMediaItems(serviceId, rows) {
  await execute(
    'DELETE FROM reseller_expiry_media_items WHERE service_id = ?',
    [serviceId]
  );
  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i] || {};
    await execute(
      `INSERT INTO reseller_expiry_media_items (service_id, scenario, country_code, media_type, media_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        serviceId,
        row.scenario,
        String(row.country_code || '')
          .trim()
          .toUpperCase(),
        row.media_type || 'video',
        String(row.media_url || '').trim(),
        row.sort_order != null ? row.sort_order : i,
      ]
    );
  }
}

async function getMatchingResellerExpiryMedia(
  userId,
  scenario,
  countryCode = ''
) {
  const service = await getResellerExpiryMediaServiceByUserId(userId);
  if (!service || Number(service.active) !== 1) return null;
  const country = String(countryCode || '')
    .trim()
    .toUpperCase();
  const exact = country
    ? await queryOne(
        `SELECT i.*, s.warning_window_days, s.repeat_interval_hours
       FROM reseller_expiry_media_items i
       INNER JOIN reseller_expiry_media_services s ON s.id = i.service_id
       WHERE i.service_id = ? AND i.scenario = ? AND UPPER(i.country_code) = ?
       ORDER BY i.sort_order ASC, i.id ASC LIMIT 1`,
        [service.id, scenario, country]
      )
    : null;
  if (exact) return exact;
  return await queryOne(
    `SELECT i.*, s.warning_window_days, s.repeat_interval_hours
     FROM reseller_expiry_media_items i
     INNER JOIN reseller_expiry_media_services s ON s.id = i.service_id
     WHERE i.service_id = ? AND i.scenario = ? AND (i.country_code = '' OR i.country_code IS NULL)
     ORDER BY i.sort_order ASC, i.id ASC LIMIT 1`,
    [service.id, scenario]
  );
}

async function touchLineExpirationMedia(
  lineId,
  at = Math.floor(Date.now() / 1000)
) {
  await execute('UPDATE `lines` SET last_expiration_video = ? WHERE id = ?', [
    unixSecondsToMysqlDatetime(at),
    lineId,
  ]);
}

// ─── Credits Logs ────────────────────────────────────────────────────

async function addCreditLog(targetId, adminId, amount, reason) {
  await execute(
    'INSERT INTO credits_logs (target_id, admin_id, amount, date, reason) VALUES (?, ?, ?, ?, ?)',
    [
      targetId,
      adminId,
      amount,
      unixSecondsToMysqlDatetime(Math.floor(Date.now() / 1000)),
      reason || '',
    ]
  );
}

async function getCreditLogs(targetId, limit = 100) {
  const rows = await query(
    'SELECT id, target_id, admin_id, amount, date, reason FROM credits_logs WHERE target_id = ? ORDER BY id DESC LIMIT ?',
    [targetId, limit]
  );
  return rows.map((row) => ({
    ...row,
    date: mysqlDatetimeToUnixSeconds(row.date),
  }));
}

// ─── API Keys ────────────────────────────────────────────────────────

async function createApiKey(userId, label) {
  const plain = `wm_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = await hashApiKey(plain);
  const keyPrefix = plain.slice(0, 12);
  const id = await insert(
    'INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)',
    [userId, keyHash, keyPrefix, label || 'Extension']
  );
  return { id, plain, keyPrefix };
}

async function listApiKeys(userId) {
  return await query(
    'SELECT id, key_prefix, label, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY id DESC',
    [userId]
  );
}

async function deleteApiKey(id, userId) {
  return await remove('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);
}

async function resolveApiKey(plain) {
  if (!plain || typeof plain !== 'string') return null;
  const trimmed = plain.trim();
  const keyPrefix = trimmed.slice(0, 12);
  // Fetch candidates by prefix to avoid comparing all keys
  const candidates = await query(
    'SELECT * FROM api_keys WHERE key_prefix = ?',
    [keyPrefix]
  );
  for (const row of candidates) {
    if (await verifyApiKey(trimmed, row.key_hash)) {
      await execute('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [
        row.id,
      ]);
      return row;
    }
  }
  return null;
}

// ─── Lines (subscribers) ─────────────────────────────────────────────
// (Functions moved to repositories/lineRepository.js)

// ─── Channels, Channel Health, QoE, Categories, Bouquets ─────────────
// (Functions moved to repositories/channelRepository.js, categoryRepository.js, bouquetRepository.js)

// ─── Packages, EPG, Security, Panel Logs, Streams ──────────────────
// (Functions moved to repositories/)

// ─── Seed (run once on fresh database) ───────────────────────────────
// seedDefaults moved to scripts/seed.js

const { seedDefaults } = require('../scripts/seed');

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  hashApiKey,
  seedDefaults,

  getSetting,
  setSetting,
  getAllSettings,

  createUser,
  findUserByUsername,
  findUserById,
  getAllUsers,
  userCount,
  verifyPassword,
  updateUser,
  deleteUser,
  touchUserLastLogin,
  getUserGroup,
  isAdmin,
  isReseller,
  getFirstAdminUserId,
  ensureUserMetaTable,
  getUserMeta,
  setUserMeta,
  listUserMetaMap,
  migrateLegacyUserMetaFromJson,
  hashLinePassword,
  verifyLinePasswordHash,
  verifyLinePassword,
  encryptLinePassword,
  attachLinePassword,

  listUserGroups,
  getUserGroupById,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,

  addCreditLog,
  getCreditLogs,

  listResellerPackageOverrides,
  getResellerPackageOverride,
  replaceResellerPackageOverrides,
  listResellerExpiryMediaServices,
  getResellerExpiryMediaServiceById,
  getResellerExpiryMediaServiceByUserId,
  createResellerExpiryMediaService,
  updateResellerExpiryMediaService,
  deleteResellerExpiryMediaService,
  listResellerExpiryMediaItems,
  replaceResellerExpiryMediaItems,
  getMatchingResellerExpiryMedia,
  touchLineExpirationMedia,

  createApiKey,
  listApiKeys,
  deleteApiKey,
  resolveApiKey,

  createLine,
  getLineById,
  getLineByUsername,
  getLineByAccessToken,
  listLines,
  lineCount,
  updateLine,
  deleteLine,
  deleteExpiredLines,
  updateLineActivity,
  getActiveConnections,
  addLiveConnection,
  removeLiveConnection,
  clearStaleLiveConnections,
  countLiveConnections,
  writeActivityHistory,

  insertChannel,
  updateChannelRow,
  deleteChannelRow,
  listChannelRowsForUser,
  listAllChannelRows,
  listAllLiveChannelIds,

  upsertChannelHealth,
  getChannelHealth,
  insertQoeMetric,
  getQoeHistory,
  getQoeAgg,
  upsertQoeAgg,

  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,

  listBouquets,
  getBouquetById,
  getBouquetsByIds,
  createBouquet,
  updateBouquet,
  deleteBouquet,

  listPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,

  listMovies,
  getMovieById,
  movieCount,
  createMovie,
  updateMovie,
  deleteMovie,
  listAllMovieStreamUrls,
  listAllMovieIds,

  listSeries,
  getSeriesById,
  seriesCount,
  createSeries,
  updateSeriesRow,
  deleteSeries,
  listAllSeriesTitles,
  listAllSeriesIds,

  listEpisodes,
  listAllEpisodes,
  getEpisodeById,
  createEpisode,
  updateEpisode,
  deleteEpisode,
  getEffectiveEpisodeServerId,

  listEpgSources,
  createEpgSource,
  deleteEpgSource,
  updateEpgSourceTimestamp,
  clearEpgData,
  insertEpgProgram,
  insertEpgBatch,
  getEpgForChannel,
  getShortEpg,
  getAllEpgData,

  listBlockedIps,
  addBlockedIp,
  removeBlockedIp,
  isIpBlocked,
  listBlockedUas,
  addBlockedUa,
  removeBlockedUa,
  isUaBlocked,
  listBlockedIsps,
  addBlockedIsp,
  removeBlockedIsp,
  recordAuthAttempt,
  getAuthAttempts,
  cleanOldAuthFlood,

  addPanelLog,
  getPanelLogs,

  listOutputFormats,

  listStreamArguments,

  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,

  insertAuditLog,
  listAuditLogs,

  ensureLinePasswordSecurityColumns,
  migrateLegacyLinePasswords,
  countIncompleteLinePasswordSecurityRows,
  dropLegacyLinePasswordColumnIfSafe,

  listAccessCodes,
  getAccessCodeByCode,
  getAccessCodeById,
  createAccessCode,
  updateAccessCode,
  deleteAccessCode,
  touchAccessCodeUsage,

  ensureServerRelationshipsTable,
  ensureStreamServerPlacementTable,
  ensureLineRuntimeSessionsTable,
  ensureServerCommandsTable,
  ensureServerAgentCredentialsTable,
  ensureServerProvisioningJobsTable,
  ensureStreamingServersTables,
  addServerRelationship,
  removeServerRelationship,
  getServerRelationships,
  getServerChildren,
  createPlacement,
  updatePlacementClients,
  getPlacement,
  getActivePlacementsForServer,
  upsertPlacementRuntimeState,
  setPlacementDesiredState,
  markPlacementStarting,
  markPlacementRunning,
  markPlacementStopped,
  markPlacementError,
  getPlacementByAsset,
  getPlacementsByServer,
  reportPlacementRuntimeFromNode,
  openRuntimeSession,
  touchRuntimeSession,
  closeRuntimeSession,
  listActiveRuntimeSessionsByServer,
  countActiveRuntimeSessionsByPlacement,
  countActiveRuntimeSessionsByServer,
  getFailoverRelationships,
  getProxyRelationships,
  getOriginServersForProxy,
  reconcilePlacementClients,
  reconcileAllPlacementClients,
  cleanStaleRuntimeSessions,
  createServerCommand,
  leaseServerCommands,
  markServerCommandRunning,
  markServerCommandSucceeded,
  markServerCommandFailed,
  expireStaleLeases,
  createServerAgentCredential,
  getActiveServerAgentCredential,
  getServerAgentCredentialForValidation,
  revokeServerAgentCredential,
  touchServerAgentCredential,
  rotateServerAgentCredential,
  getValidServerCredentials,
  revokeRotatingCredentials,

  listImportProviders,
  getImportProviderById,
  createImportProvider,
  updateImportProvider,
  deleteImportProvider,
};
