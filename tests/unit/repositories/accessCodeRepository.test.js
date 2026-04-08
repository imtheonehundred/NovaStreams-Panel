'use strict';

const {
  ensureAccessCodesTable,
  listAccessCodes,
  getAccessCodeByCode,
  getAccessCodeById,
  createAccessCode,
  updateAccessCode,
  deleteAccessCode,
  touchAccessCodeUsage,
} = require('../../../repositories/accessCodeRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/crypto', () => ({
  hashApiKey: jest.fn((key) => `hashed_${key}`),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');

describe('Access Code Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('ensureAccessCodesTable', () => {
    it('should execute CREATE TABLE statement', async () => {
      execute.mockResolvedValue({});
      await ensureAccessCodesTable();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS access_codes'));
    });
  });

  describe('listAccessCodes', () => {
    it('should return all access codes ordered by id desc', async () => {
      const mockCodes = [
        { id: 1, code: 'CODE1', role: 'admin', enabled: 1 },
        { id: 2, code: 'CODE2', role: 'reseller', enabled: 1 },
      ];
      query.mockResolvedValue(mockCodes);
      const result = await listAccessCodes();
      expect(result).toEqual(mockCodes);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY id DESC'));
    });
  });

  describe('getAccessCodeByCode', () => {
    it('should return access code by code string', async () => {
      const mockCode = { id: 1, code: 'TESTCODE', role: 'admin' };
      queryOne.mockResolvedValue(mockCode);
      const result = await getAccessCodeByCode('TESTCODE');
      expect(result).toEqual(mockCode);
      expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE code = ?'), ['TESTCODE']);
    });

    it('should trim whitespace from code', async () => {
      queryOne.mockResolvedValue(null);
      await getAccessCodeByCode('  TESTCODE  ');
      expect(queryOne).toHaveBeenCalledWith(expect.any(String), ['TESTCODE']);
    });

    it('should handle empty code', async () => {
      queryOne.mockResolvedValue(null);
      await getAccessCodeByCode('');
      expect(queryOne).toHaveBeenCalledWith(expect.any(String), ['']);
    });
  });

  describe('getAccessCodeById', () => {
    it('should return access code by id', async () => {
      const mockCode = { id: 1, code: 'TESTCODE' };
      queryOne.mockResolvedValue(mockCode);
      const result = await getAccessCodeById(1);
      expect(result).toEqual(mockCode);
      expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ?'), [1]);
    });
  });

  describe('createAccessCode', () => {
    it('should create access code with valid data', async () => {
      insert.mockResolvedValue(1);
      const data = { code: 'VALID123', role: 'admin', enabled: true, description: 'Test code' };
      await createAccessCode(data);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, ?, ?)',
        ['VALID123', 'admin', 1, 'Test code']
      );
    });

    it('should create with reseller role', async () => {
      insert.mockResolvedValue(2);
      await createAccessCode({ code: 'RESELLER1', role: 'reseller' });
      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        ['RESELLER1', 'reseller', 1, '']
      );
    });

    it('should throw error for missing code', async () => {
      await expect(createAccessCode({})).rejects.toThrow('code required');
    });

    it('should throw error for invalid code format', async () => {
      await expect(createAccessCode({ code: 'ab' })).rejects.toThrow('invalid code format');
      await expect(createAccessCode({ code: 'invalid@code!' })).rejects.toThrow('invalid code format');
    });

    it('should throw error for invalid role', async () => {
      await expect(createAccessCode({ code: 'VALID123', role: 'superadmin' })).rejects.toThrow('invalid role');
    });

    it('should default enabled to 1 when not specified', async () => {
      insert.mockResolvedValue(1);
      await createAccessCode({ code: 'TEST123' });
      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        ['TEST123', 'admin', 1, '']
      );
    });

    it('should handle enabled: false', async () => {
      insert.mockResolvedValue(1);
      await createAccessCode({ code: 'DISABLED1', enabled: false });
      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        ['DISABLED1', 'admin', 0, '']
      );
    });
  });

  describe('updateAccessCode', () => {
    it('should update code field', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateAccessCode(1, { code: 'NEWCODE456' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][0]).toContain('code = ?');
      expect(execute.mock.calls[0][1]).toContain('NEWCODE456');
    });

    it('should update role field', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateAccessCode(1, { role: 'reseller' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain('reseller');
    });

    it('should update enabled field', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateAccessCode(1, { enabled: false });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain(0);
    });

    it('should update description field', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateAccessCode(1, { description: 'Updated description' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain('Updated description');
    });

    it('should throw error when updating code to empty', async () => {
      await expect(updateAccessCode(1, { code: '' })).rejects.toThrow('code required');
    });

    it('should throw error for invalid code format on update', async () => {
      await expect(updateAccessCode(1, { code: 'ab' })).rejects.toThrow('invalid code format');
    });

    it('should throw error for invalid role on update', async () => {
      await expect(updateAccessCode(1, { role: 'invalid' })).rejects.toThrow('invalid role');
    });

    it('should do nothing when no fields provided', async () => {
      await updateAccessCode(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccessCode', () => {
    it('should delete access code', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteAccessCode(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM access_codes WHERE id = ?', [1]);
    });
  });

  describe('touchAccessCodeUsage', () => {
    it('should update last_used_at timestamp', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await touchAccessCodeUsage(1);
      expect(execute).toHaveBeenCalledWith(
        'UPDATE access_codes SET last_used_at = NOW() WHERE id = ?',
        [1]
      );
    });
  });
});
