'use strict';

const dbApi = require('../lib/db');

const ALLOWED_TYPES = new Set(['live', 'movie', 'series', 'radio']);

async function listCategories(type) {
  return await dbApi.listCategories(type);
}

async function getById(id) {
  return await dbApi.getCategoryById(id);
}

async function create(data) {
  const categoryType = data && data.category_type != null ? String(data.category_type) : 'live';
  if (!ALLOWED_TYPES.has(categoryType)) {
    throw new Error(`category_type must be one of: ${[...ALLOWED_TYPES].join(', ')}`);
  }
  return await dbApi.createCategory({ ...data, category_type: categoryType });
}

async function update(id, data) {
  const patch = { ...data };
  if (patch.category_type !== undefined) {
    const t = String(patch.category_type);
    if (!ALLOWED_TYPES.has(t)) {
      throw new Error(`category_type must be one of: ${[...ALLOWED_TYPES].join(', ')}`);
    }
  }
  return await dbApi.updateCategory(id, patch);
}

async function remove(id) {
  return await dbApi.deleteCategory(id);
}

module.exports = { listCategories, getById, create, update, remove };
