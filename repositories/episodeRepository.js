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
  mysqlDatetimeToUnixSeconds,
  unixSecondsToMysqlDatetime,
} = require('../lib/mysql-datetime');

function normalizeEpisodeTimestampRow(row) {
  if (!row) return null;
  return {
    ...row,
    added: mysqlDatetimeToUnixSeconds(row.added),
  };
}

async function listEpisodes(seriesId) {
  const rows = await query(
    'SELECT id, series_id, season_num, episode_num, title, stream_url, stream_source, container_extension, stream_server_id, added FROM episodes WHERE series_id = ? ORDER BY season_num, episode_num',
    [seriesId]
  );
  return rows.map(normalizeEpisodeTimestampRow);
}

async function listAllEpisodes(opts = {}) {
  const { search, series_id, limit: rawLimit, offset: rawOffset } = opts;
  const { limit, offset } = clampPagination(rawLimit, rawOffset);
  const where = [];
  const params = [];
  if (series_id) {
    where.push('e.series_id = ?');
    params.push(series_id);
  }
  if (search) {
    where.push('(e.title LIKE ? OR s.title LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await queryOne(
    `SELECT COUNT(*) AS c FROM episodes e LEFT JOIN series s ON e.series_id = s.id ${whereStr}`,
    params
  );
  const rows = await query(
    `SELECT e.id, e.series_id, e.season_num, e.episode_num, e.title, e.stream_url, e.container_extension, e.stream_server_id, e.added, s.title AS series_title, s.cover AS series_cover FROM episodes e LEFT JOIN series s ON e.series_id = s.id ${whereStr} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    episodes: rows.map(normalizeEpisodeTimestampRow),
    total: countRow.c,
  };
}

async function getEpisodeById(id) {
  return normalizeEpisodeTimestampRow(
    await queryOne('SELECT * FROM episodes WHERE id = ?', [id])
  );
}

async function createEpisode(data) {
  const ssid = parseInt(data.stream_server_id, 10);
  return await insert(
    `INSERT INTO episodes (series_id, season_num, episode_num, title, stream_url, stream_source, direct_source, container_extension, info_json, movie_properties, movie_subtitles, stream_server_id, added)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.series_id,
      data.season_num || 1,
      data.episode_num || 1,
      data.title || '',
      data.stream_url || '',
      data.stream_source || '',
      data.direct_source || 0,
      data.container_extension || 'mp4',
      JSON.stringify(data.info || {}),
      JSON.stringify(data.movie_properties || {}),
      JSON.stringify(data.movie_subtitles || []),
      Number.isFinite(ssid) && ssid > 0 ? ssid : 0,
      unixSecondsToMysqlDatetime(data.added || Math.floor(Date.now() / 1000)),
    ]
  );
}

async function updateEpisode(id, data) {
  const cols = [
    'series_id',
    'season_num',
    'episode_num',
    'title',
    'stream_url',
    'stream_source',
    'direct_source',
    'container_extension',
  ];
  const sets = [];
  const vals = [];
  for (const k of cols) {
    if (data[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      vals.push(data[k]);
    }
  }
  if (data.stream_server_id !== undefined) {
    const n = parseInt(data.stream_server_id, 10);
    sets.push('`stream_server_id` = ?');
    vals.push(Number.isFinite(n) && n > 0 ? n : 0);
  }
  if (data.info !== undefined) {
    sets.push('info_json = ?');
    vals.push(JSON.stringify(data.info));
  }
  if (data.movie_properties !== undefined) {
    sets.push('movie_properties = ?');
    vals.push(JSON.stringify(data.movie_properties));
  }
  if (data.movie_subtitles !== undefined) {
    sets.push('movie_subtitles = ?');
    vals.push(JSON.stringify(data.movie_subtitles));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteEpisode(id) {
  return await remove('DELETE FROM episodes WHERE id = ?', [id]);
}

async function getEffectiveEpisodeServerId(episodeId) {
  const ep = await queryOne(
    'SELECT stream_server_id, series_id FROM episodes WHERE id = ?',
    [episodeId]
  );
  if (!ep) return 0;
  const epServer = parseInt(ep.stream_server_id, 10);
  if (epServer > 0) return epServer;
  const ser = await queryOne(
    'SELECT stream_server_id FROM series WHERE id = ?',
    [ep.series_id]
  );
  if (ser) {
    const serServer = parseInt(ser.stream_server_id, 10);
    if (serServer > 0) return serServer;
  }
  const defRow = await queryOne(
    "SELECT `value` FROM settings WHERE `key` = 'default_stream_server_id'"
  );
  if (defRow) {
    const def = parseInt(defRow.value, 10);
    if (def > 0) return def;
  }
  return 0;
}

module.exports = {
  listEpisodes,
  listAllEpisodes,
  getEpisodeById,
  createEpisode,
  updateEpisode,
  deleteEpisode,
  getEffectiveEpisodeServerId,
};
