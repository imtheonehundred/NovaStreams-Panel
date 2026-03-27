#!/usr/bin/env node
'use strict';

/**
 * Run after schema import + .env: applies seedDefaults() and creates a first admin
 * if the users table is empty. Safe to run multiple times.
 *
 * Env (optional):
 *   INSTALL_ADMIN_USER     default admin
 *   INSTALL_ADMIN_PASSWORD if unset, a random password is generated
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const panelDir = path.join(__dirname, '..');
process.chdir(panelDir);

require('dotenv').config({ path: path.join(panelDir, '.env') });

const dbApi = require('../lib/db');

async function main() {
  await dbApi.seedDefaults();

  const n = await dbApi.userCount();
  if (n > 0) {
    console.log('[bootstrap-database] Users already exist; skipping admin creation.');
    return;
  }

  const username = String(process.env.INSTALL_ADMIN_USER || 'admin').trim() || 'admin';
  let password = process.env.INSTALL_ADMIN_PASSWORD;
  if (!password || !String(password).trim()) {
    password = crypto.randomBytes(14).toString('base64url').slice(0, 20);
  }

  await dbApi.createUser(username, String(password));
  console.log('[bootstrap-database] First admin user created.');
  console.log('[bootstrap-database] Username:', username);
  console.log('[bootstrap-database] Password:', password);
  console.log('[bootstrap-database] Log in at http://127.0.0.1:' + (process.env.PORT || '3000') + ' and change this password.');

  const credAppend = process.env.INSTALL_CREDENTIALS_FILE;
  if (credAppend) {
    try {
      fs.appendFileSync(
        credAppend,
        `Panel admin username: ${username}\nPanel admin password: ${password}\n`,
        'utf8'
      );
    } catch (e) {
      console.error('[bootstrap-database] Could not append credentials file:', e.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[bootstrap-database] Failed:', e.message);
    process.exit(1);
  });
