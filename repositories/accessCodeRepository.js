'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const { hashApiKey } = require('../lib/crypto');

async function ensureAccessCodesTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(255) NOT NULL,
      role ENUM('admin','reseller','user') NOT NULL DEFAULT 'admin',
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      description VARCHAR(255) DEFAULT '',
      last_used_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_access_codes_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    ALTER TABLE access_codes
    MODIFY COLUMN role ENUM('admin','reseller','user') NOT NULL DEFAULT 'admin'
  `);
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
  if (!['admin', 'reseller', 'user'].includes(role)) throw new Error('invalid role');
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
    if (!['admin', 'reseller', 'user'].includes(role)) throw new Error('invalid role');
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

module.exports = {
  ensureAccessCodesTable,
  listAccessCodes,
  getAccessCodeByCode,
  getAccessCodeById,
  createAccessCode,
  updateAccessCode,
  deleteAccessCode,
  touchAccessCodeUsage,
};
