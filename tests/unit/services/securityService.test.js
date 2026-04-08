'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(async (key) =>
    key === 'live_streaming_pass' ? '' : null
  ),
  recordAuthAttempt: jest.fn(),
  getAuthAttempts: jest.fn(async () => 0),
  isIpBlocked: jest.fn(async () => false),
  isUaBlocked: jest.fn(async () => false),
  updateLine: jest.fn(async () => true),
}));

jest.mock('../../../lib/mariadb', () => ({
  execute: jest.fn(async () => ({})),
}));

jest.mock('../../../services/lineService', () => ({
  refreshConnection: jest.fn(async () => true),
  touchRuntimeSession: jest.fn(async () => true),
}));

jest.mock('../../../services/sessionService', () => ({
  validateToken: jest.fn(async () => null),
}));

jest.mock('../../../services/sharingDetector', () => ({
  recordAndCheck: jest.fn(async () => ({ flagged: false, uniqueIps: 1 })),
  publishAlert: jest.fn(async () => true),
}));

const securityService = require('../../../services/securityService');
const dbApi = require('../../../lib/db');
const { execute } = require('../../../lib/mariadb');
const sharingDetector = require('../../../services/sharingDetector');

describe('Security Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STREAM_SECRET = 'test-stream-secret';
    process.env.STREAM_TOKEN_BIND_IP = 'true';
    process.env.SHARING_BLOCK_COOLDOWN_MIN = '15';
  });

  describe('CONFIG', () => {
    it('should have ipWindowMs defined', () => {
      expect(securityService.CONFIG.ipWindowMs).toBe(60000);
    });

    it('should have ipThreshold defined', () => {
      expect(securityService.CONFIG.ipThreshold).toBe(3);
    });
  });

  describe('blockUser and isBlocked', () => {
    it('should block and check user', () => {
      expect(securityService.isBlocked('user1')).toBe(false);
      securityService.blockUser('user1');
      expect(securityService.isBlocked('user1')).toBe(true);
    });

    it('should return false for non-blocked user', () => {
      expect(securityService.isBlocked('unknown')).toBe(false);
    });
  });

  describe('signStreamUrl', () => {
    it('should be a function', () => {
      expect(typeof securityService.signStreamUrl).toBe('function');
    });
  });

  describe('validateSignature', () => {
    it('should be a function', () => {
      expect(typeof securityService.validateSignature).toBe('function');
    });

    it('accepts a valid signature before expiry', async () => {
      const expires = Date.now() + 60000;
      const sig = await securityService.signStreamUrl('tok', expires, 'abc');
      await expect(
        securityService.validateSignature('tok', expires, sig, 'abc')
      ).resolves.toBe(true);
    });

    it('rejects an expired signature', async () => {
      const expires = Date.now() - 1000;
      const sig = await securityService.signStreamUrl('tok', expires, 'abc');
      await expect(
        securityService.validateSignature('tok', expires, sig, 'abc')
      ).resolves.toBe(false);
    });
  });

  describe('recordIp', () => {
    it('should be a function', () => {
      expect(typeof securityService.recordIp).toBe('function');
    });

    it('should return object with flagged and uniqueIps', () => {
      const result = securityService.recordIp('user123', '192.168.1.1');
      expect(result).toHaveProperty('flagged');
      expect(result).toHaveProperty('uniqueIps');
    });
  });

  describe('generateStreamToken', () => {
    it('should be a function', () => {
      expect(typeof securityService.generateStreamToken).toBe('function');
    });

    it('should encode an IP hint when binding is enabled', async () => {
      const token = await securityService.generateStreamToken(
        1,
        'abc',
        'ts',
        60,
        { ip: '1.2.3.44' }
      );
      const decoded = await securityService.decryptStreamToken(token);
      expect(decoded.ipHint).toBe('1.2.3');
    });
  });

  describe('decryptStreamToken', () => {
    it('should be a function', () => {
      expect(typeof securityService.decryptStreamToken).toBe('function');
    });

    it('returns null for malformed tokens', async () => {
      await expect(
        securityService.decryptStreamToken('bad-token')
      ).resolves.toBeNull();
    });
  });

  describe('validateStreamAccess', () => {
    it('rejects playback when token IP block does not match', async () => {
      const token = await securityService.generateStreamToken(
        1,
        'abc',
        'ts',
        60,
        { ip: '1.2.3.4' }
      );
      const expires = Date.now() + 60000;
      const sig = await securityService.signStreamUrl(token, expires, 'abc');
      const result = await securityService.validateStreamAccess({
        token,
        expires,
        sig,
        ip: '8.8.8.8',
        channelId: 'abc',
      });
      expect(result).toEqual({ ok: false, error: 'ip_mismatch' });
    });
  });

  describe('flagSharingActivity', () => {
    it('auto-blocks and records a security log when sharing is flagged', async () => {
      sharingDetector.recordAndCheck.mockResolvedValueOnce({
        flagged: true,
        uniqueIps: 4,
      });
      await securityService.flagSharingActivity(55, '5.6.7.8');
      expect(dbApi.updateLine).toHaveBeenCalledWith('55', { admin_enabled: 0 });
      expect(execute).toHaveBeenCalled();
      expect(sharingDetector.publishAlert).toHaveBeenCalledWith('55', 4);
    });
  });
});
