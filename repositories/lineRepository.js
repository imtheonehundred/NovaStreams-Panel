'use strict';

const crypto = require('crypto');
const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const {
  hashLinePassword,
  verifyLinePasswordHash,
  encryptLinePassword,
  decryptLinePassword,
} = require('../lib/crypto');
const {
  unixSecondsToMysqlDatetime,
  mysqlDatetimeToUnixSeconds,
} = require('../lib/mysql-datetime');

function clampPagination(limit, offset, maxLimit = 100) {
  let l = parseInt(limit, 10) || 50;
  let o = parseInt(offset, 10) || 0;
  if (l < 1) l = 1;
  if (l > maxLimit) l = maxLimit;
  if (o < 0) o = 0;
  return { limit: l, offset: o };
}

function normalizeLineTimestampFields(row) {
  if (!row) return null;
  return {
    ...row,
    exp_date: mysqlDatetimeToUnixSeconds(row.exp_date),
    created_at: mysqlDatetimeToUnixSeconds(row.created_at),
    last_expiration_video: mysqlDatetimeToUnixSeconds(
      row.last_expiration_video
    ),
    last_activity: mysqlDatetimeToUnixSeconds(row.last_activity),
  };
}

async function createLine(data) {
  const plainPassword = String(data.password || '');
  const passwordHash = await hashLinePassword(plainPassword);
  const passwordEnc = encryptLinePassword(plainPassword);
  return await insert(
    `INSERT INTO \`lines\` (username, password_hash, password_enc, member_id, exp_date, admin_enabled, enabled, bouquet, allowed_outputs, max_connections, is_trial, is_mag, is_e2, is_restreamer, allowed_ips, allowed_ua, forced_country, is_isplock, package_id, contact, force_server_id, bypass_ua, access_token, created_at, admin_notes, reseller_notes, is_stalker)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.username,
      passwordHash,
      passwordEnc,
      data.member_id || null,
      unixSecondsToMysqlDatetime(data.exp_date),
      data.admin_enabled !== undefined ? data.admin_enabled : 1,
      data.enabled !== undefined ? data.enabled : 1,
      JSON.stringify(data.bouquet || []),
      JSON.stringify(data.allowed_outputs || []),
      data.max_connections || 1,
      data.is_trial || 0,
      data.is_mag || 0,
      data.is_e2 || 0,
      data.is_restreamer || 0,
      JSON.stringify(data.allowed_ips || []),
      JSON.stringify(data.allowed_ua || []),
      data.forced_country || '',
      data.is_isplock || 0,
      data.package_id || null,
      data.contact || '',
      data.force_server_id || 0,
      data.bypass_ua || 0,
      data.access_token || crypto.randomBytes(16).toString('hex'),
      unixSecondsToMysqlDatetime(Math.floor(Date.now() / 1000)),
      data.admin_notes || '',
      data.reseller_notes || '',
      data.is_stalker || 0,
    ]
  );
}

async function getLineById(id) {
  return normalizeLineTimestampFields(
    await queryOne('SELECT * FROM `lines` WHERE id = ?', [id])
  );
}

async function getLineByUsername(username) {
  return normalizeLineTimestampFields(
    await queryOne('SELECT * FROM `lines` WHERE username = ?', [username])
  );
}

async function getLineByAccessToken(token) {
  return normalizeLineTimestampFields(
    await queryOne(
      'SELECT id, username, exp_date, enabled, admin_enabled FROM `lines` WHERE access_token = ? LIMIT 1',
      [token]
    )
  );
}

async function listLines(memberId, rawLimit, rawOffset) {
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  if (memberId !== undefined && memberId !== null) {
    const total = (
      await queryOne('SELECT COUNT(*) AS c FROM `lines` WHERE member_id = ?', [
        memberId,
      ])
    ).c;
    const rows = await query(
      'SELECT id, username, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact, force_server_id, package_id FROM `lines` WHERE member_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [memberId, limit, offset]
    );
    return { lines: rows.map(normalizeLineTimestampFields), total };
  }
  const total = (await queryOne('SELECT COUNT(*) AS c FROM `lines`')).c;
  const rows = await query(
    'SELECT id, username, member_id, admin_enabled, exp_date, max_connections, is_trial, last_ip, last_activity, enabled, contact, force_server_id, package_id FROM `lines` ORDER BY id DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return { lines: rows.map(normalizeLineTimestampFields), total };
}

async function lineCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM `lines`');
  return row.c;
}

async function updateLine(id, data) {
  const allowed = [
    'exp_date',
    'admin_enabled',
    'enabled',
    'admin_notes',
    'reseller_notes',
    'bouquet',
    'allowed_outputs',
    'max_connections',
    'is_trial',
    'is_mag',
    'is_e2',
    'is_stalker',
    'is_restreamer',
    'allowed_ips',
    'allowed_ua',
    'forced_country',
    'is_isplock',
    'package_id',
    'contact',
    'force_server_id',
    'bypass_ua',
  ];
  const sets = [];
  const vals = [];
  if (data.password !== undefined) {
    const plainPassword = String(data.password || '');
    sets.push('`password_hash` = ?');
    vals.push(await hashLinePassword(plainPassword));
    sets.push('`password_enc` = ?');
    vals.push(encryptLinePassword(plainPassword));
  }
  for (const k of allowed) {
    if (data[k] !== undefined) {
      if (
        ['bouquet', 'allowed_outputs', 'allowed_ips', 'allowed_ua'].includes(k)
      ) {
        sets.push(`\`${k}\` = ?`);
        vals.push(JSON.stringify(data[k]));
      } else {
        sets.push(`\`${k}\` = ?`);
        if (k === 'exp_date') {
          vals.push(data[k] ? unixSecondsToMysqlDatetime(data[k]) : null);
        } else if (['last_expiration_video', 'last_activity'].includes(k)) {
          vals.push(unixSecondsToMysqlDatetime(data[k]));
        } else {
          vals.push(data[k]);
        }
      }
    }
  }
  if (data.username !== undefined) {
    sets.push('username = ?');
    vals.push(data.username);
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE \`lines\` SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function ensureLinePasswordSecurityColumns() {
  const cols = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lines' AND COLUMN_NAME IN ('password_hash', 'password_enc')`
  );
  const passwordCol = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lines' AND COLUMN_NAME = 'password'`
  );
  const afterColumn =
    passwordCol && Number(passwordCol.c) > 0 ? 'password' : 'username';
  const present = new Set(
    (cols || []).map((row) => String(row.COLUMN_NAME || row.column_name || ''))
  );
  if (!present.has('password_hash')) {
    await execute(
      `ALTER TABLE \`lines\` ADD COLUMN \`password_hash\` VARCHAR(255) NULL AFTER \`${afterColumn}\``
    );
  }
  if (!present.has('password_enc')) {
    await execute(
      'ALTER TABLE `lines` ADD COLUMN `password_enc` TEXT NULL AFTER `password_hash`'
    );
  }
}

async function migrateLegacyLinePasswords() {
  const hasLegacyPasswordColumn = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lines' AND COLUMN_NAME = 'password'`
  );
  const rows = await query(
    hasLegacyPasswordColumn && Number(hasLegacyPasswordColumn.c) > 0
      ? `SELECT id, password, password_hash, password_enc FROM \`lines\`
         WHERE (password IS NOT NULL AND password <> '')
            OR password_hash IS NULL OR password_hash = ''
            OR password_enc IS NULL OR password_enc = ''`
      : `SELECT id, password_hash, password_enc FROM \`lines\`
         WHERE password_hash IS NULL OR password_hash = ''
            OR password_enc IS NULL OR password_enc = ''`
  );
  for (const row of rows || []) {
    const legacyPassword = String(row.password || '');
    const recoveredPassword =
      legacyPassword || decryptLinePassword(row.password_enc);
    if (!recoveredPassword) continue;
    const existingHash = row.password_hash ? String(row.password_hash) : '';
    const existingEnc = row.password_enc ? String(row.password_enc) : '';
    const hashMatchesLegacy = existingHash
      ? await verifyLinePasswordHash(recoveredPassword, existingHash)
      : false;
    const encMatchesLegacy = existingEnc
      ? decryptLinePassword(existingEnc) === recoveredPassword
      : false;
    const nextHash = hashMatchesLegacy
      ? existingHash
      : await hashLinePassword(recoveredPassword);
    const nextEnc = encMatchesLegacy
      ? existingEnc
      : encryptLinePassword(recoveredPassword);
    if (hasLegacyPasswordColumn && Number(hasLegacyPasswordColumn.c) > 0) {
      await execute(
        'UPDATE `lines` SET password = ?, password_hash = ?, password_enc = ? WHERE id = ?',
        ['', nextHash, nextEnc, row.id]
      );
    } else {
      await execute(
        'UPDATE `lines` SET password_hash = ?, password_enc = ? WHERE id = ?',
        [nextHash, nextEnc, row.id]
      );
    }
  }
}

async function countIncompleteLinePasswordSecurityRows() {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM \`lines\`
     WHERE password_hash IS NULL OR password_hash = ''
        OR password_enc IS NULL OR password_enc = ''`
  );
  return row ? Number(row.c) || 0 : 0;
}

async function dropLegacyLinePasswordColumnIfSafe() {
  const col = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lines' AND COLUMN_NAME = 'password'`
  );
  if (!col || Number(col.c) === 0) return false;
  const incomplete = await countIncompleteLinePasswordSecurityRows();
  if (incomplete > 0) {
    throw new Error(
      `Cannot drop legacy lines.password column while ${incomplete} rows are missing password_hash/password_enc`
    );
  }
  await execute('ALTER TABLE `lines` DROP COLUMN `password`');
  return true;
}

async function deleteLine(id) {
  return await remove('DELETE FROM `lines` WHERE id = ?', [id]);
}

async function deleteExpiredLines(cutoffTs = Math.floor(Date.now() / 1000)) {
  const result = await execute(
    'DELETE FROM `lines` WHERE exp_date IS NOT NULL AND exp_date < ?',
    [unixSecondsToMysqlDatetime(cutoffTs)]
  );
  return result.affectedRows || 0;
}

async function updateLineActivity(id, ip) {
  await execute(
    'UPDATE `lines` SET last_ip = ?, last_activity = ? WHERE id = ?',
    [ip || '', unixSecondsToMysqlDatetime(Math.floor(Date.now() / 1000)), id]
  );
}

async function getActiveConnections(_userId) {
  return [];
}
async function addLiveConnection(_data) {
  return 0;
}
async function removeLiveConnection(_activityId) {
  return false;
}
async function clearStaleLiveConnections() {
  return 0;
}
async function countLiveConnections(_userId) {
  return 0;
}

async function writeActivityHistory(data) {
  await execute(
    'INSERT INTO lines_activity (user_id, stream_id, server_id, user_agent, user_ip, container, date_start, date_end, geoip_country_code, isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      data.user_id,
      data.stream_id || 0,
      data.server_id || 0,
      data.user_agent || '',
      data.user_ip || '',
      data.container || '',
      unixSecondsToMysqlDatetime(data.date_start),
      unixSecondsToMysqlDatetime(
        data.date_end || Math.floor(Date.now() / 1000)
      ),
      data.geoip_country_code || '',
      data.isp || '',
    ]
  );
}

module.exports = {
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
};
