'use strict';

const mysql = require('mysql2/promise');
const { sanitizeSqlParams } = require('./mysql-datetime');

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'iptv',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iptv_panel',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+00:00',
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, sanitizeSqlParams(params));
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  const [result] = await getPool().execute(sql, sanitizeSqlParams(params));
  return result;
}

async function insert(sql, params = []) {
  const result = await execute(sql, params);
  return result.insertId;
}

async function update(sql, params = []) {
  const result = await execute(sql, params);
  return result.affectedRows;
}

async function remove(sql, params = []) {
  const result = await execute(sql, params);
  return result.affectedRows > 0;
}

async function testConnection() {
  try {
    await getPool().execute('SELECT 1');
    return true;
  } catch (e) {
    console.error('[MariaDB] Connection failed:', e.message);
    return false;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  query,
  queryOne,
  execute,
  insert,
  update,
  remove,
  testConnection,
  closePool,
};
