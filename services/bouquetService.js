'use strict';

const dbApi = require('../lib/db');

const JSON_FIELDS = ['bouquet_channels', 'bouquet_movies', 'bouquet_radios', 'bouquet_series'];

function parseJsonField(raw, fallback = []) {
  if (raw == null || raw === '') return fallback;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : fallback;
  } catch { return fallback; }
}

function parseBouquetRow(row) {
  if (!row) return null;
  const o = { ...row };
  for (const k of JSON_FIELDS) o[k] = parseJsonField(row[k], []);
  return o;
}

async function list() {
  const rows = await dbApi.listBouquets();
  return rows.map(parseBouquetRow);
}

async function getById(id) {
  return parseBouquetRow(await dbApi.getBouquetById(id));
}

async function create(data) {
  return await dbApi.createBouquet(data || {});
}

async function update(id, data) {
  return await dbApi.updateBouquet(id, data || {});
}

async function remove(id) {
  return await dbApi.deleteBouquet(id);
}

async function unionIdsFromField(bouquetIds, fieldName) {
  const set = new Set();
  if (!Array.isArray(bouquetIds) || bouquetIds.length === 0) return [];
  const bouquets = await dbApi.getBouquetsByIds(bouquetIds);
  for (const raw of bouquets) {
    const b = parseBouquetRow(raw);
    if (!b) continue;
    const arr = b[fieldName] || [];
    for (const x of arr) set.add(String(x));
  }
  return [...set];
}

async function getChannelsForBouquets(bouquetIds) {
  return await unionIdsFromField(bouquetIds, 'bouquet_channels');
}

async function getMoviesForBouquets(bouquetIds) {
  return await unionIdsFromField(bouquetIds, 'bouquet_movies');
}

async function getSeriesForBouquets(bouquetIds) {
  return await unionIdsFromField(bouquetIds, 'bouquet_series');
}

function fieldForEntityType(entityType) {
  if (entityType === 'movies') return 'bouquet_movies';
  if (entityType === 'series') return 'bouquet_series';
  if (entityType === 'channels') return 'bouquet_channels';
  return null;
}

function storedEntityId(entityType, entityId) {
  const eid = String(entityId);
  if (entityType === 'channels') return eid;
  const n = parseInt(eid, 10);
  return Number.isFinite(n) ? n : entityId;
}

/**
 * Set which bouquets contain this entity: updates each bouquet's JSON array (add/remove id).
 * entityId: number for movies/series, string channel id for live channels.
 */
async function syncEntityBouquets(entityType, entityId, bouquetIds = []) {
  const field = fieldForEntityType(entityType);
  if (!field) throw new Error('invalid entityType');
  const eid = String(entityId);
  const wanted = new Set((bouquetIds || []).map((x) => String(x)));
  const all = await list();
  const { invalidateBouquets } = require('../lib/cache');
  let changed = false;
  const addVal = storedEntityId(entityType, entityId);
  for (const b of all) {
    const raw = b[field] || [];
    const has = raw.some((x) => String(x) === eid);
    const should = wanted.has(String(b.id));
    if (should && !has) {
      await update(b.id, { [field]: [...raw, addVal] });
      changed = true;
    } else if (!should && has) {
      const next = raw.filter((x) => String(x) !== eid);
      await update(b.id, { [field]: next });
      changed = true;
    }
  }
  if (changed) await invalidateBouquets();
}

async function getBouquetIdsForEntity(entityType, entityId) {
  const field = fieldForEntityType(entityType);
  if (!field) return [];
  const eid = String(entityId);
  const out = [];
  const all = await list();
  for (const b of all) {
    const arr = (b[field] || []).map(String);
    if (arr.includes(eid)) out.push(b.id);
  }
  return out;
}

/** One pass: map channelId -> bouquet id[] */
async function getBouquetIdsMapForChannels(channelIds) {
  const field = 'bouquet_channels';
  const map = new Map();
  for (const cid of channelIds) map.set(String(cid), []);
  const all = await list();
  for (const b of all) {
    for (const cid of b[field] || []) {
      const key = String(cid);
      if (map.has(key)) map.get(key).push(b.id);
    }
  }
  return map;
}

module.exports = {
  list, getById, create, update, remove,
  getChannelsForBouquets, getMoviesForBouquets, getSeriesForBouquets,
  syncEntityBouquets, getBouquetIdsForEntity, getBouquetIdsMapForChannels,
};
