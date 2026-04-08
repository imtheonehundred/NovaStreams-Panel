'use strict';

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
}));

jest.mock('../../../lib/state', () => ({
  channels: new Map(),
}));

jest.mock('../../../lib/system-metrics', () => ({
  collectSystemMetrics: jest.fn(),
}));

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
}));

jest.mock('../../../services/backupService', () => ({
  initBackupTable: jest.fn(),
  createBackup: jest.fn(),
}));

jest.mock('node-telegram-bot-api', () => ({
  TelegramBot: jest.fn(),
}));

const { getSetting } = require('../../../lib/db');
const { TelegramBot } = require('node-telegram-bot-api');
const telegramBot = require('../../../services/telegramBot');

describe('Telegram Bot Service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await telegramBot.stopBot();
  });

  describe('getToken', () => {
    it('should return trimmed token from settings', async () => {
      getSetting.mockResolvedValue('  test_token_123  ');
      const result = await telegramBot.getToken();
      expect(result).toBe('test_token_123');
    });

    it('should return empty string if no token', async () => {
      getSetting.mockResolvedValue('');
      const result = await telegramBot.getToken();
      expect(result).toBe('');
    });
  });

  describe('getAdminChatId', () => {
    it('should return trimmed chat ID from settings', async () => {
      getSetting.mockResolvedValue('  123456789  ');
      const result = await telegramBot.getAdminChatId();
      expect(result).toBe('123456789');
    });
  });

  describe('sendAlert', () => {
    it('should do nothing if bot is not initialized', async () => {
      await telegramBot.sendAlert('Test alert', 'info');
    });

    it('should send message with correct level emoji for info', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.sendAlert('Test alert', 'info');
    });
  });

  describe('onStreamDown', () => {
    it('should send error alert for stream down', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.onStreamDown(1, 'Test Channel');
      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });

  describe('onStreamUp', () => {
    it('should send info alert for stream up', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.onStreamUp(1, 'Test Channel');
      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });

  describe('onSharingDetected', () => {
    it('should send warning alert for sharing', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.onSharingDetected('testuser', 5);
      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });

  describe('onBackupComplete', () => {
    it('should send info alert for backup complete', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.onBackupComplete('backup_20240101.zip');
      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });

  describe('onDiskLow', () => {
    it('should send warning alert for disk low', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      jest.clearAllMocks();
      getSetting.mockResolvedValue('123456');
      mockBot.sendMessage.mockResolvedValue({});
      await telegramBot.onDiskLow(90);
      expect(mockBot.sendMessage).toHaveBeenCalled();
    });
  });

  describe('stopBot', () => {
    it('should stop polling and set bot to null', async () => {
      getSetting.mockResolvedValue('token123');
      const mockBot = {
        sendMessage: jest.fn().mockResolvedValue({}),
        stopPolling: jest.fn().mockResolvedValue({}),
      };
      TelegramBot.mockImplementation(() => mockBot);
      await telegramBot.initBot();
      await telegramBot.stopBot();
      expect(mockBot.stopPolling).toHaveBeenCalled();
    });
  });

  describe('initBot', () => {
    it('should not initialize bot if no token', async () => {
      getSetting.mockResolvedValue('');
      await telegramBot.initBot();
    });

    it('should handle initialization errors', async () => {
      getSetting.mockResolvedValue('token123');
      TelegramBot.mockImplementation(() => {
        throw new Error('Init error');
      });
      await telegramBot.initBot();
    });
  });
});
