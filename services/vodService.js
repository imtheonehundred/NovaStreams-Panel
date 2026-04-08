'use strict';

const dbApi = require('../lib/db');
const bouquetService = require('./bouquetService');

function stripBouquetIds(data) {
  if (!data || typeof data !== 'object') return data;
  const o = { ...data };
  delete o.bouquet_ids;
  return o;
}

function parseMovieRow(row) {
  if (!row) return null;
  let movie_properties = {};
  let subtitles = [];
  try { movie_properties = JSON.parse(row.movie_properties || '{}'); } catch { movie_properties = {}; }
  try { subtitles = JSON.parse(row.subtitles_json || '[]'); } catch { subtitles = []; }
  return {
    ...row,
    movie_properties,
    subtitles,
    title: row.name,
    poster: row.stream_icon,
    extension: row.container_extension,
  };
}

async function listCategories() {
  const rows = await dbApi.listCategories('movie');
  return rows.map(c => ({
    id: String(c.id),
    name: c.category_name,
    category_name: c.category_name,
    category_type: c.category_type,
    parent_id: c.parent_id || 0,
    cat_order: c.cat_order,
    is_adult: c.is_adult,
  }));
}

async function listItems(categoryId, limit = 50, offset = 0, search, sortOrder) {
  const result = await dbApi.listMovies(categoryId, limit, offset, search, sortOrder);
  const movies = (result.movies || result).map(parseMovieRow);
  return { movies, total: result.total || movies.length };
}

async function getById(id) {
  const row = parseMovieRow(await dbApi.getMovieById(id));
  if (!row) return null;
  const bouquet_ids = await bouquetService.getBouquetIdsForEntity('movies', id);
  return { ...row, bouquet_ids };
}

async function create(data) {
  const d = data || {};
  const bq = Array.isArray(d.bouquet_ids) ? d.bouquet_ids : [];
  const id = await dbApi.createMovie(stripBouquetIds(d));
  await bouquetService.syncEntityBouquets('movies', id, bq);
  return id;
}

async function update(id, data) {
  const d = data || {};
  const bq = d.bouquet_ids;
  await dbApi.updateMovie(id, stripBouquetIds(d));
  if (bq !== undefined) {
    await bouquetService.syncEntityBouquets('movies', id, Array.isArray(bq) ? bq : []);
  }
}

async function remove(id) {
  return await dbApi.deleteMovie(id);
}

async function count() {
  return await dbApi.movieCount();
}

const findById = getById;

module.exports = { listCategories, listItems, getById, findById, create, update, remove, count };
