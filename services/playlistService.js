'use strict';

const dbApi = require('../lib/db');
const lineService = require('./lineService');
const bouquetService = require('./bouquetService');
const categoryService = require('./categoryService');
const { channels } = require('../lib/state');

function isMovieChannel(ch) { return String((ch && ch.channelClass) || 'normal') === 'movie'; }
function isRadioChannel(ch) { return String((ch && ch.channelClass) || 'normal') === 'radio'; }
function isInternalChannel(ch) { return !!(ch && ch.is_internal); }

async function allowedIdSetFromBouquet(line, unionFn) {
  const ids = lineService.getLineBouquetIds(line);
  if (!ids.length) return null;
  const list = await unionFn(ids);
  return new Set(list.map(String));
}

async function allowedRadioIdsFromBouquets(line) {
  const ids = lineService.getLineBouquetIds(line);
  if (!ids.length) return null;
  const set = new Set();
  const bouquets = await dbApi.getBouquetsByIds(ids);
  for (const raw of bouquets) {
    let radios;
    try { radios = typeof raw.bouquet_radios === 'string' ? JSON.parse(raw.bouquet_radios) : raw.bouquet_radios; } catch { radios = []; }
    if (Array.isArray(radios)) for (const x of radios) set.add(String(x));
  }
  return set;
}

function channelAllowed(line, channelId, allowedSet) { return !allowedSet || allowedSet.has(String(channelId)); }
function movieAllowed(line, movieId, allowedSet) { return !allowedSet || allowedSet.has(String(movieId)); }
function seriesAllowed(line, seriesId, allowedSet) { return !allowedSet || allowedSet.has(String(seriesId)); }

function escAttr(s) { return String(s ?? '').replace(/"/g, '\\"'); }
function stripTrailingSlash(u) { return String(u || '').replace(/\/+$/, ''); }

async function categoryNameFor(categoryId) {
  if (categoryId == null || categoryId === '') return 'Uncategorized';
  const c = await categoryService.getById(categoryId);
  if (!c) return 'Uncategorized';
  return c.category_name || String(categoryId);
}

async function buildLiveSection(line, resolveBaseUrl, output, type, key, allowedSet, radioSet, catNameMap) {
  const u = encodeURIComponent(line.username);
  const p = encodeURIComponent(line.password);
  const lines = [];
  const wantLive = key == null || key === 'live';
  const wantRadio = key === 'radio_streams';

  const items = [];
  channels.forEach((ch, id) => {
    if (!ch || isMovieChannel(ch) || isInternalChannel(ch)) return;
    if (wantRadio) {
      if (radioSet === null) { if (!isRadioChannel(ch)) return; }
      else if (!radioSet.has(String(id))) return;
    } else if (wantLive) {
      if (isRadioChannel(ch)) return;
      if (!channelAllowed(line, id, allowedSet)) return;
    }
    const catId = ch.category_id != null && ch.category_id !== '' ? ch.category_id : null;
    const groupTitle = catNameMap.get(String(catId)) || 'Uncategorized';
    items.push({ id, ch, groupTitle, name: ch.name || String(id), logo: ch.logoUrl || '', epgId: ch.epgChannelId || String(id) });
  });

  items.sort((a, b) => {
    const ao = Number.isFinite(Number(a.ch.sortOrder)) ? Number(a.ch.sortOrder) : 0;
    const bo = Number.isFinite(Number(b.ch.sortOrder)) ? Number(b.ch.sortOrder) : 0;
    return ao !== bo ? ao - bo : String(a.name).localeCompare(String(b.name));
  });

  for (const it of items) {
    const assetSid = it.ch.stream_server_id != null ? parseInt(it.ch.stream_server_id, 10) : 0;
    const baseUrl = await resolveBaseUrl(Number.isFinite(assetSid) && assetSid > 0 ? assetSid : 0);
    const url = `${baseUrl}/live/${u}/${p}/${it.id}.${output}`;
    lines.push(type === 'm3u_plus'
      ? `#EXTINF:-1 tvg-id="${escAttr(it.epgId)}" tvg-name="${escAttr(it.name)}" tvg-logo="${escAttr(it.logo)}" group-title="${escAttr(it.groupTitle)}",${it.name}`
      : `#EXTINF:-1,${it.name}`);
    lines.push(url);
  }
  return lines;
}

async function buildMovieSection(line, resolveBaseUrl, output, type, allowedSet, catNameMap) {
  const u = encodeURIComponent(line.username);
  const p = encodeURIComponent(line.password);
  const lines = [];
  let offset = 0;
  const batchSize = 100;
  while (true) {
    const result = await dbApi.listMovies(null, batchSize, offset);
    const movies = result.movies || [];
    if (!movies.length) break;
    for (const m of movies) {
      if (!movieAllowed(line, m.id, allowedSet)) continue;
      const ext = (m.container_extension || 'mp4').replace(/^\./, '');
      const outExt = output === 'm3u8' ? 'm3u8' : ext;
      const assetSid = m.stream_server_id != null ? parseInt(m.stream_server_id, 10) : 0;
      const baseUrl = await resolveBaseUrl(Number.isFinite(assetSid) && assetSid > 0 ? assetSid : 0);
      const url = `${baseUrl}/movie/${u}/${p}/${m.id}.${outExt}`;
      const catName = catNameMap.get(String(m.category_id)) || 'Uncategorized';
      const title = m.name || String(m.id);
      const logo = m.stream_icon || '';
      lines.push(type === 'm3u_plus'
        ? `#EXTINF:-1 tvg-id="" tvg-name="${escAttr(title)}" tvg-logo="${escAttr(logo)}" group-title="${escAttr(catName)}",${title}`
        : `#EXTINF:-1,${title}`);
      lines.push(url);
    }
    if (movies.length < batchSize) break;
    offset += batchSize;
  }
  return lines;
}

async function buildSeriesSection(line, resolveBaseUrl, output, type, allowedSet, catNameMap) {
  const u = encodeURIComponent(line.username);
  const p = encodeURIComponent(line.password);
  const lines = [];
  let offset = 0;
  const batchSize = 100;
  while (true) {
    const result = await dbApi.listSeries(null, batchSize, offset);
    const seriesRows = result.series || [];
    if (!seriesRows.length) break;
    for (const s of seriesRows) {
      if (!seriesAllowed(line, s.id, allowedSet)) continue;
      const eps = await dbApi.listEpisodes(s.id);
      const catName = catNameMap.get(String(s.category_id)) || 'Uncategorized';
      const assetSid = s.stream_server_id != null ? parseInt(s.stream_server_id, 10) : 0;
      const seriesBase = await resolveBaseUrl(Number.isFinite(assetSid) && assetSid > 0 ? assetSid : 0);
      for (const ep of eps) {
        const ext = (ep.container_extension || 'mp4').replace(/^\./, '');
        const outExt = output === 'm3u8' ? 'm3u8' : ext;
        const url = `${seriesBase}/series/${u}/${p}/${ep.id}.${outExt}`;
        const title = ep.title || `${s.title || s.id} S${ep.season_num}E${ep.episode_num}`;
        const logo = s.cover || '';
        lines.push(type === 'm3u_plus'
          ? `#EXTINF:-1 tvg-id="" tvg-name="${escAttr(title)}" tvg-logo="${escAttr(logo)}" group-title="${escAttr(catName)}",${title}`
          : `#EXTINF:-1,${title}`);
        lines.push(url);
      }
    }
    if (seriesRows.length < batchSize) break;
    offset += batchSize;
  }
  return lines;
}

async function buildCategoryNameMap() {
  const allCats = await dbApi.listCategories();
  const map = new Map();
  for (const c of allCats) map.set(String(c.id), c.category_name || String(c.id));
  return map;
}

async function generatePlaylist(line, options) {
  const opt = options || {};
  const type = opt.type === 'm3u' ? 'm3u' : 'm3u_plus';
  const output = opt.output === 'm3u8' ? 'm3u8' : 'ts';
  const key = opt.key != null && opt.key !== '' ? String(opt.key) : null;
  const fallbackBase = stripTrailingSlash(opt.baseUrl || 'http://127.0.0.1');
  const cache = new Map();
  const resolveBaseUrl =
    typeof opt.resolveBaseUrl === 'function'
      ? async (assetSid) => {
          const k = String(assetSid != null ? assetSid : 0);
          if (cache.has(k)) return cache.get(k);
          const u = await opt.resolveBaseUrl(assetSid);
          const out = stripTrailingSlash(u || fallbackBase);
          cache.set(k, out);
          return out;
        }
      : async () => fallbackBase;

  const allowedChannelSet = await allowedIdSetFromBouquet(line, bouquetService.getChannelsForBouquets);
  const allowedMovieSet = await allowedIdSetFromBouquet(line, bouquetService.getMoviesForBouquets);
  const allowedSeriesSet = await allowedIdSetFromBouquet(line, bouquetService.getSeriesForBouquets);
  const radioSet = await allowedRadioIdsFromBouquets(line);
  const catNameMap = await buildCategoryNameMap();

  const parts = [];
  const headerBase = await resolveBaseUrl(0);
  if (type === 'm3u_plus') {
    const epgUrl = `${headerBase}/api/xtream/xmltv.php?username=${encodeURIComponent(line.username)}&password=${encodeURIComponent(line.password)}`;
    parts.push(`#EXTM3U url-tvg="${escAttr(epgUrl)}"`);
  } else {
    parts.push('#EXTM3U');
  }

  // Do not use parts.push(...arr): huge playlists exceed max call stack (spread passes one arg per element).
  if (key == null || key === 'live' || key === 'radio_streams') {
    const liveLines = await buildLiveSection(line, resolveBaseUrl, output, type, key, allowedChannelSet, radioSet, catNameMap);
    for (const ln of liveLines) parts.push(ln);
  }
  if (key == null || key === 'movie') {
    const movieLines = await buildMovieSection(line, resolveBaseUrl, output, type, allowedMovieSet, catNameMap);
    for (const ln of movieLines) parts.push(ln);
  }
  if (key == null || key === 'series') {
    const seriesLines = await buildSeriesSection(line, resolveBaseUrl, output, type, allowedSeriesSet, catNameMap);
    for (const ln of seriesLines) parts.push(ln);
  }

  return parts.join('\n') + '\n';
}

module.exports = { generatePlaylist };
