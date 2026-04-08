'use strict';

const crypto = require('../../../lib/crypto');

describe('Crypto Module', () => {
  describe('hashApiKey', () => {
    it('should return a bcrypt hash', async () => {
      const hash = await crypto.hashApiKey('test-api-key');
      expect(hash).toMatch(/^\$2[aby]?\$\d{1,2}\$/);
    });

    it('should produce different hashes for same input (due to salt)', async () => {
      const hash1 = await crypto.hashApiKey('test-key');
      const hash2 = await crypto.hashApiKey('test-key');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await crypto.hashApiKey('key1');
      const hash2 = await crypto.hashApiKey('key2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyApiKey', () => {
    it('should verify correct key', async () => {
      const hash = await crypto.hashApiKey('correct-key');
      const result = await crypto.verifyApiKey('correct-key', hash);
      expect(result).toBe(true);
    });

    it('should reject incorrect key', async () => {
      const hash = await crypto.hashApiKey('correct-key');
      const result = await crypto.verifyApiKey('wrong-key', hash);
      expect(result).toBe(false);
    });

    it('should return false for empty hash', async () => {
      const result = await crypto.verifyApiKey('key', '');
      expect(result).toBe(false);
    });
  });

  describe('hashLinePassword', () => {
    it('should return a bcrypt hash', async () => {
      const hash = await crypto.hashLinePassword('testpassword');
      expect(hash).toMatch(/^\$2[aby]?\$\d{1,2}\$/);
    });

    it('should produce different hashes for same input (due to salt)', async () => {
      const hash1 = await crypto.hashLinePassword('testpassword');
      const hash2 = await crypto.hashLinePassword('testpassword');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyLinePasswordHash', () => {
    it('should verify correct password', async () => {
      const hash = await crypto.hashLinePassword('correctpassword');
      const result = await crypto.verifyLinePasswordHash(
        'correctpassword',
        hash
      );
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await crypto.hashLinePassword('correctpassword');
      const result = await crypto.verifyLinePasswordHash('wrongpassword', hash);
      expect(result).toBe(false);
    });

    it('should return false for empty hash', async () => {
      const result = await crypto.verifyLinePasswordHash('password', '');
      expect(result).toBe(false);
    });
  });

  describe('encryptLinePassword and decryptLinePassword', () => {
    it('should encrypt and decrypt correctly', () => {
      const original = 'my-secret-password';
      const encrypted = crypto.encryptLinePassword(original);
      expect(encrypted).toMatch(/^v1:[^:]+:[^:]+:[^=]+$/);

      const decrypted = crypto.decryptLinePassword(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', () => {
      const encrypted1 = crypto.encryptLinePassword('samepassword');
      const encrypted2 = crypto.encryptLinePassword('samepassword');
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should return empty string for invalid payload', () => {
      expect(crypto.decryptLinePassword('')).toBe('');
      expect(crypto.decryptLinePassword('invalid')).toBe('');
      expect(crypto.decryptLinePassword('notv1:foo:bar:baz')).toBe('');
    });

    it('should return empty string for tampered ciphertext', () => {
      const encrypted = crypto.encryptLinePassword('sensitive-password');
      const tampered = encrypted.replace(
        /.$/,
        encrypted.endsWith('a') ? 'b' : 'a'
      );
      expect(crypto.decryptLinePassword(tampered)).toBe('');
    });
  });

  describe('getLinePasswordCryptoKey', () => {
    it('should return a 32-byte key', () => {
      const key = crypto.getLinePasswordCryptoKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });
  });
});
