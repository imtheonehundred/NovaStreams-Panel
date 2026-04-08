'use strict';

const express = require('express');
const { query } = require('../lib/mariadb');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/backups', async (_req, res) => {
  try {
    const backupService = require('../services/backupService');
    await backupService.initBackupTable();
    const backups = await backupService.listBackups();
    const retentionLimit = await backupService.getLocalBackupRetentionLimit();
    res.json({ backups, retentionLimit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups', async (req, res) => {
  try {
    const backupService = require('../services/backupService');
    await backupService.initBackupTable();
    const backup = await backupService.createBackup();
    res.json({ ok: true, backup });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backups/:id/download', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const filepath = await backupService.getBackupPath(rows[0].filename);
    if (!filepath) return res.status(404).json({ error: 'file not found' });
    res.download(filepath, rows[0].filename);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups/:id/restore', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename, type FROM backups WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    if (rows[0].type !== 'local') return res.status(400).json({ error: 'only local backups can be restored' });
    const confirmFilename = String(req.body && (req.body.confirmFilename || req.body.confirm_filename) || '').trim();
    if (!confirmFilename || confirmFilename !== rows[0].filename) {
      return res.status(400).json({ error: 'confirmFilename must exactly match the backup filename' });
    }
    const result = await backupService.restoreBackup(rows[0].filename);
    res.json({ ok: true, safetyBackup: result && result.safetyBackup ? result.safetyBackup : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/backups/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const backupService = require('../services/backupService');
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await backupService.deleteBackupFile(rows[0].filename);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backups/cloud', async (_req, res) => {
  try {
    const cloudBackup = require('../services/cloudBackup');
    const backups = await cloudBackup.getCloudBackups();
    const cfg = await cloudBackup.getCloudConfig();
    const capability = cloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
    res.json({ backups, configured: cfg ? { type: cfg.type } : null, capability });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/backups/cloud/upload/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const cloudBackup = require('../services/cloudBackup');
    const cfg = await cloudBackup.getCloudConfig();
    const capability = cloudBackup.getCloudCapabilityStatus(cfg ? cfg.type : '');
    if (!capability.supported) {
      return res.status(409).json({ error: capability.message, capability });
    }
    const rows = await query('SELECT filename FROM backups WHERE id = ? AND type = ?', [id, 'local']);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await cloudBackup.createEncryptedCloudBackup(rows[0].filename);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings/cloud_backup', async (req, res) => {
  try {
    const { cloud_backup_type, gdrive_access_token, gdrive_folder_id, dropbox_access_token, s3_bucket, s3_region, s3_access_key, s3_secret_key, cloud_backup_key } = req.body;
    const dbApi = require('../lib/db');
    if (cloud_backup_type !== undefined) await dbApi.setSetting('cloud_backup_type', cloud_backup_type);
    if (gdrive_access_token !== undefined) await dbApi.setSetting('gdrive_access_token', gdrive_access_token);
    if (gdrive_folder_id !== undefined) await dbApi.setSetting('gdrive_folder_id', gdrive_folder_id);
    if (dropbox_access_token !== undefined) await dbApi.setSetting('dropbox_access_token', dropbox_access_token);
    if (s3_bucket !== undefined) await dbApi.setSetting('s3_bucket', s3_bucket);
    if (s3_region !== undefined) await dbApi.setSetting('s3_region', s3_region);
    if (s3_access_key !== undefined) await dbApi.setSetting('s3_access_key', s3_access_key);
    if (s3_secret_key !== undefined) await dbApi.setSetting('s3_secret_key', s3_secret_key);
    if (cloud_backup_key !== undefined) await dbApi.setSetting('cloud_backup_key', cloud_backup_key);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
