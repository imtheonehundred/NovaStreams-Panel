'use strict';

const crypto = require('crypto');
const userService = require('./userService');

const tokens = new Map();
const activeConnections = new Map();
const userSessions = new Map();

function randomToken() { return crypto.randomBytes(24).toString('hex'); }

function incActive(userId, token, ip, channelId) {
  const c = activeConnections.get(userId) || 0;
  activeConnections.set(userId, c + 1);
  const list = userSessions.get(userId) || [];
  list.push({ token, ts: Date.now(), ip, channelId });
  userSessions.set(userId, list);
  return c + 1;
}

function decActive(userId, token) {
  const c = activeConnections.get(userId) || 0;
  const next = Math.max(0, c - 1);
  activeConnections.set(userId, next);
  if (token && userSessions.has(userId)) {
    const list = userSessions.get(userId).filter(s => s.token !== token);
    userSessions.set(userId, list);
  }
  return next;
}

function getActive(userId) { return activeConnections.get(userId) || 0; }

function killOldestSession(userId) {
  const list = userSessions.get(userId) || [];
  if (!list.length) return null;
  list.sort((a, b) => a.ts - b.ts);
  const oldest = list.shift();
  userSessions.set(userId, list);
  if (oldest && tokens.has(oldest.token)) { tokens.delete(oldest.token); decActive(userId, oldest.token); }
  return oldest;
}

function enforceMax(user, maxConnections) {
  const list = userSessions.get(user.id) || [];
  if (list.length < maxConnections) return null;
  return killOldestSession(user.id);
}

function issueToken(user, channelId, ip, ttlSeconds = 3600) {
  const max = user.meta?.maxConnections || 3;
  enforceMax(user, max);
  const token = randomToken();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  tokens.set(token, { userId: user.id, channelId, ip, expiresAt });
  incActive(user.id, token, ip, channelId);
  return { token, expiresAt };
}

async function validateToken(token, ip) {
  const t = tokens.get(token);
  if (!t) return null;
  if (Date.now() > t.expiresAt) { tokens.delete(token); return null; }
  if (t.ip && ip && t.ip !== ip) return null;
  const user = await userService.getUserById(t.userId);
  if (!user) return null;
  const allowed = userService.isUserAllowed(user);
  if (!allowed.ok) return null;
  return { ...t, user };
}

function endSession(token) {
  const t = tokens.get(token);
  if (t) { decActive(t.userId, token); tokens.delete(token); }
}

function canOpenConnection(user) {
  const max = user.meta?.maxConnections || 3;
  return getActive(user.id) < max;
}

module.exports = { issueToken, validateToken, endSession, canOpenConnection, getActive, decActive };
