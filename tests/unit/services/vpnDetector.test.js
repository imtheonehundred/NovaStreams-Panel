'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, execute } = require('../../../lib/mariadb');

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

const db = require('../../../lib/db');

const vpnDetector = require('../../../services/vpnDetector');

describe('VPN Detector Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vpnDetector.clearCache();
  });

  describe('checkVpnIp', () => {
    it('should return false for localhost', async () => {
      expect(await vpnDetector.checkVpnIp('127.0.0.1')).toBe(false);
    });

    it('should return false for private IP 192.168.x.x', async () => {
      expect(await vpnDetector.checkVpnIp('192.168.1.1')).toBe(false);
    });

    it('should return false for private IP 10.x.x.x', async () => {
      expect(await vpnDetector.checkVpnIp('10.0.0.1')).toBe(false);
    });

    it('should return false for IPv6 localhost', async () => {
      expect(await vpnDetector.checkVpnIp('::1')).toBe(false);
    });

    it('should return false for IPv6 localhost mapped', async () => {
      expect(await vpnDetector.checkVpnIp('::ffff:127.0.0.1')).toBe(false);
    });

    it('should return cached result when available', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default');

      await vpnDetector.checkVpnIp('8.8.8.8');
      await vpnDetector.checkVpnIp('8.8.8.8');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      mockFetch.mockRestore();
    });

    it('should check VPN status for public IP', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ proxy: false, hosting: false }),
      });

      const result = await vpnDetector.checkVpnIp('8.8.8.8');
      expect(result).toBe(false);
      mockFetch.mockRestore();
    });

    it('should return true when IP is a proxy', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ proxy: true, hosting: false }),
      });

      const result = await vpnDetector.checkVpnIp('8.8.8.8');
      expect(result).toBe(true);
      mockFetch.mockRestore();
    });

    it('should return true when IP is hosting', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ proxy: false, hosting: true }),
      });

      const result = await vpnDetector.checkVpnIp('8.8.8.8');
      expect(result).toBe(true);
      mockFetch.mockRestore();
    });

    it('should return false on fetch error (fail open)', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default').mockRejectedValue(new Error('Network error'));

      const result = await vpnDetector.checkVpnIp('8.8.8.8');
      expect(result).toBe(false);
      mockFetch.mockRestore();
    });

    it('should return false on non-ok response', async () => {
      vpnDetector.clearCache();
      const fetch = require('node-fetch');
      const mockFetch = jest.spyOn(fetch, 'default').mockResolvedValue({
        ok: false,
      });

      const result = await vpnDetector.checkVpnIp('8.8.8.8');
      expect(result).toBe(false);
      mockFetch.mockRestore();
    });
  });

  describe('isVpnEnabled', () => {
    it('should return true when setting is 1', async () => {
      db.getSetting.mockResolvedValue('1');
      expect(await vpnDetector.isVpnEnabled()).toBe(true);
    });

    it('should return false when setting is not 1', async () => {
      db.getSetting.mockResolvedValue('0');
      expect(await vpnDetector.isVpnEnabled()).toBe(false);
    });
  });

  describe('recordVpnCheck', () => {
    it('should not insert when isVpn is false', async () => {
      await vpnDetector.recordVpnCheck('8.8.8.8', 123, false);
      expect(execute).not.toHaveBeenCalled();
    });

    it('should insert when isVpn is true', async () => {
      execute.mockResolvedValue(1);
      await vpnDetector.recordVpnCheck('8.8.8.8', 123, true);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO login_events'),
        expect.arrayContaining(['8.8.8.8', 'vpn_detected'])
      );
    });
  });

  describe('clearCache', () => {
    it('should clear the VPN cache', async () => {
      vpnDetector.clearCache();
      expect(() => vpnDetector.clearCache()).not.toThrow();
    });
  });
});
