'use strict';

const fs = require('fs');
const path = require('path');
const { query, queryOne, execute } = require('../lib/mariadb');

const LEGACY_META_PATH = path.join(__dirname, '..', 'data', 'user_meta.json');

function parseMeta(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function ensureUserMetaTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS user_meta (
      user_id INT NOT NULL PRIMARY KEY,
      meta_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getUserMeta(userId) {
  const row = await queryOne('SELECT meta_json FROM user_meta WHERE user_id = ? LIMIT 1', [userId]);
  return parseMeta(row && row.meta_json);
}

async function setUserMeta(userId, meta) {
  const payload = JSON.stringify(meta && typeof meta === 'object' ? meta : {});
  await execute(
    `INSERT INTO user_meta (user_id, meta_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE meta_json = VALUES(meta_json), updated_at = CURRENT_TIMESTAMP`,
    [userId, payload]
  );
  return parseMeta(payload);
}

async function listUserMetaMap(userIds = null) {
  let rows = [];
  if (Array.isArray(userIds) && userIds.length > 0) {
    const ids = [...new Set(userIds.map((value) => parseInt(value, 10)).filter((value) => Number.isFinite(value) && value > 0))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    rows = await query(`SELECT user_id, meta_json FROM user_meta WHERE user_id IN (${placeholders})`, ids);
  } else if (Array.isArray(userIds)) {
    return new Map();
  } else {
    rows = await query('SELECT user_id, meta_json FROM user_meta');
  }

  const out = new Map();
  for (const row of rows) {
    out.set(Number(row.user_id), parseMeta(row.meta_json) || {});
  }
  return out;
}

async function migrateLegacyUserMetaFromJson() {
  if (!fs.existsSync(LEGACY_META_PATH)) return 0;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_META_PATH, 'utf8'));
  } catch {
    return 0;
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return 0;

  const existing = await listUserMetaMap();
  let migrated = 0;
  for (const [rawUserId, rawMeta] of Object.entries(legacy)) {
    const userId = parseInt(rawUserId, 10);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    if (existing.has(userId)) continue;
    const meta = parseMeta(rawMeta);
    if (!meta) continue;
    await setUserMeta(userId, meta);
    migrated++;
  }
  return migrated;
}

module.exports = {
  ensureUserMetaTable,
  getUserMeta,
  setUserMeta,
  listUserMetaMap,
  migrateLegacyUserMetaFromJson,
};
