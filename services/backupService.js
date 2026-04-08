'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { query, execute } = require('../lib/mariadb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_LOCAL_BACKUPS = 50;
const MAX_CONFIGURED_LOCAL_BACKUPS = 200;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeBackupFilename(filename) {
  const name = String(filename || '').trim();
  if (!name) throw new Error('Backup filename required');
  if (path.basename(name) !== name) throw new Error('Invalid backup filename');
  if (!/\.sql(\.gz)?$/i.test(name)) throw new Error('Unsupported backup filename');
  return name;
}

async function getLocalBackupRetentionLimit() {
  try {
    const dbApi = require('../lib/db');
    const raw = await dbApi.getSetting('backups_to_keep');
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_CONFIGURED_LOCAL_BACKUPS);
    }
  } catch {}
  return MAX_LOCAL_BACKUPS;
}

function getBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  return BACKUP_DIR;
}

function getDbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'iptv',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iptv_panel',
  };
}

function mysqldumpPath() {
  return process.env.MYSQLDUMP_PATH || 'mysqldump';
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function createBackup(options = {}) {
  const cfg = getDbConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql.gz`;
  const filepath = path.join(getBackupDir(), filename);

  const passArg = cfg.password ? `-p${shellQuote(cfg.password)}` : '';
  const cmd = `${shellQuote(mysqldumpPath())} -h${shellQuote(cfg.host)} -P${shellQuote(cfg.port)} -u${shellQuote(cfg.user)} ${passArg} ${shellQuote(cfg.database)} 2>/dev/null | gzip > ${shellQuote(filepath)}`;

  await runCommand(cmd);

  const stat = fs.statSync(filepath);
  const record = {
    filename,
    size_bytes: stat.size,
    created_at: new Date().toISOString(),
    type: 'local',
  };

  await execute(
    'INSERT INTO backups (filename, size_bytes, created_at, type) VALUES (?, ?, NOW(), ?)',
    [filename, stat.size, 'local']
  );

  if (!options.skipPrune) {
    await pruneOldBackups();
  }

  return record;
}

async function listBackups() {
  const rows = await query(
    'SELECT id, filename, size_bytes, created_at, type, cloud_url FROM backups WHERE type = ? ORDER BY created_at DESC, id DESC',
    ['local']
  );
  return rows.map(r => ({
    ...r,
    size_mb: (r.size_bytes / (1024 * 1024)).toFixed(2),
    file_present: r.type !== 'local' ? null : (() => {
      try {
        return fs.existsSync(path.join(getBackupDir(), normalizeBackupFilename(r.filename)));
      } catch {
        return false;
      }
    })(),
    is_restorable: r.type === 'local' ? (() => {
      try {
        return fs.existsSync(path.join(getBackupDir(), normalizeBackupFilename(r.filename)));
      } catch {
        return false;
      }
    })() : false,
  }));
}

async function getBackupPath(filename) {
  const filepath = path.join(getBackupDir(), normalizeBackupFilename(filename));
  if (!fs.existsSync(filepath)) return null;
  return filepath;
}

async function deleteBackupFile(filename) {
  const safeFilename = normalizeBackupFilename(filename);
  const filepath = path.join(getBackupDir(), safeFilename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  await execute('DELETE FROM backups WHERE filename = ?', [safeFilename]);
}

async function restoreBackup(filename) {
  const safeFilename = normalizeBackupFilename(filename);
  const filepath = await getBackupPath(safeFilename);
  if (!filepath) throw new Error('Backup file not found');

  const safetyBackup = await createBackup({ skipPrune: true });

  const cfg = getDbConfig();
  const passArg = cfg.password ? `-p${shellQuote(cfg.password)}` : '';
  const isGz = safeFilename.endsWith('.gz');

  let cmd;
  if (isGz) {
    cmd = `gunzip < ${shellQuote(filepath)} | mysql -h${shellQuote(cfg.host)} -P${shellQuote(cfg.port)} -u${shellQuote(cfg.user)} ${passArg} ${shellQuote(cfg.database)} 2>/dev/null`;
  } else {
    cmd = `mysql -h${shellQuote(cfg.host)} -P${shellQuote(cfg.port)} -u${shellQuote(cfg.user)} ${passArg} ${shellQuote(cfg.database)} < ${shellQuote(filepath)} 2>/dev/null`;
  }

  await runCommand(cmd);
  await pruneOldBackups();
  return { ok: true, safetyBackup };
}

async function pruneOldBackups() {
  const retentionLimit = await getLocalBackupRetentionLimit();
  const rows = await query(
    'SELECT id, filename FROM backups WHERE type = ? ORDER BY created_at DESC, id DESC',
    ['local']
  );
  if (rows.length > retentionLimit) {
    const toDelete = rows.slice(retentionLimit);
    for (const r of toDelete) {
      await deleteBackupFile(r.filename);
    }
  }
}

async function initBackupTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS backups (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      size_bytes BIGINT UNSIGNED DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      type ENUM('local','gdrive','dropbox','s3') DEFAULT 'local',
      cloud_url TEXT,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = {
  createBackup,
  listBackups,
  getBackupPath,
  deleteBackupFile,
  restoreBackup,
  pruneOldBackups,
  initBackupTable,
  getLocalBackupRetentionLimit,
  normalizeBackupFilename,
};
