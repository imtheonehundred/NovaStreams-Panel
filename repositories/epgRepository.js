'use strict';

const { query, queryOne, insert, remove, execute } = require('../lib/mariadb');
const {
  sanitizeSqlParams,
  mysqlDatetimeToUnixSeconds,
  unixSecondsToMysqlDatetime,
} = require('../lib/mysql-datetime');

function normalizeEpgRow(row) {
  if (!row) return null;
  return {
    ...row,
    start: mysqlDatetimeToUnixSeconds(row.start),
    stop: mysqlDatetimeToUnixSeconds(row.stop),
  };
}

async function listEpgSources() {
  return await query('SELECT * FROM epg_sources ORDER BY id');
}

async function createEpgSource(name, url) {
  return await insert('INSERT INTO epg_sources (name, url) VALUES (?, ?)', [
    name || '',
    url,
  ]);
}

async function deleteEpgSource(id) {
  return await remove('DELETE FROM epg_sources WHERE id = ?', [id]);
}

async function updateEpgSourceTimestamp(id) {
  await execute('UPDATE epg_sources SET last_updated = NOW() WHERE id = ?', [
    id,
  ]);
}

async function clearEpgData() {
  await execute('DELETE FROM epg_data');
}

async function insertEpgProgram(channelId, title, desc, start, stop, lang) {
  await execute(
    'INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)',
    [
      channelId,
      title,
      desc || '',
      unixSecondsToMysqlDatetime(start),
      unixSecondsToMysqlDatetime(stop),
      lang || 'en',
    ]
  );
}

async function insertEpgBatch(programs) {
  if (!programs.length) return;
  const conn = require('../lib/mariadb').getPool();
  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    for (const p of programs) {
      await c.execute(
        'INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)',
        sanitizeSqlParams([
          p.channel_id,
          p.title,
          p.description || '',
          unixSecondsToMysqlDatetime(p.start),
          unixSecondsToMysqlDatetime(p.stop),
          p.lang || 'en',
        ])
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
  const rows = await query(
    'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? AND start < ? ORDER BY start',
    [
      channelId,
      unixSecondsToMysqlDatetime(fromTs || 0),
      unixSecondsToMysqlDatetime(toTs || 9999999999),
    ]
  );
  return rows.map(normalizeEpgRow);
}

async function getShortEpg(channelId, limit = 4) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await query(
    'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? ORDER BY start LIMIT ?',
    [channelId, unixSecondsToMysqlDatetime(now), limit]
  );
  return rows.map(normalizeEpgRow);
}

async function getAllEpgData() {
  const rows = await query(
    'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data ORDER BY start'
  );
  return rows.map(normalizeEpgRow);
}

module.exports = {
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
};
