'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, insert, remove, execute } = require('../../../lib/mariadb');
const securityRepo = require('../../../repositories/securityRepository');

describe('Security Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listBlockedIps', () => {
    it('should list all blocked IPs', async () => {
      query.mockResolvedValue([{ id: 1, ip: '1.2.3.4' }]);
      const result = await securityRepo.listBlockedIps();
      expect(query).toHaveBeenCalledWith('SELECT * FROM blocked_ips ORDER BY id');
      expect(result).toHaveLength(1);
    });
  });

  describe('addBlockedIp', () => {
    it('should insert blocked IP with notes', async () => {
      insert.mockResolvedValue(1);
      await securityRepo.addBlockedIp('1.2.3.4', 'spam');
      expect(insert).toHaveBeenCalledWith('INSERT IGNORE INTO blocked_ips (ip, notes) VALUES (?, ?)', ['1.2.3.4', 'spam']);
    });

    it('should use empty notes if not provided', async () => {
      insert.mockResolvedValue(1);
      await securityRepo.addBlockedIp('1.2.3.4');
      expect(insert).toHaveBeenCalledWith('INSERT IGNORE INTO blocked_ips (ip, notes) VALUES (?, ?)', ['1.2.3.4', '']);
    });
  });

  describe('removeBlockedIp', () => {
    it('should remove blocked IP by id', async () => {
      remove.mockResolvedValue(1);
      await securityRepo.removeBlockedIp(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM blocked_ips WHERE id = ?', [1]);
    });
  });

  describe('isIpBlocked', () => {
    it('should return true when IP is blocked', async () => {
      queryOne.mockResolvedValue({ ok: 1 });
      const result = await securityRepo.isIpBlocked('1.2.3.4');
      expect(result).toBe(true);
    });

    it('should return false when IP is not blocked', async () => {
      queryOne.mockResolvedValue(null);
      const result = await securityRepo.isIpBlocked('1.2.3.4');
      expect(result).toBe(false);
    });
  });

  describe('listBlockedUas', () => {
    it('should list all blocked user agents', async () => {
      query.mockResolvedValue([{ id: 1, user_agent: 'BadBot' }]);
      const result = await securityRepo.listBlockedUas();
      expect(query).toHaveBeenCalledWith('SELECT * FROM blocked_uas ORDER BY id');
      expect(result).toHaveLength(1);
    });
  });

  describe('addBlockedUa', () => {
    it('should insert blocked UA with notes', async () => {
      insert.mockResolvedValue(1);
      await securityRepo.addBlockedUa('BadBot', 'bot');
      expect(insert).toHaveBeenCalledWith('INSERT INTO blocked_uas (user_agent, notes) VALUES (?, ?)', ['BadBot', 'bot']);
    });
  });

  describe('removeBlockedUa', () => {
    it('should remove blocked UA by id', async () => {
      remove.mockResolvedValue(1);
      await securityRepo.removeBlockedUa(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM blocked_uas WHERE id = ?', [1]);
    });
  });

  describe('isUaBlocked', () => {
    it('should return true when UA matches regex pattern', async () => {
      query.mockResolvedValue([{ user_agent: 'BadBot.*' }]);
      const result = await securityRepo.isUaBlocked('BadBot/1.0');
      expect(result).toBe(true);
    });

    it('should return false when UA does not match', async () => {
      query.mockResolvedValue([{ user_agent: 'GoodBot' }]);
      const result = await securityRepo.isUaBlocked('BadBot/1.0');
      expect(result).toBe(false);
    });

    it('should handle invalid regex gracefully', async () => {
      query.mockResolvedValue([{ user_agent: '[invalid' }]);
      const result = await securityRepo.isUaBlocked('[invalid');
      expect(result).toBe(true);
    });
  });

  describe('listBlockedIsps', () => {
    it('should list all blocked ISPs', async () => {
      query.mockResolvedValue([{ id: 1, isp: 'Bad ISP' }]);
      const result = await securityRepo.listBlockedIsps();
      expect(query).toHaveBeenCalledWith('SELECT * FROM blocked_isps ORDER BY id');
      expect(result).toHaveLength(1);
    });
  });

  describe('addBlockedIsp', () => {
    it('should insert blocked ISP', async () => {
      insert.mockResolvedValue(1);
      await securityRepo.addBlockedIsp('Bad ISP', 'reason');
      expect(insert).toHaveBeenCalledWith('INSERT INTO blocked_isps (isp, notes) VALUES (?, ?)', ['Bad ISP', 'reason']);
    });
  });

  describe('removeBlockedIsp', () => {
    it('should remove blocked ISP by id', async () => {
      remove.mockResolvedValue(1);
      await securityRepo.removeBlockedIsp(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM blocked_isps WHERE id = ?', [1]);
    });
  });

  describe('recordAuthAttempt', () => {
    it('should update existing auth flood record', async () => {
      queryOne.mockResolvedValue({ id: 1 });
      await securityRepo.recordAuthAttempt('1.2.3.4', 'user');
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE auth_flood');
    });

    it('should insert new auth flood record', async () => {
      queryOne.mockResolvedValue(null);
      await securityRepo.recordAuthAttempt('1.2.3.4', 'user');
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO auth_flood');
    });
  });

  describe('getAuthAttempts', () => {
    it('should return total attempts within window', async () => {
      queryOne.mockResolvedValue({ total: 5 });
      const result = await securityRepo.getAuthAttempts('1.2.3.4', 300);
      expect(result).toBe(5);
    });

    it('should return 0 when no row', async () => {
      queryOne.mockResolvedValue(null);
      const result = await securityRepo.getAuthAttempts('1.2.3.4', 300);
      expect(result).toBe(0);
    });

    it('should use default window of 300 seconds', async () => {
      queryOne.mockResolvedValue({ total: 0 });
      await securityRepo.getAuthAttempts('1.2.3.4');
      const [sql, params] = queryOne.mock.calls[0];
      expect(sql).toContain('auth_flood');
    });
  });

  describe('cleanOldAuthFlood', () => {
    it('should delete old auth flood records', async () => {
      execute.mockResolvedValue({ affectedRows: 10 });
      await securityRepo.cleanOldAuthFlood(600);
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('DELETE FROM auth_flood');
    });
  });
});
