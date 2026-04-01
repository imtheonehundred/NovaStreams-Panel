'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, queryOne, insert, update, remove, execute } = require('./mariadb');
const { toMysqlDatetimeUtc, sanitizeSqlParams } = require('./mysql-datetime');

function hashApiKey(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

function clampPagination(limit, offset, maxLimit = 100) {
  let l = parseInt(limit, 10) || 50;
  let o = parseInt(offset, 10) || 0;
  if (l < 1) l = 1;
  if (l > maxLimit) l = maxLimit;
  if (o < 0) o = 0;
  return { limit: l, offset: o };
}

const RELEASE_DATE_MAX_LEN = 255;

/** Xtream/API release strings can exceed legacy VARCHAR(20); keep DB-safe. */
function sanitizeReleaseDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return s.length > RELEASE_DATE_MAX_LEN ? s.slice(0, RELEASE_DATE_MAX_LEN) : s;
}

function getLinePasswordSecretMaterial() {
  const secret = String(process.env.LINE_PASSWORD_SECRET || '').trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LINE_PASSWORD_SECRET is required for line password crypto in production');
  }
  return 'dev-line-password-secret';
}

function getLinePasswordCryptoKey() {
  return crypto.createHash('sha256').update(getLinePasswordSecretMaterial(), 'utf8').digest();
}

async function hashLinePassword(plain) {
  return await bcrypt.hash(String(plain), 12);
}

async function verifyLinePasswordHash(plain, passwordHash) {
  if (!passwordHash) return false;
  return await bcrypt.compare(String(plain), String(passwordHash));
}

async function verifyLinePassword(lineRow, plain) {
  return await verifyLinePasswordHash(plain, lineRow && lineRow.password_hash);
}

function encryptLinePassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getLinePasswordCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptLinePassword(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getLinePasswordCryptoKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function attachLinePassword(row) {
  if (!row) return null;
  const next = { ...row };
  next.password = decryptLinePassword(next.password_enc);
  return next;
}

// ─── Settings ────────────────────────────────────────────────────────

async function getSetting(key) {
  const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return row ? row.value : '';
}

async function setSetting(key, value) {
  await execute(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, String(value)]
  );
}

async function getAllSettings() {
  const rows = await query('SELECT `key`, `value` FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// ─── Panel Users (admin/reseller) ────────────────────────────────────

async function createUser(username, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  return await insert('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
}

async function findUserByUsername(username) {
  return await queryOne('SELECT id, username, password_hash, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, api_key, last_login, created_at FROM users WHERE username = ?', [username]);
}

async function findUserById(id) {
  return await queryOne('SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, last_login, created_at FROM users WHERE id = ?', [id]);
}

async function getAllUsers() {
  return await query('SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, last_login, created_at FROM users');
}

async function userCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM users');
  return row.c;
}

async function verifyPassword(userRow, password) {
  return await bcrypt.compare(password, userRow.password_hash);
}

async function updateUser(id, fields) {
  const allowed = ['email', 'notes', 'member_group_id', 'credits', 'status', 'reseller_dns', 'owner_id', 'theme', 'lang'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(fields[k]); }
  }
  if (fields.password) {
    sets.push('password_hash = ?');
    vals.push(await bcrypt.hash(fields.password, 12));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function touchUserLastLogin(id, at = Math.floor(Date.now() / 1000)) {
  await execute('UPDATE users SET last_login = ? WHERE id = ?', [at, id]);
}

async function deleteUser(id) {
  return await remove('DELETE FROM users WHERE id = ?', [id]);
}

async function getUserGroup(userId) {
  const u = await queryOne('SELECT member_group_id FROM users WHERE id = ?', [userId]);
  if (!u) return null;
  return await queryOne('SELECT * FROM user_groups WHERE group_id = ?', [u.member_group_id]);
}

async function isAdmin(userId) {
  const g = await getUserGroup(userId);
  return g && g.is_admin === 1;
}

async function isReseller(userId) {
  const g = await getUserGroup(userId);
  return g && g.is_reseller === 1;
}

// ─── User Groups ─────────────────────────────────────────────────────

async function listUserGroups() {
  return await query('SELECT * FROM user_groups ORDER BY group_id');
}

async function getUserGroupById(id) {
  return await queryOne('SELECT * FROM user_groups WHERE group_id = ?', [id]);
}

async function createUserGroup(data) {
  return await insert(
    'INSERT INTO user_groups (group_name, is_admin, is_reseller, allowed_pages) VALUES (?, ?, ?, ?)',
    [data.group_name || 'New Group', data.is_admin || 0, data.is_reseller || 0, data.allowed_pages || '[]']
  );
}

async function updateUserGroup(id, data) {
  const allowed = ['group_name', 'is_admin', 'is_reseller', 'total_allowed_gen_trials', 'total_allowed_gen_in', 'delete_users', 'allowed_pages', 'can_delete', 'create_sub_resellers', 'create_sub_resellers_price', 'allow_change_bouquets', 'allow_download', 'allow_restrictions', 'allow_change_username', 'allow_change_password', 'minimum_trial_credits', 'notice_html', 'manage_expiry_media'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE user_groups SET ${sets.join(', ')} WHERE group_id = ?`, vals);
}

async function deleteUserGroup(id) {
  return await remove('DELETE FROM user_groups WHERE group_id = ?', [id]);
}

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
  await execute('DELETE FROM reseller_package_overrides WHERE user_id = ?', [userId]);
  for (const row of rows || []) {
    await execute(
      `INSERT INTO reseller_package_overrides (user_id, package_id, trial_credits_override, official_credits_override, enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        row.package_id,
        row.trial_credits_override != null ? row.trial_credits_override : null,
        row.official_credits_override != null ? row.official_credits_override : null,
        row.enabled !== undefined ? row.enabled : 1,
      ]
    );
  }
}

async function listResellerExpiryMediaServices(rawLimit = 50, rawOffset = 0, search = '') {
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
  const totalRow = search ? await queryOne(countSql, [term, term]) : await queryOne(countSql);
  const rows = search ? await query(rowsSql, [term, term, limit, offset]) : await query(rowsSql, [limit, offset]);
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
  for (const key of ['active', 'warning_window_days', 'repeat_interval_hours']) {
    if (data[key] !== undefined) {
      sets.push(`\`${key}\` = ?`);
      vals.push(data[key]);
    }
  }
  if (sets.length) {
    vals.push(id);
    await execute(`UPDATE reseller_expiry_media_services SET ${sets.join(', ')} WHERE id = ?`, vals);
  }
  return await getResellerExpiryMediaServiceById(id);
}

async function deleteResellerExpiryMediaService(id) {
  return await remove('DELETE FROM reseller_expiry_media_services WHERE id = ?', [id]);
}

async function listResellerExpiryMediaItems(serviceId) {
  return await query(
    `SELECT id, service_id, scenario, country_code, media_type, media_url, sort_order
     FROM reseller_expiry_media_items WHERE service_id = ? ORDER BY scenario ASC, sort_order ASC, id ASC`,
    [serviceId]
  );
}

async function replaceResellerExpiryMediaItems(serviceId, rows) {
  await execute('DELETE FROM reseller_expiry_media_items WHERE service_id = ?', [serviceId]);
  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i] || {};
    await execute(
      `INSERT INTO reseller_expiry_media_items (service_id, scenario, country_code, media_type, media_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        serviceId,
        row.scenario,
        String(row.country_code || '').trim().toUpperCase(),
        row.media_type || 'video',
        String(row.media_url || '').trim(),
        row.sort_order != null ? row.sort_order : i,
      ]
    );
  }
}

async function getMatchingResellerExpiryMedia(userId, scenario, countryCode = '') {
  const service = await getResellerExpiryMediaServiceByUserId(userId);
  if (!service || Number(service.active) !== 1) return null;
  const country = String(countryCode || '').trim().toUpperCase();
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

async function touchLineExpirationMedia(lineId, at = Math.floor(Date.now() / 1000)) {
  await execute('UPDATE `lines` SET last_expiration_video = ? WHERE id = ?', [at, lineId]);
}

// ─── Credits Logs ────────────────────────────────────────────────────

async function addCreditLog(targetId, adminId, amount, reason) {
  await execute(
    'INSERT INTO credits_logs (target_id, admin_id, amount, date, reason) VALUES (?, ?, ?, ?, ?)',
    [targetId, adminId, amount, Math.floor(Date.now() / 1000), reason || '']
  );
}

async function getCreditLogs(targetId, limit = 100) {
  return await query('SELECT id, target_id, admin_id, amount, date, reason FROM credits_logs WHERE target_id = ? ORDER BY id DESC LIMIT ?', [targetId, limit]);
}

// ─── API Keys ────────────────────────────────────────────────────────

async function createApiKey(userId, label) {
  const plain = `wm_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = hashApiKey(plain);
  const keyPrefix = plain.slice(0, 12);
  const id = await insert('INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)', [userId, keyHash, keyPrefix, label || 'Extension']);
  return { id, plain, keyPrefix };
}

async function listApiKeys(userId) {
  return await query('SELECT id, key_prefix, label, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY id DESC', [userId]);
}

async function deleteApiKey(id, userId) {
  return await remove('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, userId]);
}

async function resolveApiKey(plain) {
  if (!plain || typeof plain !== 'string') return null;
  const keyHash = hashApiKey(plain.trim());
  const row = await queryOne('SELECT * FROM api_keys WHERE key_hash = ?', [keyHash]);
  if (!row) return null;
  await execute('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [row.id]);
  return row;
}

// ─── Lines (subscribers) ─────────────────────────────────────────────

async function createLine(data) {
  const plainPassword = String(data.password || '');
  const passwordHash = await hashLinePassword(plainPassword);
  const passwordEnc = encryptLinePassword(plainPassword);
  return await insert(
    `INSERT INTO \`lines\` (username, password, password_hash, password_enc, member_id, exp_date, admin_enabled, enabled, bouquet, allowed_outputs, max_connections, is_trial, is_mag, is_e2, is_restreamer, allowed_ips, allowed_ua, forced_country, is_isplock, package_id, contact, force_server_id, bypass_ua, access_token, created_at, admin_notes, reseller_notes, is_stalker)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.username, '', passwordHash, passwordEnc,
      data.member_id || null, data.exp_date || null,
      data.admin_enabled !== undefined ? data.admin_enabled : 1,
      data.enabled !== undefined ? data.enabled : 1,
      JSON.stringify(data.bouquet || []),
      JSON.stringify(data.allowed_outputs || []),
      data.max_connections || 1,
      data.is_trial || 0, data.is_mag || 0, data.is_e2 || 0, data.is_restreamer || 0,
      JSON.stringify(data.allowed_ips || []),
      JSON.stringify(data.allowed_ua || []),
      data.forced_country || '', data.is_isplock || 0,
      data.package_id || null, data.contact || '',
      data.force_server_id || 0, data.bypass_ua || 0,
      data.access_token || crypto.randomBytes(16).toString('hex'),
      Math.floor(Date.now() / 1000),
      data.admin_notes || '',
      data.reseller_notes || '',
      data.is_stalker || 0,
    ]
  );
}

async function getLineById(id) {
  return await queryOne('SELECT * FROM `lines` WHERE id = ?', [id]);
}

async function getLineByUsername(username) {
  return await queryOne('SELECT * FROM `lines` WHERE username = ?', [username]);
}

async function listLines(memberId, rawLimit, rawOffset) {
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  if (memberId !== undefined && memberId !== null) {
      const total = (await queryOne('SELECT COUNT(*) AS c FROM `lines` WHERE member_id = ?', [memberId])).c;
      const rows = await query(
      'SELECT id, username, password, password_hash, password_enc, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact, force_server_id, package_id FROM `lines` WHERE member_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [memberId, limit, offset]
    );
    return { lines: rows, total };
  }
  const total = (await queryOne('SELECT COUNT(*) AS c FROM `lines`')).c;
  const rows = await query(
    'SELECT id, username, password, password_hash, password_enc, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact, force_server_id, package_id FROM `lines` ORDER BY id DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return { lines: rows, total };
}

async function lineCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM `lines`');
  return row.c;
}

async function updateLine(id, data) {
  const allowed = ['exp_date', 'admin_enabled', 'enabled', 'admin_notes', 'reseller_notes', 'bouquet', 'allowed_outputs', 'max_connections', 'is_trial', 'is_mag', 'is_e2', 'is_stalker', 'is_restreamer', 'allowed_ips', 'allowed_ua', 'forced_country', 'is_isplock', 'package_id', 'contact', 'force_server_id', 'bypass_ua'];
  const sets = [];
  const vals = [];
  if (data.password !== undefined) {
    const plainPassword = String(data.password || '');
    sets.push('`password` = ?');
    vals.push('');
    sets.push('`password_hash` = ?');
    vals.push(await hashLinePassword(plainPassword));
    sets.push('`password_enc` = ?');
    vals.push(encryptLinePassword(plainPassword));
  }
  for (const k of allowed) {
    if (data[k] !== undefined) {
      if (['bouquet', 'allowed_outputs', 'allowed_ips', 'allowed_ua'].includes(k)) {
        sets.push(`\`${k}\` = ?`);
        vals.push(JSON.stringify(data[k]));
      } else {
        sets.push(`\`${k}\` = ?`);
        vals.push(data[k]);
      }
    }
  }
  if (data.username !== undefined) { sets.push('username = ?'); vals.push(data.username); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE \`lines\` SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function ensureLinePasswordSecurityColumns() {
  const cols = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lines' AND COLUMN_NAME IN ('password_hash', 'password_enc')`
  );
  const present = new Set((cols || []).map((row) => String(row.COLUMN_NAME || row.column_name || '')));
  if (!present.has('password_hash')) {
    await execute('ALTER TABLE `lines` ADD COLUMN `password_hash` VARCHAR(255) NULL AFTER `password`');
  }
  if (!present.has('password_enc')) {
    await execute('ALTER TABLE `lines` ADD COLUMN `password_enc` TEXT NULL AFTER `password_hash`');
  }
}

async function migrateLegacyLinePasswords() {
  const rows = await query(
    `SELECT id, password, password_hash, password_enc FROM \`lines\`
     WHERE (password IS NOT NULL AND password <> '')
        OR password_hash IS NULL OR password_hash = ''
        OR password_enc IS NULL OR password_enc = ''`
  );
  for (const row of rows || []) {
    const legacyPassword = String(row.password || '');
    const recoveredPassword = legacyPassword || decryptLinePassword(row.password_enc);
    if (!recoveredPassword) continue;
    const existingHash = row.password_hash ? String(row.password_hash) : '';
    const existingEnc = row.password_enc ? String(row.password_enc) : '';
    const hashMatchesLegacy = existingHash ? await verifyLinePasswordHash(recoveredPassword, existingHash) : false;
    const encMatchesLegacy = existingEnc ? decryptLinePassword(existingEnc) === recoveredPassword : false;
    const nextHash = hashMatchesLegacy ? existingHash : await hashLinePassword(recoveredPassword);
    const nextEnc = encMatchesLegacy ? existingEnc : encryptLinePassword(recoveredPassword);
    await execute(
      'UPDATE `lines` SET password = ?, password_hash = ?, password_enc = ? WHERE id = ?',
      ['', nextHash, nextEnc, row.id]
    );
  }
}

async function deleteLine(id) {
  return await remove('DELETE FROM `lines` WHERE id = ?', [id]);
}

async function deleteExpiredLines(cutoffTs = Math.floor(Date.now() / 1000)) {
  const result = await execute(
    'DELETE FROM `lines` WHERE exp_date IS NOT NULL AND exp_date < ?',
    [cutoffTs]
  );
  return result.affectedRows || 0;
}

async function updateLineActivity(id, ip) {
  await execute('UPDATE `lines` SET last_ip = ?, last_activity = ? WHERE id = ?', [ip || '', Math.floor(Date.now() / 1000), id]);
}

// Connection tracking stubs - actual tracking is in Redis (see lib/redis.js / services/lineService.js)
async function getActiveConnections(userId) { return []; }
async function addLiveConnection(data) { return 0; }
async function removeLiveConnection(activityId) { return false; }
async function clearStaleLiveConnections() { return 0; }
async function countLiveConnections(userId) { return 0; }

async function writeActivityHistory(data) {
  await execute(
    'INSERT INTO lines_activity (user_id, stream_id, server_id, user_agent, user_ip, container, date_start, date_end, geoip_country_code, isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [data.user_id, data.stream_id || 0, data.server_id || 0, data.user_agent || '', data.user_ip || '', data.container || '', data.date_start, data.date_end || Math.floor(Date.now() / 1000), data.geoip_country_code || '', data.isp || '']
  );
}

// ─── Channels (restream engine) ──────────────────────────────────────

function stripVolatile(ch) {
  const o = { ...ch };
  delete o.userId;
  o.status = 'stopped';
  o.hlsUrl = null;
  o.error = null;
  return o;
}

async function insertChannel(id, userId, channel) {
  const nowIso = new Date().toISOString();
  const createdAtIso = channel.createdAt || nowIso;
  const forDb = stripVolatile({ ...channel, createdAt: createdAtIso });
  const createdAtDb = toMysqlDatetimeUtc(createdAtIso);
  const nowDb = toMysqlDatetimeUtc(nowIso);
  await execute('INSERT INTO channels (id, user_id, json_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, userId, JSON.stringify(forDb), createdAtDb, nowDb]);
}

async function updateChannelRow(id, userId, channel) {
  const nowDb = toMysqlDatetimeUtc(new Date());
  const prev = await queryOne('SELECT json_data FROM channels WHERE id = ? AND user_id = ?', [id, userId]);
  if (!prev) return false;
  const merged = { ...JSON.parse(prev.json_data), ...channel };
  const forDb = stripVolatile(merged);
  await execute('UPDATE channels SET json_data = ?, updated_at = ? WHERE id = ? AND user_id = ?', [JSON.stringify(forDb), nowDb, id, userId]);
  return true;
}

async function deleteChannelRow(id, userId) {
  return await remove('DELETE FROM channels WHERE id = ? AND user_id = ?', [id, userId]);
}

async function listChannelRowsForUser(userId) {
  return await query('SELECT id, user_id, json_data FROM channels WHERE user_id = ?', [userId]);
}

async function listAllChannelRows() {
  return await query('SELECT id, user_id, json_data FROM channels');
}

// ─── Channel Health ──────────────────────────────────────────────────

async function upsertChannelHealth(channelId, userId, score, statusText, meta) {
  const st = Math.max(0, Math.min(100, parseInt(score, 10) || 0));
  const nowDb = toMysqlDatetimeUtc(new Date());
  const metaJson = JSON.stringify(meta || {});
  await execute(
    `INSERT INTO channel_health (channel_id, user_id, stability_score, last_checked, status_text, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stability_score = VALUES(stability_score), last_checked = VALUES(last_checked), status_text = VALUES(status_text), meta_json = VALUES(meta_json)`,
    [channelId, userId, st, nowDb, statusText || 'Stable', metaJson]
  );
  return { stability_score: st, last_checked: nowDb, status_text: statusText || 'Stable', meta_json: metaJson };
}

async function getChannelHealth(channelId, userId) {
  return await queryOne('SELECT channel_id, stability_score, last_checked, status_text, meta_json FROM channel_health WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
}

// ─── QoE ─────────────────────────────────────────────────────────────

async function insertQoeMetric(row) {
  await execute(
    'INSERT INTO qoe_metrics (channel_id, user_id, startup_ms, buffer_events, buffer_duration_ms, errors, latency_ms, bitrate_switches, dropped_frames, playback_ms, qoe_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [row.channel_id, row.user_id, row.startup_ms, row.buffer_events, row.buffer_duration_ms, row.errors, row.latency_ms, row.bitrate_switches, row.dropped_frames, row.playback_ms, row.qoe_score]
  );
}

async function getQoeHistory(channelId, userId, limit = 60) {
  return await query('SELECT created_at, startup_ms, buffer_events, buffer_duration_ms, errors, latency_ms, qoe_score FROM qoe_metrics WHERE channel_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?', [channelId, userId, limit]);
}

async function getQoeAgg(channelId, userId) {
  return await queryOne('SELECT channel_id, last_qoe_at, qoe_score, final_score, avg_startup_ms, avg_buffer_ratio, avg_latency_ms FROM qoe_agg WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
}

async function upsertQoeAgg(channelId, userId, data) {
  await execute(
    `INSERT INTO qoe_agg (channel_id, user_id, last_qoe_at, qoe_score, final_score, avg_startup_ms, avg_buffer_ratio, avg_latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_qoe_at = VALUES(last_qoe_at), qoe_score = VALUES(qoe_score), final_score = VALUES(final_score), avg_startup_ms = VALUES(avg_startup_ms), avg_buffer_ratio = VALUES(avg_buffer_ratio), avg_latency_ms = VALUES(avg_latency_ms)`,
    [channelId, userId, data.last_qoe_at, data.qoe_score, data.final_score, data.avg_startup_ms, data.avg_buffer_ratio, data.avg_latency_ms]
  );
}

// ─── Categories ──────────────────────────────────────────────────────

async function listCategories(type) {
  if (type) return await query('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories WHERE category_type = ? ORDER BY cat_order, id', [type]);
  return await query('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories ORDER BY cat_order, id');
}

async function getCategoryById(id) {
  return await queryOne('SELECT * FROM stream_categories WHERE id = ?', [id]);
}

async function createCategory(data) {
  return await insert(
    'INSERT INTO stream_categories (category_type, category_name, parent_id, cat_order, is_adult) VALUES (?, ?, ?, ?, ?)',
    [data.category_type || 'live', data.category_name || 'New', data.parent_id || 0, data.cat_order || 0, data.is_adult || 0]
  );
}

async function updateCategory(id, data) {
  const sets = [];
  const vals = [];
  for (const k of ['category_type', 'category_name', 'parent_id', 'cat_order', 'is_adult']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE stream_categories SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteCategory(id) {
  return await remove('DELETE FROM stream_categories WHERE id = ?', [id]);
}

// ─── Bouquets ────────────────────────────────────────────────────────

async function listBouquets() {
  return await query('SELECT * FROM bouquets ORDER BY bouquet_order, id');
}

async function getBouquetById(id) {
  return await queryOne('SELECT * FROM bouquets WHERE id = ?', [id]);
}

async function getBouquetsByIds(ids) {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return await query(`SELECT * FROM bouquets WHERE id IN (${placeholders})`, ids);
}

async function createBouquet(data) {
  return await insert(
    'INSERT INTO bouquets (bouquet_name, bouquet_channels, bouquet_movies, bouquet_radios, bouquet_series, bouquet_order) VALUES (?, ?, ?, ?, ?, ?)',
    [
      data.bouquet_name || 'New Bouquet',
      JSON.stringify(data.bouquet_channels || []),
      JSON.stringify(data.bouquet_movies || []),
      JSON.stringify(data.bouquet_radios || []),
      JSON.stringify(data.bouquet_series || []),
      data.bouquet_order || 0
    ]
  );
}

async function updateBouquet(id, data) {
  const sets = [];
  const vals = [];
  for (const k of ['bouquet_name', 'bouquet_order']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  for (const k of ['bouquet_channels', 'bouquet_movies', 'bouquet_radios', 'bouquet_series']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(JSON.stringify(data[k])); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE bouquets SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteBouquet(id) {
  return await remove('DELETE FROM bouquets WHERE id = ?', [id]);
}

// ─── Packages ────────────────────────────────────────────────────────

async function listPackages() {
  return await query('SELECT * FROM packages ORDER BY id');
}

async function getPackageById(id) {
  return await queryOne('SELECT * FROM packages WHERE id = ?', [id]);
}

async function createPackage(data) {
  return await insert(
    `INSERT INTO packages (package_name, is_trial, is_official, trial_credits, official_credits, trial_duration, trial_duration_in, official_duration, official_duration_in, groups_json, bouquets_json, output_formats_json, options_json, max_connections, forced_country, is_line, is_mag, is_e2, is_restreamer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.package_name || 'New Package',
      data.is_trial || 0, data.is_official || 1,
      data.trial_credits || 0, data.official_credits || 0,
      data.trial_duration || 0, data.trial_duration_in || 'day',
      data.official_duration || 30, data.official_duration_in || 'month',
      JSON.stringify(data.groups || []),
      JSON.stringify(data.bouquets || []),
      JSON.stringify(data.output_formats || []),
      JSON.stringify(data.options != null ? data.options : {}),
      data.max_connections || 1,
      data.forced_country || '',
      data.is_line !== undefined ? data.is_line : 1,
      data.is_mag || 0, data.is_e2 || 0, data.is_restreamer || 0
    ]
  );
}

async function updatePackage(id, data) {
  const simple = ['package_name', 'is_trial', 'is_official', 'trial_credits', 'official_credits', 'trial_duration', 'trial_duration_in', 'official_duration', 'official_duration_in', 'max_connections', 'forced_country', 'is_line', 'is_mag', 'is_e2', 'is_restreamer'];
  const json = ['groups', 'bouquets', 'output_formats'];
  const sets = [];
  const vals = [];
  for (const k of simple) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  for (const k of json) {
    if (data[k] !== undefined) { sets.push(`${k}_json = ?`); vals.push(JSON.stringify(data[k])); }
  }
  if (data.options !== undefined) {
    sets.push('options_json = ?');
    vals.push(JSON.stringify(data.options));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE packages SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deletePackage(id) {
  return await remove('DELETE FROM packages WHERE id = ?', [id]);
}

// ─── Movies ──────────────────────────────────────────────────────────

const MOVIE_LIST_COLS = 'id, name, stream_icon, category_id, rating, rating_5based, year, tmdb_id, container_extension, stream_server_id, added';

async function listMovies(categoryId, rawLimit, rawOffset, search, sortOrder) {
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  const orderDir = sortOrder === 'id_asc' ? 'ASC' : 'DESC';
  const where = [];
  const params = [];
  if (categoryId) {
    where.push('category_id = ?');
    params.push(String(categoryId));
  }
  const q = search && String(search).trim();
  if (q) {
    where.push('name LIKE ?');
    params.push(`%${q}%`);
  }
  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await queryOne(`SELECT COUNT(*) AS c FROM movies ${whereStr}`, params)).c;
  const rows = await query(
    `SELECT ${MOVIE_LIST_COLS} FROM movies ${whereStr} ORDER BY id ${orderDir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { movies: rows, total };
}

async function getMovieById(id) {
  return await queryOne('SELECT * FROM movies WHERE id = ?', [id]);
}

async function movieCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM movies');
  return row.c;
}

async function createMovie(data) {
  const ssid = parseInt(data.stream_server_id, 10);
  return await insert(
    `INSERT INTO movies (name, stream_url, stream_source, category_id, stream_icon, rating, rating_5based, plot, movie_cast, director, genre, duration, duration_secs, container_extension, movie_properties, tmdb_id, backdrop_path, year, subtitles_json, release_date, youtube_trailer, country, similar, stream_server_id, added)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name || '', data.stream_url || '', data.stream_source || '',
      data.category_id || '', data.stream_icon || '',
      data.rating || '0', data.rating_5based || 0,
      data.plot || '', data.movie_cast || '', data.director || '', data.genre || '',
      data.duration || '', data.duration_secs || 0,
      data.container_extension || 'mp4',
      JSON.stringify(data.movie_properties || {}),
      data.tmdb_id || null, data.backdrop_path || '',
      data.year || null, JSON.stringify(data.subtitles || []),
      sanitizeReleaseDate(data.release_date), data.youtube_trailer || '',
      data.country || '', JSON.stringify(data.similar || []),
      Number.isFinite(ssid) && ssid > 0 ? ssid : 0,
      data.added || Math.floor(Date.now() / 1000)
    ]
  );
}

async function updateMovie(id, data) {
  const cols = ['name', 'stream_url', 'stream_source', 'category_id', 'stream_icon', 'rating', 'rating_5based', 'plot', 'movie_cast', 'director', 'genre', 'duration', 'duration_secs', 'container_extension', 'tmdb_id', 'backdrop_path', 'year', 'release_date', 'youtube_trailer', 'country', 'stream_server_id'];
  const sets = [];
  const vals = [];
  for (const k of cols) {
    if (data[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      if (k === 'stream_server_id') {
        const n = parseInt(data[k], 10);
        vals.push(Number.isFinite(n) && n > 0 ? n : 0);
      } else {
        vals.push(k === 'release_date' ? sanitizeReleaseDate(data[k]) : data[k]);
      }
    }
  }
  if (data.movie_properties !== undefined) { sets.push('movie_properties = ?'); vals.push(JSON.stringify(data.movie_properties)); }
  if (data.subtitles !== undefined) { sets.push('subtitles_json = ?'); vals.push(JSON.stringify(data.subtitles)); }
  if (data.similar !== undefined) { sets.push('similar = ?'); vals.push(JSON.stringify(data.similar)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE movies SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteMovie(id) {
  return await remove('DELETE FROM movies WHERE id = ?', [id]);
}

// ─── Series ──────────────────────────────────────────────────────────

const SERIES_LIST_COLS = 'id, title, cover, category_id, rating, rating_5based, year, tmdb_id, stream_server_id, seasons, last_modified';

async function listSeries(categoryId, rawLimit, rawOffset, search, sortOrder) {
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  const orderDir = sortOrder === 'id_asc' ? 'ASC' : 'DESC';
  const where = [];
  const params = [];
  if (categoryId) {
    where.push('category_id = ?');
    params.push(String(categoryId));
  }
  const q = search && String(search).trim();
  if (q) {
    where.push('title LIKE ?');
    params.push(`%${q}%`);
  }
  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await queryOne(`SELECT COUNT(*) AS c FROM series ${whereStr}`, params)).c;
  const rows = await query(
    `SELECT ${SERIES_LIST_COLS} FROM series ${whereStr} ORDER BY id ${orderDir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { series: rows, total };
}

async function getSeriesById(id) {
  return await queryOne('SELECT * FROM series WHERE id = ?', [id]);
}

async function seriesCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM series');
  return row.c;
}

async function createSeries(data) {
  const ssid = parseInt(data.stream_server_id, 10);
  return await insert(
    `INSERT INTO series (title, category_id, cover, cover_big, plot, series_cast, director, genre, rating, rating_5based, release_date, backdrop_path, year, youtube_trailer, episode_run_time, seasons, similar, stream_server_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title || '', data.category_id || '', data.cover || '', data.cover_big || '',
      data.plot || '', data.series_cast || '', data.director || '', data.genre || '',
      data.rating || '0', data.rating_5based || 0,
      sanitizeReleaseDate(data.release_date), data.backdrop_path || '',
      data.year || null, data.youtube_trailer || '', data.episode_run_time || 0,
      JSON.stringify(data.seasons || []), JSON.stringify(data.similar || []),
      Number.isFinite(ssid) && ssid > 0 ? ssid : 0,
    ]
  );
}

async function updateSeriesRow(id, data) {
  const cols = ['title', 'category_id', 'cover', 'cover_big', 'plot', 'series_cast', 'director', 'genre', 'rating', 'rating_5based', 'release_date', 'tmdb_id', 'backdrop_path', 'year', 'youtube_trailer', 'episode_run_time', 'stream_server_id'];
  const sets = [];
  const vals = [];
  for (const k of cols) {
    if (data[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      if (k === 'stream_server_id') {
        const n = parseInt(data[k], 10);
        vals.push(Number.isFinite(n) && n > 0 ? n : 0);
      } else {
        vals.push(k === 'release_date' ? sanitizeReleaseDate(data[k]) : data[k]);
      }
    }
  }
  if (data.seasons !== undefined) { sets.push('seasons = ?'); vals.push(JSON.stringify(data.seasons)); }
  if (data.similar !== undefined) { sets.push('similar = ?'); vals.push(JSON.stringify(data.similar)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE series SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteSeries(id) {
  await execute('DELETE FROM episodes WHERE series_id = ?', [id]);
  return await remove('DELETE FROM series WHERE id = ?', [id]);
}

// ─── Episodes ────────────────────────────────────────────────────────

async function listEpisodes(seriesId) {
  return await query('SELECT id, series_id, season_num, episode_num, title, stream_url, stream_source, container_extension, stream_server_id, added FROM episodes WHERE series_id = ? ORDER BY season_num, episode_num', [seriesId]);
}

async function listAllEpisodes(opts = {}) {
  const { search, series_id, limit: rawLimit, offset: rawOffset } = opts;
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  const where = [];
  const params = [];
  if (series_id) { where.push('e.series_id = ?'); params.push(series_id); }
  if (search) { where.push('(e.title LIKE ? OR s.title LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await queryOne(`SELECT COUNT(*) AS c FROM episodes e LEFT JOIN series s ON e.series_id = s.id ${whereStr}`, params);
  const rows = await query(`SELECT e.id, e.series_id, e.season_num, e.episode_num, e.title, e.stream_url, e.container_extension, e.stream_server_id, e.added, s.title AS series_title, s.cover AS series_cover FROM episodes e LEFT JOIN series s ON e.series_id = s.id ${whereStr} ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { episodes: rows, total: countRow.c };
}

async function getEpisodeById(id) {
  return await queryOne('SELECT * FROM episodes WHERE id = ?', [id]);
}

async function createEpisode(data) {
  const ssid = parseInt(data.stream_server_id, 10);
  return await insert(
    `INSERT INTO episodes (series_id, season_num, episode_num, title, stream_url, stream_source, direct_source, container_extension, info_json, movie_properties, movie_subtitles, stream_server_id, added)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.series_id, data.season_num || 1, data.episode_num || 1,
      data.title || '', data.stream_url || '', data.stream_source || '', data.direct_source || 0,
      data.container_extension || 'mp4',
      JSON.stringify(data.info || {}),
      JSON.stringify(data.movie_properties || {}),
      JSON.stringify(data.movie_subtitles || []),
      Number.isFinite(ssid) && ssid > 0 ? ssid : 0,
      data.added || Math.floor(Date.now() / 1000)
    ]
  );
}

async function updateEpisode(id, data) {
  const cols = ['series_id', 'season_num', 'episode_num', 'title', 'stream_url', 'stream_source', 'direct_source', 'container_extension'];
  const sets = [];
  const vals = [];
  for (const k of cols) { if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); } }
  if (data.stream_server_id !== undefined) {
    const n = parseInt(data.stream_server_id, 10);
    sets.push('`stream_server_id` = ?');
    vals.push(Number.isFinite(n) && n > 0 ? n : 0);
  }
  if (data.info !== undefined) { sets.push('info_json = ?'); vals.push(JSON.stringify(data.info)); }
  if (data.movie_properties !== undefined) { sets.push('movie_properties = ?'); vals.push(JSON.stringify(data.movie_properties)); }
  if (data.movie_subtitles !== undefined) { sets.push('movie_subtitles = ?'); vals.push(JSON.stringify(data.movie_subtitles)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteEpisode(id) {
  return await remove('DELETE FROM episodes WHERE id = ?', [id]);
}

/**
 * Resolve the effective stream_server_id for an episode.
 * Resolution order: episode override → series default → default_stream_server_id setting → 0
 * @param {number} episodeId
 * @returns {Promise<number>}
 */
async function getEffectiveEpisodeServerId(episodeId) {
  const ep = await queryOne('SELECT stream_server_id, series_id FROM episodes WHERE id = ?', [episodeId]);
  if (!ep) return 0;
  const epServer = parseInt(ep.stream_server_id, 10);
  if (epServer > 0) return epServer;
  const ser = await queryOne('SELECT stream_server_id FROM series WHERE id = ?', [ep.series_id]);
  if (ser) {
    const serServer = parseInt(ser.stream_server_id, 10);
    if (serServer > 0) return serServer;
  }
  const defRow = await queryOne("SELECT `value` FROM settings WHERE `key` = 'default_stream_server_id'");
  if (defRow) {
    const def = parseInt(defRow.value, 10);
    if (def > 0) return def;
  }
  return 0;
}

// ─── EPG ─────────────────────────────────────────────────────────────

async function listEpgSources() {
  return await query('SELECT * FROM epg_sources ORDER BY id');
}

async function createEpgSource(name, url) {
  return await insert('INSERT INTO epg_sources (name, url) VALUES (?, ?)', [name || '', url]);
}

async function deleteEpgSource(id) {
  return await remove('DELETE FROM epg_sources WHERE id = ?', [id]);
}

async function updateEpgSourceTimestamp(id) {
  await execute('UPDATE epg_sources SET last_updated = NOW() WHERE id = ?', [id]);
}

async function clearEpgData() {
  await execute('DELETE FROM epg_data');
}

async function insertEpgProgram(channelId, title, desc, start, stop, lang) {
  await execute('INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)', [channelId, title, desc || '', start, stop, lang || 'en']);
}

async function insertEpgBatch(programs) {
  if (!programs.length) return;
  const conn = require('./mariadb').getPool();
  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    for (const p of programs) {
      await c.execute(
        'INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)',
        sanitizeSqlParams([p.channel_id, p.title, p.description || '', p.start, p.stop, p.lang || 'en'])
      );
    }
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

async function getEpgForChannel(channelId, fromTs, toTs) {
  return await query('SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? AND start < ? ORDER BY start', [channelId, fromTs || 0, toTs || 9999999999]);
}

async function getShortEpg(channelId, limit = 4) {
  const now = Math.floor(Date.now() / 1000);
  return await query('SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? ORDER BY start LIMIT ?', [channelId, now, limit]);
}

async function getAllEpgData() {
  return await query('SELECT id, channel_id, title, description, start, stop, lang FROM epg_data ORDER BY start');
}

// ─── Security blocklists ─────────────────────────────────────────────

async function listBlockedIps() { return await query('SELECT * FROM blocked_ips ORDER BY id'); }
async function addBlockedIp(ip, notes) { return await insert('INSERT IGNORE INTO blocked_ips (ip, notes) VALUES (?, ?)', [ip, notes || '']); }
async function removeBlockedIp(id) { return await remove('DELETE FROM blocked_ips WHERE id = ?', [id]); }
async function isIpBlocked(ip) { return !!(await queryOne('SELECT 1 AS ok FROM blocked_ips WHERE ip = ?', [ip])); }

async function listBlockedUas() { return await query('SELECT * FROM blocked_uas ORDER BY id'); }
async function addBlockedUa(ua, notes) { return await insert('INSERT INTO blocked_uas (user_agent, notes) VALUES (?, ?)', [ua, notes || '']); }
async function removeBlockedUa(id) { return await remove('DELETE FROM blocked_uas WHERE id = ?', [id]); }
async function isUaBlocked(ua) {
  const rows = await query('SELECT user_agent FROM blocked_uas');
  for (const r of rows) {
    try { if (new RegExp(r.user_agent, 'i').test(ua)) return true; } catch { if (ua === r.user_agent) return true; }
  }
  return false;
}

async function listBlockedIsps() { return await query('SELECT * FROM blocked_isps ORDER BY id'); }
async function addBlockedIsp(isp, notes) { return await insert('INSERT INTO blocked_isps (isp, notes) VALUES (?, ?)', [isp, notes || '']); }
async function removeBlockedIsp(id) { return await remove('DELETE FROM blocked_isps WHERE id = ?', [id]); }

// ─── Auth flood ──────────────────────────────────────────────────────

async function recordAuthAttempt(ip, username) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await queryOne('SELECT id FROM auth_flood WHERE ip = ? AND username = ?', [ip, username || '']);
  if (existing) {
    await execute('UPDATE auth_flood SET attempts = attempts + 1, last_attempt = ? WHERE id = ?', [now, existing.id]);
  } else {
    await execute('INSERT INTO auth_flood (ip, username, attempts, last_attempt) VALUES (?, ?, 1, ?)', [ip, username || '', now]);
  }
}

async function getAuthAttempts(ip, windowSec) {
  const since = Math.floor(Date.now() / 1000) - (windowSec || 300);
  const row = await queryOne('SELECT SUM(attempts) AS total FROM auth_flood WHERE ip = ? AND last_attempt > ?', [ip, since]);
  return row ? (row.total || 0) : 0;
}

async function cleanOldAuthFlood(windowSec) {
  const before = Math.floor(Date.now() / 1000) - (windowSec || 600);
  await execute('DELETE FROM auth_flood WHERE last_attempt < ?', [before]);
}

// ─── Panel logs ──────────────────────────────────────────────────────

async function addPanelLog(userId, action, targetType, targetId, details) {
  await execute('INSERT INTO panel_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [userId || 0, action || '', targetType || '', String(targetId || ''), details || '']);
}

async function getPanelLogs(limit = 200) {
  return await query('SELECT id, user_id, action, target_type, target_id, details, created_at FROM panel_logs ORDER BY id DESC LIMIT ?', [limit]);
}

// ─── Output formats ──────────────────────────────────────────────────

async function listOutputFormats() {
  return await query('SELECT * FROM output_formats ORDER BY id');
}

// ─── Stream arguments ────────────────────────────────────────────────

async function listStreamArguments(cat) {
  if (cat) return await query('SELECT * FROM stream_arguments WHERE argument_cat = ? ORDER BY id', [cat]);
  return await query('SELECT * FROM stream_arguments ORDER BY id');
}

// ─── Profiles ────────────────────────────────────────────────────────

async function listProfiles() {
  return await query('SELECT * FROM profiles ORDER BY id');
}

async function getProfileById(id) {
  return await queryOne('SELECT * FROM profiles WHERE id = ?', [id]);
}

async function createProfile(name, options) {
  return await insert('INSERT INTO profiles (profile_name, profile_options) VALUES (?, ?)', [name, JSON.stringify(options || {})]);
}

async function updateProfile(id, name, options) {
  const sets = [];
  const vals = [];
  if (name !== undefined) { sets.push('profile_name = ?'); vals.push(name); }
  if (options !== undefined) { sets.push('profile_options = ?'); vals.push(JSON.stringify(options)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteProfile(id) {
  return await remove('DELETE FROM profiles WHERE id = ?', [id]);
}

// ─── Seed (run once on fresh database) ───────────────────────────────

async function ensureImportProvidersTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS import_providers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      bouquet_id INT DEFAULT 0,
      update_frequency INT DEFAULT 0,
      last_updated BIGINT DEFAULT 0,
      movie_categories JSON DEFAULT NULL,
      series_categories JSON DEFAULT NULL,
      live_categories JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureAccessCodesTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(255) NOT NULL,
      role ENUM('admin','reseller') NOT NULL DEFAULT 'admin',
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      description VARCHAR(255) DEFAULT '',
      last_used_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_access_codes_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Older installs may lack packages.options_json; package save fails without it. */
async function ensurePackagesOptionsJsonColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packages' AND COLUMN_NAME = 'options_json'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      'ALTER TABLE `packages` ADD COLUMN `options_json` TEXT NULL AFTER `output_formats_json`'
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) return;
    throw e;
  }
}

/** Legacy installs used VARCHAR(20) for release_date; Xtream values can be longer. */
async function ensureMoviesSeriesStreamServerIdColumns() {
  try {
    for (const { table, after } of [
      { table: 'movies', after: 'similar' },
      { table: 'series', after: 'similar' },
    ]) {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'stream_server_id'`,
        [table]
      );
      if (row && Number(row.c) > 0) continue;
      await execute(
        `ALTER TABLE \`${table}\` ADD COLUMN \`stream_server_id\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`${after}\``
      );
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) return;
    throw e;
  }
}

/** Phase 1 LB: add stream_server_id to episodes for per-episode server override. */
async function ensureEpisodesStreamServerIdColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'episodes' AND COLUMN_NAME = 'stream_server_id'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      "ALTER TABLE `episodes` ADD COLUMN `stream_server_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = inherit from series' AFTER `movie_subtitles`"
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) return;
    throw e;
  }
}

async function ensureReleaseDateColumnsWide() {
  try {
    for (const table of ['movies', 'series']) {
      const row = await queryOne(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'release_date'`,
        [table]
      );
      if (row && Number(row.len) >= RELEASE_DATE_MAX_LEN) continue;
      await execute(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`release_date\` VARCHAR(${RELEASE_DATE_MAX_LEN}) NOT NULL DEFAULT ''`
      );
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/Unknown column|doesn't exist|check that it exists/i.test(msg)) return;
    throw e;
  }
}

function parseJsonArrayField(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseProviderRow(row) {
  if (!row) return null;
  return {
    ...row,
    movie_categories: parseJsonArrayField(row.movie_categories),
    series_categories: parseJsonArrayField(row.series_categories),
    live_categories: parseJsonArrayField(row.live_categories),
  };
}

async function listImportProviders() {
  const rows = await query('SELECT * FROM import_providers ORDER BY id ASC');
  return rows.map(parseProviderRow);
}

async function getImportProviderById(id) {
  return parseProviderRow(await queryOne('SELECT * FROM import_providers WHERE id = ?', [id]));
}

async function createImportProvider(data) {
  const name = String(data.name || '').trim() || 'Provider';
  const url = String(data.url || '').trim();
  if (!url) throw new Error('url required');
  return await insert(
    `INSERT INTO import_providers (name, url, bouquet_id, update_frequency, last_updated, movie_categories, series_categories, live_categories)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      url,
      parseInt(data.bouquet_id, 10) || 0,
      parseInt(data.update_frequency, 10) || 0,
      parseInt(data.last_updated, 10) || 0,
      JSON.stringify(Array.isArray(data.movie_categories) ? data.movie_categories : []),
      JSON.stringify(Array.isArray(data.series_categories) ? data.series_categories : []),
      JSON.stringify(Array.isArray(data.live_categories) ? data.live_categories : []),
    ]
  );
}

async function updateImportProvider(id, data) {
  const sets = [];
  const vals = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(String(data.name).trim()); }
  if (data.url !== undefined) { sets.push('url = ?'); vals.push(String(data.url).trim()); }
  if (data.bouquet_id !== undefined) { sets.push('bouquet_id = ?'); vals.push(parseInt(data.bouquet_id, 10) || 0); }
  if (data.update_frequency !== undefined) { sets.push('update_frequency = ?'); vals.push(parseInt(data.update_frequency, 10) || 0); }
  if (data.last_updated !== undefined) { sets.push('last_updated = ?'); vals.push(parseInt(data.last_updated, 10) || 0); }
  if (data.movie_categories !== undefined) { sets.push('movie_categories = ?'); vals.push(JSON.stringify(data.movie_categories || [])); }
  if (data.series_categories !== undefined) { sets.push('series_categories = ?'); vals.push(JSON.stringify(data.series_categories || [])); }
  if (data.live_categories !== undefined) { sets.push('live_categories = ?'); vals.push(JSON.stringify(data.live_categories || [])); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE import_providers SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteImportProvider(id) {
  return await remove('DELETE FROM import_providers WHERE id = ?', [id]);
}

async function getFirstAdminUserId() {
  const row = await queryOne(
    `SELECT u.id FROM users u
     INNER JOIN user_groups g ON u.member_group_id = g.group_id
     WHERE g.is_admin = 1
     ORDER BY u.id ASC LIMIT 1`
  );
  if (row) return row.id;
  const any = await queryOne('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  return any ? any.id : null;
}

async function listAllMovieStreamUrls() {
  const rows = await query('SELECT stream_url FROM movies WHERE stream_url IS NOT NULL AND TRIM(stream_url) != \'\'');
  return rows.map((r) => r.stream_url).filter(Boolean);
}

async function listAllSeriesTitles() {
  const rows = await query('SELECT title FROM series WHERE title IS NOT NULL');
  return rows.map((r) => r.title).filter(Boolean);
}

async function listAllEpisodeStreamUrls() {
  const rows = await query('SELECT stream_url FROM episodes WHERE stream_url IS NOT NULL AND TRIM(stream_url) != \'\'');
  return rows.map((r) => r.stream_url).filter(Boolean);
}

async function listAllChannelMpdUrls() {
  const rows = await query('SELECT json_data FROM channels');
  const out = [];
  for (const r of rows) {
    try {
      const j = typeof r.json_data === 'string' ? JSON.parse(r.json_data) : r.json_data;
      const u = j && j.mpdUrl;
      if (u) out.push(String(u));
    } catch {}
  }
  return out;
}

async function listAllMovieIds() {
  const rows = await query('SELECT id FROM movies ORDER BY id ASC');
  return rows.map((r) => r.id);
}

async function listAllSeriesIds() {
  const rows = await query('SELECT id FROM series ORDER BY id ASC');
  return rows.map((r) => r.id);
}

async function listAllLiveChannelIds() {
  const rows = await query('SELECT id FROM channels ORDER BY id ASC');
  return rows.map((r) => r.id);
}

async function listAccessCodes() {
  return await query(
    'SELECT id, code, role, enabled, description, last_used_at, created_at, updated_at FROM access_codes ORDER BY id DESC'
  );
}

async function getAccessCodeByCode(code) {
  return await queryOne(
    'SELECT id, code, role, enabled, description, last_used_at, created_at, updated_at FROM access_codes WHERE code = ?',
    [String(code || '').trim()]
  );
}

async function getAccessCodeById(id) {
  return await queryOne(
    'SELECT id, code, role, enabled, description, last_used_at, created_at, updated_at FROM access_codes WHERE id = ?',
    [id]
  );
}

async function createAccessCode(data) {
  const raw = String((data && data.code) || '').trim();
  if (!raw) throw new Error('code required');
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(raw)) throw new Error('invalid code format');
  const role = String((data && data.role) || 'admin').toLowerCase();
  if (!['admin', 'reseller'].includes(role)) throw new Error('invalid role');
  const enabled = data && data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1;
  const description = String((data && data.description) || '').trim();
  return await insert(
    'INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, ?, ?)',
    [raw, role, enabled, description]
  );
}

async function updateAccessCode(id, data) {
  const sets = [];
  const vals = [];
  if (data.code !== undefined) {
    const code = String(data.code || '').trim();
    if (!code) throw new Error('code required');
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(code)) throw new Error('invalid code format');
    sets.push('code = ?');
    vals.push(code);
  }
  if (data.role !== undefined) {
    const role = String(data.role || '').toLowerCase();
    if (!['admin', 'reseller'].includes(role)) throw new Error('invalid role');
    sets.push('role = ?');
    vals.push(role);
  }
  if (data.enabled !== undefined) {
    sets.push('enabled = ?');
    vals.push(data.enabled ? 1 : 0);
  }
  if (data.description !== undefined) {
    sets.push('description = ?');
    vals.push(String(data.description || '').trim());
  }
  if (!sets.length) return;
  vals.push(id);
  await execute(`UPDATE access_codes SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteAccessCode(id) {
  return await remove('DELETE FROM access_codes WHERE id = ?', [id]);
}

async function touchAccessCodeUsage(id) {
  await execute('UPDATE access_codes SET last_used_at = NOW() WHERE id = ?', [id]);
}

async function ensureServerProvisioningJobsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_provisioning_jobs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      status ENUM('pending','running','done','error') NOT NULL DEFAULT 'pending',
      log TEXT,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_spj_server (server_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Phase 1 LB: explicit server relationship table for origin/proxy/LB-member mapping. */
async function ensureServerRelationshipsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_relationships (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      parent_server_id INT UNSIGNED NOT NULL,
      child_server_id INT UNSIGNED NOT NULL,
      relationship_type ENUM('origin-proxy','lb-member','failover') NOT NULL DEFAULT 'origin-proxy',
      priority INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_server_rel (parent_server_id, child_server_id, relationship_type),
      KEY idx_srel_child (child_server_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Phase 1 LB: per-stream per-server runtime placement state table. */
async function ensureStreamServerPlacementTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS stream_server_placement (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      stream_type ENUM('live','movie','episode') NOT NULL,
      stream_id VARCHAR(64) NOT NULL,
      server_id INT UNSIGNED NOT NULL,
      status ENUM('planned','starting','running','stopping','stopped','error','stale','orphaned') NOT NULL DEFAULT 'planned',
      pid INT UNSIGNED DEFAULT NULL,
      bitrate_kbps INT UNSIGNED DEFAULT NULL,
      clients INT UNSIGNED NOT NULL DEFAULT 0,
      error_text TEXT,
      started_at DATETIME DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      parent_server_id INT UNSIGNED NULL,
      desired_state ENUM('stopped','running') NOT NULL DEFAULT 'stopped',
      runtime_mode ENUM('origin','relay','direct','archive') NOT NULL DEFAULT 'origin',
      on_demand TINYINT(1) NOT NULL DEFAULT 0,
      monitor_pid INT UNSIGNED NULL,
      delay_pid INT UNSIGNED NULL,
      runtime_instance_id VARCHAR(64) NULL,
      current_source TEXT NULL,
      stream_info_json JSON NULL,
      compatible TINYINT(1) NOT NULL DEFAULT 0,
      video_codec VARCHAR(64) NULL,
      audio_codec VARCHAR(64) NULL,
      resolution VARCHAR(64) NULL,
      ready_at DATETIME NULL,
      last_runtime_report_at DATETIME NULL,
      last_command_id BIGINT UNSIGNED NULL,
      restart_count INT UNSIGNED NOT NULL DEFAULT 0,
      error_code VARCHAR(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_placement (stream_type, stream_id, server_id),
      KEY idx_placement_server (server_id, status),
      KEY idx_placement_status (status),
      KEY idx_placement_runtime_instance (runtime_instance_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Phase 1 XC Runtime: migrate existing installs to expanded status enum + new columns
  // Add new columns via ALTER for existing installs that don't have them
  const newCols = [
    ['parent_server_id', 'INT UNSIGNED NULL'],
    ['desired_state', "ENUM('stopped','running') NOT NULL DEFAULT 'stopped'"],
    ['runtime_mode', "ENUM('origin','relay','direct','archive') NOT NULL DEFAULT 'origin'"],
    ['on_demand', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['monitor_pid', 'INT UNSIGNED NULL'],
    ['delay_pid', 'INT UNSIGNED NULL'],
    ['runtime_instance_id', 'VARCHAR(64) NULL'],
    ['current_source', 'TEXT NULL'],
    ['stream_info_json', 'JSON NULL'],
    ['compatible', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['video_codec', 'VARCHAR(64) NULL'],
    ['audio_codec', 'VARCHAR(64) NULL'],
    ['resolution', 'VARCHAR(64) NULL'],
    ['ready_at', 'DATETIME NULL'],
    ['last_runtime_report_at', 'DATETIME NULL'],
    ['last_command_id', 'BIGINT UNSIGNED NULL'],
    ['restart_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['error_code', 'VARCHAR(64) NULL'],
  ];
  for (const [colName, colDef] of newCols) {
    try {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stream_server_placement' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (!row || Number(row.c) === 0) {
        await execute(`ALTER TABLE stream_server_placement ADD COLUMN ${colName} ${colDef}`);
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) continue;
      throw e;
    }
  }
  // Migrate old status values to new values
  try {
    await execute(`UPDATE stream_server_placement SET status = 'planned' WHERE status = 'pending'`);
    await execute(`UPDATE stream_server_placement SET status = 'stopped' WHERE status = 'stopped'`);
    // 'active' stays as-is but will be set to 'running' via markPlacementRunning
  } catch { /* ignore migration errors */ }
}

/** Phase 1 XC Runtime: active session truth table (equivalent to XC lines_live). */
async function ensureLineRuntimeSessionsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS line_runtime_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      line_id INT UNSIGNED NOT NULL,
      stream_type ENUM('live','movie','episode') NOT NULL,
      stream_id VARCHAR(64) NOT NULL,
      placement_id INT UNSIGNED NULL,
      origin_server_id INT UNSIGNED NULL,
      proxy_server_id INT UNSIGNED NULL,
      container VARCHAR(20) NOT NULL DEFAULT '',
      session_uuid VARCHAR(64) NOT NULL,
      playback_token VARCHAR(255) NULL,
      user_ip VARCHAR(45) NOT NULL DEFAULT '',
      user_agent VARCHAR(512) NOT NULL DEFAULT '',
      date_start INT UNSIGNED NULL,
      date_end INT UNSIGNED NULL,
      last_seen_at DATETIME NULL,
      geoip_country_code VARCHAR(5) NOT NULL DEFAULT '',
      isp VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_session_uuid (session_uuid),
      KEY idx_lrs_line (line_id),
      KEY idx_lrs_server (origin_server_id),
      KEY idx_lrs_placement (placement_id),
      KEY idx_lrs_last_seen (last_seen_at),
      KEY idx_lrs_date_start (date_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Phase 1 XC Runtime: command queue truth table (DB-backed, agent-pull delivery). */
async function ensureServerCommandsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_commands (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      stream_type ENUM('live','movie','episode') NULL,
      stream_id VARCHAR(64) NULL,
      placement_id INT UNSIGNED NULL,
      command_type ENUM('start_stream','stop_stream','restart_stream','probe_stream','reload_proxy_config','sync_server_config','reconcile_runtime','reconcile_sessions') NOT NULL,
      payload_json JSON NULL,
      status ENUM('queued','leased','running','succeeded','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
      issued_by_user_id INT UNSIGNED NULL,
      lease_token VARCHAR(64) NULL,
      lease_expires_at DATETIME NULL,
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME NULL,
      finished_at DATETIME NULL,
      result_json JSON NULL,
      error_text TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_sc_server (server_id, status),
      KEY idx_sc_placement (placement_id),
      KEY idx_sc_lease_expires (lease_expires_at),
      KEY idx_sc_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Phase 1 XC Runtime: per-node agent credential storage (replaces meta_json secrets). */
async function ensureServerAgentCredentialsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_agent_credentials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      credential_id VARCHAR(64) NOT NULL,
      secret_hash VARCHAR(255) NOT NULL,
      status ENUM('active','rotating','revoked') NOT NULL DEFAULT 'active',
      issued_at DATETIME NOT NULL,
      rotated_at DATETIME NULL,
      last_used_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sac_server_cred (server_id, credential_id),
      UNIQUE KEY uq_sac_credential_id (credential_id),
      KEY idx_sac_status (status),
      CONSTRAINT fk_sac_server FOREIGN KEY (server_id) REFERENCES streaming_servers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureDefaultStreamServerIdSetting() {
  const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', ['default_stream_server_id']);
  if (!row) {
    await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', ['default_stream_server_id', '0']);
  }
}

async function ensureStreamingServersTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS streaming_servers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL DEFAULT '',
      role ENUM('main','lb','edge') NOT NULL DEFAULT 'edge',
      public_host VARCHAR(255) NOT NULL DEFAULT '',
      public_ip VARCHAR(45) NOT NULL DEFAULT '',
      private_ip VARCHAR(45) NOT NULL DEFAULT '',
      max_clients INT DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      proxied TINYINT(1) NOT NULL DEFAULT 0,
      timeshift_only TINYINT(1) NOT NULL DEFAULT 0,
      network_mbps_cap INT DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      meta_json JSON DEFAULT NULL,
      last_heartbeat_at DATETIME DEFAULT NULL,
      health_cpu_pct DECIMAL(5,2) DEFAULT NULL,
      health_mem_pct DECIMAL(5,2) DEFAULT NULL,
      health_net_mbps DECIMAL(12,4) DEFAULT NULL,
      health_ping_ms DECIMAL(10,2) DEFAULT NULL,
      agent_version VARCHAR(64) DEFAULT NULL,
      runtime_enabled TINYINT(1) NOT NULL DEFAULT 0,
      proxy_enabled TINYINT(1) NOT NULL DEFAULT 0,
      controller_enabled TINYINT(1) NOT NULL DEFAULT 0,
      base_url VARCHAR(255) NOT NULL DEFAULT '',
      server_ip VARCHAR(45) NOT NULL DEFAULT '',
      dns_1 VARCHAR(45) NOT NULL DEFAULT '',
      dns_2 VARCHAR(45) NOT NULL DEFAULT '',
      admin_password VARCHAR(255) NOT NULL DEFAULT '',
      full_duplex TINYINT(1) NOT NULL DEFAULT 0,
      boost_fpm TINYINT(1) NOT NULL DEFAULT 0,
      http_port INT UNSIGNED NOT NULL DEFAULT 8080,
      https_m3u_lines TINYINT(1) NOT NULL DEFAULT 0,
      force_ssl_port TINYINT(1) NOT NULL DEFAULT 0,
      https_port INT UNSIGNED NOT NULL DEFAULT 8083,
      time_difference VARCHAR(32) NOT NULL DEFAULT 'Auto',
      ssh_port INT UNSIGNED NOT NULL DEFAULT 22,
      network_interface VARCHAR(64) NOT NULL DEFAULT 'all',
      network_speed VARCHAR(64) NOT NULL DEFAULT '',
      os_info VARCHAR(128) NOT NULL DEFAULT '',
      geoip_load_balancing TINYINT(1) NOT NULL DEFAULT 0,
      geoip_countries TEXT NOT NULL DEFAULT '',
      extra_nginx_config TEXT NOT NULL DEFAULT '',
      server_guard_enabled TINYINT(1) NOT NULL DEFAULT 0,
      ip_whitelisting TINYINT(1) NOT NULL DEFAULT 0,
      botnet_fighter TINYINT(1) NOT NULL DEFAULT 0,
      under_attack TINYINT(1) NOT NULL DEFAULT 0,
      connection_limit_ports VARCHAR(255) NOT NULL DEFAULT '',
      max_conn_per_ip INT UNSIGNED NOT NULL DEFAULT 3,
      max_hits_normal_user INT UNSIGNED NOT NULL DEFAULT 1,
      max_hits_restreamer INT UNSIGNED NOT NULL DEFAULT 1,
      whitelist_username TINYINT(1) NOT NULL DEFAULT 0,
      block_user_minutes INT UNSIGNED NOT NULL DEFAULT 30,
      auto_restart_mysql TINYINT(1) NOT NULL DEFAULT 0,
      isp_enabled TINYINT(1) NOT NULL DEFAULT 0,
      isp_priority INT UNSIGNED NOT NULL DEFAULT 1,
      isp_allowed_names TEXT NOT NULL DEFAULT '',
      isp_case_sensitive ENUM('none','lower','upper') NOT NULL DEFAULT 'lower',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_streaming_servers_role (role, enabled, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Edit Server parity: add new columns for existing installs
  const newCols = [
    ['runtime_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['proxy_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['controller_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['base_url', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
    ['server_ip', 'VARCHAR(45) NOT NULL DEFAULT \'\''],
    ['dns_1', 'VARCHAR(45) NOT NULL DEFAULT \'\''],
    ['dns_2', 'VARCHAR(45) NOT NULL DEFAULT \'\''],
    ['admin_password', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
    ['full_duplex', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['boost_fpm', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['http_port', 'INT UNSIGNED NOT NULL DEFAULT 8080'],
    ['https_m3u_lines', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['force_ssl_port', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['https_port', 'INT UNSIGNED NOT NULL DEFAULT 8083'],
    ['time_difference', 'VARCHAR(32) NOT NULL DEFAULT \'Auto\''],
    ['ssh_port', 'INT UNSIGNED NOT NULL DEFAULT 22'],
    ['network_interface', 'VARCHAR(64) NOT NULL DEFAULT \'all\''],
    ['network_speed', 'VARCHAR(64) NOT NULL DEFAULT \'\''],
    ['os_info', 'VARCHAR(128) NOT NULL DEFAULT \'\''],
    ['geoip_load_balancing', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['geoip_countries', 'TEXT NOT NULL DEFAULT \'\''],
    ['extra_nginx_config', 'TEXT NOT NULL DEFAULT \'\''],
    ['server_guard_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['ip_whitelisting', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['botnet_fighter', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['under_attack', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['connection_limit_ports', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
    ['max_conn_per_ip', 'INT UNSIGNED NOT NULL DEFAULT 3'],
    ['max_hits_normal_user', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['max_hits_restreamer', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['whitelist_username', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['block_user_minutes', 'INT UNSIGNED NOT NULL DEFAULT 30'],
    ['auto_restart_mysql', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['isp_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['isp_priority', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['isp_allowed_names', 'TEXT NOT NULL DEFAULT \'\''],
    ['isp_case_sensitive', 'ENUM(\'none\',\'lower\',\'upper\') NOT NULL DEFAULT \'lower\''],
  ];
  for (const [col, def] of newCols) {
    try {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_servers' AND COLUMN_NAME = ?`,
        [col]
      );
      if (!row || Number(row.c) === 0) {
        await execute(`ALTER TABLE streaming_servers ADD COLUMN ${col} ${def}`);
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) continue;
      throw e;
    }
  }
  await execute(`
    CREATE TABLE IF NOT EXISTS streaming_server_domains (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      domain VARCHAR(255) NOT NULL DEFAULT '',
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      ssl_port INT UNSIGNED NOT NULL DEFAULT 443,
      ssl_status ENUM('active','expired','missing') NOT NULL DEFAULT 'missing',
      ssl_expiry DATE DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_ssd_server (server_id),
      CONSTRAINT fk_ssd_server FOREIGN KEY (server_id) REFERENCES streaming_servers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Add SSL columns to existing streaming_server_domains installs
  for (const [col, def] of [['ssl_port', 'INT UNSIGNED NOT NULL DEFAULT 443'], ['ssl_status', 'ENUM(\'active\',\'expired\',\'missing\') NOT NULL DEFAULT \'missing\''], ['ssl_expiry', 'DATE DEFAULT NULL']]) {
    try {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_server_domains' AND COLUMN_NAME = ?`,
        [col]
      );
      if (!row || Number(row.c) === 0) {
        await execute(`ALTER TABLE streaming_server_domains ADD COLUMN ${col} ${def}`);
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) continue;
      throw e;
    }
  }
}

async function ensureStreamingPerformanceDefaults() {
  const defaults = [
    ['streaming_prebuffer_enabled', '1'],
    ['streaming_prebuffer_size_mb', '6'],
    ['streaming_prebuffer_on_demand_min_bytes', '2097152'],
    ['streaming_prebuffer_on_demand_max_wait_ms', '3000'],
    ['streaming_ingest_style', 'webapp'],
    ['streaming_low_latency_enabled', '1'],
    ['streaming_minimal_ingest_enabled', '1'],
    ['streaming_prewarm_enabled', '1'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [k]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
    }
  }
}

async function ensureBackupsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS backups (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      size_bytes BIGINT UNSIGNED DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      type ENUM('local','gdrive','dropbox','s3') DEFAULT 'local',
      cloud_url TEXT,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureBlockedAsnsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS blocked_asns (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      asn VARCHAR(50) NOT NULL,
      org VARCHAR(255) DEFAULT '',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_asn (asn)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureLoginEventsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS login_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED DEFAULT NULL,
      ip VARCHAR(45) DEFAULT '',
      event_type VARCHAR(50) DEFAULT '',
      is_vpn TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_le_user (user_id),
      KEY idx_le_vpn (is_vpn)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureRolesPermissionsTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) DEFAULT '',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      resource VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_perm (resource, action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INT UNSIGNED NOT NULL,
      permission_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
      CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(
    `INSERT IGNORE INTO roles (id, name, description) VALUES
      (1, 'admin', 'Full administrator'),
      (2, 'reseller', 'Reseller with limited access'),
      (3, 'user', 'End user')`
  );
  await execute(
    `INSERT IGNORE INTO permissions (id, name, resource, action) VALUES
      (1, 'streams.view', 'streams', 'view'),
      (2, 'streams.edit', 'streams', 'edit'),
      (3, 'streams.delete', 'streams', 'delete'),
      (4, 'movies.view', 'movies', 'view'),
      (5, 'movies.edit', 'movies', 'edit'),
      (6, 'movies.delete', 'movies', 'delete'),
      (7, 'series.view', 'series', 'view'),
      (8, 'series.edit', 'series', 'edit'),
      (9, 'series.delete', 'series', 'delete'),
      (10, 'users.view', 'users', 'view'),
      (11, 'users.edit', 'users', 'edit'),
      (12, 'users.delete', 'users', 'delete'),
      (13, 'lines.view', 'lines', 'view'),
      (14, 'lines.edit', 'lines', 'edit'),
      (15, 'lines.delete', 'lines', 'delete'),
      (16, 'backups.view', 'backups', 'view'),
      (17, 'backups.create', 'backups', 'create'),
      (18, 'backups.restore', 'backups', 'restore'),
      (19, 'settings.view', 'settings', 'view'),
      (20, 'settings.edit', 'settings', 'edit'),
      (21, 'security.view', 'security', 'view'),
      (22, 'security.edit', 'security', 'edit'),
      (23, 'server.view', 'server', 'view'),
      (24, 'server.edit', 'server', 'edit')`
  );
  await execute('INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT 1, id FROM permissions');
}

async function ensureUsersNotesColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notes'`
    );
    if (row && Number(row.c) > 0) return;
    await execute('ALTER TABLE `users` ADD COLUMN `notes` TEXT NULL AFTER `email`');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) return;
    throw e;
  }
}

async function ensureUserGroupsManageExpiryMediaColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_groups' AND COLUMN_NAME = 'manage_expiry_media'`
    );
    if (row && Number(row.c) > 0) return;
    await execute('ALTER TABLE `user_groups` ADD COLUMN `manage_expiry_media` TINYINT DEFAULT 0 AFTER `allow_change_bouquets`');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg)) return;
    throw e;
  }
}

async function ensureResellerPackageOverridesTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_package_overrides (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      package_id INT UNSIGNED NOT NULL,
      trial_credits_override DECIMAL(12,2) DEFAULT NULL,
      official_credits_override DECIMAL(12,2) DEFAULT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_reseller_package_override (user_id, package_id),
      KEY idx_rpo_user (user_id),
      KEY idx_rpo_package (package_id),
      CONSTRAINT fk_rpo_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureResellerExpiryMediaTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_expiry_media_services (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      warning_window_days INT UNSIGNED NOT NULL DEFAULT 7,
      repeat_interval_hours INT UNSIGNED NOT NULL DEFAULT 6,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_rems_user (user_id),
      KEY idx_rems_user (user_id),
      CONSTRAINT fk_rems_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_expiry_media_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      service_id INT UNSIGNED NOT NULL,
      scenario ENUM('expiring','expired') NOT NULL,
      country_code VARCHAR(5) NOT NULL DEFAULT '',
      media_type ENUM('video','image') NOT NULL DEFAULT 'video',
      media_url VARCHAR(2048) NOT NULL DEFAULT '',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_remi_service (service_id),
      KEY idx_remi_scenario (scenario),
      CONSTRAINT fk_remi_service FOREIGN KEY (service_id) REFERENCES reseller_expiry_media_services (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensurePlexServersTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS plex_servers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      url VARCHAR(500) NOT NULL,
      plex_token VARCHAR(100) DEFAULT '',
      last_seen DATETIME DEFAULT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureAdminFeatureSettingsDefaults() {
  const defaults = [
    ['enable_vpn_detection', '0'],
    ['block_vpn', '0'],
    ['enable_multilogin_detection', '0'],
    ['max_connections_per_line', '1'],
    ['block_vod_download', '0'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [k]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
    }
  }
}

async function ensureSettingsParityDefaults() {
  const defaults = [
    ['service_logo_url', ''],
    ['service_logo_sidebar_url', ''],
    ['system_timezone', 'UTC'],
    ['force_epg_timezone', 'UTC'],
    ['enigma2_bouquet_name', 'Example'],
    ['load_balancing_key', ''],
    ['geolite2_version', 'Auto'],
    ['security_patch_level', '5 Levels'],

    ['player_credentials_user', ''],
    ['player_credentials_pass', ''],
    ['tmdb_http', '0'],
    ['new_playlist_without_ts', '1'],
    ['release_parser', 'python'],
    ['logout_on_ip_change', '0'],
    ['cloudflare_connecting_ip', 'HTTP_CF_CONNECTING_IP'],
    ['maximum_login_attempts', '5'],
    ['minimum_password_length', '0'],
    ['default_entries_to_show', '25'],
    ['two_factor_authentication', '0'],
    ['localhost_api', '1'],
    ['dark_mode_login', '0'],
    ['dashboard_stats_enabled', '0'],
    ['stats_interval', '600'],
    ['dashboard_world_map_live', '1'],
    ['dashboard_world_map_activity', '1'],
    ['download_images', '0'],
    ['auto_refresh_default', '1'],
    ['alternate_scandir_cloud', '0'],
    ['show_alert_tickets', '1'],
    ['statistics_enabled', '1'],
    ['disable_get_playlist', '0'],
    ['disable_xml_epg', '0'],
    ['disable_player_api_epg', '0'],

    ['reseller_copyright', ''],
    ['reseller_disable_trials', '0'],
    ['reseller_allow_restrictions', '0'],
    ['reseller_trial_set_date_on_usage', '0'],
    ['reseller_paid_set_date_on_usage', '0'],
    ['reseller_change_usernames', '1'],
    ['reseller_change_own_dns', '0'],
    ['reseller_change_own_email', '0'],
    ['reseller_change_own_password', '1'],
    ['reseller_change_own_language', '1'],
    ['reseller_send_mag_events', '0'],
    ['reseller_use_isplock', '1'],
    ['reseller_use_reset_isp', '1'],
    ['reseller_see_manuals', '1'],
    ['reseller_view_info_dashboard', '0'],
    ['reseller_view_apps_dashboard', '1'],
    ['reseller_convert_mag_to_m3u', '0'],
    ['reseller_deny_same_user_pass', '0'],
    ['reseller_deny_weak_username_password', '0'],
    ['reseller_deny_similar_user_pass', '0'],
    ['reseller_deny_similar_percentage', '80'],
    ['reseller_generating_type', 'random_number'],
    ['reseller_min_chars', '6'],

    ['streaming_main_lb_https', '[]'],
    ['use_https_m3u_lines', '0'],
    ['secure_lb_connection', '0'],
    ['streaming_auto_kick_users', '0'],
    ['category_order_type', 'bouquet'],
    ['streaming_client_prebuffer', '30'],
    ['streaming_restreamer_prebuffer', '0'],
    ['split_clients', 'equally'],
    ['split_by', 'connections'],
    ['analysis_duration', '500000'],
    ['probe_size', '5000000'],
    ['use_custom_name_series_episodes', '0'],
    ['restart_on_audio_loss', '0'],
    ['save_connection_logs', '0'],
    ['save_client_logs', '1'],
    ['case_sensitive_details', '1'],
    ['override_country_with_first', '0'],
    ['enable_xc_firewall', '0'],
    ['enable_isps', '1'],
    ['enable_isp_lock', '0'],
    ['token_revalidate', '0'],
    ['token_validity', ''],
    ['vod_download_speed', '45000'],
    ['vod_download_limit', '20'],
    ['buffer_size_for_reading', '8192'],
    ['block_vpn_proxies_servers', '0'],
    ['always_use_first_working_stream_source', '0'],
    ['stream_down_video_enabled', '0'],
    ['stream_down_video_url', 'Default http video link .ts'],
    ['banned_video_enabled', '0'],
    ['banned_video_url', 'Default http video link .ts'],
    ['expired_video_enabled', '1'],
    ['expired_video_url', 'Default http video link .ts'],
    ['countrylock_video_enabled', '0'],
    ['countrylock_video_url', 'Default http video link .ts'],
    ['max_conn_exceed_video_enabled', '0'],
    ['max_conn_exceed_video_url', 'Default http video link .ts'],
    ['enable_connections_exceed_video_log', '0'],
    ['admin_streaming_ips', ''],
    ['adult_stream_password', ''],
    ['verify_client_ip_during_lb', '0'],
    ['user_connections_red_after_hours', '3'],
    ['restrict_player_api_devices', '0'],
    ['disallow_proxy_types', '[]'],

    ['enable_remote_secure_backups', '0'],
    ['enable_local_backups', '1'],
    ['local_backup_directory', 'data/backups'],
    ['backup_interval_unit', 'hours'],
    ['backups_to_keep', '20'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [k]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
    }
  }
}

async function ensureAdminFeatureTables() {
  await ensureBackupsTable();
  await ensureBlockedAsnsTable();
  await ensureLoginEventsTable();
  await ensureRolesPermissionsTables();
  await ensurePlexServersTable();
  await ensureAdminFeatureSettingsDefaults();
}

async function seedDefaults() {
  await ensureUsersNotesColumn();
  await ensureUserGroupsManageExpiryMediaColumn();
  await ensureImportProvidersTable();
  await ensureAccessCodesTable();
  await ensureLinePasswordSecurityColumns();
  await migrateLegacyLinePasswords();
  await ensurePackagesOptionsJsonColumn();
  await ensureMoviesSeriesStreamServerIdColumns();
  await ensureReleaseDateColumnsWide();
  await ensureStreamingServersTables();
  await ensureServerProvisioningJobsTable();
  await ensureEpisodesStreamServerIdColumn();
  await ensureServerRelationshipsTable();
  await ensureStreamServerPlacementTable();
  await ensureLineRuntimeSessionsTable();
  await ensureServerCommandsTable();
  await ensureServerAgentCredentialsTable();
  await ensureDefaultStreamServerIdSetting();
  await ensureStreamingPerformanceDefaults();
  await ensureAdminFeatureTables();
  await ensureResellerPackageOverridesTable();
  await ensureResellerExpiryMediaTables();
  await ensureSettingsParityDefaults();
  const gc = await queryOne('SELECT COUNT(*) AS c FROM user_groups');
  if (gc.c === 0) {
    await execute("INSERT INTO user_groups (group_name, is_admin, is_reseller) VALUES ('Administrators', 1, 0)");
    await execute("INSERT INTO user_groups (group_name, is_admin, is_reseller) VALUES ('Resellers', 0, 1)");
  }

  const ofc = await queryOne('SELECT COUNT(*) AS c FROM output_formats');
  if (ofc.c === 0) {
    await execute("INSERT INTO output_formats (output_key, output_name) VALUES ('m3u8', 'HLS (m3u8)')");
    await execute("INSERT INTO output_formats (output_key, output_name) VALUES ('ts', 'MPEG-TS')");
    await execute("INSERT INTO output_formats (output_key, output_name) VALUES ('rtmp', 'RTMP')");
  }

  const sac = await queryOne('SELECT COUNT(*) AS c FROM stream_arguments');
  if (sac.c === 0) {
    const args = [
      ['fetch', 'User Agent', 'Set a Custom User Agent', 'http', 'user_agent', '-user_agent "%s"', 'text', 'Mozilla/5.0'],
      ['fetch', 'HTTP Proxy', 'Set an HTTP Proxy (ip:port)', 'http', 'proxy', '-http_proxy "%s"', 'text', null],
      ['transcode', 'Video Bit Rate (kbps)', 'Change the video bitrate', null, 'bitrate', '-b:v %dk', 'text', null],
      ['transcode', 'Audio Bitrate (kbps)', 'Change the audio bitrate', null, 'audio_bitrate', '-b:a %dk', 'text', null],
      ['transcode', 'Min Bitrate (kbps)', 'Minimum bitrate tolerance', null, 'minimum_bitrate', '-minrate %dk', 'text', null],
      ['transcode', 'Max Bitrate (kbps)', 'Maximum bitrate tolerance', null, 'maximum_bitrate', '-maxrate %dk', 'text', null],
      ['transcode', 'Buffer Size (kbps)', 'Rate control buffer size', null, 'bufsize', '-bufsize %dk', 'text', null],
      ['transcode', 'CRF Value', 'Quantizer scale 0-51 (lower = better)', null, 'crf', '-crf %d', 'text', null],
      ['transcode', 'Scaling', 'Width:Height (e.g. 1280:720 or 1280:-1)', null, 'scaling', '-filter_complex "scale=%s"', 'text', null],
      ['transcode', 'Aspect Ratio', 'e.g. 16:9', null, 'aspect', '-aspect %s', 'text', null],
      ['transcode', 'Frame Rate', 'Target video frame rate', null, 'video_frame_rate', '-r %d', 'text', null],
      ['transcode', 'Audio Sample Rate', 'Audio sample rate in Hz', null, 'audio_sample_rate', '-ar %d', 'text', null],
      ['transcode', 'Audio Channels', 'Number of audio channels', null, 'audio_channels', '-ac %d', 'text', null],
      ['transcode', 'Delogo Filter', 'Remove area: x=0:y=0:w=100:h=77:band=10', null, 'delogo', '-filter_complex "delogo=%s"', 'text', null],
      ['transcode', 'Threads', '0 = auto-detect optimal', null, 'threads', '-threads %d', 'text', null],
      ['transcode', 'Logo Path', 'Overlay logo (upper-left, requires H.264)', null, 'logo', '-i "%s" -filter_complex "overlay"', 'text', null],
      ['fetch', 'Cookie', 'HTTP Cookie for fetching source', 'http', 'cookie', "-cookies '%s'", 'text', null],
      ['transcode', 'Deinterlace', 'Yadif deinterlacing filter', null, 'deinterlace', '-filter_complex "yadif"', 'radio', '0'],
      ['fetch', 'Headers', 'Custom HTTP headers', 'http', 'headers', "-headers $'%s\\r\\n'", 'text', null],
      ['fetch', 'Force Input Audio Codec', 'Force input audio codec (e.g. aac, ac3)', null, 'force_input_acodec', '-acodec %s', 'text', null],
      ['fetch', 'Skip FFProbe', 'Skip codec detection via ffprobe', null, 'skip_ffprobe', '', 'radio', '0'],
    ];
    for (const a of args) {
      await execute('INSERT INTO stream_arguments (argument_cat, argument_name, argument_description, argument_wprotocol, argument_key, argument_cmd, argument_type, argument_default_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', a);
    }
  }

  const sc = await queryOne('SELECT COUNT(*) AS c FROM settings');
  if (sc.c === 0) {
    const defaults = {
      server_name: 'IPTV Panel', server_port: '80', server_protocol: 'http',
      domain_name: '', disable_player_api: '0', disable_ministra: '1',
      allow_countries: '', auth_flood_limit: '10', auth_flood_window_sec: '300',
      bruteforce_max_attempts: '10', bruteforce_window_sec: '600',
      restrict_playlists: '0', restrict_same_ip: '0', disallow_2nd_ip_con: '0',
      user_auto_kick_hours: '0', tmdb_api_key: '', tmdb_language: 'en',
      automatic_backups: '0', backup_interval_hours: '24', cache_playlists: '0',
      encrypt_playlist: '0', live_streaming_pass: '', detect_restream: '0',
      api_redirect: '0', legacy_panel_api: '0', stream_user_agent: '',
    };
    for (const [k, v] of Object.entries(defaults)) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
    }
  }

  const acc = await queryOne('SELECT COUNT(*) AS c FROM access_codes');
  if ((acc && acc.c) === 0) {
    const adminCode = String(process.env.DEFAULT_ADMIN_ACCESS_CODE || 'admin').trim();
    const resellerCode = String(process.env.DEFAULT_RESELLER_ACCESS_CODE || 'reseller').trim();
    if (/^[A-Za-z0-9_-]{3,128}$/.test(adminCode)) {
      await execute('INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, 1, ?)', [adminCode, 'admin', 'Default admin gateway']);
    }
    if (/^[A-Za-z0-9_-]{3,128}$/.test(resellerCode) && resellerCode !== adminCode) {
      await execute('INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, 1, ?)', [resellerCode, 'reseller', 'Default reseller gateway']);
    }
  }
}

// ─── Transcode Profiles ──────────────────────────────────────────────

async function listTranscodeProfiles() {
  return await query('SELECT id, name, output_mode, video_encoder, x264_preset, rendition_mode, renditions, audio_bitrate_k, hls_segment_seconds, hls_playlist_size, created_at, updated_at FROM transcode_profiles ORDER BY id');
}

async function getTranscodeProfile(id) {
  return await queryOne('SELECT * FROM transcode_profiles WHERE id = ?', [id]);
}

async function createTranscodeProfile(data) {
  return await insert(
    'INSERT INTO transcode_profiles (name, output_mode, video_encoder, x264_preset, rendition_mode, renditions, audio_bitrate_k, hls_segment_seconds, hls_playlist_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      data.name || 'Untitled',
      data.output_mode || 'copy',
      data.video_encoder || 'cpu_x264',
      data.x264_preset || 'veryfast',
      data.rendition_mode || 'single',
      JSON.stringify(data.renditions || ['1080p']),
      parseInt(data.audio_bitrate_k, 10) || 128,
      parseInt(data.hls_segment_seconds, 10) || 4,
      parseInt(data.hls_playlist_size, 10) || 10,
    ]
  );
}

async function updateTranscodeProfile(id, data) {
  const allowed = ['name', 'output_mode', 'video_encoder', 'x264_preset', 'rendition_mode', 'audio_bitrate_k', 'hls_segment_seconds', 'hls_playlist_size'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (data.renditions !== undefined) { sets.push('`renditions` = ?'); vals.push(JSON.stringify(data.renditions)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE transcode_profiles SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteTranscodeProfile(id) {
  return await remove('DELETE FROM transcode_profiles WHERE id = ?', [id]);
}

// ─── Server Relationships (Phase 2 LB helpers) ────────────────────────

/**
 * Add a relationship between two servers. Uses INSERT IGNORE to avoid
 * duplicates on the unique key (parent, child, type).
 * @param {number} parentId - Parent (origin/upstream) server ID.
 * @param {number} childId  - Child (proxy/edge) server ID.
 * @param {string} type     - One of 'origin-proxy', 'lb-member', 'failover'.
 * @returns {Promise<number|void>} Insert ID or void if duplicate.
 */
async function addServerRelationship(parentId, childId, type) {
  const validTypes = ['origin-proxy', 'lb-member', 'failover'];
  if (!validTypes.includes(type)) throw new Error(`invalid relationship_type: ${type}`);
  return await insert(
    `INSERT IGNORE INTO server_relationships (parent_server_id, child_server_id, relationship_type) VALUES (?, ?, ?)`,
    [parentId, childId, type]
  );
}

/**
 * Remove a specific relationship between two servers.
 * @param {number} parentId
 * @param {number} childId
 * @param {string} type
 * @returns {Promise<void>}
 */
async function removeServerRelationship(parentId, childId, type) {
  await execute(
    `DELETE FROM server_relationships WHERE parent_server_id = ? AND child_server_id = ? AND relationship_type = ?`,
    [parentId, childId, type]
  );
}

/**
 * Get all relationships where the given server is either parent or child.
 * @param {number} serverId
 * @returns {Promise<Array>} Relationship rows.
 */
async function getServerRelationships(serverId) {
  return await query(
    `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
     FROM server_relationships WHERE parent_server_id = ? OR child_server_id = ?
     ORDER BY relationship_type, priority ASC`,
    [serverId, serverId]
  );
}

/**
 * Get all children of a given parent server, optionally filtered by type.
 * @param {number} parentId
 * @param {string} [type] - Optional relationship_type filter.
 * @returns {Promise<Array>} Relationship rows for children.
 */
async function getServerChildren(parentId, type) {
  if (type) {
    return await query(
      `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
       FROM server_relationships WHERE parent_server_id = ? AND relationship_type = ?
       ORDER BY priority ASC`,
      [parentId, type]
    );
  }
  return await query(
    `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
     FROM server_relationships WHERE parent_server_id = ?
     ORDER BY priority ASC`,
    [parentId]
  );
}

// ─── Placement helpers (stream_server_placement table) ─────────────

async function createPlacement({ streamType, streamId, serverId }) {
  await execute(
    `INSERT INTO stream_server_placement (stream_type, stream_id, server_id, status, started_at)
     VALUES (?, ?, ?, 'active', NOW())
     ON DUPLICATE KEY UPDATE status = 'active', started_at = NOW()`,
    [streamType, String(streamId), serverId]
  );
}

async function updatePlacementClients(streamType, streamId, serverId, delta) {
  const d = delta > 0 ? '+' : '-';
  await execute(
    `UPDATE stream_server_placement SET clients = GREATEST(0, clients ${d}), status = CASE WHEN clients > 0 THEN 'active' ELSE 'stopped' END, updated_at = NOW()
     WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

async function getPlacement(streamType, streamId, serverId) {
  return await queryOne(
    'SELECT * FROM stream_server_placement WHERE stream_type = ? AND stream_id = ? AND server_id = ?',
    [streamType, String(streamId), serverId]
  );
}

async function getActivePlacementsForServer(serverId) {
  return await query(
    'SELECT * FROM stream_server_placement WHERE server_id = ? AND clients > 0 ORDER BY stream_type, stream_id',
    [serverId]
  );
}

// ─── Phase 1 XC Runtime: Placement Foundation Helpers ─────────────────

/**
 * Upsert a placement row's full runtime state.
 * Used by node runtime reports to update stream_info_json, codec, resolution, etc.
 */
async function upsertPlacementRuntimeState({ streamType, streamId, serverId, fields = {} }) {
  const sets = [];
  const vals = [];
  const validFields = [
    'status', 'pid', 'bitrate_kbps', 'clients', 'error_text', 'started_at',
    'parent_server_id', 'desired_state', 'runtime_mode', 'on_demand',
    'monitor_pid', 'delay_pid', 'runtime_instance_id', 'current_source',
    'stream_info_json', 'compatible', 'video_codec', 'audio_codec', 'resolution',
    'ready_at', 'last_runtime_report_at', 'last_command_id', 'restart_count', 'error_code',
  ];
  for (const k of validFields) {
    if (fields[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      vals.push(k === 'stream_info_json' ? JSON.stringify(fields[k]) : fields[k]);
    }
  }
  if (sets.length === 0) return;
  vals.push(streamType, String(streamId), serverId);
  await execute(
    `UPDATE stream_server_placement SET ${sets.join(', ')} WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    vals
  );
}

/** Set the desired_state of a placement. */
async function setPlacementDesiredState(streamType, streamId, serverId, desiredState) {
  const valid = ['stopped', 'running'];
  if (!valid.includes(desiredState)) throw new Error(`invalid desired_state: ${desiredState}`);
  await execute(
    `UPDATE stream_server_placement SET desired_state = ? WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [desiredState, streamType, String(streamId), serverId]
  );
}

/** Mark a placement as 'starting'. */
async function markPlacementStarting(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'starting' WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

/** Mark a placement as 'running' and record ready_at. */
async function markPlacementRunning(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'running', ready_at = NOW() WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

/** Mark a placement as 'stopped'. */
async function markPlacementStopped(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'stopped', pid = NULL, monitor_pid = NULL, delay_pid = NULL WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

/** Mark a placement as 'error' with an error code and text. */
async function markPlacementError(streamType, streamId, serverId, errorCode, errorText) {
  await execute(
    `UPDATE stream_server_placement SET status = 'error', error_code = ?, error_text = ? WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [errorCode || null, errorText || null, streamType, String(streamId), serverId]
  );
}

/**
 * Apply a batch of runtime reports from a remote node to placement rows.
 * Each report may target a different stream on the same server.
 * Silently skips placements that do not exist.
 * @param {number} serverId
 * @param {Array<{placement_id?: number, stream_type?: string, stream_id?: string, status?: string, pid?: number, monitor_pid?: number, runtime_instance_id?: string, ready_at?: string, current_source?: string, bitrate_kbps?: number, compatible?: number, video_codec?: string, audio_codec?: string, resolution?: string, error_text?: string}>} reports
 */
async function reportPlacementRuntimeFromNode(serverId, reports) {
  if (!Array.isArray(reports) || reports.length === 0) return;
  for (const r of reports) {
    // Resolve placement by id or by (stream_type, stream_id, server_id)
    let targetStreamType = r.stream_type || 'live';
    let targetStreamId = r.stream_id ? String(r.stream_id) : '';
    let targetPlacementId = r.placement_id;

    if (!targetStreamId && !targetPlacementId) continue;

    // Build fields object — only include known runtime fields
    const fields = {};
    if (r.status !== undefined) fields.status = r.status;
    if (r.pid !== undefined) fields.pid = r.pid;
    if (r.monitor_pid !== undefined) fields.monitor_pid = r.monitor_pid;
    if (r.runtime_instance_id !== undefined) fields.runtime_instance_id = r.runtime_instance_id;
    if (r.ready_at !== undefined) fields.ready_at = r.ready_at;
    if (r.current_source !== undefined) fields.current_source = r.current_source;
    if (r.bitrate_kbps !== undefined) fields.bitrate_kbps = r.bitrate_kbps;
    if (r.compatible !== undefined) fields.compatible = r.compatible;
    if (r.video_codec !== undefined) fields.video_codec = r.video_codec;
    if (r.audio_codec !== undefined) fields.audio_codec = r.audio_codec;
    if (r.resolution !== undefined) fields.resolution = r.resolution;
    if (r.error_text !== undefined) fields.error_text = r.error_text;
    fields.last_runtime_report_at = 'NOW()';

    if (Object.keys(fields).length === 0) continue;

    if (targetPlacementId) {
      // Direct placement update by id
      await execute(
        `UPDATE stream_server_placement SET ${Object.keys(fields).map(k => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(fields), targetPlacementId]
      );
    } else if (targetStreamId) {
      await upsertPlacementRuntimeState({
        streamType: targetStreamType,
        streamId: targetStreamId,
        serverId,
        fields,
      });
    }
  }
}

/**
 * Get all placement rows for a given asset (stream_type + stream_id).
 * Returns rows across all servers.
 */
async function getPlacementByAsset(streamType, streamId) {
  return await query(
    'SELECT * FROM stream_server_placement WHERE stream_type = ? AND stream_id = ? ORDER BY server_id',
    [streamType, String(streamId)]
  );
}

/** Get all placement rows for a given server. */
async function getPlacementsByServer(serverId, status) {
  if (status) {
    return await query(
      'SELECT * FROM stream_server_placement WHERE server_id = ? AND status = ? ORDER BY stream_type, stream_id',
      [serverId, status]
    );
  }
  return await query(
    'SELECT * FROM stream_server_placement WHERE server_id = ? ORDER BY stream_type, stream_id',
    [serverId]
  );
}

// ─── Phase 1 XC Runtime: Active Session Foundation Helpers ─────────────

/**
 * Open a new runtime session for a line viewing an asset.
 * Returns the inserted row id.
 */
async function openRuntimeSession({ lineId, streamType, streamId, placementId, originServerId, proxyServerId, container, sessionUuid, playbackToken, userIp, userAgent, geoipCountryCode, isp }) {
  const id = await insert(
    `INSERT INTO line_runtime_sessions
     (line_id, stream_type, stream_id, placement_id, origin_server_id, proxy_server_id, container, session_uuid, playback_token, user_ip, user_agent, date_start, last_seen_at, geoip_country_code, isp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
    [
      lineId, streamType, String(streamId),
      placementId || null, originServerId || null, proxyServerId || null,
      container || '', sessionUuid, playbackToken || null,
      userIp || '', userAgent || '',
      Math.floor(Date.now() / 1000),
      geoipCountryCode || '', isp || '',
    ]
  );
  return id;
}

/** Touch a runtime session to update last_seen_at. */
async function touchRuntimeSession(sessionUuid) {
  await execute(
    'UPDATE line_runtime_sessions SET last_seen_at = NOW() WHERE session_uuid = ?',
    [sessionUuid]
  );
}

/** Close a runtime session (set date_end). */
async function closeRuntimeSession(sessionUuid, dateEnd) {
  await execute(
    'UPDATE line_runtime_sessions SET date_end = ?, last_seen_at = NOW() WHERE session_uuid = ?',
    [dateEnd || Math.floor(Date.now() / 1000), sessionUuid]
  );
}

/** List all active sessions (no date_end) for a given server. */
async function listActiveRuntimeSessionsByServer(originServerId) {
  return await query(
    'SELECT * FROM line_runtime_sessions WHERE origin_server_id = ? AND date_end IS NULL ORDER BY last_seen_at DESC',
    [originServerId]
  );
}

/** Count active sessions for a given placement. */
async function countActiveRuntimeSessionsByPlacement(placementId) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM line_runtime_sessions WHERE placement_id = ? AND date_end IS NULL',
    [placementId]
  );
  return row ? Number(row.c) : 0;
}

// ─── Phase 6 — Occupancy Truth & Session Reconciliation ────────────────

/**
 * Count active sessions (no date_end) for a given origin server.
 * Used for occupancy truth and server-level session counting.
 */
async function countActiveRuntimeSessionsByServer(originServerId) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM line_runtime_sessions WHERE origin_server_id = ? AND date_end IS NULL',
    [originServerId]
  );
  return row ? Number(row.c) : 0;
}

/**
 * Get enabled failover relationships where the given server is the primary (parent).
 * Returns candidates ordered by priority.
 * @param {number} parentServerId
 * @returns {Promise<Array>} relationship rows with failover server details
 */
async function getFailoverRelationships(parentServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.enabled AS server_enabled,
            s.runtime_enabled, s.last_heartbeat_at
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.child_server_id
     WHERE r.parent_server_id = ?
       AND r.relationship_type = 'failover'
       AND r.enabled = 1
       AND s.enabled = 1
     ORDER BY r.priority ASC`
  );
}

/**
 * Reconcile a single placement's clients count from active session truth.
 * Sets clients = count of active sessions for that stream_type+stream_id+server_id.
 * Also updates the status: 'running' if clients > 0, 'stopped' otherwise.
 * @param {string} streamType
 * @param {string} streamId
 * @param {number} serverId
 */
async function reconcilePlacementClients(streamType, streamId, serverId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM line_runtime_sessions
     WHERE stream_type = ? AND stream_id = ? AND origin_server_id = ? AND date_end IS NULL`,
    [streamType, String(streamId), serverId]
  );
  const clients = row ? Number(row.c) : 0;
  const status = clients > 0 ? 'running' : 'stopped';
  await execute(
    `UPDATE stream_server_placement
     SET clients = ?, status = ?, updated_at = NOW()
     WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [clients, status, streamType, String(streamId), serverId]
  );
}

/**
 * Full reconciliation of all placement client counts from active session truth.
 * Runs across all placement rows and corrects drifted or stale counts.
 */
async function reconcileAllPlacementClients() {
  // Get all unique (stream_type, stream_id, server_id) combos from active sessions
  const activeCounts = await query(
    `SELECT stream_type, stream_id, origin_server_id, COUNT(*) AS c
     FROM line_runtime_sessions
     WHERE date_end IS NULL
     GROUP BY stream_type, stream_id, origin_server_id`
  );

  // Build a map for quick lookup
  const countMap = new Map(
    activeCounts.map(r => [`${r.stream_type}:${r.stream_id}:${r.origin_server_id}`, Number(r.c)])
  );

  // Get all placement rows
  const placements = await query(
    'SELECT stream_type, stream_id, server_id, clients, status FROM stream_server_placement'
  );

  let reconciled = 0;
  for (const p of placements) {
    const key = `${p.stream_type}:${p.stream_id}:${p.server_id}`;
    const expected = countMap.get(key) || 0;
    const currentClients = Number(p.clients) || 0;
    const currentStatus = String(p.status || '');
    const expectedStatus = expected > 0 ? 'running' : 'stopped';
    if (currentClients !== expected || currentStatus !== expectedStatus) {
      await execute(
        `UPDATE stream_server_placement
         SET clients = ?, status = ?, updated_at = NOW()
         WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
        [expected, expectedStatus, p.stream_type, String(p.stream_id), p.server_id]
      );
      reconciled++;
    }
  }
  return reconciled;
}

/**
 * Close runtime sessions that have not been touched within maxAgeSeconds.
 * Used by the stale-session reaper to clean up zombie sessions.
 * @param {number} maxAgeSeconds - sessions with last_seen_at older than this are closed
 * @returns {Promise<number>} number of sessions closed
 */
async function cleanStaleRuntimeSessions(maxAgeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(60, maxAgeSeconds);
  const result = await execute(
    `UPDATE line_runtime_sessions
     SET date_end = ?, last_seen_at = ?
     WHERE date_end IS NULL AND last_seen_at < FROM_UNIXTIME(?)`,
    [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), cutoff]
  );
  return result.affectedRows || 0;
}

// ─── Phase 7 — Origin/Proxy Chain Helpers ──────────────────────────

/**
 * Get enabled origin→proxy relationships where the given server is the parent (origin).
 * Returns proxy children ordered by priority.
 * @param {number} originServerId
 * @returns {Promise<Array>} relationship rows with proxy server details
 */
async function getProxyRelationships(originServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.private_ip,
            s.enabled AS server_enabled, s.proxy_enabled, s.last_heartbeat_at,
            s.meta_json
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.child_server_id
     WHERE r.parent_server_id = ?
       AND r.relationship_type = 'origin-proxy'
       AND r.enabled = 1
       AND s.enabled = 1
       AND s.proxy_enabled = 1
     ORDER BY r.priority ASC`
  );
}

/**
 * Get all origin servers that a proxy server forwards to (reverse of getProxyRelationships).
 * Returns origin servers where this proxy is the child in an origin-proxy relationship.
 * @param {number} proxyServerId
 * @returns {Promise<Array>} origin server rows
 */
async function getOriginServersForProxy(proxyServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.private_ip,
            s.enabled AS server_enabled, s.runtime_enabled, s.last_heartbeat_at,
            s.meta_json
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.parent_server_id
     WHERE r.child_server_id = ?
       AND r.relationship_type = 'origin-proxy'
       AND r.enabled = 1
       AND s.enabled = 1
     ORDER BY r.priority ASC`
  );
}

// ─── Phase 1 XC Runtime: Command Queue Foundation Helpers ──────────────

/**
 * Create a new server command and return its id.
 * @param {Object} p
 */
async function createServerCommand({ serverId, streamType, streamId, placementId, commandType, payload, issuedByUserId }) {
  const validTypes = ['start_stream','stop_stream','restart_stream','probe_stream','reload_proxy_config','sync_server_config','reconcile_runtime','reconcile_sessions'];
  if (!validTypes.includes(commandType)) throw new Error(`invalid command_type: ${commandType}`);
  return await insert(
    `INSERT INTO server_commands
     (server_id, stream_type, stream_id, placement_id, command_type, payload_json, issued_by_user_id, status, attempt_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NOW())`,
    [
      serverId,
      streamType || null,
      streamId != null ? String(streamId) : null,
      placementId || null,
      commandType,
      payload != null ? JSON.stringify(payload) : null,
      issuedByUserId || null,
    ]
  );
}

/**
 * Lease up to `limit` queued commands for a server.
 * Sets lease_token, lease_expires_at, and status = 'leased'.
 * Returns the leased rows.
 */
async function leaseServerCommands(serverId, limit = 5) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await execute(
    `UPDATE server_commands
     SET status = 'leased', lease_token = ?, lease_expires_at = ?
     WHERE id IN (
       SELECT id FROM (
         SELECT id FROM server_commands
         WHERE server_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT ?
       ) AS sub
     )`,
    [token, expiresAt, serverId, limit]
  );
  return await query(
    `SELECT * FROM server_commands WHERE server_id = ? AND status = 'leased' AND lease_token = ? ORDER BY created_at ASC`,
    [serverId, token]
  );
}

/** Mark a leased command as running. */
async function markServerCommandRunning(commandId) {
  await execute(
    `UPDATE server_commands SET status = 'running', attempt_count = attempt_count + 1, delivered_at = NOW() WHERE id = ? AND status = 'leased'`,
    [commandId]
  );
}

/** Mark a command as succeeded with a result payload. */
async function markServerCommandSucceeded(commandId, result) {
  await execute(
    `UPDATE server_commands SET status = 'succeeded', result_json = ?, finished_at = NOW() WHERE id = ?`,
    [result != null ? JSON.stringify(result) : null, commandId]
  );
}

/** Mark a command as failed with an error. */
async function markServerCommandFailed(commandId, errorText) {
  await execute(
    `UPDATE server_commands SET status = 'failed', error_text = ?, finished_at = NOW() WHERE id = ?`,
    [errorText || null, commandId]
  );
}

/** Expire stale leases that have passed their lease_expires_at. */
async function expireStaleLeases() {
  await execute(
    `UPDATE server_commands SET status = 'expired' WHERE status = 'leased' AND lease_expires_at < NOW()`
  );
}

// ─── Phase 1 XC Runtime: Node Credential Foundation Helpers ────────────

/**
 * Create a new agent credential for a server.
 * @param {number} serverId
 * @param {string} plainSecret - the raw secret (will be hashed before storage)
 * @returns {Promise<{id: number, credential_id: string, plainSecret: string}>}
 */
async function createServerAgentCredential(serverId, plainSecret) {
  const credentialId = `cred_${crypto.randomBytes(8).toString('hex')}`;
  const secretHash = hashApiKey(String(plainSecret));
  const id = await insert(
    `INSERT INTO server_agent_credentials
     (server_id, credential_id, secret_hash, status, issued_at)
     VALUES (?, ?, ?, 'active', NOW())`,
    [serverId, credentialId, secretHash]
  );
  return { id, credentialId, plainSecret };
}

/**
 * Get the active (non-revoked) credential for a server.
 * Returns the row with secret_hash (caller compares).
 */
async function getActiveServerAgentCredential(serverId) {
  return await queryOne(
    `SELECT * FROM server_agent_credentials WHERE server_id = ? AND status = 'active' ORDER BY issued_at DESC LIMIT 1`,
    [serverId]
  );
}

/**
 * Revoke a credential by credential_id.
 */
async function revokeServerAgentCredential(serverId, credentialId) {
  await execute(
    `UPDATE server_agent_credentials SET status = 'revoked' WHERE server_id = ? AND credential_id = ?`,
    [serverId, credentialId]
  );
}

/**
 * Touch last_used_at on a credential (called on successful auth).
 */
async function touchServerAgentCredential(credentialId) {
  await execute(
    `UPDATE server_agent_credentials SET last_used_at = NOW() WHERE credential_id = ?`,
    [credentialId]
  );
}

/**
 * Phase 8 — Credential rotation with overlapping window.
 *
 * Creates a new active credential while keeping the old one in 'rotating' status.
 * Returns the new credential so the panel can push it to the node. The old
 * credential stays valid during the overlap window so the node is not locked out
 * while updating its AGENT_SECRET.
 *
 * After the node has confirmed the new secret, call revokeRotatingCredentials(serverId)
 * to clean up the old credential.
 *
 * @param {number} serverId
 * @param {string} [plainSecret] - optional; a cryptographically random secret is generated if not provided
 * @returns {Promise<{newCredential: {id: number, credential_id: string, plainSecret: string}, oldCredential: object|null}>}
 */
async function rotateServerAgentCredential(serverId, plainSecret) {
  const newPlainSecret = plainSecret || crypto.randomBytes(24).toString('base64url');
  const newCredentialId = `cred_${crypto.randomBytes(8).toString('hex')}`;
  const newSecretHash = hashApiKey(newPlainSecret);

  // Mark any existing active credential as 'rotating' (overlap window)
  await execute(
    `UPDATE server_agent_credentials SET status = 'rotating', rotated_at = NOW()
     WHERE server_id = ? AND status = 'active'`,
    [serverId]
  );

  // Insert the new credential as active
  const newId = await insert(
    `INSERT INTO server_agent_credentials
     (server_id, credential_id, secret_hash, status, issued_at)
     VALUES (?, ?, ?, 'active', NOW())`,
    [serverId, newCredentialId, newSecretHash]
  );

  // Get the old credential for audit purposes
  const oldCredential = await queryOne(
    `SELECT * FROM server_agent_credentials WHERE server_id = ? AND status = 'rotating' ORDER BY issued_at DESC LIMIT 1`,
    [serverId]
  );

  return {
    newCredential: { id: newId, credentialId: newCredentialId, plainSecret: newPlainSecret },
    oldCredential,
  };
}

/**
 * Get all valid (non-revoked) credentials for a server — includes both
 * 'active' and 'rotating' credentials. Used during credential rotation to
 * validate a node's secret against both the current and the incoming credential.
 *
 * @param {number} serverId
 * @returns {Promise<object[]>}
 */
async function getValidServerCredentials(serverId) {
  return await query(
    `SELECT id, server_id, credential_id, status, issued_at, rotated_at, last_used_at
     FROM server_agent_credentials
     WHERE server_id = ? AND status IN ('active', 'rotating')
     ORDER BY issued_at DESC`,
    [serverId]
  );
}

/**
 * Revoke any 'rotating' credentials for a server. Called after a successful
 * rotation to clean up the old credential, or to discard a failed rotation.
 *
 * @param {number} serverId
 * @returns {Promise<number>} number of credentials revoked
 */
async function revokeRotatingCredentials(serverId) {
  const { affectedRows } = await execute(
    `UPDATE server_agent_credentials SET status = 'revoked' WHERE server_id = ? AND status = 'rotating'`,
    [serverId]
  );
  return affectedRows;
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  hashApiKey,
  seedDefaults,

  getSetting, setSetting, getAllSettings,

  createUser, findUserByUsername, findUserById, getAllUsers, userCount,
  verifyPassword, updateUser, deleteUser, touchUserLastLogin, getUserGroup, isAdmin, isReseller,
  hashLinePassword, verifyLinePasswordHash, verifyLinePassword,
  encryptLinePassword,
  attachLinePassword,

  listUserGroups, getUserGroupById, createUserGroup, updateUserGroup, deleteUserGroup,

  addCreditLog, getCreditLogs,

  listResellerPackageOverrides, getResellerPackageOverride, replaceResellerPackageOverrides,
  listResellerExpiryMediaServices, getResellerExpiryMediaServiceById, getResellerExpiryMediaServiceByUserId,
  createResellerExpiryMediaService, updateResellerExpiryMediaService, deleteResellerExpiryMediaService,
  listResellerExpiryMediaItems, replaceResellerExpiryMediaItems, getMatchingResellerExpiryMedia,
  touchLineExpirationMedia,

  createApiKey, listApiKeys, deleteApiKey, resolveApiKey,

  createLine, getLineById, getLineByUsername, listLines, lineCount,
  updateLine, deleteLine, deleteExpiredLines, updateLineActivity,
  getActiveConnections, addLiveConnection, removeLiveConnection,
  clearStaleLiveConnections, countLiveConnections,
  writeActivityHistory,

  insertChannel, updateChannelRow, deleteChannelRow,
  listChannelRowsForUser, listAllChannelRows,

  upsertChannelHealth, getChannelHealth,
  insertQoeMetric, getQoeHistory, getQoeAgg, upsertQoeAgg,

  listCategories, getCategoryById, createCategory, updateCategory, deleteCategory,

  listBouquets, getBouquetById, getBouquetsByIds, createBouquet, updateBouquet, deleteBouquet,

  listPackages, getPackageById, createPackage, updatePackage, deletePackage,

  listMovies, getMovieById, movieCount, createMovie, updateMovie, deleteMovie,

  listSeries, getSeriesById, seriesCount, createSeries, updateSeriesRow, deleteSeries,

  listEpisodes, listAllEpisodes, getEpisodeById, createEpisode, updateEpisode, deleteEpisode, getEffectiveEpisodeServerId,

  listEpgSources, createEpgSource, deleteEpgSource, updateEpgSourceTimestamp,
  clearEpgData, insertEpgProgram, insertEpgBatch,
  getEpgForChannel, getShortEpg, getAllEpgData,

  listBlockedIps, addBlockedIp, removeBlockedIp, isIpBlocked,
  listBlockedUas, addBlockedUa, removeBlockedUa, isUaBlocked,
  listBlockedIsps, addBlockedIsp, removeBlockedIsp,
  recordAuthAttempt, getAuthAttempts, cleanOldAuthFlood,

  addPanelLog, getPanelLogs,

  listOutputFormats,

  listStreamArguments,

  listProfiles, getProfileById, createProfile, updateProfile, deleteProfile,

  listTranscodeProfiles, getTranscodeProfile, createTranscodeProfile, updateTranscodeProfile, deleteTranscodeProfile,

  ensureImportProvidersTable,
  ensureLinePasswordSecurityColumns,
  migrateLegacyLinePasswords,
  listImportProviders, getImportProviderById, createImportProvider, updateImportProvider, deleteImportProvider,
  ensureAccessCodesTable,
  ensurePackagesOptionsJsonColumn,
  ensureMoviesSeriesStreamServerIdColumns,
  ensureReleaseDateColumnsWide,
  ensureStreamingServersTables,
  ensureServerProvisioningJobsTable,
  ensureEpisodesStreamServerIdColumn,
  ensureServerRelationshipsTable,
  ensureStreamServerPlacementTable,
  ensureLineRuntimeSessionsTable,
  ensureServerCommandsTable,
  ensureServerAgentCredentialsTable,
  ensureDefaultStreamServerIdSetting,
  ensureBackupsTable,
  ensureBlockedAsnsTable,
  ensureLoginEventsTable,
  ensureRolesPermissionsTables,
  ensureUsersNotesColumn,
  ensureUserGroupsManageExpiryMediaColumn,
  ensureResellerPackageOverridesTable,
  ensureResellerExpiryMediaTables,
  ensurePlexServersTable,
  ensureAdminFeatureTables,
  listAccessCodes, getAccessCodeByCode, getAccessCodeById, createAccessCode, updateAccessCode, deleteAccessCode, touchAccessCodeUsage,
  getFirstAdminUserId,
  listAllMovieStreamUrls, listAllSeriesTitles, listAllEpisodeStreamUrls, listAllChannelMpdUrls,
  listAllMovieIds, listAllSeriesIds, listAllLiveChannelIds,

  addServerRelationship, removeServerRelationship, getServerRelationships, getServerChildren,

  createPlacement, updatePlacementClients, getPlacement, getActivePlacementsForServer,
  upsertPlacementRuntimeState, setPlacementDesiredState, markPlacementStarting,
  markPlacementRunning, markPlacementStopped, markPlacementError,
  getPlacementByAsset, getPlacementsByServer,
  reportPlacementRuntimeFromNode,
  openRuntimeSession, touchRuntimeSession, closeRuntimeSession,
  listActiveRuntimeSessionsByServer, countActiveRuntimeSessionsByPlacement, countActiveRuntimeSessionsByServer,
  getFailoverRelationships,
  getProxyRelationships, getOriginServersForProxy,
  reconcilePlacementClients, reconcileAllPlacementClients, cleanStaleRuntimeSessions,
  createServerCommand, leaseServerCommands, markServerCommandRunning,
  markServerCommandSucceeded, markServerCommandFailed, expireStaleLeases,
  createServerAgentCredential, getActiveServerAgentCredential,
  revokeServerAgentCredential, touchServerAgentCredential,
  rotateServerAgentCredential, getValidServerCredentials, revokeRotatingCredentials,
  getEffectiveEpisodeServerId,
};
