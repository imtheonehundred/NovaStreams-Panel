'use strict';

const { query, insert } = require('../lib/mariadb');

async function insertAuditLog(entry) {
  return await insert(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_address, user_agent, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.user_id || null,
      entry.action,
      entry.resource_type || null,
      entry.resource_id !== null && entry.resource_id !== undefined
        ? String(entry.resource_id)
        : null,
      entry.ip_address || '',
      entry.user_agent || '',
      JSON.stringify(entry.meta || {}),
    ]
  );
}

async function listAuditLogs(limit = 100) {
  return await query(
    'SELECT id, user_id, action, resource_type, resource_id, ip_address, user_agent, meta, created_at FROM audit_log ORDER BY id DESC LIMIT ?',
    [limit]
  );
}

module.exports = {
  insertAuditLog,
  listAuditLogs,
};
