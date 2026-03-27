'use strict';

const path = require('path');
const dbApi = require('../lib/db');
const { loadJson, saveJson, ensureDirExists } = require('../utils/fileStore');

const DATA_DIR = path.join(__dirname, '..', 'data');
const META_PATH = path.join(DATA_DIR, 'user_meta.json');
ensureDirExists(DATA_DIR);
let metaCache = loadJson(META_PATH, {});

function getMeta(userId) {
  return metaCache[userId] || { status: 'active', expiresAt: null, maxConnections: 3 };
}

function setMeta(userId, patch) {
  const current = getMeta(userId);
  metaCache[userId] = { ...current, ...patch };
  saveJson(META_PATH, metaCache);
  return metaCache[userId];
}

async function createUser(username, password, meta = {}) {
  const id = await dbApi.createUser(username, password);
  setMeta(id, meta);
  return id;
}

async function updateUser(userId, patch = {}) {
  return setMeta(userId, patch);
}

async function getUserByUsername(username) {
  const row = await dbApi.findUserByUsername(username);
  if (!row) return null;
  return { id: row.id, username: row.username, meta: getMeta(row.id) };
}

async function getUserById(userId) {
  const row = await dbApi.findUserById(userId);
  if (!row) return null;
  return { id: row.id, username: row.username, meta: getMeta(row.id) };
}

async function verifyCredentials(username, password) {
  const row = await dbApi.findUserByUsername(username);
  if (!row) return null;
  if (!(await dbApi.verifyPassword(row, password))) return null;
  return { id: row.id, username: row.username, meta: getMeta(row.id) };
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
  return users.map(u => ({ id: u.id, username: u.username, meta: getMeta(u.id) }));
}

module.exports = { createUser, updateUser, getUserByUsername, getUserById, verifyCredentials, isUserAllowed, getMeta, listUsers };
