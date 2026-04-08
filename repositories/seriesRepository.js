'use strict';

const { query, queryOne, insert, update, remove, execute } = require('../lib/mariadb');
const { clampPagination, sanitizeReleaseDate } = require('../lib/mysql-datetime');

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

async function listAllSeriesTitles() {
  const rows = await query('SELECT title FROM series');
  return rows.map(r => r.title);
}

async function listAllSeriesIds() {
  const rows = await query('SELECT id FROM series');
  return rows.map(r => r.id);
}

module.exports = {
  listSeries,
  getSeriesById,
  seriesCount,
  createSeries,
  updateSeriesRow,
  deleteSeries,
  listAllSeriesTitles,
  listAllSeriesIds,
};
