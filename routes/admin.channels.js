'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');
const importChannelBridge = require('../lib/importChannelBridge');
const { validateBody } = require('../middleware/validation');
const { liveChannelImportSchema } = require('../middleware/schemas/channel');

router.post(
  '/import-live',
  validateBody(liveChannelImportSchema),
  async (req, res) => {
    const body = req.body || {};
    const url = body.url || body.mpdUrl;
    try {
      const userId = await dbApi.getFirstAdminUserId();
      if (!userId) return res.status(500).json({ error: 'no admin user' });
      const { detectInputType } = require('../lib/input-detect');
      const inputType = body.inputType || detectInputType(url);
      const created = await importChannelBridge.importLiveChannel(
        {
          name: body.name || 'Live',
          mpdUrl: url,
          inputType,
          category_id:
            body.category_id != null
              ? parseInt(body.category_id, 10)
              : undefined,
          logoUrl: body.logo || body.logoUrl || '',
          epgChannelId: body.epg_channel_id || body.epgChannelId || '',
        },
        userId
      );
      res.status(201).json(created);
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message || 'failed' });
    }
  }
);

module.exports = router;
