'use strict';

const bcrypt = require('bcryptjs');
const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const {
  mysqlDatetimeToUnixSeconds,
  unixSecondsToMysqlDatetime,
} = require('../lib/mysql-datetime');

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    ...row,
    last_login: mysqlDatetimeToUnixSeconds(row.last_login),
  };
}

async function createUser(username, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  return await insert(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [username, passwordHash]
  );
}

async function findUserByUsername(username) {
  return normalizeUserRow(
    await queryOne(
      'SELECT id, username, password_hash, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, api_key, last_login, created_at FROM users WHERE username = ?',
      [username]
    )
  );
}

async function findUserById(id) {
  return normalizeUserRow(
    await queryOne(
      'SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, theme, lang, last_login, created_at FROM users WHERE id = ?',
      [id]
    )
  );
}

async function getAllUsers() {
  const rows = await query(
    'SELECT id, username, email, notes, member_group_id, credits, status, reseller_dns, owner_id, last_login, created_at FROM users'
  );
  return rows.map(normalizeUserRow);
}

async function userCount() {
  const row = await queryOne('SELECT COUNT(*) AS c FROM users');
  return row.c;
}

async function verifyPassword(userRow, password) {
  return await bcrypt.compare(password, userRow.password_hash);
}

async function updateUser(id, fields) {
  const allowed = [
    'email',
    'notes',
    'member_group_id',
    'credits',
    'status',
    'reseller_dns',
    'owner_id',
    'theme',
    'lang',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      vals.push(fields[k]);
    }
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
  await execute('UPDATE users SET last_login = ? WHERE id = ?', [
    unixSecondsToMysqlDatetime(at),
    id,
  ]);
}

async function deleteUser(id) {
  return await remove('DELETE FROM users WHERE id = ?', [id]);
}

async function getUserGroup(userId) {
  const u = await queryOne('SELECT member_group_id FROM users WHERE id = ?', [
    userId,
  ]);
  if (!u) return null;
  return await queryOne('SELECT * FROM user_groups WHERE group_id = ?', [
    u.member_group_id,
  ]);
}

async function isAdmin(userId) {
  const g = await getUserGroup(userId);
  return g && g.is_admin === 1;
}

async function isReseller(userId) {
  const g = await getUserGroup(userId);
  return g && g.is_reseller === 1;
}

async function getFirstAdminUserId() {
  const admin = await queryOne(
    `SELECT u.id FROM users u
     JOIN user_groups g ON g.group_id = u.member_group_id
     WHERE g.is_admin = 1 LIMIT 1`
  );
  if (admin) return admin.id;
  // Fallback to first user if no admin group exists
  const first = await queryOne('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  return first ? first.id : null;
}

module.exports = {
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
};
