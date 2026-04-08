'use strict';

const mockChannels = new Map();
const mockProcesses = new Map();
const mockTsBroadcasts = new Map();

jest.mock('../../../lib/state', () => ({
  channels: mockChannels,
  processes: mockProcesses,
  tsBroadcasts: mockTsBroadcasts,
}));

jest.mock('../../../lib/db', () => ({
  createServerCommand: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  canIssueCommandToServer: jest.fn(),
}));

jest.mock('../../../services/eventBus', () => ({
  eventBus: { emit: jest.fn() },
  WS_EVENTS: {
    STREAM_STARTING: 'stream:starting',
    STREAM_RUNNING: 'stream:running',
    STREAM_EXITED: 'stream:exited',
    STREAM_STOPPED: 'stream:stopped',
    STREAM_ERROR: 'stream:error',
    STREAM_FATAL: 'stream:fatal',
    STREAM_RECOVERY_FAILED: 'stream:recovery_failed',
    STREAM_ZOMBIE: 'stream:zombie',
    SHARING_DETECTED: 'sharing:detected',
  },
}));

jest.mock('../../../config/constants', () => ({
  STREAM_METADATA_MAX_ENTRIES: 1000,
  STREAM_METADATA_CLEANUP_INTERVAL_MS: 60000,
}));

const dbApi = require('../../../lib/db');
const serverService = require('../../../services/serverService');
const streamManager = require('../../../services/streamManager');

describe('StreamManager Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChannels.clear();
    mockProcesses.clear();
    mockTsBroadcasts.clear();
    serverService.canIssueCommandToServer.mockReset();
    dbApi.createServerCommand.mockReset();
  });

  describe('getChannelStatus', () => {
    it('should return offline status for non-existent channel', () => {
      const result = streamManager.getChannelStatus(999);
      expect(result).toEqual({ status: 'offline', msg: 'Not loaded' });
    });

    it('should return stopped status for channel without process', () => {
      mockChannels.set(1, { id: 1, name: 'Test Channel', status: 'stopped' });
      const result = streamManager.getChannelStatus(1);
      expect(result.id).toBe(1);
      expect(result.status).toBe('stopped');
      expect(result.activeProcess).toBe(false);
    });

    it('should return running status for channel with active process', () => {
      const mockProc = { pid: 12345 };
      mockChannels.set(2, { id: 2, name: 'Running Channel', status: 'running', startedAt: new Date().toISOString() });
      mockProcesses.set(2, mockProc);
      const result = streamManager.getChannelStatus(2);
      expect(result.status).toBe('running');
      expect(result.activeProcess).toBe(true);
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should include restarts count in status', () => {
      mockChannels.set(3, { id: 3, name: 'Crashed Channel', error: 'FFmpeg crashed' });
      const result = streamManager.getChannelStatus(3);
      expect(result.restarts).toBe(0);
    });

    it('should include lastError when present', () => {
      mockChannels.set(4, { id: 4, name: 'Error Channel', error: 'Connection refused' });
      const result = streamManager.getChannelStatus(4);
      expect(result.lastError).toBe('Connection refused');
    });
  });

  describe('listActiveChannels', () => {
    it('should return empty array when no processes running', () => {
      const result = streamManager.listActiveChannels();
      expect(result).toEqual([]);
    });

    it('should return active channels with status', () => {
      const mockProc = { pid: 111 };
      mockChannels.set(10, { id: 10, name: 'Channel 10', status: 'running', startedAt: new Date().toISOString() });
      mockProcesses.set(10, mockProc);

      const mockProc2 = { pid: 222 };
      mockChannels.set(11, { id: 11, name: 'Channel 11', status: 'running', startedAt: new Date().toISOString() });
      mockProcesses.set(11, mockProc2);

      const result = streamManager.listActiveChannels();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(10);
      expect(result[0].activeProcess).toBe(true);
      expect(result[1].id).toBe(11);
      expect(result[1].activeProcess).toBe(true);
    });
  });

  describe('issueRemoteCommand', () => {
    it('should reject de-scoped command types', async () => {
      const result = await streamManager.issueRemoteCommand({
        serverId: 1,
        commandType: 'start_stream',
      });
      expect(result).toEqual({ ok: false, reason: 'command de-scoped in TARGET: start_stream' });
    });

    it('should reject de-scoped command types - multiple', async () => {
      const deScopedTypes = ['start_stream', 'stop_stream', 'restart_stream', 'probe_stream'];
      for (const cmd of deScopedTypes) {
        const result = await streamManager.issueRemoteCommand({ serverId: 1, commandType: cmd });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('de-scoped');
      }
    });

    it('should reject invalid command types', async () => {
      const result = await streamManager.issueRemoteCommand({
        serverId: 1,
        commandType: 'unknown_command',
      });
      expect(result).toEqual({ ok: false, reason: 'invalid command type: unknown_command' });
    });

    it('should reject when server check fails', async () => {
      serverService.canIssueCommandToServer.mockResolvedValue({ ok: false, reason: 'Server not reachable' });
      const result = await streamManager.issueRemoteCommand({
        serverId: 1,
        commandType: 'reload_proxy_config',
      });
      expect(result).toEqual({ ok: false, reason: 'Server not reachable' });
      expect(serverService.canIssueCommandToServer).toHaveBeenCalledWith(1, 'reload_proxy_config');
    });

    it('should create command when server check passes', async () => {
      serverService.canIssueCommandToServer.mockResolvedValue({ ok: true });
      dbApi.createServerCommand.mockResolvedValue(42);
      const result = await streamManager.issueRemoteCommand({
        serverId: 1,
        commandType: 'reload_proxy_config',
        streamType: 'live',
        streamId: 100,
        issuedByUserId: 5,
      });
      expect(result).toEqual({ ok: true, commandId: 42 });
      expect(dbApi.createServerCommand).toHaveBeenCalledWith({
        serverId: 1,
        streamType: 'live',
        streamId: '100',
        placementId: null,
        commandType: 'reload_proxy_config',
        payload: null,
        issuedByUserId: 5,
      });
    });

    it('should handle optional parameters correctly', async () => {
      serverService.canIssueCommandToServer.mockResolvedValue({ ok: true });
      dbApi.createServerCommand.mockResolvedValue(99);
      const result = await streamManager.issueRemoteCommand({
        serverId: 2,
        commandType: 'restart_services',
        payload: { reason: 'maintenance' },
      });
      expect(result).toEqual({ ok: true, commandId: 99 });
      expect(dbApi.createServerCommand).toHaveBeenCalledWith({
        serverId: 2,
        streamType: null,
        streamId: null,
        placementId: null,
        commandType: 'restart_services',
        payload: { reason: 'maintenance' },
        issuedByUserId: null,
      });
    });

    it('should handle database errors gracefully', async () => {
      serverService.canIssueCommandToServer.mockResolvedValue({ ok: true });
      dbApi.createServerCommand.mockRejectedValue(new Error('DB connection failed'));
      const result = await streamManager.issueRemoteCommand({
        serverId: 1,
        commandType: 'reboot_server',
      });
      expect(result).toEqual({ ok: false, reason: 'DB connection failed' });
    });

    it('should accept all supported command types', async () => {
      serverService.canIssueCommandToServer.mockResolvedValue({ ok: true });
      dbApi.createServerCommand.mockResolvedValue(1);
      const supportedTypes = ['reload_proxy_config', 'restart_services', 'reboot_server'];
      for (const cmd of supportedTypes) {
        const result = await streamManager.issueRemoteCommand({ serverId: 1, commandType: cmd });
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('startLiveOnRemote', () => {
    it('should return de-scoped message', async () => {
      const result = await streamManager.startLiveOnRemote(1, 1, 1);
      expect(result).toEqual({ ok: false, reason: 'remote live runtime is de-scoped in TARGET' });
    });
  });

  describe('stopLiveOnRemote', () => {
    it('should return de-scoped message', async () => {
      const result = await streamManager.stopLiveOnRemote(1, 1, 1);
      expect(result).toEqual({ ok: false, reason: 'remote live runtime is de-scoped in TARGET' });
    });
  });
});
