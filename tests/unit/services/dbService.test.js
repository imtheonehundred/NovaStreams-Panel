'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  getPool: jest.fn(() => ({
    getConnection: jest.fn(() => ({
      query: jest.fn(),
      release: jest.fn(),
    })),
  })),
}));

const { query, getPool } = require('../../../lib/mariadb');

const dbService = require('../../../services/dbService');

describe('DB Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TABLES_TO_MAINTAIN', () => {
    it('should contain expected tables', () => {
      expect(dbService.TABLES_TO_MAINTAIN).toContain('streams');
      expect(dbService.TABLES_TO_MAINTAIN).toContain('streams_series');
      expect(dbService.TABLES_TO_MAINTAIN).toContain('streams_episodes');
      expect(dbService.TABLES_TO_MAINTAIN).toContain('bouquets');
    });
  });

  describe('getRunningTask', () => {
    it('should return null initially', () => {
      expect(dbService.getRunningTask()).toBeNull();
    });
  });

  describe('getDatabaseStatus', () => {
    it('should return database status', async () => {
      query.mockResolvedValue([
        { table_name: 'streams', size_mb: 10.5 },
        { table_name: 'users', size_mb: 5.2 },
      ]);

      const result = await dbService.getDatabaseStatus();
      expect(result).toHaveProperty('total_tables');
      expect(result).toHaveProperty('total_size_mb');
      expect(result).toHaveProperty('tables');
      expect(result.tables).toHaveLength(2);
    });

    it('should calculate total size correctly', async () => {
      query.mockResolvedValue([
        { table_name: 't1', size_mb: 10.0 },
        { table_name: 't2', size_mb: 5.0 },
      ]);

      const result = await dbService.getDatabaseStatus();
      expect(result.total_size_mb).toBe(15.0);
    });
  });

  describe('getDatabasePerformance', () => {
    it('should return performance metrics', async () => {
      query.mockResolvedValue([
        { Variable_name: 'Threads_connected', Value: '10' },
        { Variable_name: 'Slow_queries', Value: '5' },
        { Variable_name: 'Queries', Value: '1000' },
        { Variable_name: 'Uptime', Value: '3600' },
      ]);

      const result = await dbService.getDatabasePerformance();
      expect(result.Threads_connected).toBe(10);
      expect(result.Slow_queries).toBe(5);
      expect(result.Queries).toBe(1000);
      expect(result.Uptime).toBe(3600);
    });

    it('should handle missing values', async () => {
      query.mockResolvedValue([]);

      const result = await dbService.getDatabasePerformance();
      expect(result.Threads_connected).toBe(0);
      expect(result.Slow_queries).toBe(0);
    });
  });

  describe('getDatabaseLive', () => {
    it('should return live database metrics', async () => {
      query
        .mockResolvedValueOnce([
          { Variable_name: 'Threads_connected', Value: '5' },
          { Variable_name: 'Slow_queries', Value: '2' },
          { Variable_name: 'Queries', Value: '500' },
          { Variable_name: 'Uptime', Value: '100' },
        ])
        .mockResolvedValueOnce([
          { Variable_name: 'Innodb_buffer_pool_bytes_data', Value: '1073741824' },
          { Variable_name: 'Innodb_buffer_pool_bytes_dirty', Value: '0' },
        ]);

      const result = await dbService.getDatabaseLive();
      expect(result.current_connections).toBe(5);
      expect(result.queries_per_second).toBe(5);
      expect(result.memory).toHaveProperty('innodb_buffer_pool_bytes_data');
    });

    it('should handle zero uptime', async () => {
      query
        .mockResolvedValueOnce([
          { Variable_name: 'Threads_connected', Value: '5' },
          { Variable_name: 'Slow_queries', Value: '2' },
          { Variable_name: 'Queries', Value: '500' },
          { Variable_name: 'Uptime', Value: '0' },
        ])
        .mockResolvedValueOnce([]);

      const result = await dbService.getDatabaseLive();
      expect(result.queries_per_second).toBe(0);
    });
  });

  describe('optimizeDatabase', () => {
    it('should be a function', () => {
      expect(typeof dbService.optimizeDatabase).toBe('function');
    });

    it('should return result structure', async () => {
      const mockPool = getPool();
      const mockConn = {
        query: jest.fn().mockResolvedValue([[]]),
        release: jest.fn(),
      };
      mockPool.getConnection.mockResolvedValue(mockConn);

      const result = await dbService.optimizeDatabase();
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('action');
      expect(result.action).toBe('optimize');
    });
  });

  describe('repairDatabase', () => {
    it('should be a function', () => {
      expect(typeof dbService.repairDatabase).toBe('function');
    });
  });
});
