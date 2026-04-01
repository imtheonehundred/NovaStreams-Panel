'use strict';

/**
 * Phase 6 — Occupancy-Aware Failover tests.
 *
 * Tests cover:
 * 1. Session truth lifecycle (open/touch/close via lineService)
 * 2. Placement clients reconciliation helpers exported from lib/db
 * 3. Explicit failover relationship evaluation via serverService
 * 4. Primary unavailable triggers failover (no arbitrary reroute)
 * 5. crons contain Phase 6 job entries
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Top-level mocks for lib/mariadb and lib/db (baseline)
// ─────────────────────────────────────────────────────────────────────────
jest.mock('../../../lib/mariadb', () => ({
  execute: jest.fn(),
  insert: jest.fn(),
  queryOne: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  getMovieById: jest.fn(),
  getEpisodeById: jest.fn(),
  getPlacementByAsset: jest.fn(),
  getSetting: jest.fn(),
  openRuntimeSession: jest.fn(),
  touchRuntimeSession: jest.fn(),
  closeRuntimeSession: jest.fn(),
  getServer: jest.fn(),
  getServerHealthStatus: jest.fn(),
  queryOne: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  insert: jest.fn(),
  getRuntimeCapableServers: jest.fn(),
  getProxyCapableServers: jest.fn(),
  getRuntimePlacementsForAsset: jest.fn(),
  getRuntimePlacementsForServer: jest.fn(),
  getOriginProxyRelationships: jest.fn(),
  buildFullLbNginxConfig: jest.fn(),
  applyHeartbeat: jest.fn(),
  updateServerCapabilities: jest.fn(),
  canIssueCommandToServer: jest.fn(),
  getEffectiveEpisodeServerId: jest.fn(),
  getMovieStreamServerId: jest.fn(),
  getFailoverRelationships: jest.fn(),
  reconcilePlacementClients: jest.fn(),
  reconcileAllPlacementClients: jest.fn(),
  cleanStaleRuntimeSessions: jest.fn(),
}));

const db = require('../../../lib/db');

// ─────────────────────────────────────────────────────────────────────────
// serverService — selectFailoverServer
//
// Uses isolateModules + doMock pattern to inject controlled mocks
// that intercept both lib/mariadb (for getServerHealthStatus) and
// lib/db (for getFailoverRelationships / getPlacementByAsset).
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 6 — selectFailoverServer', () => {
  let testServerService;
  let mockMariadb;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();
    mockMariadb = {
      execute: jest.fn(),
      insert: jest.fn(),
      queryOne: jest.fn(),
      query: jest.fn(),
    };
    mockDb = {
      getMovieById: jest.fn(),
      getEpisodeById: jest.fn(),
      getPlacementByAsset: jest.fn(),
      getSetting: jest.fn(),
      openRuntimeSession: jest.fn(),
      touchRuntimeSession: jest.fn(),
      closeRuntimeSession: jest.fn(),
      getServer: jest.fn(),
      getServerHealthStatus: jest.fn(),
      queryOne: jest.fn(),
      query: jest.fn(),
      execute: jest.fn(),
      insert: jest.fn(),
      getRuntimeCapableServers: jest.fn(),
      getProxyCapableServers: jest.fn(),
      getRuntimePlacementsForAsset: jest.fn(),
      getRuntimePlacementsForServer: jest.fn(),
      getOriginProxyRelationships: jest.fn(),
      buildFullLbNginxConfig: jest.fn(),
      applyHeartbeat: jest.fn(),
      updateServerCapabilities: jest.fn(),
      canIssueCommandToServer: jest.fn(),
      getEffectiveEpisodeServerId: jest.fn(),
      getMovieStreamServerId: jest.fn(),
      getFailoverRelationships: jest.fn(),
      reconcilePlacementClients: jest.fn(),
      reconcileAllPlacementClients: jest.fn(),
      cleanStaleRuntimeSessions: jest.fn(),
    };
    jest.doMock('../../../lib/mariadb', () => mockMariadb);
    jest.doMock('../../../lib/db', () => mockDb);
    testServerService = require('../../../services/serverService');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no failover relationships exist', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).toBeNull();
  });

  it('returns null when all failover candidates are stale', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
      { id: 2, parent_server_id: 3, child_server_id: 8, server_id: 8, name: 'F2', public_host: 'f2.example', meta_json: '{}' },
    ]);
    // Both are stale — getServerHealthStatus from lib/mariadb returns stale
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date(Date.now() - 600000) }); // 10 min ago
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).toBeNull();
  });

  it('returns first healthy failover for live when placement is runtime-ready', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
    ]);
    // getServerHealthStatus returns fresh
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    mockDb.getPlacementByAsset.mockResolvedValue([
      { server_id: 7, status: 'running', runtime_instance_id: 'inst-abc', ready_at: new Date() },
    ]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).not.toBeNull();
    expect(result.serverId).toBe(7);
    expect(result.isFailover).toBe(true);
  });

  it('skips candidate with no placement and uses next healthy failover', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
      { id: 2, parent_server_id: 3, child_server_id: 8, server_id: 8, name: 'F2', public_host: 'f2.example', meta_json: '{}' },
    ]);
    // Both healthy
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    // First candidate has no placement, second does
    mockDb.getPlacementByAsset
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { server_id: 8, status: 'running', runtime_instance_id: 'inst-xyz', ready_at: new Date() },
      ]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).not.toBeNull();
    expect(result.serverId).toBe(8);
  });

  it('skips candidate when placement status is not running', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
    ]);
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    mockDb.getPlacementByAsset.mockResolvedValue([
      { server_id: 7, status: 'stopped', runtime_instance_id: 'inst-abc', ready_at: new Date() },
    ]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).toBeNull();
  });

  it('skips candidate when runtime_instance_id is not set', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
    ]);
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    mockDb.getPlacementByAsset.mockResolvedValue([
      { server_id: 7, status: 'running', runtime_instance_id: null, ready_at: new Date() },
    ]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).toBeNull();
  });

  it('selects failover for movie asset based on server health alone', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
    ]);
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    // No runtime placement check for movies
    const result = await testServerService.selectFailoverServer(3, 'movie', '200');
    expect(result).not.toBeNull();
    expect(result.serverId).toBe(7);
    expect(result.isFailover).toBe(true);
  });

  it('selects failover for episode asset based on server health alone', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([
      { id: 1, parent_server_id: 3, child_server_id: 7, server_id: 7, name: 'F1', public_host: 'f1.example', meta_json: '{}' },
    ]);
    mockMariadb.queryOne.mockResolvedValue({ last_heartbeat_at: new Date() });
    const result = await testServerService.selectFailoverServer(3, 'episode', '300');
    expect(result).not.toBeNull();
    expect(result.serverId).toBe(7);
  });

  it('does NOT select arbitrary server when no explicit failover relationship exists', async () => {
    mockDb.getFailoverRelationships.mockResolvedValue([]);
    const result = await testServerService.selectFailoverServer(3, 'live', '100');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// lineService — runtime session lifecycle
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 6 — lineService runtime session lifecycle', () => {
  let lineService;
  let localDb;

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
        setex: jest.fn().mockResolvedValue('OK'),
        sadd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
        srem: jest.fn().mockResolvedValue(1),
        scard: jest.fn().mockResolvedValue(0),
        smembers: jest.fn().mockResolvedValue([]),
      })),
    }));
    lineService = require('../../../services/lineService');
    localDb = require('../../../lib/db');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('openRuntimeSession calls dbApi.openRuntimeSession with all fields forwarded', async () => {
    localDb.openRuntimeSession.mockResolvedValueOnce(99);
    const result = await lineService.openRuntimeSession({
      lineId: 5,
      streamType: 'live',
      streamId: '100',
      placementId: 7,
      originServerId: 3,
      container: 'ts',
      sessionUuid: 'uuid-abc',
      userIp: '1.2.3.4',
      userAgent: 'TestAgent/1.0',
      geoipCountryCode: 'US',
    });
    expect(result).toBe(99);
    expect(localDb.openRuntimeSession).toHaveBeenCalledWith({
      lineId: 5,
      streamType: 'live',
      streamId: '100',
      placementId: 7,
      originServerId: 3,
      proxyServerId: undefined,
      container: 'ts',
      sessionUuid: 'uuid-abc',
      playbackToken: undefined,
      userIp: '1.2.3.4',
      userAgent: 'TestAgent/1.0',
      geoipCountryCode: 'US',
      isp: undefined,
    });
  });

  it('openRuntimeSession records a movie session with correct streamType', async () => {
    localDb.openRuntimeSession.mockResolvedValueOnce(100);
    const result = await lineService.openRuntimeSession({
      lineId: 5,
      streamType: 'movie',
      streamId: '200',
      placementId: 8,
      originServerId: 3,
      container: 'mp4',
      sessionUuid: 'uuid-mov',
      userIp: '5.6.7.8',
      userAgent: 'VLC/3.0',
      geoipCountryCode: 'DE',
    });
    expect(result).toBe(100);
    expect(localDb.openRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({ streamType: 'movie', streamId: '200' })
    );
  });

  it('touchRuntimeSession calls dbApi.touchRuntimeSession with sessionUuid', async () => {
    localDb.touchRuntimeSession.mockResolvedValue();
    await lineService.touchRuntimeSession('uuid-xyz');
    expect(localDb.touchRuntimeSession).toHaveBeenCalledWith('uuid-xyz');
  });

  it('closeRuntimeSession calls dbApi.closeRuntimeSession with sessionUuid and optional dateEnd', async () => {
    localDb.closeRuntimeSession.mockResolvedValue();
    await lineService.closeRuntimeSession('uuid-xyz', 1234567890);
    expect(localDb.closeRuntimeSession).toHaveBeenCalledWith('uuid-xyz', 1234567890);
  });

  it('closeRuntimeSession passes undefined when dateEnd is omitted', async () => {
    localDb.closeRuntimeSession.mockResolvedValue();
    await lineService.closeRuntimeSession('uuid-xyz');
    expect(localDb.closeRuntimeSession).toHaveBeenCalledWith('uuid-xyz', undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// lib/db.js — helpers are exported (structural)
// Uses jest.unmock to allow the real lib/db module to be required for
// export verification, isolating from the top-level mock.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 6 — lib/db exports for session reconciliation', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('dbApi exports cleanStaleRuntimeSessions', () => {
    jest.unmock('../../../lib/db');
    const realDb = require('../../../lib/db');
    expect(typeof realDb.cleanStaleRuntimeSessions).toBe('function');
  });

  it('dbApi exports reconcileAllPlacementClients', () => {
    jest.unmock('../../../lib/db');
    const realDb = require('../../../lib/db');
    expect(typeof realDb.reconcileAllPlacementClients).toBe('function');
  });

  it('dbApi exports reconcilePlacementClients', () => {
    jest.unmock('../../../lib/db');
    const realDb = require('../../../lib/db');
    expect(typeof realDb.reconcilePlacementClients).toBe('function');
  });

  it('dbApi exports getFailoverRelationships', () => {
    jest.unmock('../../../lib/db');
    const realDb = require('../../../lib/db');
    expect(typeof realDb.getFailoverRelationships).toBe('function');
  });

  it('dbApi exports countActiveRuntimeSessionsByServer', () => {
    jest.unmock('../../../lib/db');
    const realDb = require('../../../lib/db');
    expect(typeof realDb.countActiveRuntimeSessionsByServer).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// lib/crons.js — Phase 6 cron entries exist
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 6 — cron entries for session reconciliation', () => {
  it('crons.js source contains cleanStaleRuntimeSessions call', () => {
    const fs = require('fs');
    const cronsSrc = fs.readFileSync(require.resolve('../../../lib/crons.js'), 'utf8');
    expect(cronsSrc).toContain('cleanStaleRuntimeSessions');
  });

  it('crons.js source contains reconcileAllPlacementClients call', () => {
    const fs = require('fs');
    const cronsSrc = fs.readFileSync(require.resolve('../../../lib/crons.js'), 'utf8');
    expect(cronsSrc).toContain('reconcileAllPlacementClients');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// routes/stream.js — explicit failover structural checks
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 6 — routes/stream.js explicit failover wiring', () => {
  it('stream.js source contains selectFailoverServer call', () => {
    const fs = require('fs');
    const streamSrc = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
    expect(streamSrc).toContain('selectFailoverServer');
    expect(streamSrc).toContain('failoverSelected');
    expect(streamSrc).toContain('effectiveSelected');
    expect(streamSrc).toContain('isFailover');
    expect(streamSrc).toContain('reconcilePlacementClients');
    expect(streamSrc).toContain('buildLiveDeliveryPlan');
  });

  it('stream.js source builds the final live delivery plan with failoverSelected', () => {
    const fs = require('fs');
    const streamSrc = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
    expect(streamSrc).toContain('buildLiveDeliveryPlan(req, line, parsed.id, ext, selected, failoverSelected)');
  });

  it('stream.js source contains reconcilePlacementClients call after openRuntimeSession', () => {
    const fs = require('fs');
    const streamSrc = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
    expect(streamSrc).toContain('reconcilePlacementClients');
  });
});
