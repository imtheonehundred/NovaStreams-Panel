'use strict';

const crypto = require('crypto');
const redis = require('../lib/redis');
const userService = require('./userService');

function randomToken() { return crypto.randomBytes(24).toString('hex'); }

function getTokenKey(token) {
  return `playback:token:${String(token || '')}`;
}

function getUserSessionsKey(userId) {
  return `playback:user:${String(userId)}:sessions`;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function listValidSessions(userId) {
  const client = redis.getClient();
  const tokens = await client.zrange(getUserSessionsKey(userId), 0, -1);
  if (!Array.isArray(tokens) || tokens.length === 0) return [];

  const now = Date.now();
  const valid = [];
  const stale = [];
  for (const token of tokens) {
    const record = safeParse(await client.get(getTokenKey(token)));
    if (!record || now > Number(record.expiresAt || 0)) {
      stale.push(token);
      continue;
    }
    valid.push({ token, record });
  }
  if (stale.length > 0) {
    await client.zrem(getUserSessionsKey(userId), ...stale);
  }
  return valid;
}

async function removeSessionToken(token, record = null) {
  const client = redis.getClient();
  const existing = record || safeParse(await client.get(getTokenKey(token)));
  await client.del(getTokenKey(token));
  if (existing && existing.userId != null) {
    await client.zrem(getUserSessionsKey(existing.userId), String(token));
  }
  return existing;
}

async function getActive(userId) {
  return (await listValidSessions(userId)).length;
}

async function decActive(userId, token) {
  if (token) {
    await removeSessionToken(String(token));
  }
  return await getActive(userId);
}

async function killOldestSession(userId) {
  const sessions = await listValidSessions(userId);
  if (!sessions.length) return null;
  const oldest = sessions[0];
  await removeSessionToken(oldest.token, oldest.record);
  return {
    token: oldest.token,
    ts: oldest.record.issuedAt,
    ip: oldest.record.ip,
    channelId: oldest.record.channelId,
  };
}

async function enforceMax(user, maxConnections) {
  let sessions = await listValidSessions(user.id);
  let evicted = null;
  while (sessions.length >= maxConnections) {
    evicted = await killOldestSession(user.id);
    sessions = await listValidSessions(user.id);
  }
  return evicted;
}

async function issueToken(user, channelId, ip, ttlSeconds = 3600) {
  const max = user.meta?.maxConnections || 3;
  await enforceMax(user, max);
  const token = randomToken();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const record = { userId: user.id, channelId, ip, issuedAt, expiresAt };
  const client = redis.getClient();
  await client.setex(getTokenKey(token), Math.max(1, ttlSeconds), JSON.stringify(record));
  await client.zadd(getUserSessionsKey(user.id), issuedAt, token);
  return { token, expiresAt };
}

async function validateToken(token, ip) {
  const t = safeParse(await redis.getClient().get(getTokenKey(token)));
  if (!t) return null;
  if (Date.now() > t.expiresAt) {
    await removeSessionToken(token, t);
    return null;
  }
  if (t.ip && ip && t.ip !== ip) return null;
  const user = await userService.getUserById(t.userId);
  if (!user) {
    await removeSessionToken(token, t);
    return null;
  }
  const allowed = userService.isUserAllowed(user);
  if (!allowed.ok) {
    await removeSessionToken(token, t);
    return null;
  }
  return { ...t, user };
}

async function endSession(token) {
  if (!token) return;
  await removeSessionToken(String(token));
}

async function canOpenConnection(user) {
  const max = user.meta?.maxConnections || 3;
  return (await getActive(user.id)) < max;
}

module.exports = { issueToken, validateToken, endSession, canOpenConnection, getActive, decActive };
