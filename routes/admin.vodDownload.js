'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');

router.get('/settings/block_vod_download', async (_req, res) => {
  try {
    const val = await dbApi.getSetting('block_vod_download');
    res.json({ enabled: val === '1' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/block_vod_download', async (req, res) => {
  try {
    const { enabled } = req.body;
    await dbApi.setSetting('block_vod_download', enabled ? '1' : '0');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
