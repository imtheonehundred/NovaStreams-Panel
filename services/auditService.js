'use strict';

const dbApi = require('../lib/db');
const { error: logError } = require('./logger');

function buildRequestMeta(req) {
  if (!req) return {};
  return {
    method: req.method,
    path: req.originalUrl || req.path || '',
  };
}

function truncateUserAgent(userAgent) {
  return String(userAgent || '').slice(0, 512);
}

async function log(
  userId,
  action,
  resourceType,
  resourceId,
  meta = {},
  req = null
) {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await dbApi.insertAuditLog({
      user_id: userId || null,
      action,
      resource_type: resourceType || null,
      resource_id:
        resourceId !== null && resourceId !== undefined
          ? String(resourceId)
          : null,
      ip_address: req ? req.ip || req.connection?.remoteAddress || '' : '',
      user_agent: req ? truncateUserAgent(req.get?.('user-agent')) : '',
      meta: {
        ...buildRequestMeta(req),
        ...(meta || {}),
      },
    });
  } catch (error) {
    logError('audit_log_failed', {
      action,
      resourceType,
      resourceId,
      error: error.message,
    });
  }
}

module.exports = {
  log,
};
