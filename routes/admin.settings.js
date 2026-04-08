'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const streamingSettings = require('../lib/streaming-settings');
const provisionService = require('../services/provisionService');
const { invalidateSettings } = require('../lib/cache');
const auditService = require('../services/auditService');

const router = express.Router();

const SENSITIVE_SETTING_KEYS = new Set([
  'live_streaming_pass',
  'tmdb_api_key',
  'telegram_bot_token',
  'gdrive_access_token',
  'dropbox_access_token',
  's3_access_key',
  's3_secret_key',
  'cloud_backup_key',
]);

function sanitizeSettings(settings) {
  const next = { ...(settings || {}) };
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = '';
  }
  return next;
}

router.get('/settings', async (_req, res) => {
  res.json(sanitizeSettings(await dbApi.getAllSettings()));
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body))
    return res.status(400).json({ error: 'object body required' });
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_SETTING_KEYS.has(k) && String(v ?? '').trim() === '')
      continue;
    await dbApi.setSetting(k, v);
  }
  await invalidateSettings();
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
  } catch (e) {
    console.error('[settings] refresh streaming:', e.message);
  }
  await auditService.log(
    req.userId,
    'admin.settings.update',
    'settings',
    'global',
    { keys: Object.keys(body) },
    req
  );
  res.json(sanitizeSettings(await dbApi.getAllSettings()));
});

router.get('/settings/streaming-performance', async (_req, res) => {
  try {
    await streamingSettings.refreshStreamingSettings(dbApi);
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/settings/streaming-performance', async (req, res) => {
  try {
    const b = req.body || {};
    const K = streamingSettings.KEYS;
    const boolStr = (v) =>
      v === true ||
      v === 1 ||
      v === '1' ||
      v === 'true' ||
      v === 'on' ||
      v === 'yes'
        ? '1'
        : '0';
    if (b.prebuffer_enabled !== undefined)
      await dbApi.setSetting(K.prebuffer_enabled, boolStr(b.prebuffer_enabled));
    if (b.prebuffer_size_mb !== undefined) {
      const n = parseFloat(b.prebuffer_size_mb, 10);
      if (!Number.isFinite(n) || n < 1 || n > 16) {
        return res
          .status(400)
          .json({ error: 'prebuffer_size_mb must be 1–16' });
      }
      await dbApi.setSetting(K.prebuffer_size_mb, String(n));
    }
    if (b.prebuffer_on_demand_min_bytes !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_min_bytes, 10);
      if (!Number.isFinite(n) || n < 0) {
        return res
          .status(400)
          .json({ error: 'invalid prebuffer_on_demand_min_bytes' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_min_bytes, String(n));
    }
    if (b.prebuffer_on_demand_max_wait_ms !== undefined) {
      const n = parseInt(b.prebuffer_on_demand_max_wait_ms, 10);
      if (!Number.isFinite(n) || n < 100 || n > 60000) {
        return res
          .status(400)
          .json({ error: 'prebuffer_on_demand_max_wait_ms must be 100–60000' });
      }
      await dbApi.setSetting(K.prebuffer_on_demand_max_wait_ms, String(n));
    }
    if (b.ingest_style !== undefined) {
      const s = String(b.ingest_style || '')
        .trim()
        .toLowerCase();
      if (!['webapp', 'xc', 'safe'].includes(s)) {
        return res
          .status(400)
          .json({ error: 'ingest_style must be webapp, xc, or safe' });
      }
      await dbApi.setSetting(K.ingest_style, s);
    }
    if (b.low_latency_enabled !== undefined)
      await dbApi.setSetting(
        K.low_latency_enabled,
        boolStr(b.low_latency_enabled)
      );
    if (b.minimal_ingest_enabled !== undefined) {
      await dbApi.setSetting(
        K.minimal_ingest_enabled,
        boolStr(b.minimal_ingest_enabled)
      );
    }
    if (b.prewarm_enabled !== undefined)
      await dbApi.setSetting(K.prewarm_enabled, boolStr(b.prewarm_enabled));
    if (b.streaming_provisioning_enabled !== undefined) {
      await dbApi.setSetting(
        provisionService.STREAMING_PROVISIONING_KEY,
        boolStr(b.streaming_provisioning_enabled)
      );
    }
    await streamingSettings.refreshStreamingSettings(dbApi);
    await invalidateSettings();
    const prov = await provisionService.getProvisioningUiState();
    res.json({ ...streamingSettings.getStreamingConfig(), ...prov });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

module.exports = router;
