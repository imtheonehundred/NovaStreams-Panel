'use strict';

const { getSetting } = require('../lib/db');

let bot = null;
let adminChatId = null;

async function getToken() {
  return (await getSetting('telegram_bot_token') || '').trim();
}

async function getAdminChatId() {
  return (await getSetting('telegram_admin_chat_id') || '').trim();
}

async function initBot() {
  try {
    const token = await getToken();
    if (!token) {
      console.log('[TELEGRAM] No bot token configured — bot disabled');
      return;
    }
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(token, { polling: true });
    adminChatId = await getAdminChatId();
    registerCommands();
    console.log('[TELEGRAM] Bot started');
  } catch (e) {
    console.error('[TELEGRAM] Failed to start bot:', e.message);
  }
}

function registerCommands() {
  if (!bot) return;
  bot.onText(/\/start/, (msg) => {
    sendReply(msg.chat.id, 'Welcome to NovaStreams Bot! Use /help for commands.');
  });

  bot.onText(/\/help/, (msg) => {
    const help = `
*NovaStreams Bot Commands*

/status — Panel & system status
/streams — Active stream count
/users — User count
/backup — Trigger manual backup
/stop — Stop watching alerts
/help — Show this message
    `.trim();
    sendReply(msg.chat.id, help, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    try {
      const { collectSystemMetrics } = require('../lib/system-metrics');
      const { getSetting } = require('../lib/db');
      const { query } = require('../lib/mariadb');
      const { channels } = require('../lib/state');

      const sys = await collectSystemMetrics();
      const diskUse = sys.disk?.[0];
      const [userRow] = await query('SELECT COUNT(*) as c FROM `lines` WHERE enabled = 1');
      const activeRow = await query('SELECT COUNT(*) as c FROM lines_activity WHERE date_end IS NULL').catch(() => [{ c: 0 }]);

      const text = `
*System Status*

Uptime: ${sys.uptime ? Math.round(sys.uptime / 3600) + 'h' : 'N/A'}
CPU: ${sys.cpuLoad ? sys.cpuLoad.toFixed(1) + '%' : 'N/A'}
RAM: ${sys.memUsed ? Math.round(sys.memUsed / 1024) + 'MB' : 'N/A'}
Disk: ${diskUse ? diskUse.use + '%' : 'N/A'}
Channels: ${channels ? channels.size : 0}
Active Lines: ${activeRow[0]?.c || 0}
Online Users: ${userRow?.c || 0}
    `.trim();
      sendReply(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) {
      sendReply(msg.chat.id, 'Error fetching status: ' + e.message);
    }
  });

  bot.onText(/\/streams/, async (msg) => {
    try {
      const { channels } = require('../lib/state');
      const runningCount = [...channels.values()].filter(c => c._proc && !c._proc.killed).length;
      sendReply(msg.chat.id, `Active streams: *${runningCount}*\nTotal channels: *${channels.size}*`, { parse_mode: 'Markdown' });
    } catch (e) {
      sendReply(msg.chat.id, 'Error: ' + e.message);
    }
  });

  bot.onText(/\/users/, async (msg) => {
    try {
      const { query } = require('../lib/mariadb');
      const [activeRow] = await query('SELECT COUNT(*) as c FROM `lines` WHERE enabled = 1');
      const [totalRow] = await query('SELECT COUNT(*) as c FROM `lines`');
      sendReply(msg.chat.id, `Active lines: *${activeRow?.c || 0}*\nTotal lines: *${totalRow?.c || 0}*`, { parse_mode: 'Markdown' });
    } catch (e) {
      sendReply(msg.chat.id, 'Error: ' + e.message);
    }
  });

  bot.onText(/\/backup/, async (msg) => {
    try {
      const backupService = require('./backupService');
      await backupService.initBackupTable();
      const backup = await backupService.createBackup();
      sendReply(msg.chat.id, `Backup created: *${backup.filename}* (${(backup.size_bytes / 1024 / 1024).toFixed(1)} MB)`, { parse_mode: 'Markdown' });
    } catch (e) {
      sendReply(msg.chat.id, 'Backup failed: ' + e.message);
    }
  });

  bot.onText(/\/stop/, (msg) => {
    sendReply(msg.chat.id, 'Alerts stopped. Restart the bot to re-enable.');
  });
}

function sendReply(chatId, text, opts) {
  if (!bot) return;
  bot.sendMessage(chatId, text, { ...opts, chat_id: chatId }).catch(() => {});
}

async function sendAlert(message, level = 'info') {
  if (!bot) return;
  const chatId = adminChatId || await getAdminChatId();
  if (!chatId) return;
  const emoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
  bot.sendMessage(chatId, `${emoji} *NovaStreams*\n${message}`, { parse_mode: 'Markdown' }).catch(() => {});
}

async function onStreamDown(channelId, channelName) {
  await sendAlert(`Stream DOWN: ${channelName} (ID: ${channelId})`, 'error');
}

async function onStreamUp(channelId, channelName) {
  await sendAlert(`Stream UP: ${channelName} (ID: ${channelId})`, 'info');
}

async function onSharingDetected(username, ipCount) {
  await sendAlert(`Sharing detected: ${username} — ${ipCount} unique IPs`, 'warning');
}

async function onBackupComplete(filename) {
  await sendAlert(`Backup complete: ${filename}`, 'info');
}

async function onDiskLow(usedPercent) {
  await sendAlert(`Disk low: ${usedPercent}% used`, 'warning');
}

async function stopBot() {
  if (bot) {
    bot.stopPolling();
    bot = null;
    console.log('[TELEGRAM] Bot stopped');
  }
}

module.exports = {
  initBot,
  stopBot,
  sendAlert,
  onStreamDown,
  onStreamUp,
  onSharingDetected,
  onBackupComplete,
  onDiskLow,
};
