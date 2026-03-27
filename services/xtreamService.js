'use strict';

const dbApi = require('../lib/db');
const redis = require('../lib/redis');
const lineService = require('./lineService');
const categoryService = require('./categoryService');
const bouquetService = require('./bouquetService');
const vodService = require('./vodService');
const seriesService = require('./seriesService');
const epgService = require('./epgService');
const { channels } = require('../lib/state');

function isMovieChannel(ch) {
  return String((ch && ch.channelClass) || 'normal') === 'movie';
}

function isInternalChannel(ch) {
  return !!(ch && ch.is_internal);
}

function getBouquetIds(line) {
  return lineService.getLineBouquetIds(line);
}

async function allowedIdSetFromBouquet(line, unionFn) {
  const ids = getBouquetIds(line);
  if (!ids.length) return null;
  const list = await unionFn(ids);
  return new Set(list.map(String));
}

function channelAllowed(line, channelId, allowedSet) {
  if (!allowedSet) return true;
  return allowedSet.has(String(channelId));
}

function movieAllowed(line, movieId, allowedSet) {
  if (!allowedSet) return true;
  return allowedSet.has(String(movieId));
}

function seriesAllowed(line, seriesId, allowedSet) {
  if (!allowedSet) return true;
  return allowedSet.has(String(seriesId));
}

function parseAddedUnix(ch) {
  if (!ch || !ch.createdAt) return 0;
  const t = Date.parse(ch.createdAt);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function b64utf8(s) { return Buffer.from(String(s ?? ''), 'utf8').toString('base64'); }

async function serverInfo(req) {
  const domain = String(await dbApi.getSetting('domain_name') || '').trim();
  const port = String(await dbApi.getSetting('server_port') || '80').trim();
  const protocol = String(await dbApi.getSetting('server_protocol') || 'http').trim().toLowerCase();
  const host = req && typeof req.get === 'function' ? String(req.get('host') || '') : '';
  const url = domain || (host ? host.split(':')[0] : '');
  const nowSec = Math.floor(Date.now() / 1000);
  return { url, port, https_port: '', server_protocol: protocol === 'https' ? 'https' : 'http', rtmp_port: '', timezone: 'UTC', timestamp_now: nowSec, time_now: new Date().toISOString() };
}

async function userInfo(line) {
  return await lineService.getUserInfo(line);
}

async function liveCategories(line) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getChannelsForBouquets);
  let hasAny = false;
  channels.forEach((ch, id) => {
    if (!ch || isMovieChannel(ch) || isInternalChannel(ch)) return;
    if (!channelAllowed(line, id, allowedSet)) return;
    hasAny = true;
  });
  if (!hasAny) return [];

  const used = new Set();
  channels.forEach((ch, id) => {
    if (!ch || isMovieChannel(ch) || isInternalChannel(ch)) return;
    if (!channelAllowed(null, id, allowedSet)) return;
    const cid = ch.category_id != null && ch.category_id !== '' ? String(ch.category_id) : null;
    if (cid != null) used.add(cid);
  });

  const rows = await categoryService.listCategories('live') || [];
  const out = [];
  for (const c of rows) {
    const cid = String(c.id);
    if (used.size > 0 && !used.has(cid)) continue;
    out.push({ category_id: cid, category_name: c.category_name || '', parent_id: c.parent_id != null ? c.parent_id : 0 });
  }
  return out;
}

function liveStreamRow(ch, id, num, categoryAdultMap) {
  const catId = ch.category_id != null && ch.category_id !== '' ? String(ch.category_id) : '0';
  const adult = categoryAdultMap && categoryAdultMap.has(catId) ? categoryAdultMap.get(catId) : 0;
  return {
    num, name: ch.name || String(id), stream_type: 'live', stream_id: id,
    stream_icon: ch.logoUrl || '', epg_channel_id: ch.epgChannelId != null && ch.epgChannelId !== '' ? String(ch.epgChannelId) : '',
    added: parseAddedUnix(ch), category_id: catId, is_adult: adult ? 1 : 0,
    direct_source: '', tv_archive: 0, tv_archive_duration: 0,
  };
}

async function liveStreams(line) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getChannelsForBouquets);
  const cats = await categoryService.listCategories('live') || [];
  const categoryAdultMap = new Map(cats.map(c => [String(c.id), c.is_adult ? 1 : 0]));
  const list = [];
  channels.forEach((ch, id) => {
    if (!ch || isMovieChannel(ch) || isInternalChannel(ch)) return;
    if (!channelAllowed(line, id, allowedSet)) return;
    list.push({ id: String(id), ch });
  });
  list.sort((a, b) => {
    const ao = Number.isFinite(Number(a.ch.sortOrder)) ? Number(a.ch.sortOrder) : 0;
    const bo = Number.isFinite(Number(b.ch.sortOrder)) ? Number(b.ch.sortOrder) : 0;
    if (ao !== bo) return ao - bo;
    return String(a.ch.name || '').localeCompare(String(b.ch.name || ''));
  });
  return list.map((item, idx) => liveStreamRow(item.ch, item.id, idx + 1, categoryAdultMap));
}

async function vodCategories(line) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getMoviesForBouquets);

  const cacheKey = `xtream:vod_cats:${allowedSet ? [...allowedSet].sort().join(',') : 'all'}`;
  const cached = await redis.cacheGet(cacheKey);
  if (cached) return cached;

  const result = await vodService.listItems(null, 100, 0);
  const allMovies = result.movies || [];
  const withAccess = allMovies.filter(m => movieAllowed(line, m.id, allowedSet));
  if (withAccess.length === 0) return [];

  const used = new Set();
  for (const m of withAccess) {
    const cid = m.category_id != null && m.category_id !== '' ? String(m.category_id) : null;
    if (cid != null) used.add(cid);
  }
  const rows = await categoryService.listCategories('movie') || [];
  const out = [];
  for (const c of rows) {
    const cid = String(c.id);
    if (used.size > 0 && !used.has(cid)) continue;
    out.push({ category_id: cid, category_name: c.category_name || '', parent_id: c.parent_id != null ? c.parent_id : 0 });
  }
  await redis.cacheSet(cacheKey, out, 120);
  return out;
}

async function vodStreams(line, categoryId, page = 1, perPage = 50) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getMoviesForBouquets);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * perPage;
  const result = await vodService.listItems(categoryId || null, perPage, offset);
  const movies = result.movies || [];
  const out = [];
  let num = offset;
  for (const m of movies) {
    if (!movieAllowed(line, m.id, allowedSet)) continue;
    num += 1;
    out.push({
      num, name: m.title || m.name || String(m.id), stream_type: 'movie', stream_id: m.id,
      stream_icon: m.poster || m.stream_icon || '',
      rating: m.rating != null ? String(m.rating) : '0',
      rating_5based: Number(m.rating_5based) || 0,
      added: m.added != null ? Number(m.added) : 0,
      category_id: m.category_id != null ? String(m.category_id) : '',
      container_extension: m.extension || m.container_extension || 'mp4',
      direct_source: '',
    });
  }
  return out;
}

async function vodInfo(line, vodId) {
  const id = parseInt(vodId, 10);
  if (!Number.isFinite(id)) return null;
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getMoviesForBouquets);
  if (!movieAllowed(line, id, allowedSet)) return null;
  const m = await vodService.getById(id);
  if (!m) return null;
  return {
    info: {
      movie_image: m.poster || m.stream_icon || '', plot: m.plot || '', cast: m.movie_cast || '',
      director: m.director || '', genre: m.genre || '', duration: m.duration || '',
      rating: m.rating != null ? String(m.rating) : '0', name: m.title || m.name || '',
      backdrop_path: m.backdrop_path || '', tmdb_id: m.tmdb_id != null ? Number(m.tmdb_id) : 0,
      year: m.year != null ? String(m.year) : '',
    },
    movie_data: {
      stream_id: m.id, name: m.title || m.name || '',
      added: m.added != null ? Number(m.added) : 0,
      category_id: m.category_id != null ? String(m.category_id) : '',
      container_extension: m.extension || m.container_extension || 'mp4',
    },
  };
}

async function seriesCategories(line) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getSeriesForBouquets);
  const result = await seriesService.listSeries(null, 100, 0);
  const allSeries = result.series || [];
  const withAccess = allSeries.filter(s => seriesAllowed(line, s.id, allowedSet));
  if (withAccess.length === 0) return [];

  const used = new Set();
  for (const s of withAccess) {
    const cid = s.category_id != null && s.category_id !== '' ? String(s.category_id) : null;
    if (cid != null) used.add(cid);
  }
  const rows = await categoryService.listCategories('series') || [];
  const out = [];
  for (const c of rows) {
    const cid = String(c.id);
    if (used.size > 0 && !used.has(cid)) continue;
    out.push({ category_id: cid, category_name: c.category_name || '', parent_id: c.parent_id != null ? c.parent_id : 0 });
  }
  return out;
}

async function seriesList(line, categoryId, page = 1, perPage = 50) {
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getSeriesForBouquets);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * perPage;
  const result = await seriesService.listSeries(categoryId || null, perPage, offset);
  const rows = result.series || [];
  const out = [];
  let num = offset;
  for (const s of rows) {
    if (!seriesAllowed(line, s.id, allowedSet)) continue;
    num += 1;
    out.push({
      num, name: s.name || s.title || String(s.id), series_id: s.id,
      cover: s.poster || s.cover || '', plot: s.plot || '', cast: s.series_cast || '',
      director: s.director || '', genre: s.genre || '', release_date: s.release_date || '',
      rating: s.rating != null ? String(s.rating) : '0', rating_5based: Number(s.rating_5based) || 0,
      backdrop_path: s.backdrop_path || '', tmdb_id: s.tmdb_id != null ? Number(s.tmdb_id) : 0,
      year: s.year != null ? String(s.year) : '',
      category_id: s.category_id != null ? String(s.category_id) : '',
    });
  }
  return out;
}

function episodeToXc(ep) {
  const info = ep.info && typeof ep.info === 'object' ? ep.info : {};
  return {
    id: ep.id, episode_num: ep.episode_num != null ? ep.episode_num : 0,
    title: ep.title || '', container_extension: ep.container_extension || 'mp4',
    info: {
      movie_image: info.movie_image || info.stream_icon || '', plot: info.plot || '',
      duration_secs: info.duration_secs != null ? info.duration_secs : 0,
      rating: info.rating != null ? String(info.rating) : '', name: info.name || ep.title || '',
    },
    season: ep.season_num != null ? ep.season_num : ep.season_number,
  };
}

async function seriesInfo(line, seriesId) {
  const id = parseInt(seriesId, 10);
  if (!Number.isFinite(id)) return null;
  const allowedSet = await allowedIdSetFromBouquet(line, bouquetService.getSeriesForBouquets);
  if (!seriesAllowed(line, id, allowedSet)) return null;
  const data = await seriesService.findSeries(id);
  if (!data) return null;
  const episodes = {};
  for (const s of data.seasons || []) {
    episodes[String(s.season_number)] = (s.episodes || []).map(episodeToXc);
  }
  const seasonNums = (data.seasons || []).map(s => s.season_number).sort((a, b) => a - b);
  return {
    seasons: seasonNums,
    info: {
      name: data.name || data.title || '', cover: data.poster || data.cover || '',
      plot: data.plot || '', cast: data.series_cast || '', director: data.director || '',
      genre: data.genre || '', release_date: data.release_date || '',
      rating: data.rating != null ? String(data.rating) : '0',
      backdrop_path: data.backdrop_path || '', tmdb_id: data.tmdb_id != null ? Number(data.tmdb_id) : 0,
    },
    episodes,
  };
}

async function shortEpg(channelId, limit) {
  const cid = String(channelId || '');
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 4));
  const rows = await epgService.getShortEpg(cid, lim) || [];
  return {
    epg_listings: rows.map(r => ({
      id: String(r.id), epg_id: String(r.id), title: b64utf8(r.title || ''),
      lang: r.lang || 'en', start: String(r.start != null ? r.start : 0),
      end: String(r.stop != null ? r.stop : 0),
      start_timestamp: r.start != null ? r.start : 0, stop_timestamp: r.stop != null ? r.stop : 0,
      description: b64utf8(r.description || ''),
    })),
  };
}

async function simpleDataTable(streamId) {
  const cid = String(streamId || '');
  const rows = await epgService.getEpgForChannel(cid, 0, 2147483647) || [];
  return {
    epg_listings: rows.map(r => ({
      id: String(r.id), epg_id: String(r.id), title: b64utf8(r.title || ''),
      lang: r.lang || 'en', start: String(r.start != null ? r.start : 0),
      end: String(r.stop != null ? r.stop : 0),
      start_timestamp: r.start != null ? r.start : 0, stop_timestamp: r.stop != null ? r.stop : 0,
      description: b64utf8(r.description || ''),
    })),
  };
}

function liveInfo(streamId) {
  const id = String(streamId || '');
  const ch = channels.get(id);
  if (!ch || isMovieChannel(ch) || isInternalChannel(ch)) return null;
  const catId = ch.category_id != null && ch.category_id !== '' ? String(ch.category_id) : '0';
  return {
    stream_id: id, name: ch.name || id, stream_type: 'live', stream_icon: ch.logoUrl || '',
    epg_channel_id: ch.epgChannelId != null && ch.epgChannelId !== '' ? String(ch.epgChannelId) : '',
    added: parseAddedUnix(ch), category_id: catId, is_adult: 0, direct_source: '',
    tv_archive: 0, tv_archive_duration: 0,
  };
}

function filterByCategoryId(rows, categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return rows;
  const want = String(categoryId);
  return rows.filter(r => String(r.category_id) === want);
}

module.exports = {
  serverInfo, userInfo, liveCategories, liveStreams,
  vodCategories, vodStreams, vodInfo,
  seriesCategories, seriesList, seriesInfo,
  shortEpg, simpleDataTable, liveInfo, filterByCategoryId,
};
