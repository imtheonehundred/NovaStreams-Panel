'use strict';
const express = require('express');
const router = express.Router();
const categoryService = require('../services/categoryService');
const importService = require('../services/importService');
const { invalidateCategories } = require('../lib/cache');

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/categories', async (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  try { res.json({ categories: await categoryService.listCategories(type) }); }
  catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

router.post('/categories', async (req, res) => {
  try {
    const id = await categoryService.create(req.body || {});
    await invalidateCategories();
    res.status(201).json({ id });
  } catch (e) { res.status(400).json({ error: e.message || 'create failed' }); }
});

router.put('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  if (!(await categoryService.getById(id))) return res.status(404).json({ error: 'not found' });
  try {
    await categoryService.update(id, req.body || {});
    await invalidateCategories();
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message || 'update failed' }); }
});

router.delete('/categories/:id', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const ok = await categoryService.remove(id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  await invalidateCategories();
  res.json({ ok: true });
});

router.post('/categories/find-or-create', async (req, res) => {
  const { category_name, category_type } = req.body || {};
  if (!category_name || !category_type) return res.status(400).json({ error: 'category_name and category_type required' });
  try {
    const id = await importService.findOrCreateCategory(String(category_name), String(category_type), null);
    await invalidateCategories();
    res.json({ id, category_name: String(category_name) });
  } catch (e) { res.status(400).json({ error: e.message || 'failed' }); }
});

module.exports = router;
