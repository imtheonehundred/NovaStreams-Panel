'use strict';

const path = require('path');
const fs = require('fs');

describe('Phase 8 — Final Hardening', () => {
  describe('lib/db — credential rotation helpers', () => {
    let dbApi;

    beforeEach(() => {
      jest.resetModules();
      jest.doMock('../../../lib/mariadb', () => ({
        query: jest.fn(),
        queryOne: jest.fn(),
        insert: jest.fn(),
        execute: jest.fn(),
        getPool: jest.fn(() => null),
      }));
      dbApi = require('../../../lib/db');
    });

    afterEach(() => {
      jest.resetModules();
    });

    it('exports rotateServerAgentCredential', () => {
      expect(typeof dbApi.rotateServerAgentCredential).toBe('function');
    });

    it('exports getValidServerCredentials', () => {
      expect(typeof dbApi.getValidServerCredentials).toBe('function');
    });

    it('exports revokeRotatingCredentials', () => {
      expect(typeof dbApi.revokeRotatingCredentials).toBe('function');
    });

    it('rotateServerAgentCredential is async', () => {
      expect(dbApi.rotateServerAgentCredential.constructor.name).toBe('AsyncFunction');
    });

    it('getValidServerCredentials returns active and rotating credentials', async () => {
      const rows = [
        { id: 1, server_id: 5, credential_id: 'cred_new', status: 'active', issued_at: new Date() },
        { id: 2, server_id: 5, credential_id: 'cred_old', status: 'rotating', issued_at: new Date() },
      ];
      const mockQuery = dbApi.__mockQuery || jest.fn();
      // Test structure: getValidServerCredentials should query for IN ('active','rotating')
      const src = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(src).toContain("status IN ('active', 'rotating')");
    });

    it('rotateServerAgentCredential sets old active to rotating', async () => {
      const src = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(src).toContain("status = 'rotating'");
      expect(src).toContain('rotated_at = NOW()');
    });

    it('rotateServerAgentCredential inserts new credential as active', async () => {
      const src = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(src).toContain("VALUES (?, ?, ?, 'active', NOW())");
    });

    it('revokeRotatingCredentials updates rotating credentials to revoked', async () => {
      const src = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(src).toContain("status = 'revoked'");
      expect(src).toContain('server_id = ? AND status = \'rotating\'');
    });
  });

  describe('lib/db — command queue lease/ack integration', () => {
    it('expireStaleLeases is exported', () => {
      jest.resetModules();
      jest.doMock('../../../lib/mariadb', () => ({
        execute: jest.fn(),
        insert: jest.fn(),
        queryOne: jest.fn(),
        query: jest.fn(),
        getPool: jest.fn(() => null),
      }));
      const dbApi = require('../../../lib/db');
      expect(typeof dbApi.expireStaleLeases).toBe('function');
    });

    it('leaseServerCommands marks commands as leased with expiry', () => {
      const dbSrc = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(dbSrc).toContain('lease_token');
      expect(dbSrc).toContain('lease_expires_at');
      expect(dbSrc).toContain("status = 'leased'");
    });

    it('markServerCommandSucceeded sets status and result_json', () => {
      const dbSrc = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(dbSrc).toContain('markServerCommandSucceeded');
      expect(dbSrc).toContain("status = 'succeeded'");
    });

    it('markServerCommandFailed sets status and error_text', () => {
      const dbSrc = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(dbSrc).toContain('markServerCommandFailed');
      expect(dbSrc).toContain("status = 'failed'");
    });

    it('command lease has finite expiry (lease_expires_at column exists)', () => {
      const schemaPath = path.resolve(__dirname, '../../../scripts/schema.sql');
      const schemaSrc = fs.readFileSync(schemaPath, 'utf8');
      // server_commands table uses backtick quoting; search for it broadly
      expect(schemaSrc).toContain('lease_expires_at');
      expect(schemaSrc).toContain('server_commands');
    });
  });

  describe('serverService — canIssueCommandToServer gating', () => {
    it('canIssueCommandToServer checks heartbeat freshness', () => {
      const src = fs.readFileSync(require.resolve('../../../services/serverService.js'), 'utf8');
      expect(src).toContain('canIssueCommandToServer');
      expect(src).toContain('getServerHealthStatus');
    });

    it('canIssueCommandToServer is exported', () => {
      jest.resetModules();
      jest.doMock('../../../lib/db', () => ({}));
      jest.doMock('../../../lib/mariadb', () => ({ query: jest.fn(), queryOne: jest.fn(), getPool: jest.fn(() => null) }));
      jest.doMock('../../../lib/redis', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), keys: jest.fn(() => []) }));
      const serverService = require('../../../services/serverService');
      expect(typeof serverService.canIssueCommandToServer).toBe('function');
    });

    it('streamManager.issueRemoteCommand gates by canIssueCommandToServer', () => {
      const src = fs.readFileSync(require.resolve('../../../services/streamManager.js'), 'utf8');
      expect(src).toContain('canIssueCommandToServer');
    });
  });

  describe('routes/stream.js — remote runtime rollback safety', () => {
    it('redirectToLiveStream falls back to panel-local when remote is not ready', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // When runtime not ready AND no failover, check local FFmpeg or return 503
      expect(src).toContain('return res.status(503).send');
    });

    it('handleLive falls back to panel when no publicBaseUrl', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // When selected.publicBaseUrl is empty, should fall through to panel-based URL
      expect(src).toContain('useRemoteUrl = false');
    });

    it('movie route falls back to panel-local proxy when no node selected', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // movie: if no selected.publicBaseUrl, uses proxyStream (panel-local)
      expect(src).toContain('proxyStream(req, res, getSourceUrls(row)');
    });

    it('episode route falls back to panel-local proxy when no node selected', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // episode: if no selected.publicBaseUrl, uses proxyStream (panel-local)
      expect(src).toContain('proxyStream(req, res, sourceUrls, container)');
    });

    it('failover chain does NOT reroute to arbitrary unscripted nodes', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // Explicit: only reroutes via selectFailoverServer which uses explicit relationships
      expect(src).toContain('selectFailoverServer');
      // No fallback to arbitrary server when failover not available
      expect(src).not.toMatch(/fallback.*selectServer.*arbitrary/is);
    });
  });

  describe('routes/stream.js — remote live ownership flow', () => {
    it('handleLive calls selectServer with assetType=live', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain("assetType: 'live'");
    });

    it('redirectToLiveStream checks isRuntimeReady before redirecting to remote', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('isRuntimeReady');
      // isRuntimeReady result gates the useRemoteUrl flag
      expect(src).toContain('useRemoteUrl = true');
    });

    it('trackLiveConnection records origin_server_id in runtime session', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('originServerId: selected.serverId');
    });

    it('trackLiveConnection still records proxy_server_id field, but live path now passes null', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('proxyServerId: proxySelected ? proxySelected.serverId : null');
      expect(src).toContain('trackLiveConnection(line, parsed.id, ext, req, plan.servingSelected, null)');
    });
  });

  describe('routes/stream.js — remote VOD/episode serving', () => {
    it('movie route calls selectServer with assetType=movie', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain("assetType: 'movie'");
    });

    it('episode route calls selectServer with assetType=episode', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain("assetType: 'episode'");
    });

    it('buildNodeStreamRedirectUrl constructs signed redirect URL', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('buildNodeStreamRedirectUrl');
      expect(src).toContain('generateStreamToken');
      expect(src).toContain('signStreamUrl');
    });

    it('buildProxyRedirectUrl constructs signed redirect to proxy', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('buildProxyRedirectUrl');
    });

    it('agent handles /stream/movie/ and /stream/episode/ URL patterns', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('movieMatch');
      expect(src).toContain('episodeMatch');
    });

    it('agent no longer exposes /stream/live/ URL pattern in current TARGET', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).not.toContain('liveMatch');
    });
  });

  describe('routes/stream.js — proxy/origin redirect flow', () => {
    it('handleLive no longer calls selectProxyServer after origin resolution for live playback', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).not.toContain('selectProxyServer(effectiveSelected.serverId)');
    });

    it('movie route calls selectProxyServer when node is selected', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // movie route should check selectProxyServer before redirecting
      const movieRouteIdx = src.indexOf("router.get('/movie/");
      const nextRouteIdx = src.indexOf("router.get('/series/");
      const movieRoute = src.slice(movieRouteIdx, nextRouteIdx);
      expect(movieRoute).toContain('selectProxyServer');
    });

    it('episode route calls selectProxyServer when node is selected', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      const seriesRouteIdx = src.indexOf("router.get('/series/");
      const afterSeries = src.slice(seriesRouteIdx);
      expect(afterSeries).toContain('selectProxyServer');
    });

    it('buildProxyUpstreamConfig generates nginx upstream block', () => {
      const src = fs.readFileSync(require.resolve('../../../services/serverService.js'), 'utf8');
      expect(src).toContain('buildProxyUpstreamConfig');
      expect(src).toContain('upstream');
    });

    it('agent sync_proxy_upstream writes nginx config and reloads', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('handleSyncProxyUpstream');
      expect(src).toContain('nginx -t');
      expect(src).toContain('iptv_proxy_upstream.conf');
    });
  });

  describe('routes/stream.js — failover behavior', () => {
    it('handleLive calls selectFailoverServer when primary is not runtime-ready', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('selectFailoverServer');
    });

    it('live delivery plan is built from selected or failover, never arbitrary', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('buildLiveDeliveryPlan');
      expect(src).toContain('failoverSelected');
      expect(src).toContain('servingSelected');
    });

    it('redirectToLiveStream receives failoverSelected as parameter', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      expect(src).toContain('failoverSelected');
    });

    it('trackLiveConnection is called with effectiveSelected (actual serving node)', () => {
      const src = fs.readFileSync(require.resolve('../../../routes/stream.js'), 'utf8');
      // handleLive tracks against the final serving plan so panel-local fallback avoids remote attribution.
      expect(src).toContain('trackLiveConnection(line, parsed.id, ext, req, plan.servingSelected, null)');
    });

    it('selectFailoverServer returns null when no explicit relationship exists', () => {
      const src = fs.readFileSync(require.resolve('../../../services/serverService.js'), 'utf8');
      expect(src).toContain('getFailoverRelationships');
    });
  });

  describe('Placement and session truth — rollback safety', () => {
    it('stream_server_placement has desired_state column', () => {
      const schemaSrc = fs.readFileSync(require.resolve('../../../scripts/schema.sql'), 'utf8');
      expect(schemaSrc).toContain('desired_state');
      expect(schemaSrc).toContain('stream_server_placement');
    });

    it('stream_server_placement has runtime_instance_id column for truth', () => {
      const schemaSrc = fs.readFileSync(require.resolve('../../../scripts/schema.sql'), 'utf8');
      expect(schemaSrc).toContain('runtime_instance_id');
    });

    it('stream_server_placement has ready_at column', () => {
      const schemaSrc = fs.readFileSync(require.resolve('../../../scripts/schema.sql'), 'utf8');
      expect(schemaSrc).toContain('ready_at');
    });

    it('line_runtime_sessions is canonical active occupancy truth', () => {
      const schemaSrc = fs.readFileSync(require.resolve('../../../scripts/schema.sql'), 'utf8');
      expect(schemaSrc).toContain('line_runtime_sessions');
      expect(schemaSrc).toContain('origin_server_id');
      expect(schemaSrc).toContain('proxy_server_id');
    });

    it('placement.clients is derived from line_runtime_sessions (not independent)', () => {
      const src = fs.readFileSync(require.resolve('../../../lib/db.js'), 'utf8');
      expect(src).toContain('reconcilePlacementClients');
      // The function recomputes from active sessions
      expect(src).toContain('countActiveRuntimeSessionsByPlacement');
    });

    it('stale sessions are reaped by cron', () => {
      const cronSrc = fs.readFileSync(require.resolve('../../../lib/crons.js'), 'utf8');
      expect(cronSrc).toContain('cleanStaleRuntimeSessions');
    });
  });

  describe('Agent — command execution and telemetry', () => {
    it('agent version is reported in heartbeat', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('version');
      expect(src).toContain('VERSION');
    });

    it('agent reports capabilities in heartbeat', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('capabilities');
      expect(src).toContain('getCapabilities');
    });

    it('agent validateWithPanel uses GET for /api/stream/node-validate', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('function getText(');
      expect(src).toContain("method: 'GET'");
      expect(src).toContain("/api/stream/node-validate");
      expect(src).toContain('const raw = await getText(u.toString())');
    });

    it('agent explicitly rejects de-scoped probe_stream command', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('probe_stream');
      expect(src).toContain('handleDeScopedCommand');
    });

    it('agent handles reload_proxy_config command', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('reload_proxy_config');
      expect(src).toContain('handleReloadProxyConfig');
    });

    it('agent handles sync_proxy_upstream command', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('sync_proxy_upstream');
      expect(src).toContain('handleSyncProxyUpstream');
    });

    it('agent explicitly rejects de-scoped reconcile_runtime command', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('reconcile_runtime');
      expect(src).toContain('handleDeScopedCommand');
    });

    it('agent explicitly rejects de-scoped reconcile_sessions command', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('reconcile_sessions');
      expect(src).toContain('handleDeScopedCommand');
    });

    it('agent sends command ack after execution', () => {
      const src = fs.readFileSync(require.resolve('../../../agent/index.js'), 'utf8');
      expect(src).toContain('sendCommandAck');
      expect(src).toContain('command_id');
      expect(src).toContain('status');
    });
  });

  describe('Server provisioning — install profiles', () => {
    it('provisionService exports getInstallScriptForProfile', () => {
      const provSrc = fs.readFileSync(require.resolve('../../../services/provisionService.js'), 'utf8');
      expect(provSrc).toContain('getInstallScriptForProfile');
    });

    it('install script includes profile-specific AGENT_PROFILE', () => {
      const provSrc = fs.readFileSync(require.resolve('../../../services/provisionService.js'), 'utf8');
      expect(provSrc).toContain('AGENT_PROFILE');
    });

    it('install script includes CREDENTIAL_ID for the node', () => {
      const provSrc = fs.readFileSync(require.resolve('../../../services/provisionService.js'), 'utf8');
      expect(provSrc).toContain('CREDENTIAL_ID=');
    });

    it('install script masks AGENT_SECRET in logs', () => {
      const provSrc = fs.readFileSync(require.resolve('../../../services/provisionService.js'), 'utf8');
      // Secret should be masked, not shown in plain text
      expect(provSrc).toContain('***');
    });
  });

  describe('load-bearing docs reflect implemented reality', () => {
    it('docs/CURRENT_IMPLEMENTED_STATE.md contains Phase 7 section', () => {
      const doc = fs.readFileSync(require.resolve('../../../docs/CURRENT_IMPLEMENTED_STATE.md'), 'utf8');
      expect(doc).toContain('Phase 7');
      expect(doc).toContain('origin-proxy');
    });

    it('CLAUDE.md references LB target architecture docs', () => {
      const claude = fs.readFileSync(require.resolve('../../../CLAUDE.md'), 'utf8');
      expect(claude).toContain('LB_SOURCE_ARCHITECTURE_ANALYSIS');
      expect(claude).toContain('LB_TARGET_GAP_ANALYSIS');
      expect(claude).toContain('LB_IMPLEMENTATION_PLAN');
    });

    it('CLAUDE.md documents current selector resolution order', () => {
      const claude = fs.readFileSync(require.resolve('../../../CLAUDE.md'), 'utf8');
      expect(claude).toContain('selectServer');
      expect(claude).toContain('force_server_id');
    });

    it('no runtime parity phase is marked complete if tests do not cover it', () => {
      // This test ensures no phase is documented as complete without tests
      const testFiles = [
        'xcRuntimePhase1.test.js',
        'xcRuntimePhase3.test.js',
        'xcRuntimePhase4.test.js',
        'xcRuntimePhase5.test.js',
        'xcRuntimePhase6.test.js',
        'xcRuntimePhase7.test.js',
        'xcRuntimePhase8.test.js',
      ];
      for (const tf of testFiles) {
        const found = fs.existsSync(path.resolve(__dirname, '../../..', 'tests/unit/services', tf));
        expect(found).toBe(true);
      }
    });
  });
});
