'use strict';

/**
 * Crypto utilities for the IPTV panel.
 * Handles API key hashing, line password hashing, and password encryption.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

async function hashApiKey(plain) {
  return await bcrypt.hash(String(plain), 12);
}

async function verifyApiKey(plain, hash) {
  if (!hash) return false;
  return await bcrypt.compare(String(plain), String(hash));
}

function getLinePasswordSecretMaterial() {
  const secret = String(process.env.LINE_PASSWORD_SECRET || '').trim();
  if (secret) return secret;
  // Always throw if no secret is configured — no fallback in any environment.
  // Encryption key material must never default to a known string.
  throw new Error('LINE_PASSWORD_SECRET environment variable is required');
}

function getLinePasswordCryptoKey() {
  return crypto.createHash('sha256').update(getLinePasswordSecretMaterial(), 'utf8').digest();
}

function getSensitiveValueSecretMaterial() {
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
  if (sessionSecret) return sessionSecret;
  const lineSecret = String(process.env.LINE_PASSWORD_SECRET || '').trim();
  if (lineSecret) return lineSecret;
  // Always throw if no secret is configured — no fallback in any environment.
  throw new Error('SESSION_SECRET or LINE_PASSWORD_SECRET environment variable is required');
}

function getSensitiveValueCryptoKey() {
  return crypto.createHash('sha256').update(getSensitiveValueSecretMaterial(), 'utf8').digest();
}

async function hashLinePassword(plain) {
  return await bcrypt.hash(String(plain), 12);
}

async function verifyLinePasswordHash(plain, passwordHash) {
  if (!passwordHash) return false;
  return await bcrypt.compare(String(plain), String(passwordHash));
}

function encryptLinePassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getLinePasswordCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptLinePassword(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getLinePasswordCryptoKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function encryptSensitiveValue(plain) {
  const raw = String(plain || '');
  if (!raw) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSensitiveValueCryptoKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSensitiveValue(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const encrypted = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSensitiveValueCryptoKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

module.exports = {
  hashApiKey,
  verifyApiKey,
  getLinePasswordSecretMaterial,
  getLinePasswordCryptoKey,
  getSensitiveValueSecretMaterial,
  getSensitiveValueCryptoKey,
  hashLinePassword,
  verifyLinePasswordHash,
  encryptLinePassword,
  decryptLinePassword,
  encryptSensitiveValue,
  decryptSensitiveValue,
};
