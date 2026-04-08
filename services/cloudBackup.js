'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, execute } = require('../lib/mariadb');
const backupService = require('./backupService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const ALGORITHM = 'aes-256-gcm';
const LOCAL_ONLY_MESSAGE =
  'Coming Soon: cloud backup providers are not available yet. NovaStreams currently supports local backups only.';
const CLOUD_UPLOAD_CAPABILITIES = {
  gdrive: {
    supported: false,
    message: `${LOCAL_ONLY_MESSAGE} Google Drive integration has not shipped yet.`,
  },
  dropbox: {
    supported: false,
    message: `${LOCAL_ONLY_MESSAGE} Dropbox integration has not shipped yet.`,
  },
  s3: {
    supported: false,
    message: `${LOCAL_ONLY_MESSAGE} Amazon S3 integration has not shipped yet.`,
  },
};

function decodeEncryptionKey(keyBase64) {
  const key = Buffer.from(String(keyBase64 || ''), 'base64');
  if (key.length === 32) return key;
  if (key.length > 32) return crypto.createHash('sha256').update(key).digest();
  throw new Error('Invalid encryption key length');
}

function getCloudCapabilityStatus(type) {
  const normalized = String(type || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return {
      configured: false,
      supported: false,
      type: '',
      message: LOCAL_ONLY_MESSAGE,
    };
  }
  const capability = CLOUD_UPLOAD_CAPABILITIES[normalized] || {
    supported: false,
    message: `${LOCAL_ONLY_MESSAGE} Provider '${normalized}' is not recognized by this build.`,
  };
  return {
    configured: true,
    supported: !!capability.supported,
    type: normalized,
    message: capability.message,
  };
}

function encryptFile(srcPath, destPath, keyBase64) {
  const key = decodeEncryptionKey(keyBase64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const inp = fs.createReadStream(srcPath);
  const out = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    inp.on('error', (e) => reject(e));
    out.on('error', (e) => reject(e));
    out.on('finish', () => {
      const authTag = cipher.getAuthTag();
      resolve({
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      });
    });
    inp.pipe(cipher).pipe(out);
  });
}

function decryptFile(srcPath, destPath, keyBase64, ivBase64, authTagBase64) {
  try {
    const key = decodeEncryptionKey(keyBase64);
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const inp = fs.createReadStream(srcPath);
    const out = fs.createWriteStream(destPath);
    return new Promise((resolve, reject) => {
      inp.on('error', (e) => reject(e));
      out.on('error', (e) => reject(e));
      out.on('finish', resolve);
      inp.pipe(decipher).pipe(out);
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

async function uploadToGoogleDrive(_localPath, _destFilename, _driveConfig) {
  throw new Error(
    `${LOCAL_ONLY_MESSAGE} Google Drive upload is disabled in this build.`
  );
}

async function uploadToDropbox(_localPath, _destPath, _dropboxConfig) {
  throw new Error(
    `${LOCAL_ONLY_MESSAGE} Dropbox upload is disabled in this build.`
  );
}

async function uploadToS3(_localPath, _destKey, _s3Config) {
  throw new Error(
    `${LOCAL_ONLY_MESSAGE} Amazon S3 upload is disabled in this build.`
  );
}

async function storeCloudRecord(filename, sizeBytes, cloudUrl, cloudType) {
  await execute(
    'INSERT INTO backups (filename, size_bytes, created_at, type, cloud_url) VALUES (?, ?, NOW(), ?, ?)',
    [filename, sizeBytes, cloudType, cloudUrl]
  );
}

async function getCloudConfig() {
  const dbApi = require('../lib/db');
  const type = await dbApi.getSetting('cloud_backup_type');
  if (!type) return null;

  const cfg = { type };
  if (type === 'gdrive') {
    cfg.access_token = await dbApi.getSetting('gdrive_access_token');
    cfg.folder_id = await dbApi.getSetting('gdrive_folder_id');
    cfg.encryption_key = await dbApi.getSetting('cloud_backup_key');
  } else if (type === 'dropbox') {
    cfg.access_token = await dbApi.getSetting('dropbox_access_token');
    cfg.encryption_key = await dbApi.getSetting('cloud_backup_key');
  } else if (type === 's3') {
    cfg.bucket = await dbApi.getSetting('s3_bucket');
    cfg.region = (await dbApi.getSetting('s3_region')) || 'us-east-1';
    cfg.access_key = await dbApi.getSetting('s3_access_key');
    cfg.secret_key = await dbApi.getSetting('s3_secret_key');
    cfg.encryption_key = await dbApi.getSetting('cloud_backup_key');
  }
  return cfg;
}

async function createEncryptedCloudBackup(filename) {
  const localPath = await backupService.getBackupPath(filename);
  if (!localPath) throw new Error('Backup file not found');
  const stat = fs.statSync(localPath);
  const cloudCfg = await getCloudConfig();
  if (!cloudCfg) throw new Error('Cloud backup not configured');
  const capability = getCloudCapabilityStatus(cloudCfg.type);
  if (!capability.supported) throw new Error(capability.message);
  if (!cloudCfg.encryption_key)
    throw new Error('Cloud backup encryption key not set');

  const encFilename = filename + '.enc';
  const encPath = path.join(BACKUP_DIR, encFilename);

  await encryptFile(localPath, encPath, cloudCfg.encryption_key);

  let cloudUrl;
  let uploadOk = false;
  try {
    if (cloudCfg.type === 'gdrive') {
      cloudUrl = await uploadToGoogleDrive(encPath, encFilename, cloudCfg);
      uploadOk = true;
    } else if (cloudCfg.type === 'dropbox') {
      cloudUrl = await uploadToDropbox(encPath, `/${encFilename}`, cloudCfg);
      uploadOk = true;
    } else if (cloudCfg.type === 's3') {
      cloudUrl = await uploadToS3(encPath, encFilename, cloudCfg);
      uploadOk = true;
    }
  } finally {
    // Only delete encrypted file after successful upload
    if (uploadOk && fs.existsSync(encPath)) fs.unlinkSync(encPath);
  }

  await storeCloudRecord(
    filename,
    stat.size,
    cloudUrl || 'uploaded',
    cloudCfg.type
  );
  return { ok: true };
}

async function getCloudBackups() {
  const rows = await query(
    'SELECT id, filename, size_bytes, created_at, type, cloud_url FROM backups WHERE type IN ("gdrive","dropbox","s3") ORDER BY created_at DESC'
  );
  return rows.map((r) => ({
    ...r,
    size_mb: (r.size_bytes / (1024 * 1024)).toFixed(2),
  }));
}

module.exports = {
  LOCAL_ONLY_MESSAGE,
  encryptFile,
  decryptFile,
  uploadToGoogleDrive,
  uploadToDropbox,
  uploadToS3,
  createEncryptedCloudBackup,
  getCloudBackups,
  getCloudConfig,
  getCloudCapabilityStatus,
};
