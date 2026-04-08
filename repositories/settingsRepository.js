'use strict';

const { query, queryOne, execute } = require('../lib/mariadb');

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

module.exports = {
  getSetting,
  setSetting,
  getAllSettings,
};