'use strict';

const dbApi = require('../lib/db');
const bouquetService = require('./bouquetService');

function stripBouquetIds(data) {
  if (!data || typeof data !== 'object') return data;
  const o = { ...data };
  delete o.bouquet_ids;
  return o;
}

function parseEpisodeRow(row) {
  if (!row) return null;
  let info = {};
  try { info = JSON.parse(row.info_json || '{}'); } catch { info = {}; }
  return { ...row, info, episode_number: row.episode_num, season_number: row.season_num };
}

function parseSeriesRow(row) {
  if (!row) return null;
  return { ...row, name: row.title, poster: row.cover };
}

async function listSeries(categoryId, limit = 50, offset = 0, search, sortOrder) {
  const result = await dbApi.listSeries(categoryId, limit, offset, search, sortOrder);
  const series = (result.series || result).map(parseSeriesRow);
  return { series, total: result.total || series.length };
}

function groupEpisodesBySeason(episodeRows) {
  const seasonMap = new Map();
  for (const raw of episodeRows) {
    const ep = parseEpisodeRow(raw);
    const sn = ep.season_num != null ? ep.season_num : ep.season_number;
    const key = Number(sn);
    if (!seasonMap.has(key)) seasonMap.set(key, { season_number: key, episodes: [] });
    seasonMap.get(key).episodes.push(ep);
  }
  const seasons = [...seasonMap.values()].sort((a, b) => a.season_number - b.season_number);
  for (const s of seasons) s.episodes.sort((a, b) => (a.episode_num || 0) - (b.episode_num || 0));
  return seasons;
}

async function findSeries(id) {
  const series = await dbApi.getSeriesById(id);
  if (!series) return null;
  const episodes = await dbApi.listEpisodes(series.id);
  const seasons = groupEpisodesBySeason(episodes);
  const base = parseSeriesRow(series);
  const bouquet_ids = await bouquetService.getBouquetIdsForEntity('series', id);
  return {
    ...base,
    bouquet_ids,
    seasons,
    episodesBySeason: seasons.reduce((acc, season) => { acc[season.season_number] = season.episodes; return acc; }, {}),
  };
}

async function create(data) {
  const d = data || {};
  const bq = Array.isArray(d.bouquet_ids) ? d.bouquet_ids : [];
  const id = await dbApi.createSeries(stripBouquetIds(d));
  await bouquetService.syncEntityBouquets('series', id, bq);
  return id;
}

async function update(id, data) {
  const d = data || {};
  const bq = d.bouquet_ids;
  await dbApi.updateSeriesRow(id, stripBouquetIds(d));
  if (bq !== undefined) {
    await bouquetService.syncEntityBouquets('series', id, Array.isArray(bq) ? bq : []);
  }
}
async function remove(id) { return await dbApi.deleteSeries(id); }
async function addEpisode(data) { return await dbApi.createEpisode(data || {}); }
async function updateEpisode(id, data) { return await dbApi.updateEpisode(id, data || {}); }
async function removeEpisode(id) { return await dbApi.deleteEpisode(id); }
async function count() { return await dbApi.seriesCount(); }

module.exports = { listSeries, findSeries, create, update, remove, addEpisode, updateEpisode, removeEpisode, count };
