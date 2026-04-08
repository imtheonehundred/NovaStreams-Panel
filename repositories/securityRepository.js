'use strict';

const { query, queryOne, insert, remove, execute } = require('../lib/mariadb');
const { unixSecondsToMysqlDatetime } = require('../lib/mysql-datetime');

async function listBlockedIps() {
  return await query('SELECT * FROM blocked_ips ORDER BY id');
}
async function addBlockedIp(ip, notes) {
  return await insert(
    'INSERT IGNORE INTO blocked_ips (ip, notes) VALUES (?, ?)',
    [ip, notes || '']
  );
}
async function removeBlockedIp(id) {
  return await remove('DELETE FROM blocked_ips WHERE id = ?', [id]);
}
async function isIpBlocked(ip) {
  return !!(await queryOne('SELECT 1 AS ok FROM blocked_ips WHERE ip = ?', [
    ip,
  ]));
}

async function listBlockedUas() {
  return await query('SELECT * FROM blocked_uas ORDER BY id');
}
async function addBlockedUa(ua, notes) {
  return await insert(
    'INSERT INTO blocked_uas (user_agent, notes) VALUES (?, ?)',
    [ua, notes || '']
  );
}
async function removeBlockedUa(id) {
  return await remove('DELETE FROM blocked_uas WHERE id = ?', [id]);
}
async function isUaBlocked(ua) {
  const rows = await query('SELECT user_agent FROM blocked_uas');
  for (const r of rows) {
    try {
      if (new RegExp(r.user_agent, 'i').test(ua)) return true;
    } catch {
      if (ua === r.user_agent) return true;
    }
  }
  return false;
}

async function listBlockedIsps() {
  return await query('SELECT * FROM blocked_isps ORDER BY id');
}
async function addBlockedIsp(isp, notes) {
  return await insert('INSERT INTO blocked_isps (isp, notes) VALUES (?, ?)', [
    isp,
    notes || '',
  ]);
}
async function removeBlockedIsp(id) {
  return await remove('DELETE FROM blocked_isps WHERE id = ?', [id]);
}

async function recordAuthAttempt(ip, username) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await queryOne(
    'SELECT id FROM auth_flood WHERE ip = ? AND username = ?',
    [ip, username || '']
  );
  if (existing) {
    await execute(
      'UPDATE auth_flood SET attempts = attempts + 1, last_attempt = ? WHERE id = ?',
      [unixSecondsToMysqlDatetime(now), existing.id]
    );
  } else {
    await execute(
      'INSERT INTO auth_flood (ip, username, attempts, last_attempt) VALUES (?, ?, 1, ?)',
      [ip, username || '', unixSecondsToMysqlDatetime(now)]
    );
  }
}

async function getAuthAttempts(ip, windowSec) {
  const since = Math.floor(Date.now() / 1000) - (windowSec || 300);
  const row = await queryOne(
    'SELECT SUM(attempts) AS total FROM auth_flood WHERE ip = ? AND last_attempt > ?',
    [ip, unixSecondsToMysqlDatetime(since)]
  );
  return row ? row.total || 0 : 0;
}

async function cleanOldAuthFlood(windowSec) {
  const before = Math.floor(Date.now() / 1000) - (windowSec || 600);
  await execute('DELETE FROM auth_flood WHERE last_attempt < ?', [
    unixSecondsToMysqlDatetime(before),
  ]);
}

module.exports = {
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
};
