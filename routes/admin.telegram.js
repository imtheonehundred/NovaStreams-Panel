'use strict';
const express = require('express');
const router = express.Router();
const dbApi = require('../lib/db');

router.get('/settings/telegram', async (_req, res) => {
  try {
    const token = await dbApi.getSetting('telegram_bot_token');
    const chatId = await dbApi.getSetting('telegram_admin_chat_id');
    const enabled = await dbApi.getSetting('telegram_alerts_enabled');
    res.json({
      bot_token_set: !!token,
      admin_chat_id: chatId || '',
      alerts_enabled: enabled !== '0',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/telegram', async (req, res) => {
  try {
    const { bot_token, admin_chat_id, alerts_enabled } = req.body;
    if (bot_token !== undefined) await dbApi.setSetting('telegram_bot_token', bot_token || '');
    if (admin_chat_id !== undefined) await dbApi.setSetting('telegram_admin_chat_id', admin_chat_id || '');
    if (alerts_enabled !== undefined) await dbApi.setSetting('telegram_alerts_enabled', alerts_enabled ? '1' : '0');
    const { stopBot, initBot } = require('../services/telegramBot');
    await stopBot();
    if (bot_token) {
      setTimeout(() => initBot().catch(e => console.error('[TELEGRAM]', e.message)), 2000);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
