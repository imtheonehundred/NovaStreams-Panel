'use strict';

const dbApi = require('../lib/db');
const bouquetService = require('./bouquetService');

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return fallback; }
}

function parsePackageRow(row) {
  if (!row) return null;
  return {
    ...row,
    groups: parseJson(row.groups_json, []),
    bouquets: parseJson(row.bouquets_json, []),
    output_formats: parseJson(row.output_formats_json, []),
    options: parseJson(row.options_json, {}),
  };
}

function stripParsedForDb(data) {
  const o = { ...data };
  delete o.groups_json; delete o.bouquets_json; delete o.output_formats_json; delete o.options_json;
  return o;
}

async function list() { return (await dbApi.listPackages()).map(parsePackageRow); }
async function getById(id) { return parsePackageRow(await dbApi.getPackageById(id)); }

async function create(data) {
  const d = data || {};
  return await dbApi.createPackage({
    package_name: d.package_name != null ? d.package_name : d.name != null ? d.name : 'New Package',
    is_trial: d.is_trial, is_official: d.is_official,
    trial_credits: d.trial_credits, official_credits: d.official_credits,
    trial_duration: d.trial_duration, trial_duration_in: d.trial_duration_in,
    official_duration: d.official_duration, official_duration_in: d.official_duration_in,
    groups: d.groups != null ? d.groups : d.categories != null ? d.categories : [],
    bouquets: d.bouquets != null ? d.bouquets : [],
    output_formats: d.output_formats != null ? d.output_formats : [],
    options: d.options != null && typeof d.options === 'object' ? d.options : {},
    max_connections: d.max_connections, forced_country: d.forced_country,
    is_line: d.is_line, is_mag: d.is_mag, is_e2: d.is_e2, is_restreamer: d.is_restreamer,
  });
}

async function update(id, data) { return await dbApi.updatePackage(id, stripParsedForDb(data || {})); }
async function remove(id) { return await dbApi.deletePackage(id); }

async function applyPackageToLine(packageId) {
  const pkg = await getById(packageId);
  if (!pkg) return null;
  const bouquets = Array.isArray(pkg.bouquets) ? pkg.bouquets.map(String) : [];
  const outputFormats = Array.isArray(pkg.output_formats) ? pkg.output_formats : [];
  return {
    bouquet: bouquets, bouquets, groups: Array.isArray(pkg.groups) ? pkg.groups : [],
    max_connections: pkg.max_connections != null ? pkg.max_connections : 1,
    output_formats: outputFormats, allowed_outputs: outputFormats,
    forced_country: pkg.forced_country || '',
    is_mag: pkg.is_mag || 0, is_e2: pkg.is_e2 || 0, is_restreamer: pkg.is_restreamer || 0,
    is_line: pkg.is_line !== undefined ? pkg.is_line : 1, is_trial: pkg.is_trial || 0,
    is_official: pkg.is_official !== undefined ? pkg.is_official : 1,
    trial_credits: pkg.trial_credits || 0, official_credits: pkg.official_credits || 0,
    trial_duration: pkg.trial_duration || 0, trial_duration_in: pkg.trial_duration_in || 'day',
    official_duration: pkg.official_duration || 30, official_duration_in: pkg.official_duration_in || 'month',
    options: pkg.options && typeof pkg.options === 'object' ? pkg.options : {},
  };
}

async function loadUserPackageMap() {
  try { return JSON.parse(await dbApi.getSetting('user_package_assignments') || '{}'); } catch { return {}; }
}
async function saveUserPackageMap(map) { await dbApi.setSetting('user_package_assignments', JSON.stringify(map)); }

async function assignPackage(userId, packageIds) {
  const map = await loadUserPackageMap();
  map[String(userId)] = (packageIds || []).map(String);
  await saveUserPackageMap(map);
  return map[String(userId)];
}

async function getUserPackages(userId) {
  const map = await loadUserPackageMap();
  return map[String(userId)] || [];
}

async function assignBouquetsToPackage(packageId, bouquetIds = []) {
  return await update(packageId, { bouquets: bouquetIds });
}

let _streamAllowedCache = {};
let _cacheTime = 0;

async function _buildStreamCache(userId) {
  const now = Date.now();
  if (_streamAllowedCache[userId] && now - _cacheTime < 30000) return _streamAllowedCache[userId];
  const allowed = { live: new Set(), movie: new Set(), series: new Set() };
  const pkgIds = await getUserPackages(userId);
  for (const pid of pkgIds) {
    const pkg = await getById(pid);
    if (!pkg) continue;
    const bIds = pkg.bouquets || [];
    (await bouquetService.getChannelsForBouquets(bIds)).forEach(ch => allowed.live.add(String(ch)));
    (await bouquetService.getMoviesForBouquets(bIds)).forEach(m => allowed.movie.add(String(m)));
    (await bouquetService.getSeriesForBouquets(bIds)).forEach(s => allowed.series.add(String(s)));
  }
  _streamAllowedCache[userId] = allowed;
  _cacheTime = now;
  return allowed;
}

async function isChannelAllowed(userId, channelId) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return true;
  const cache = await _buildStreamCache(userId);
  return cache.live.has(String(channelId));
}

async function isMovieAllowed(userId, movieId) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return true;
  const cache = await _buildStreamCache(userId);
  return cache.movie.has(String(movieId));
}

async function isSeriesAllowed(userId, seriesId) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return true;
  const cache = await _buildStreamCache(userId);
  return cache.series.has(String(seriesId));
}

async function filterChannels(userId, arr) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return arr;
  const cache = await _buildStreamCache(userId);
  return (arr || []).filter(c => cache.live.has(String(c.stream_id || c.id || c)));
}
async function filterMovies(userId, arr) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return arr;
  const cache = await _buildStreamCache(userId);
  return (arr || []).filter(m => cache.movie.has(String(m.stream_id || m.id || m)));
}
async function filterSeries(userId, arr) {
  const assigned = await getUserPackages(userId);
  if (!assigned.length) return arr;
  const cache = await _buildStreamCache(userId);
  return (arr || []).filter(s => cache.series.has(String(s.series_id || s.id || s)));
}

function listPackages() { return list(); }
function createPackageLegacy(data) {
  return create({ name: data.name, package_name: data.name, groups: data.categories || data.groups || [], bouquets: data.bouquets || [] });
}

module.exports = {
  list, listPackages, getById, create, createPackage: createPackageLegacy, update, remove,
  applyPackageToLine, assignPackage, getUserPackages, assignBouquetsToPackage,
  isChannelAllowed, isMovieAllowed, isSeriesAllowed, filterChannels, filterMovies, filterSeries,
};
