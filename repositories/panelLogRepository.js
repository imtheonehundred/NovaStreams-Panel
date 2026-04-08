'use strict';

const { query, execute } = require('../lib/mariadb');

async function addPanelLog(userId, action, targetType, targetId, details) {
  await execute('INSERT INTO panel_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)', [userId || 0, action || '', targetType || '', String(targetId || ''), details || '']);
}

async function getPanelLogs(limit = 200) {
  return await query('SELECT id, user_id, action, target_type, target_id, details, created_at FROM panel_logs ORDER BY id DESC LIMIT ?', [limit]);
}

module.exports = {
  addPanelLog,
  getPanelLogs,
};
