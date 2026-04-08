'use strict';

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([[], []]),
    end: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { getPool, query, queryOne, execute, insert, update, remove, testConnection, closePool } = require('../../../lib/mariadb');
const mysql = require('mysql2/promise');

describe('mariadb', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPool', () => {
    it('should create pool with default config', () => {
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(mysql.createPool).toHaveBeenCalledWith(expect.objectContaining({
        host: expect.any(String),
        port: expect.any(Number),
        user: expect.any(String),
        database: expect.any(String),
        charset: 'utf8mb4',
        timezone: '+00:00',
        supportBigNumbers: true,
        bigNumberStrings: false,
        dateStrings: true,
        multipleStatements: false,
        namedPlaceholders: false,
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
      }));
    });

    it('should return same pool on subsequent calls', () => {
      const pool1 = getPool();
      const pool2 = getPool();
      expect(pool1).toBe(pool2);
    });
  });

  describe('query', () => {
    it('should execute query and return rows', async () => {
      const mockRows = [{ id: 1, name: 'test' }];
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([mockRows, []]);

      const result = await query('SELECT * FROM test');

      expect(result).toEqual(mockRows);
      expect(pool.execute).toHaveBeenCalledWith('SELECT * FROM test', []);
    });

    it('should pass params to query', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([[], []]);

      await query('SELECT * FROM test WHERE id = ?', [1]);

      expect(pool.execute).toHaveBeenCalledWith('SELECT * FROM test WHERE id = ?', [1]);
    });
  });

  describe('queryOne', () => {
    it('should return first row', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]);

      const result = await queryOne('SELECT * FROM test');

      expect(result).toEqual({ id: 1 });
    });

    it('should return null for empty results', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([[], []]);

      const result = await queryOne('SELECT * FROM test');

      expect(result).toBeNull();
    });
  });

  describe('execute', () => {
    it('should return result from execute', async () => {
      const mockResult = { affectedRows: 1 };
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([mockResult, []]);

      const result = await execute('UPDATE test SET name = ?', ['test']);

      expect(result).toEqual(mockResult);
    });
  });

  describe('insert', () => {
    it('should return insertId', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([{ insertId: 42 }, []]);

      const result = await insert('INSERT INTO test (name) VALUES (?)', ['test']);

      expect(result).toBe(42);
    });
  });

  describe('update', () => {
    it('should return affectedRows', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([{ affectedRows: 5 }, []]);

      const result = await update('UPDATE test SET name = ?', ['test']);

      expect(result).toBe(5);
    });
  });

  describe('remove', () => {
    it('should return true when rows affected', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const result = await remove('DELETE FROM test WHERE id = ?', [1]);

      expect(result).toBe(true);
    });

    it('should return false when no rows affected', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

      const result = await remove('DELETE FROM test WHERE id = ?', [999]);

      expect(result).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('should return true on successful connection', async () => {
      const pool = getPool();
      pool.execute.mockResolvedValueOnce([[{ '1': 1 }], []]);

      const result = await testConnection();

      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      const pool = getPool();
      pool.execute.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await testConnection();

      expect(result).toBe(false);
    });
  });

  describe('closePool', () => {
    it('should close the pool', async () => {
      const pool = getPool();
      pool.end.mockResolvedValueOnce(undefined);

      await closePool();

      expect(pool.end).toHaveBeenCalled();
    });

    it('should handle close when pool is null', async () => {
      await closePool();
      await closePool();
    });
  });
});
