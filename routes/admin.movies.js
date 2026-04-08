'use strict';
const express = require('express');
const router = express.Router();
const vodService = require('../services/vodService');
const { invalidateVod } = require('../lib/cache');
const {
  validateBody,
  validateParams,
  validateQuery,
} = require('../middleware/validation');
const {
  movieIdParamsSchema,
  movieListQuerySchema,
  movieCreateSchema,
  movieUpdateSchema,
} = require('../middleware/schemas/movie');

router.get('/movies', validateQuery(movieListQuerySchema), async (req, res) => {
  const categoryId = req.query.category_id
    ? String(req.query.category_id)
    : undefined;
  const search =
    req.query.search != null && String(req.query.search).trim() !== ''
      ? String(req.query.search).trim()
      : undefined;
  const sortOrder = req.query.sort === 'id_asc' ? 'id_asc' : 'id_desc';
  const { limit, offset } = req.query;
  try {
    const result = await vodService.listItems(
      categoryId,
      limit,
      offset,
      search,
      sortOrder
    );
    res.json({ movies: result.movies, total: result.total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get(
  '/movies/:id',
  validateParams(movieIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const movie = await vodService.getById(id);
    if (!movie) return res.status(404).json({ error: 'not found' });
    res.json(movie);
  }
);

router.post('/movies', validateBody(movieCreateSchema), async (req, res) => {
  try {
    const id = await vodService.create(req.body || {});
    await invalidateVod();
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.put(
  '/movies/:id',
  validateParams(movieIdParamsSchema),
  validateBody(movieUpdateSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!(await vodService.getById(id)))
      return res.status(404).json({ error: 'not found' });
    try {
      await vodService.update(id, req.body || {});
      await invalidateVod();
      res.json({ ok: true, id });
    } catch (e) {
      res.status(400).json({ error: e.message || 'update failed' });
    }
  }
);

router.delete(
  '/movies/:id',
  validateParams(movieIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const ok = await vodService.remove(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    await invalidateVod();
    res.json({ ok: true });
  }
);

module.exports = router;
