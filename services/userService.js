'use strict';

const dbApi = require('../lib/db');

const DEFAULT_META = { status: 'active', expiresAt: null, maxConnections: 3 };

function normalizeMeta(meta) {
  return { ...DEFAULT_META, ...(meta && typeof meta === 'object' ? meta : {}) };
}

async function getMeta(userId) {
  return normalizeMeta(await dbApi.getUserMeta(userId));
}

async function setMeta(userId, patch) {
  const current = await getMeta(userId);
  const next = normalizeMeta({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  await dbApi.setUserMeta(userId, next);
  return next;
}

async function createUser(username, password, meta = {}) {
  const id = await dbApi.createUser(username, password);
  await setMeta(id, meta);
  return id;
}

async function updateUser(userId, patch = {}) {
  return await setMeta(userId, patch);
}

async function getUserByUsername(username) {
  const row = await dbApi.findUserByUsername(username);
  if (!row) return null;
  return { id: row.id, username: row.username, meta: await getMeta(row.id) };
}

async function getUserById(userId) {
  const row = await dbApi.findUserById(userId);
  if (!row) return null;
  return { id: row.id, username: row.username, meta: await getMeta(row.id) };
}

async function verifyCredentials(username, password) {
  const row = await dbApi.findUserByUsername(username);
  if (!row) return null;
  if (!(await dbApi.verifyPassword(row, password))) return null;
  return { id: row.id, username: row.username, meta: await getMeta(row.id) };
}

function isUserAllowed(user) {
  if (!user) return { ok: false, reason: 'user_not_found' };
  const { status = 'active', expiresAt } = user.meta || {};
  if (status === 'banned') return { ok: false, reason: 'banned' };
  if (expiresAt && Date.now() > new Date(expiresAt).getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

async function listUsers() {
  const users = await dbApi.getAllUsers();
  const metaMap = await dbApi.listUserMetaMap(users.map((u) => u.id)) || new Map();
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    meta: normalizeMeta(metaMap.get(Number(u.id))),
  }));
}

module.exports = { createUser, updateUser, getUserByUsername, getUserById, verifyCredentials, isUserAllowed, getMeta, listUsers };
