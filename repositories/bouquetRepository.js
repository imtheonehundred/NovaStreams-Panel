'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');

async function listBouquets() {
  return await query('SELECT * FROM bouquets ORDER BY bouquet_order, id');
}

async function getBouquetById(id) {
  return await queryOne('SELECT * FROM bouquets WHERE id = ?', [id]);
}

async function getBouquetsByIds(ids) {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return await query(`SELECT * FROM bouquets WHERE id IN (${placeholders})`, ids);
}

async function createBouquet(data) {
  return await insert(
    'INSERT INTO bouquets (bouquet_name, bouquet_channels, bouquet_movies, bouquet_radios, bouquet_series, bouquet_order) VALUES (?, ?, ?, ?, ?, ?)',
    [
      data.bouquet_name || 'New Bouquet',
      JSON.stringify(data.bouquet_channels || []),
      JSON.stringify(data.bouquet_movies || []),
      JSON.stringify(data.bouquet_radios || []),
      JSON.stringify(data.bouquet_series || []),
      data.bouquet_order || 0
    ]
  );
}

async function updateBouquet(id, data) {
  const sets = [];
  const vals = [];
  for (const k of ['bouquet_name', 'bouquet_order']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  for (const k of ['bouquet_channels', 'bouquet_movies', 'bouquet_radios', 'bouquet_series']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(JSON.stringify(data[k])); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE bouquets SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteBouquet(id) {
  return await remove('DELETE FROM bouquets WHERE id = ?', [id]);
}

module.exports = {
  listBouquets,
  getBouquetById,
  getBouquetsByIds,
  createBouquet,
  updateBouquet,
  deleteBouquet,
};
