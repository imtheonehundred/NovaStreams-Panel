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
  return await queryOne('SELECT id, username, password_hash, email, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, api_key, last_login, created_at FROM users WHERE username = ?', [username]);
}

async function findUserById(id) {
  return await queryOne('SELECT id, username, email, member_group_id, credits, status, reseller_dns, owner_id, theme, lang FROM users WHERE id = ?', [id]);
}

async function getAllUsers() {
  return await query('SELECT id, username, email, member_group_id, credits, status, owner_id, created_at FROM users');
}

async function userCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM users');
  return row.c;
}

async function verifyPassword(userRow, password) {
  return await bcrypt.compare(password, userRow.password_hash);
}

async function updateUser(id, fields) {
  const allowed = ['email', 'member_group_id', 'credits', 'status', 'reseller_dns', 'owner_id', 'theme', 'lang'];
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
  const allowed = ['group_name', 'is_admin', 'is_reseller', 'total_allowed_gen_trials', 'delete_users', 'allowed_pages', 'can_delete', 'create_sub_resellers', 'create_sub_resellers_price', 'allow_change_bouquets'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE user_groups SET ${sets.join(', ')} WHERE group_id = ?`, vals);
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
  return await insert(
    `INSERT INTO \`lines\` (username, password, member_id, exp_date, admin_enabled, enabled, bouquet, allowed_outputs, max_connections, is_trial, is_mag, is_e2, is_restreamer, allowed_ips, allowed_ua, forced_country, is_isplock, package_id, contact, access_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.username, data.password,
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
      data.access_token || crypto.randomBytes(16).toString('hex'),
      Math.floor(Date.now() / 1000),
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
      'SELECT id, username, password, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact FROM `lines` WHERE member_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [memberId, limit, offset]
    );
    return { lines: rows, total };
  }
  const total = (await queryOne('SELECT COUNT(*) AS c FROM `lines`')).c;
  const rows = await query(
    'SELECT id, username, password, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact FROM `lines` ORDER BY id DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return { lines: rows, total };
}

async function lineCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM `lines`');
  return row.c;
}

async function updateLine(id, data) {
  const allowed = ['password', 'exp_date', 'admin_enabled', 'enabled', 'admin_notes', 'reseller_notes', 'bouquet', 'allowed_outputs', 'max_connections', 'is_trial', 'is_mag', 'is_e2', 'is_restreamer', 'allowed_ips', 'allowed_ua', 'forced_country', 'is_isplock', 'package_id', 'contact', 'force_server_id', 'bypass_ua'];
  const sets = [];
  const vals = [];
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

async function deleteLine(id) {
  return await remove('DELETE FROM `lines` WHERE id = ?', [id]);
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

const SERIES_LIST_COLS = 'id, title, cover, category_id, rating, rating_5based, year, tmdb_id, stream_server_id, last_modified';

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
    `INSERT INTO series (title, category_id, cover, cover_big, plot, series_cast, director, genre, rating, rating_5based, release_date, tmdb_id, backdrop_path, year, youtube_trailer, episode_run_time, seasons, similar, stream_server_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title || '', data.category_id || '', data.cover || '', data.cover_big || '',
      data.plot || '', data.series_cast || '', data.director || '', data.genre || '',
      data.rating || '0', data.rating_5based || 0,
      sanitizeReleaseDate(data.release_date), data.tmdb_id || null, data.backdrop_path || '',
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
  return await query('SELECT id, series_id, season_num, episode_num, title, stream_url, stream_source, container_extension, added FROM episodes WHERE series_id = ? ORDER BY season_num, episode_num', [seriesId]);
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
  const rows = await query(`SELECT e.id, e.series_id, e.season_num, e.episode_num, e.title, e.stream_url, e.container_extension, e.added, s.title AS series_title, s.cover AS series_cover FROM episodes e LEFT JOIN series s ON e.series_id = s.id ${whereStr} ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { episodes: rows, total: countRow.c };
}

async function getEpisodeById(id) {
  return await queryOne('SELECT * FROM episodes WHERE id = ?', [id]);
}

async function createEpisode(data) {
  return await insert(
    `INSERT INTO episodes (series_id, season_num, episode_num, title, stream_url, stream_source, direct_source, container_extension, info_json, movie_properties, movie_subtitles, added)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.series_id, data.season_num || 1, data.episode_num || 1,
      data.title || '', data.stream_url || '', data.stream_source || '', data.direct_source || 0,
      data.container_extension || 'mp4',
      JSON.stringify(data.info || {}),
      JSON.stringify(data.movie_properties || {}),
      JSON.stringify(data.movie_subtitles || []),
      data.added || Math.floor(Date.now() / 1000)
    ]
  );
}

async function updateEpisode(id, data) {
  const cols = ['series_id', 'season_num', 'episode_num', 'title', 'stream_url', 'stream_source', 'direct_source', 'container_extension'];
  const sets = [];
  const vals = [];
  for (const k of cols) { if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); } }
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_streaming_servers_role (role, enabled, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS streaming_server_domains (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      domain VARCHAR(255) NOT NULL DEFAULT '',
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_ssd_server (server_id),
      CONSTRAINT fk_ssd_server FOREIGN KEY (server_id) REFERENCES streaming_servers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
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

async function seedDefaults() {
  await ensureImportProvidersTable();
  await ensureAccessCodesTable();
  await ensurePackagesOptionsJsonColumn();
  await ensureMoviesSeriesStreamServerIdColumns();
  await ensureReleaseDateColumnsWide();
  await ensureStreamingServersTables();
  await ensureServerProvisioningJobsTable();
  await ensureDefaultStreamServerIdSetting();
  await ensureStreamingPerformanceDefaults();
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

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  hashApiKey,
  seedDefaults,

  getSetting, setSetting, getAllSettings,

  createUser, findUserByUsername, findUserById, getAllUsers, userCount,
  verifyPassword, updateUser, deleteUser, getUserGroup, isAdmin, isReseller,

  listUserGroups, getUserGroupById, createUserGroup, updateUserGroup,

  addCreditLog, getCreditLogs,

  createApiKey, listApiKeys, deleteApiKey, resolveApiKey,

  createLine, getLineById, getLineByUsername, listLines, lineCount,
  updateLine, deleteLine, updateLineActivity,
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

  listEpisodes, listAllEpisodes, getEpisodeById, createEpisode, updateEpisode, deleteEpisode,

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
  listImportProviders, getImportProviderById, createImportProvider, updateImportProvider, deleteImportProvider,
  ensureAccessCodesTable,
  ensurePackagesOptionsJsonColumn,
  ensureMoviesSeriesStreamServerIdColumns,
  ensureReleaseDateColumnsWide,
  ensureStreamingServersTables,
  ensureServerProvisioningJobsTable,
  ensureDefaultStreamServerIdSetting,
  listAccessCodes, getAccessCodeByCode, getAccessCodeById, createAccessCode, updateAccessCode, deleteAccessCode, touchAccessCodeUsage,
  getFirstAdminUserId,
  listAllMovieStreamUrls, listAllSeriesTitles, listAllEpisodeStreamUrls, listAllChannelMpdUrls,
  listAllMovieIds, listAllSeriesIds, listAllLiveChannelIds,
};
