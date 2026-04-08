'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');

async function listCategories(type) {
  if (type) return await query('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories WHERE category_type = ? ORDER BY cat_order, id', [type]);
  return await query('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories ORDER BY cat_order, id');
}

async function getCategoryById(id) {
  return await queryOne('SELECT * FROM stream_categories WHERE id = ?', [id]);
}

async function createCategory(data) {
  return await insert(
    'INSERT INTO stream_categories (category_type, category_name, parent_id, cat_order, is_adult) VALUES (?, ?, ?, ?, ?)',
    [data.category_type || 'live', data.category_name || 'New', data.parent_id || 0, data.cat_order || 0, data.is_adult || 0]
  );
}

async function updateCategory(id, data) {
  const sets = [];
  const vals = [];
  for (const k of ['category_type', 'category_name', 'parent_id', 'cat_order', 'is_adult']) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE stream_categories SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteCategory(id) {
  return await remove('DELETE FROM stream_categories WHERE id = ?', [id]);
}

module.exports = {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
};
