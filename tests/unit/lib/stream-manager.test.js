'use strict';

jest.mock('tree-kill');

const streamManager = require('../../../lib/stream-manager');
const treeKill = require('tree-kill');

describe('Stream Manager Library', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('killProcess', () => {
    it('should be a function', () => {
      expect(typeof streamManager.killProcess).toBe('function');
    });

    it('should call treeKill with SIGKILL', async () => {
      treeKill.mockImplementation((pid, signal, callback) => {
        callback();
      });
      await streamManager.killProcess(12345);
      expect(treeKill).toHaveBeenCalledWith(12345, 'SIGKILL', expect.any(Function));
    });

    it('should pass through pid correctly', async () => {
      treeKill.mockImplementation((pid, signal, callback) => {
        expect(pid).toBe(999);
        callback();
      });
      await streamManager.killProcess(999);
    });

    it('should resolve even when treeKill passes error to callback', async () => {
      treeKill.mockImplementation((pid, signal, callback) => {
        callback(new Error('mock error'));
      });
      const result = await streamManager.killProcess(12345);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('mock error');
    });
  });
});
