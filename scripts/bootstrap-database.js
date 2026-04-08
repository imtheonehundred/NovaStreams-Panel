#!/usr/bin/env node
'use strict';

/**
 * Run after schema import + .env: applies seedDefaults() and creates a first admin
 * if the users table is empty. Safe to run multiple times.
 *
 * Env (optional):
 *   INSTALL_ADMIN_USER     default random username when unset
 *   INSTALL_ADMIN_PASSWORD if unset, a random password is generated
 *   DEFAULT_ADMIN_ACCESS_CODE / DEFAULT_RESELLER_ACCESS_CODE seed first portal codes
 *   INSTALL_REGISTER_MAIN_SERVER=false skips first local server row creation
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const panelDir = path.join(__dirname, '..');
process.chdir(panelDir);

require('dotenv').config({ path: path.join(panelDir, '.env') });

const dbApi = require('../lib/db');
const { queryOne } = require('../lib/mariadb');
const serverService = require('../services/serverService');

function randomToken(length) {
  return crypto.randomBytes(Math.max(length * 2, 16)).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, length);
}

function appendCredentials(file, lines) {
  if (!file) return;
  try {
    fs.appendFileSync(file, lines.filter(Boolean).join('\n') + '\n', 'utf8');
  } catch (e) {
    console.error('[bootstrap-database] Could not append credentials file:', e.message);
  }
}

function normalizeHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function buildBaseUrl(host, port) {
  if (!host) return '';
  if (port === 80) return `http://${host}`;
  if (port === 443) return `https://${host}`;
  return `http://${host}:${port}`;
}

async function ensureMainServerRow() {
  if (String(process.env.INSTALL_REGISTER_MAIN_SERVER || 'true').trim().toLowerCase() === 'false') {
    return null;
  }

  const row = await queryOne('SELECT COUNT(*) AS c FROM streaming_servers');
  if (row && Number(row.c) > 0) return null;

  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  const publicHost = normalizeHost(process.env.INSTALL_MAIN_SERVER_PUBLIC_HOST || process.env.PANEL_PUBLIC_HOST || process.env.PUBLIC_HOST) || '127.0.0.1';
  const serverIp = String(process.env.INSTALL_MAIN_SERVER_IP || process.env.PANEL_PUBLIC_IP || publicHost).trim();
  const baseUrl = String(process.env.INSTALL_MAIN_SERVER_BASE_URL || process.env.PANEL_BASE_URL || buildBaseUrl(publicHost, port)).trim();
  const name = String(process.env.INSTALL_MAIN_SERVER_NAME || `${os.hostname()} Main Server`).trim();

  const created = await serverService.createServer({
    name,
    role: 'main',
    enabled: 1,
    runtime_enabled: 1,
    controller_enabled: 1,
    public_host: publicHost,
    public_ip: serverIp,
    private_ip: serverIp,
    server_ip: serverIp,
    base_url: baseUrl,
    os_info: `${os.platform()} ${os.release()}`,
  });

  console.log('[bootstrap-database] Main server row created.');
  console.log('[bootstrap-database] Main server name:', created.name || name);
  console.log('[bootstrap-database] Main server base URL:', baseUrl);

  return {
    name: created.name || name,
    baseUrl,
    publicHost,
    serverIp,
  };
}

async function main() {
  await dbApi.seedDefaults();

  const credAppend = process.env.INSTALL_CREDENTIALS_FILE;
  const adminAccessCode = String(process.env.DEFAULT_ADMIN_ACCESS_CODE || '').trim();
  const resellerAccessCode = String(process.env.DEFAULT_RESELLER_ACCESS_CODE || '').trim();

  const n = await dbApi.userCount();
  if (n > 0) {
    console.log('[bootstrap-database] Users already exist; skipping admin creation.');
  } else {
    const username = String(process.env.INSTALL_ADMIN_USER || `admin_${randomToken(8).toLowerCase()}`).trim() || `admin_${randomToken(8).toLowerCase()}`;
    let password = process.env.INSTALL_ADMIN_PASSWORD;
    if (!password || !String(password).trim()) {
      password = randomToken(20);
    }

    await dbApi.createUser(username, String(password));
    console.log('[bootstrap-database] First admin user created.');
    console.log('[bootstrap-database] Username:', username);
    console.log('[bootstrap-database] Password:', password);
    console.log('[bootstrap-database] Log in at http://127.0.0.1:' + (process.env.PORT || '3000') + ' and change this password.');

    appendCredentials(credAppend, [
      `Panel admin username: ${username}`,
      `Panel admin password: ${password}`,
    ]);
  }

  if (adminAccessCode) {
    console.log('[bootstrap-database] Admin access code:', adminAccessCode);
  }
  if (resellerAccessCode) {
    console.log('[bootstrap-database] Reseller access code:', resellerAccessCode);
  }
  appendCredentials(credAppend, [
    adminAccessCode ? `Admin access code: ${adminAccessCode}` : '',
    resellerAccessCode ? `Reseller access code: ${resellerAccessCode}` : '',
  ]);

  const mainServer = await ensureMainServerRow();
  if (mainServer) {
    appendCredentials(credAppend, [
      `Main server name: ${mainServer.name}`,
      `Main server base URL: ${mainServer.baseUrl}`,
      `Main server host: ${mainServer.publicHost}`,
      `Main server IP: ${mainServer.serverIp}`,
    ]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[bootstrap-database] Failed:', e.message);
    process.exit(1);
  });
