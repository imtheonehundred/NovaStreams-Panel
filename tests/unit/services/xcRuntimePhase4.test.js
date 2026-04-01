'use strict';

/**
 * Phase 4 — Live Runtime Ownership tests.
 *
 * Tests cover:
 * 1. isRuntimeReady() — runtime-readiness gate logic
 * 2. startLiveOnRemote() — remote live start orchestration
 * 3. stopLiveOnRemote() — remote live stop orchestration
 * 4. redirectToLiveStream() runtime-readiness gate in live playback flow
 */

jest.mock('../../../lib/mariadb', () => ({
  execute: jest.fn(),
  insert: jest.fn(),
  queryOne: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  getPlacementByAsset: jest.fn(),
  getPlacementsByServer: jest.fn(),
  setPlacementDesiredState: jest.fn(),
  markPlacementStarting: jest.fn(),
  markPlacementRunning: jest.fn(),
  markPlacementStopped: jest.fn(),
  markPlacementError: jest.fn(),
  upsertPlacementRuntimeState: jest.fn(),
  reportPlacementRuntimeFromNode: jest.fn(),
  createServerCommand: jest.fn(),
  openRuntimeSession: jest.fn(),
  touchRuntimeSession: jest.fn(),
  closeRuntimeSession: jest.fn(),
  getPlacement: jest.fn(),
  ensureServerProvisioningJobsTable: jest.fn(),
  getSetting: jest.fn(),
  addPanelLog: jest.fn(),
  createServerAgentCredential: jest.fn(),
  leaseServerCommands: jest.fn(),
  markServerCommandRunning: jest.fn(),
  markServerCommandSucceeded: jest.fn(),
  markServerCommandFailed: jest.fn(),
}));

const db = require('../../../lib/db');

// ─────────────────────────────────────────────────────────────────────────
// serverService — isRuntimeReady
//
// Uses jest.isolateModules to get a fresh serverService instance per test
// with properly controlled mocks for both lib/mariadb (used internally by
// getServerHealthStatus) and lib/db (used for getPlacementByAsset).
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 4 — isRuntimeReady', () => {
  let testServerService;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to load serverService with isolated mocks
  function loadServerServiceWithMocks({ queryOneResult, placementResult }) {
    const mockMariadb = {
      execute: jest.fn(),
      insert: jest.fn(),
      queryOne: jest.fn().mockResolvedValue(queryOneResult),
      query: jest.fn(),
    };
    const mockDb = {
      getPlacementByAsset: jest.fn().mockResolvedValue(placementResult || []),
      getPlacementsByServer: jest.fn(),
      getServer: jest.fn(),
      queryOne: jest.fn().mockResolvedValue(queryOneResult),
      query: jest.fn(),
      execute: jest.fn(),
      insert: jest.fn(),
      getSetting: jest.fn(),
      addPanelLog: jest.fn(),
      createServerAgentCredential: jest.fn(),
      getPlacement: jest.fn(),
      ensureServerProvisioningJobsTable: jest.fn(),
    };
    jest.doMock('../../../lib/mariadb', () => mockMariadb);
    jest.doMock('../../../lib/db', () => mockDb);
    const serverService = require('../../../services/serverService');
    return { serverService, mockMariadb, mockDb };
  }

  it('returns ready=true when placement is running with runtime_instance_id, ready_at, and fresh heartbeat', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: { last_heartbeat_at: new Date() },
      placementResult: [
        { id: 7, server_id: 5, status: 'running', runtime_instance_id: 'ffmpeg-abc', ready_at: '2026-03-28T10:00:00Z' },
      ],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(true);
    expect(result.placement).toBeDefined();
  });

  it('returns ready=false when server heartbeat is stale', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: null, // causes fresh: false in getServerHealthStatus
      placementResult: [],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/heartbeat stale/);
  });

  it('returns ready=false when no placement exists for the server', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: { last_heartbeat_at: new Date() },
      placementResult: [
        { id: 7, server_id: 99, status: 'running', runtime_instance_id: 'ffmpeg-abc', ready_at: '2026-03-28T10:00:00Z' },
      ],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/no placement/);
  });

  it('returns ready=false when placement status is not running', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: { last_heartbeat_at: new Date() },
      placementResult: [
        { id: 7, server_id: 5, status: 'starting', runtime_instance_id: 'ffmpeg-abc', ready_at: '2026-03-28T10:00:00Z' },
      ],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/status is 'starting'/);
  });

  it('returns ready=false when runtime_instance_id is not set', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: { last_heartbeat_at: new Date() },
      placementResult: [
        { id: 7, server_id: 5, status: 'running', runtime_instance_id: null, ready_at: '2026-03-28T10:00:00Z' },
      ],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/runtime_instance_id/);
  });

  it('returns ready=false when ready_at is not set', async () => {
    const { serverService: svc } = loadServerServiceWithMocks({
      queryOneResult: { last_heartbeat_at: new Date() },
      placementResult: [
        { id: 7, server_id: 5, status: 'running', runtime_instance_id: 'ffmpeg-abc', ready_at: null },
      ],
    });
    const result = await svc.isRuntimeReady(5, 101);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/ready_at/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// streamManager — startLiveOnRemote / stopLiveOnRemote
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 4 — remote live orchestration', () => {
  let streamManager, localDb;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../lib/db', () => ({
      getPlacementByAsset: jest.fn(),
      getPlacementsByServer: jest.fn(),
      setPlacementDesiredState: jest.fn(),
      markPlacementStarting: jest.fn(),
      markPlacementRunning: jest.fn(),
      markPlacementStopped: jest.fn(),
      markPlacementError: jest.fn(),
      upsertPlacementRuntimeState: jest.fn(),
      reportPlacementRuntimeFromNode: jest.fn(),
      createServerCommand: jest.fn(),
      ensureServerProvisioningJobsTable: jest.fn(),
      getSetting: jest.fn(),
      addPanelLog: jest.fn(),
      createServerAgentCredential: jest.fn(),
      getServer: jest.fn(),
      getServerHealthStatus: jest.fn(),
      applyHeartbeat: jest.fn(),
      updateServerCapabilities: jest.fn(),
      getRuntimeCapableServers: jest.fn(),
      getProxyCapableServers: jest.fn(),
      getOriginProxyRelationships: jest.fn(),
      buildFullLbNginxConfig: jest.fn(),
    }));
    jest.doMock('../../../services/serverService', () => ({
      canIssueCommandToServer: jest.fn(),
      getServer: jest.fn(),
      getServerHealthStatus: jest.fn(),
      applyHeartbeat: jest.fn(),
      updateServerCapabilities: jest.fn(),
      getRuntimeCapableServers: jest.fn(),
      getProxyCapableServers: jest.fn(),
      getRuntimePlacementsForAsset: jest.fn(),
      getRuntimePlacementsForServer: jest.fn(),
      getOriginProxyRelationships: jest.fn(),
      buildFullLbNginxConfig: jest.fn(),
    }));
    streamManager = require('../../../services/streamManager');
    localDb = require('../../../lib/db');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startLiveOnRemote', () => {
    it('returns an explicit de-scoped result in current TARGET', async () => {
      const result = await streamManager.startLiveOnRemote(101, 5, 1);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/de-scoped/);
      expect(localDb.setPlacementDesiredState).not.toHaveBeenCalled();
      expect(localDb.markPlacementStarting).not.toHaveBeenCalled();
    });
  });

  describe('stopLiveOnRemote', () => {
    it('returns an explicit de-scoped result in current TARGET', async () => {
      const result = await streamManager.stopLiveOnRemote(101, 5, 1);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/de-scoped/);
      expect(localDb.setPlacementDesiredState).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// lineService — runtime session helpers
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 4 — lineService runtime session helpers', () => {
  let lineService, localDb;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../lib/db', () => ({
      getLineById: jest.fn(),
      getLineByUsername: jest.fn(),
      updateLine: jest.fn(),
      createLine: jest.fn(),
      deleteLine: jest.fn(),
      listLines: jest.fn(),
      getPackageById: jest.fn(),
      getBouquetsByIds: jest.fn(),
      updateLineActivity: jest.fn(),
      writeActivityHistory: jest.fn(),
      getSetting: jest.fn(),
      openRuntimeSession: jest.fn(),
      touchRuntimeSession: jest.fn(),
      closeRuntimeSession: jest.fn(),
    }));
    jest.doMock('../../../lib/redis', () => ({
      getClient: jest.fn(() => ({
        setex: jest.fn(),
        sadd: jest.fn(),
        expire: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        srem: jest.fn(),
        scard: jest.fn(),
        smembers: jest.fn(),
      })),
    }));
    lineService = require('../../../services/lineService');
    localDb = require('../../../lib/db');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('openRuntimeSession', () => {
    it('calls dbApi.openRuntimeSession with correct arguments', async () => {
      localDb.openRuntimeSession.mockResolvedValueOnce(99);
      const result = await lineService.openRuntimeSession({
        lineId: 5,
        streamType: 'live',
        streamId: '101',
        placementId: 7,
        originServerId: 3,
        container: 'ts',
        sessionUuid: 'uuid-123',
        userIp: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
        geoipCountryCode: 'US',
      });
      expect(result).toBe(99);
      expect(localDb.openRuntimeSession).toHaveBeenCalledWith({
        lineId: 5,
        streamType: 'live',
        streamId: '101',
        placementId: 7,
        originServerId: 3,
        proxyServerId: undefined,
        container: 'ts',
        sessionUuid: 'uuid-123',
        playbackToken: undefined,
        userIp: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
        geoipCountryCode: 'US',
        isp: undefined,
      });
    });
  });

  describe('touchRuntimeSession', () => {
    it('calls dbApi.touchRuntimeSession with the session uuid', async () => {
      localDb.touchRuntimeSession.mockResolvedValueOnce();
      await lineService.touchRuntimeSession('session-abc');
      expect(localDb.touchRuntimeSession).toHaveBeenCalledWith('session-abc');
    });
  });

  describe('closeRuntimeSession', () => {
    it('calls dbApi.closeRuntimeSession with uuid and optional dateEnd', async () => {
      localDb.closeRuntimeSession.mockResolvedValueOnce();
      await lineService.closeRuntimeSession('session-abc', 1714300000);
      expect(localDb.closeRuntimeSession).toHaveBeenCalledWith('session-abc', 1714300000);
    });

    it('defaults dateEnd to undefined when not provided', async () => {
      localDb.closeRuntimeSession.mockResolvedValueOnce();
      await lineService.closeRuntimeSession('session-xyz');
      expect(localDb.closeRuntimeSession).toHaveBeenCalledWith('session-xyz', undefined);
    });
  });
});
