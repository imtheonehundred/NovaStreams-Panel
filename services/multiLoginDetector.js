'use strict';

const { query } = require('../lib/mariadb');
const { getSetting } = require('../lib/db');

// In-memory: lineId → Set of {ip, userAgent, lastSeen}
const activeConnections = new Map();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function recordConnection(lineId, ip, userAgent) {
  if (!lineId) return;
  if (!activeConnections.has(lineId)) {
    activeConnections.set(lineId, new Map());
  }
  const key = `${ip}|${userAgent}`;
  const conns = activeConnections.get(lineId);
  conns.set(key, { ip, userAgent, lastSeen: Date.now() });
}

async function getConnections(lineId) {
  if (!activeConnections.has(lineId)) return [];
  return Array.from(activeConnections.get(lineId).values());
}

async function isMultiLogin(lineId) {
  const maxConns = parseInt(await getSetting('max_connections_per_line') || '1', 10);
  if (!activeConnections.has(lineId)) return false;
  const unique = activeConnections.get(lineId).size;
  return unique > maxConns;
}

async function getMultiLoginLines() {
  const maxConns = parseInt(await getSetting('max_connections_per_line') || '1', 10);
  const result = [];
  for (const [lineId, conns] of activeConnections.entries()) {
    if (conns.size > maxConns) {
      result.push({ lineId, connections: Array.from(conns.values()), count: conns.size });
    }
  }
  return result;
}

async function disconnectLine(lineId) {
  activeConnections.delete(lineId);
}

function cleanup() {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 min timeout
  for (const [lineId, conns] of activeConnections.entries()) {
    for (const [key, conn] of conns.entries()) {
      if (now - conn.lastSeen > timeout) {
        conns.delete(key);
      }
    }
    if (conns.size === 0) {
      activeConnections.delete(lineId);
    }
  }
}

// Start background cleanup
setInterval(cleanup, CLEANUP_INTERVAL_MS).unref();

module.exports = {
  recordConnection,
  getConnections,
  isMultiLogin,
  getMultiLoginLines,
  disconnectLine,
  cleanup,
};
