'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const {
  mysqlDatetimeToUnixSeconds,
  unixSecondsToMysqlDatetime,
} = require('../lib/mysql-datetime');

function parseJsonArrayField(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseProviderRow(row) {
  if (!row) return null;
  return {
    ...row,
    last_updated: mysqlDatetimeToUnixSeconds(row.last_updated),
    movie_categories: parseJsonArrayField(row.movie_categories),
    series_categories: parseJsonArrayField(row.series_categories),
    live_categories: parseJsonArrayField(row.live_categories),
  };
}

async function ensureImportProvidersTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS import_providers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      bouquet_id INT DEFAULT 0,
      update_frequency INT DEFAULT 0,
      last_updated DATETIME DEFAULT NULL,
      movie_categories JSON DEFAULT NULL,
      series_categories JSON DEFAULT NULL,
      live_categories JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function listImportProviders() {
  const rows = await query('SELECT * FROM import_providers ORDER BY id ASC');
  return rows.map(parseProviderRow);
}

async function getImportProviderById(id) {
  return parseProviderRow(
    await queryOne('SELECT * FROM import_providers WHERE id = ?', [id])
  );
}

async function createImportProvider(data) {
  const name = String(data.name || '').trim() || 'Provider';
  const url = String(data.url || '').trim();
  const lastUpdated = parseInt(data.last_updated, 10) || 0;
  if (!url) throw new Error('url required');
  return await insert(
    `INSERT INTO import_providers (name, url, bouquet_id, update_frequency, last_updated, movie_categories, series_categories, live_categories)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      url,
      parseInt(data.bouquet_id, 10) || 0,
      parseInt(data.update_frequency, 10) || 0,
      lastUpdated > 0 ? unixSecondsToMysqlDatetime(lastUpdated) : null,
      JSON.stringify(
        Array.isArray(data.movie_categories) ? data.movie_categories : []
      ),
      JSON.stringify(
        Array.isArray(data.series_categories) ? data.series_categories : []
      ),
      JSON.stringify(
        Array.isArray(data.live_categories) ? data.live_categories : []
      ),
    ]
  );
}

async function updateImportProvider(id, data) {
  const sets = [];
  const vals = [];
  if (data.name !== undefined) {
    sets.push('name = ?');
    vals.push(String(data.name).trim());
  }
  if (data.url !== undefined) {
    sets.push('url = ?');
    vals.push(String(data.url).trim());
  }
  if (data.bouquet_id !== undefined) {
    sets.push('bouquet_id = ?');
    vals.push(parseInt(data.bouquet_id, 10) || 0);
  }
  if (data.update_frequency !== undefined) {
    sets.push('update_frequency = ?');
    vals.push(parseInt(data.update_frequency, 10) || 0);
  }
  if (data.last_updated !== undefined) {
    const lastUpdated = parseInt(data.last_updated, 10) || 0;
    sets.push('last_updated = ?');
    vals.push(lastUpdated > 0 ? unixSecondsToMysqlDatetime(lastUpdated) : null);
  }
  if (data.movie_categories !== undefined) {
    sets.push('movie_categories = ?');
    vals.push(JSON.stringify(data.movie_categories || []));
  }
  if (data.series_categories !== undefined) {
    sets.push('series_categories = ?');
    vals.push(JSON.stringify(data.series_categories || []));
  }
  if (data.live_categories !== undefined) {
    sets.push('live_categories = ?');
    vals.push(JSON.stringify(data.live_categories || []));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(
    `UPDATE import_providers SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

async function deleteImportProvider(id) {
  return await remove('DELETE FROM import_providers WHERE id = ?', [id]);
}

module.exports = {
  ensureImportProvidersTable,
  listImportProviders,
  getImportProviderById,
  createImportProvider,
  updateImportProvider,
  deleteImportProvider,
};
