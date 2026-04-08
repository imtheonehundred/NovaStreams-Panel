'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

const { query } = require('../../../lib/mariadb');
const cloudBackup = require('../../../services/cloudBackup');

describe('Cloud Backup Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCloudCapabilityStatus', () => {
    it('should return de-scoped status for empty type', () => {
      const result = cloudBackup.getCloudCapabilityStatus('');
      expect(result.configured).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.type).toBe('');
    });

    it('should return de-scoped status for null', () => {
      const result = cloudBackup.getCloudCapabilityStatus(null);
      expect(result.configured).toBe(false);
      expect(result.supported).toBe(false);
    });

    it('should return de-scoped status for gdrive', () => {
      const result = cloudBackup.getCloudCapabilityStatus('gdrive');
      expect(result.configured).toBe(true);
      expect(result.supported).toBe(false);
      expect(result.type).toBe('gdrive');
      expect(result.message).toContain('local backups only');
    });

    it('should return de-scoped status for dropbox', () => {
      const result = cloudBackup.getCloudCapabilityStatus('dropbox');
      expect(result.configured).toBe(true);
      expect(result.supported).toBe(false);
      expect(result.type).toBe('dropbox');
    });

    it('should return de-scoped status for s3', () => {
      const result = cloudBackup.getCloudCapabilityStatus('s3');
      expect(result.configured).toBe(true);
      expect(result.supported).toBe(false);
      expect(result.type).toBe('s3');
    });

    it('should return unsupported for unknown provider', () => {
      const result = cloudBackup.getCloudCapabilityStatus('unknown');
      expect(result.configured).toBe(true);
      expect(result.supported).toBe(false);
      expect(result.type).toBe('unknown');
    });
  });

  describe('encryptFile and decryptFile', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let tempDir;
    let srcFile;
    let encFile;
    let decFile;
    let testKey;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-backup-test-'));
      srcFile = path.join(tempDir, 'source.txt');
      encFile = path.join(tempDir, 'encrypted.enc');
      decFile = path.join(tempDir, 'decrypted.txt');
      fs.writeFileSync(srcFile, 'test content for encryption');
      testKey = Buffer.from('a'.repeat(64)).toString('base64');
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true });
      } catch {
        // Temp directory cleanup is best effort in tests.
      }
    });

    it('should encrypt and decrypt file correctly', async () => {
      const { iv, authTag } = await cloudBackup.encryptFile(
        srcFile,
        encFile,
        testKey
      );
      expect(iv).toBeDefined();
      expect(authTag).toBeDefined();
      expect(Buffer.from(iv, 'base64')).toHaveLength(12);

      await cloudBackup.decryptFile(encFile, decFile, testKey, iv, authTag);
      const decrypted = fs.readFileSync(decFile, 'utf8');
      expect(decrypted).toBe('test content for encryption');
    });

    it('should throw error for invalid key length on decrypt', async () => {
      const { iv, authTag } = await cloudBackup.encryptFile(
        srcFile,
        encFile,
        testKey
      );
      const badKey = Buffer.from('short').toString('base64');
      await expect(
        cloudBackup.decryptFile(encFile, decFile, badKey, iv, authTag)
      ).rejects.toThrow();
    });
  });

  describe('uploadToGoogleDrive', () => {
    it('should throw a local-only coming soon message', async () => {
      await expect(
        cloudBackup.uploadToGoogleDrive('/tmp/test', 'test.enc', {})
      ).rejects.toThrow('local backups only');
    });
  });

  describe('uploadToDropbox', () => {
    it('should throw a local-only coming soon message', async () => {
      await expect(
        cloudBackup.uploadToDropbox('/tmp/test', '/test.enc', {})
      ).rejects.toThrow('local backups only');
    });
  });

  describe('uploadToS3', () => {
    it('should throw a local-only coming soon message', async () => {
      await expect(
        cloudBackup.uploadToS3('/tmp/test', 'test.enc', {})
      ).rejects.toThrow('local backups only');
    });
  });

  describe('getCloudBackups', () => {
    it('should return formatted backup records', async () => {
      query.mockResolvedValue([
        {
          id: 1,
          filename: 'backup.tar.gz',
          size_bytes: 1024 * 1024,
          created_at: '2024-01-01',
          type: 'gdrive',
          cloud_url: 'http://...',
        },
      ]);

      const results = await cloudBackup.getCloudBackups();
      expect(results).toHaveLength(1);
      expect(results[0].size_mb).toBe('1.00');
    });

    it('should return empty array when no backups', async () => {
      query.mockResolvedValue([]);
      const results = await cloudBackup.getCloudBackups();
      expect(results).toHaveLength(0);
    });
  });
});
