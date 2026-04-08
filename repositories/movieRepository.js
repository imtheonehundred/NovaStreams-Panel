'use strict';

const {
  query,
  queryOne,
  insert,
  update,
  remove,
  execute,
} = require('../lib/mariadb');
const {
  clampPagination,
  sanitizeReleaseDate,
  mysqlDatetimeToUnixSeconds,
  unixSecondsToMysqlDatetime,
} = require('../lib/mysql-datetime');

const MOVIE_LIST_COLS =
  'id, name, stream_icon, category_id, rating, rating_5based, year, tmdb_id, container_extension, stream_server_id, added';

function normalizeMovieTimestampRow(row) {
  if (!row) return null;
  return {
    ...row,
    added: mysqlDatetimeToUnixSeconds(row.added),
  };
}

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
  const total = (
    await queryOne(`SELECT COUNT(*) AS c FROM movies ${whereStr}`, params)
  ).c;
  const rows = await query(
    `SELECT ${MOVIE_LIST_COLS} FROM movies ${whereStr} ORDER BY id ${orderDir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { movies: rows.map(normalizeMovieTimestampRow), total };
}

async function getMovieById(id) {
  return normalizeMovieTimestampRow(
    await queryOne('SELECT * FROM movies WHERE id = ?', [id])
  );
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
      data.name || '',
      data.stream_url || '',
      data.stream_source || '',
      data.category_id || '',
      data.stream_icon || '',
      data.rating || '0',
      data.rating_5based || 0,
      data.plot || '',
      data.movie_cast || '',
      data.director || '',
      data.genre || '',
      data.duration || '',
      data.duration_secs || 0,
      data.container_extension || 'mp4',
      JSON.stringify(data.movie_properties || {}),
      data.tmdb_id || null,
      data.backdrop_path || '',
      data.year || null,
      JSON.stringify(data.subtitles || []),
      sanitizeReleaseDate(data.release_date),
      data.youtube_trailer || '',
      data.country || '',
      JSON.stringify(data.similar || []),
      Number.isFinite(ssid) && ssid > 0 ? ssid : 0,
      unixSecondsToMysqlDatetime(data.added || Math.floor(Date.now() / 1000)),
    ]
  );
}

async function updateMovie(id, data) {
  const cols = [
    'name',
    'stream_url',
    'stream_source',
    'category_id',
    'stream_icon',
    'rating',
    'rating_5based',
    'plot',
    'movie_cast',
    'director',
    'genre',
    'duration',
    'duration_secs',
    'container_extension',
    'tmdb_id',
    'backdrop_path',
    'year',
    'release_date',
    'youtube_trailer',
    'country',
    'stream_server_id',
  ];
  const sets = [];
  const vals = [];
  for (const k of cols) {
    if (data[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      if (k === 'stream_server_id') {
        const n = parseInt(data[k], 10);
        vals.push(Number.isFinite(n) && n > 0 ? n : 0);
      } else {
        vals.push(
          k === 'release_date' ? sanitizeReleaseDate(data[k]) : data[k]
        );
      }
    }
  }
  if (data.movie_properties !== undefined) {
    sets.push('movie_properties = ?');
    vals.push(JSON.stringify(data.movie_properties));
  }
  if (data.subtitles !== undefined) {
    sets.push('subtitles_json = ?');
    vals.push(JSON.stringify(data.subtitles));
  }
  if (data.similar !== undefined) {
    sets.push('similar = ?');
    vals.push(JSON.stringify(data.similar));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE movies SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteMovie(id) {
  return await remove('DELETE FROM movies WHERE id = ?', [id]);
}

async function listAllMovieStreamUrls() {
  const rows = await query(
    'SELECT stream_url FROM movies WHERE stream_url IS NOT NULL AND stream_url != ""'
  );
  return rows.map((r) => r.stream_url);
}

async function listAllMovieIds() {
  const rows = await query('SELECT id FROM movies');
  return rows.map((r) => r.id);
}

module.exports = {
  listMovies,
  getMovieById,
  movieCount,
  createMovie,
  updateMovie,
  deleteMovie,
  listAllMovieStreamUrls,
  listAllMovieIds,
};
