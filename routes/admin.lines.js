'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const lineService = require('../services/lineService');
const { invalidateLines } = require('../lib/cache');
const { query } = require('../lib/mariadb');
const {
  validateBody,
  validateParams,
  validateQuery,
} = require('../middleware/validation');
const {
  lineListQuerySchema,
  lineIdParamsSchema,
  lineCreateSchema,
  lineUpdateSchema,
  bulkLineImportSchema,
} = require('../middleware/schemas/line');
const auditService = require('../services/auditService');

const router = express.Router();

router.get('/lines', validateQuery(lineListQuerySchema), async (req, res) => {
  const mid = req.query.member_id;
  let memberId;
  if (mid !== undefined && mid !== '' && mid !== 'null') {
    memberId = Number(mid);
  }
  try {
    const { limit, offset } = req.query;
    const result = await lineService.listAll(memberId, limit, offset);
    const lines = (result.lines || result).map((r) =>
      lineService.normalizeLineRow(dbApi.attachLinePassword(r))
    );
    res.json({ lines, total: result.total || lines.length });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get(
  '/lines/:id/connections',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const line = await dbApi.getLineById(id);
    if (!line) return res.status(404).json({ error: 'not found' });
    const connections = await lineService.getActiveConnections(id);
    res.json({ connections });
  }
);

router.post(
  '/lines/:id/kill-connections',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const line = await dbApi.getLineById(id);
    if (!line) return res.status(404).json({ error: 'not found' });
    const killed = await lineService.killConnections(id);
    res.json({ ok: true, killed });
  }
);

router.post('/lines/expired/delete', async (_req, res) => {
  const deleted = await dbApi.deleteExpiredLines();
  await invalidateLines();
  res.json({ ok: true, deleted });
});

router.post(
  '/lines/:id/ban',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!(await dbApi.getLineById(id)))
      return res.status(404).json({ error: 'not found' });
    await lineService.update(id, { admin_enabled: 0 });
    await invalidateLines();
    res.json({ ok: true, id, admin_enabled: 0 });
  }
);

router.post(
  '/lines/:id/unban',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!(await dbApi.getLineById(id)))
      return res.status(404).json({ error: 'not found' });
    await lineService.update(id, { admin_enabled: 1 });
    await invalidateLines();
    res.json({ ok: true, id, admin_enabled: 1 });
  }
);

router.get(
  '/lines/:id',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const row = await dbApi.getLineById(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(lineService.normalizeLineRow(dbApi.attachLinePassword(row)));
  }
);

router.post('/lines', validateBody(lineCreateSchema), async (req, res) => {
  try {
    const line = await lineService.createLine(req.body || {});
    await invalidateLines();
    await auditService.log(
      req.userId,
      'admin.line.create',
      'line',
      line.id,
      { username: line.username },
      req
    );
    res
      .status(201)
      .json(lineService.normalizeLineRow(dbApi.attachLinePassword(line)));
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.put(
  '/lines/:id',
  validateParams(lineIdParamsSchema),
  validateBody(lineUpdateSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!(await dbApi.getLineById(id)))
      return res.status(404).json({ error: 'not found' });
    try {
      const line = await lineService.update(id, req.body || {});
      await invalidateLines();
      await auditService.log(
        req.userId,
        'admin.line.update',
        'line',
        id,
        { fields: Object.keys(req.body || {}) },
        req
      );
      res.json(lineService.normalizeLineRow(dbApi.attachLinePassword(line)));
    } catch (e) {
      res.status(400).json({ error: e.message || 'update failed' });
    }
  }
);

router.delete(
  '/lines/:id',
  validateParams(lineIdParamsSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const ok = await lineService.remove(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    await invalidateLines();
    await auditService.log(
      req.userId,
      'admin.line.delete',
      'line',
      id,
      {},
      req
    );
    res.json({ ok: true });
  }
);

router.post(
  '/lines/bulk',
  validateBody(bulkLineImportSchema),
  async (req, res) => {
    try {
      const {
        users,
        package_id,
        member_id = 0,
        test_mode = false,
        skip_duplicates = true,
        max_connections,
        is_trial,
        bouquet,
      } = req.body || {};

      if (!Array.isArray(users) || !users.length) {
        return res.status(400).json({ error: 'No users provided' });
      }
      if (!package_id) {
        return res.status(400).json({ error: 'Package ID required' });
      }

      const basePayload = {
        package_id: parseInt(package_id, 10),
        member_id: parseInt(member_id, 10) || 0,
        admin_enabled: 1,
      };
      const pkg = await dbApi.getPackageById(basePayload.package_id);
      if (!pkg) {
        return res.status(400).json({ error: 'Package not found' });
      }
      if (
        max_connections !== undefined &&
        max_connections !== null &&
        max_connections !== ''
      ) {
        const mc = parseInt(max_connections, 10);
        if (Number.isFinite(mc) && mc > 0) basePayload.max_connections = mc;
      }
      if (is_trial !== undefined) {
        basePayload.is_trial = Number(is_trial) ? 1 : 0;
      }
      if (Array.isArray(bouquet) && bouquet.length) {
        basePayload.bouquet = bouquet
          .map((b) => parseInt(b, 10))
          .filter((v) => Number.isFinite(v));
      }

      const existingLines = await query('SELECT username FROM `lines`');
      const existingUsernames = new Set(
        existingLines.map((l) => l.username?.toLowerCase())
      );

      const details = [];
      let created = 0;
      let skipped = 0;
      let errors = 0;

      for (const user of users) {
        const username = (user.username || '').trim();
        const password = (user.password || '').trim();

        if (!username) {
          details.push({
            username: '(empty)',
            status: 'error',
            message: 'Empty username',
          });
          errors++;
          continue;
        }

        if (existingUsernames.has(username.toLowerCase())) {
          if (skip_duplicates) {
            details.push({
              username,
              status: 'skipped',
              message: 'Duplicate username',
            });
            skipped++;
            continue;
          } else {
            details.push({
              username,
              status: 'error',
              message: 'Duplicate username',
            });
            errors++;
            continue;
          }
        }

        if (test_mode) {
          details.push({
            username,
            status: 'valid',
            message: 'Would be created',
          });
          created++;
          existingUsernames.add(username.toLowerCase());
        } else {
          try {
            const payload = { ...basePayload, username, password };
            const expDate = parseInt(user.exp_date, 10);
            if (Number.isFinite(expDate) && expDate > 0)
              payload.exp_date = expDate;
            if (user.exp_date === null) payload.exp_date = null;
            await lineService.createLine(payload);
            details.push({
              username,
              status: 'created',
              message: 'User created',
            });
            created++;
            existingUsernames.add(username.toLowerCase());
          } catch (createErr) {
            details.push({
              username,
              status: 'error',
              message: createErr.message || 'Creation failed',
            });
            errors++;
          }
        }
      }

      if (!test_mode && created > 0) {
        await invalidateLines();
      }

      await auditService.log(
        req.userId,
        'admin.line.bulk_create',
        'line',
        null,
        { created, skipped, errors, totalUsers: users.length, test_mode },
        req
      );

      res.json({
        test_mode,
        created,
        skipped,
        errors,
        total: users.length,
        details,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Bulk import failed' });
    }
  }
);

module.exports = router;
