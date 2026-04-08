'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

const { query, queryOne, execute } = require('../../../lib/mariadb');
const settingsRepo = require('../../../repositories/settingsRepository');

describe('Settings Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getSetting', () => {
    it('should get setting value by key', async () => {
      queryOne.mockResolvedValue({ value: 'some_value' });
      const result = await settingsRepo.getSetting('some_key');
      expect(queryOne).toHaveBeenCalledWith('SELECT `value` FROM settings WHERE `key` = ?', ['some_key']);
      expect(result).toBe('some_value');
    });

    it('should return empty string when setting not found', async () => {
      queryOne.mockResolvedValue(null);
      const result = await settingsRepo.getSetting('missing_key');
      expect(result).toBe('');
    });
  });

  describe('setSetting', () => {
    it('should insert or update setting', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await settingsRepo.setSetting('key', 'value');
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        ['key', 'value']
      );
    });

    it('should convert value to string', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await settingsRepo.setSetting('key', 123);
      const [, params] = execute.mock.calls[0];
      expect(params[1]).toBe('123');
    });
  });

  describe('getAllSettings', () => {
    it('should get all settings as key-value object', async () => {
      query.mockResolvedValue([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ]);
      const result = await settingsRepo.getAllSettings();
      expect(query).toHaveBeenCalledWith('SELECT `key`, `value` FROM settings');
      expect(result).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should return empty object when no settings', async () => {
      query.mockResolvedValue([]);
      const result = await settingsRepo.getAllSettings();
      expect(result).toEqual({});
    });
  });
});
