'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

const { query, execute } = require('../../../lib/mariadb');
const panelLogRepository = require('../../../repositories/panelLogRepository');

describe('panelLogRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addPanelLog', () => {
    it('should insert panel log with all fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await panelLogRepository.addPanelLog(1, 'CREATE', 'user', 5, 'Created new user');

      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO panel_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
        [1, 'CREATE', 'user', '5', 'Created new user']
      );
    });

    it('should handle null userId', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await panelLogRepository.addPanelLog(null, 'DELETE', 'server', 10, 'Deleted server');

      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        [0, 'DELETE', 'server', '10', 'Deleted server']
      );
    });

    it('should handle missing optional fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await panelLogRepository.addPanelLog();

      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        [0, '', '', '', '']
      );
    });

    it('should convert targetId to string', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await panelLogRepository.addPanelLog(1, 'ACTION', 'type', 123, 'details');

      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['123'])
      );
    });
  });

  describe('getPanelLogs', () => {
    it('should return panel logs with default limit', async () => {
      const rows = [
        { id: 1, user_id: 1, action: 'CREATE', target_type: 'user', target_id: '5', details: 'Created user' },
      ];
      query.mockResolvedValue(rows);

      const result = await panelLogRepository.getPanelLogs();

      expect(result).toEqual(rows);
      expect(query).toHaveBeenCalledWith(
        'SELECT id, user_id, action, target_type, target_id, details, created_at FROM panel_logs ORDER BY id DESC LIMIT ?',
        [200]
      );
    });

    it('should accept custom limit', async () => {
      query.mockResolvedValue([]);

      await panelLogRepository.getPanelLogs(50);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        [50]
      );
    });

    it('should handle empty result', async () => {
      query.mockResolvedValue([]);

      const result = await panelLogRepository.getPanelLogs();

      expect(result).toEqual([]);
    });
  });
});
