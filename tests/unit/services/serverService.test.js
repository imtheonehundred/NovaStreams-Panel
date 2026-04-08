'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
  createPlacement: jest.fn(),
  getServerRelationships: jest.fn(),
  getEffectiveEpisodeServerId: jest.fn(),
  getPlacementByAsset: jest.fn(),
  getPlacementsByServer: jest.fn(),
  getFailoverRelationships: jest.fn(),
  getProxyRelationships: jest.fn(),
  getOriginServersForProxy: jest.fn(),
}));

jest.mock('../../../lib/public-stream-origin', () => ({
  publicStreamOrigin: jest.fn(),
}));

const { query, queryOne, execute, insert, remove } = require('../../../lib/mariadb');
const dbApi = require('../../../lib/db');
const publicStreamOrigin = require('../../../lib/public-stream-origin');
const serverService = require('../../../services/serverService');

describe('serverService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listServers', () => {
    it('should return servers with domains', async () => {
      const servers = [{ id: 1, name: 'Server 1', meta_json: '{}' }];
      const domains = [{ id: 1, server_id: 1, domain: 'example.com' }];
      query.mockResolvedValueOnce(servers).mockResolvedValueOnce(domains);

      const result = await serverService.listServers();

      expect(result).toHaveLength(1);
      expect(result[0].domains).toHaveLength(1);
      expect(result[0].domains[0].domain).toBe('example.com');
    });

    it('should parse meta_json for each server', async () => {
      const servers = [{ id: 1, name: 'Server 1', meta_json: '{"key":"value"}' }];
      query.mockResolvedValueOnce(servers).mockResolvedValueOnce([]);

      const result = await serverService.listServers();

      expect(result[0].meta_json).toEqual({ key: 'value' });
    });
  });

  describe('getServer', () => {
    it('should return server with domains', async () => {
      const server = { id: 1, name: 'Server 1', meta_json: '{}' };
      const domains = [{ id: 1, server_id: 1, domain: 'example.com' }];
      queryOne.mockResolvedValue(server);
      query.mockResolvedValue(domains);

      const result = await serverService.getServer(1);

      expect(result.id).toBe(1);
      expect(result.domains).toHaveLength(1);
    });

    it('should return null for non-existent server', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.getServer(999);

      expect(result).toBeNull();
    });
  });

  describe('createServer', () => {
    it('should create server with main role and demote others', async () => {
      const data = {
        name: 'New Server',
        role: 'main',
        public_host: 'example.com',
        enabled: true,
      };
      insert.mockResolvedValue(1);
      queryOne.mockResolvedValue({ id: 1, role: 'main', meta_json: '{}' });
      query.mockResolvedValue([]);

      const result = await serverService.createServer(data);

      expect(insert).toHaveBeenCalled();
      expect(execute).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('should throw error for invalid role', async () => {
      const data = { name: 'Test', role: 'invalid' };

      await expect(serverService.createServer(data)).rejects.toThrow('invalid role');
    });

    it('should use default values for optional fields', async () => {
      const data = { name: 'Test Server' };
      insert.mockResolvedValue(1);
      queryOne.mockResolvedValue({ id: 1, role: 'edge', meta_json: null });
      query.mockResolvedValue([]);

      await serverService.createServer(data);

      expect(insert).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO streaming_servers'), expect.any(Array));
    });

  });

  describe('updateServer', () => {
    it('should update server fields', async () => {
      const existing = { id: 1, meta_json: '{}' };
      queryOne.mockResolvedValueOnce(existing).mockResolvedValueOnce({ role: 'edge' });
      query.mockResolvedValue([]);
      execute.mockResolvedValue({ affectedRows: 1 });

      const result = await serverService.updateServer(1, { name: 'Updated Name' });

      expect(execute).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('should return null for non-existent server', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.updateServer(999, { name: 'Test' });

      expect(result).toBeNull();
    });

    it('should throw error for invalid role', async () => {
      queryOne.mockResolvedValue({ id: 1, meta_json: '{}' });

      await expect(serverService.updateServer(1, { role: 'invalid' })).rejects.toThrow('invalid role');
    });
  });

  describe('deleteServer', () => {
    it('should delete server', async () => {
      remove.mockResolvedValue(true);

      const result = await serverService.deleteServer(1);

      expect(remove).toHaveBeenCalledWith('DELETE FROM streaming_servers WHERE id = ?', [1]);
      expect(result).toBe(true);
    });
  });

  describe('reorderServers', () => {
    it('should reorder servers', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      const result = await serverService.reorderServers([
        { id: 1, sort_order: 2 },
        { id: 2, sort_order: 1 },
      ]);

      expect(execute).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });

    it('should throw error for non-array input', async () => {
      await expect(serverService.reorderServers('not array')).rejects.toThrow('orderings must be an array');
    });

    it('should skip invalid orderings', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.reorderServers([
        { id: 'invalid', sort_order: 'invalid' },
        { id: 1, sort_order: 2 },
      ]);

      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildServerPublicBaseUrl', () => {
    it('should return null for null row', () => {
      expect(serverService.buildServerPublicBaseUrl(null)).toBeNull();
    });

    it('should use meta public_base_url if set', () => {
      const row = {
        meta_json: { public_base_url: 'https://cdn.example.com' },
        public_host: 'example.com',
      };
      expect(serverService.buildServerPublicBaseUrl(row)).toBe('https://cdn.example.com');
    });

    it('should build url from public_host with https', () => {
      const row = {
        meta_json: { https: true },
        public_host: 'example.com',
      };
      expect(serverService.buildServerPublicBaseUrl(row)).toBe('https://example.com');
    });

    it('should build url from public_host with http', () => {
      const row = {
        meta_json: {},
        public_host: 'example.com',
      };
      expect(serverService.buildServerPublicBaseUrl(row)).toBe('http://example.com');
    });

    it('should include port when not 80 or 443', () => {
      const row = {
        meta_json: { port: 8080 },
        public_host: 'example.com',
      };
      expect(serverService.buildServerPublicBaseUrl(row)).toBe('http://example.com:8080');
    });

    it('should not include port when 80', () => {
      const row = {
        meta_json: { port: 80 },
        public_host: 'example.com',
      };
      expect(serverService.buildServerPublicBaseUrl(row)).toBe('http://example.com');
    });
  });

  describe('getServerHealthStatus', () => {
    it('should return fresh status for recent heartbeat', async () => {
      const now = new Date();
      queryOne.mockResolvedValue({ last_heartbeat_at: now });

      const result = await serverService.getServerHealthStatus(1);

      expect(result.fresh).toBe(true);
      expect(result.staleMs).toBeLessThan(1000);
    });

    it('should return stale status for old heartbeat', async () => {
      const old = new Date(Date.now() - 10 * 60 * 1000);
      queryOne.mockResolvedValue({ last_heartbeat_at: old });

      const result = await serverService.getServerHealthStatus(1);

      expect(result.fresh).toBe(false);
    });

    it('should return not fresh for missing heartbeat', async () => {
      queryOne.mockResolvedValue({});

      const result = await serverService.getServerHealthStatus(1);

      expect(result.fresh).toBe(false);
      expect(result.lastHeartbeatAt).toBeNull();
    });
  });

  describe('getDefaultStreamServerId', () => {
    it('should return server id from settings', async () => {
      dbApi.getSetting.mockResolvedValue('5');

      const result = await serverService.getDefaultStreamServerId();

      expect(result).toBe(5);
    });

    it('should return 0 for missing setting', async () => {
      dbApi.getSetting.mockResolvedValue(null);

      const result = await serverService.getDefaultStreamServerId();

      expect(result).toBe(0);
    });

    it('should return 0 for invalid setting', async () => {
      dbApi.getSetting.mockResolvedValue('invalid');

      const result = await serverService.getDefaultStreamServerId();

      expect(result).toBe(0);
    });
  });

  describe('selectServer', () => {
    it('should throw error when no servers available', async () => {
      dbApi.getSetting.mockResolvedValue('');
      queryOne.mockResolvedValue(null);
      query.mockResolvedValue([]);

      await expect(serverService.selectServer({ assetType: 'live', assetId: 1 }))
        .rejects.toThrow('No server available for selection');
    });
  });

  describe('recordPlacementSelection', () => {
    it('should create placement for valid types', async () => {
      dbApi.createPlacement.mockResolvedValue(1);

      await serverService.recordPlacementSelection('live', '1', 1);

      expect(dbApi.createPlacement).toHaveBeenCalledWith({
        streamType: 'live',
        streamId: '1',
        serverId: 1,
      });
    });

    it('should skip invalid types', async () => {
      await serverService.recordPlacementSelection('invalid', '1', 1);

      expect(dbApi.createPlacement).not.toHaveBeenCalled();
    });

    it('should skip invalid server ids', async () => {
      await serverService.recordPlacementSelection('live', '1', 0);

      expect(dbApi.createPlacement).not.toHaveBeenCalled();
    });
  });

  describe('demoteOtherMains', () => {
    it('should demote other main servers', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.demoteOtherMains(1);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("role = 'main'"),
        [1]
      );
    });
  });

  describe('replaceDomains', () => {
    it('should replace domains for server', async () => {
      execute.mockResolvedValue({ affectedRows: 0 });
      insert.mockResolvedValue(1);

      await serverService.replaceDomains(1, ['domain1.com', 'domain2.com']);

      expect(execute).toHaveBeenCalledWith(
        'DELETE FROM streaming_server_domains WHERE server_id = ?',
        [1]
      );
      expect(insert).toHaveBeenCalledTimes(2);
    });

    it('should skip invalid domains', async () => {
      execute.mockResolvedValue({ affectedRows: 0 });

      await serverService.replaceDomains(1, ['', null, undefined]);

      expect(insert).not.toHaveBeenCalled();
    });

    it('should mark first domain as primary', async () => {
      execute.mockResolvedValue({ affectedRows: 0 });
      insert.mockResolvedValue(1);

      await serverService.replaceDomains(1, ['domain1.com', 'domain2.com']);

      expect(insert).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        [1, 'domain1.com', 1, 0]
      );
      expect(insert).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        [1, 'domain2.com', 0, 1]
      );
    });

    it('should handle object domains', async () => {
      execute.mockResolvedValue({ affectedRows: 0 });
      insert.mockResolvedValue(1);

      await serverService.replaceDomains(1, [{ domain: 'objdomain.com' }]);

      expect(insert).toHaveBeenCalledWith(
        expect.any(String),
        [1, 'objdomain.com', 1, 0]
      );
    });
  });

  describe('getMovieStreamServerId', () => {
    it('should return server id from movie', async () => {
      queryOne.mockResolvedValue({ stream_server_id: '5' });

      const result = await serverService.getMovieStreamServerId(1);

      expect(result).toBe(5);
    });

    it('should return 0 for missing movie', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.getMovieStreamServerId(999);

      expect(result).toBe(0);
    });

    it('should return 0 for invalid server id', async () => {
      queryOne.mockResolvedValue({ stream_server_id: 'invalid' });

      const result = await serverService.getMovieStreamServerId(1);

      expect(result).toBe(0);
    });
  });

  describe('getLiveChannelStreamServerId', () => {
    it('should return server id from channel json_data', async () => {
      queryOne.mockResolvedValue({ json_data: JSON.stringify({ stream_server_id: 7 }) });

      const result = await serverService.getLiveChannelStreamServerId(1);

      expect(result).toBe(7);
    });

    it('should return 0 for missing channel', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.getLiveChannelStreamServerId(999);

      expect(result).toBe(0);
    });

    it('should return 0 for invalid json_data', async () => {
      queryOne.mockResolvedValue({ json_data: 'invalid' });

      const result = await serverService.getLiveChannelStreamServerId(1);

      expect(result).toBe(0);
    });
  });

  describe('applyHeartbeat', () => {
    it('should update server heartbeat with metrics', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.applyHeartbeat(1, {
        cpu: 50,
        mem: 60,
        net_mbps: 100,
        ping_ms: 10,
        version: '1.0.0',
      });

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE streaming_servers'),
        expect.arrayContaining([50, 60, 100, 10, '1.0.0', 1])
      );
    });

    it('should handle null/undefined metrics', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.applyHeartbeat(1, {
        cpu: null,
        mem: undefined,
        net_mbps: null,
        ping_ms: undefined,
        version: null,
      });

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE streaming_servers'),
        expect.arrayContaining([null, null, null, null, null, 1])
      );
    });

    it('should truncate version to 64 chars', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.applyHeartbeat(1, {
        version: 'a'.repeat(100),
      });

      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['a'.repeat(64), 1])
      );
    });
  });

  describe('updateServerCapabilities', () => {
    it('should update capabilities', async () => {
      queryOne.mockResolvedValue({ meta_json: '{}' });
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.updateServerCapabilities(1, {
        runtime: true,
        proxy: false,
        controller: true,
        profile: 'test-profile',
      });

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE streaming_servers'),
        [1, 0, 1, expect.any(String), 1]
      );
    });

    it('should merge agent_profile into existing meta', async () => {
      queryOne.mockResolvedValue({ meta_json: '{"other":"data"}' });
      execute.mockResolvedValue({ affectedRows: 1 });

      await serverService.updateServerCapabilities(1, {
        profile: 'test-profile',
      });

      const call = execute.mock.calls[0];
      const metaArg = JSON.parse(call[1][3]);
      expect(metaArg.other).toBe('data');
      expect(metaArg.agent_profile).toBe('test-profile');
    });
  });

  describe('canIssueCommandToServer', () => {
    it('should return false for non-existent server', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.canIssueCommandToServer(999, 'reload_proxy_config');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('server not found');
    });

    it('should return false for disabled server', async () => {
      queryOne.mockResolvedValueOnce({ id: 1, enabled: 0, meta_json: '{}' });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'reload_proxy_config');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('server disabled');
    });

    it('should return false for stale heartbeat', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'reload_proxy_config');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('server heartbeat stale');
    });

    it('should return false for de-scoped commands', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'start_stream');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('de-scoped');
    });

    it('should return true for reload_proxy_config', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'reload_proxy_config');

      expect(result.ok).toBe(true);
    });

    it('should return true for restart_services', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'restart_services');

      expect(result.ok).toBe(true);
    });

    it('should return false for unknown command', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);

      const result = await serverService.canIssueCommandToServer(1, 'unknown_command');

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('unknown command type');
    });
  });

  describe('isRuntimeReady', () => {
    it('should return false for stale heartbeat', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) });
      query.mockResolvedValue([]);

      const result = await serverService.isRuntimeReady(1, 1);

      expect(result.ready).toBe(false);
      expect(result.reason).toBe('server heartbeat stale');
    });

    it('should return false when no placement found', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);
      dbApi.getPlacementByAsset.mockResolvedValue([]);

      const result = await serverService.isRuntimeReady(1, 1);

      expect(result.ready).toBe(false);
      expect(result.reason).toBe('no placement found for this server');
    });

    it('should return false when placement not running', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);
      dbApi.getPlacementByAsset.mockResolvedValue([{ server_id: 1, status: 'stopped' }]);

      const result = await serverService.isRuntimeReady(1, 1);

      expect(result.ready).toBe(false);
      expect(result.reason).toContain("status is 'stopped'");
    });

    it('should return false when runtime_instance_id not set', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);
      dbApi.getPlacementByAsset.mockResolvedValue([{ server_id: 1, status: 'running', runtime_instance_id: null }]);

      const result = await serverService.isRuntimeReady(1, 1);

      expect(result.ready).toBe(false);
      expect(result.reason).toBe('runtime_instance_id not set');
    });

    it('should return true when placement is ready', async () => {
      queryOne
        .mockResolvedValueOnce({ id: 1, enabled: 1, meta_json: '{}' })
        .mockResolvedValueOnce({ last_heartbeat_at: new Date() });
      query.mockResolvedValue([]);
      dbApi.getPlacementByAsset.mockResolvedValue([{
        server_id: 1,
        status: 'running',
        runtime_instance_id: 'inst_1',
        ready_at: new Date(),
      }]);

      const result = await serverService.isRuntimeReady(1, 1);

      expect(result.ready).toBe(true);
    });
  });

  describe('selectFailoverServer', () => {
    it('should return null when no failover relationships', async () => {
      dbApi.getFailoverRelationships.mockResolvedValue([]);

      const result = await serverService.selectFailoverServer(1, 'live', 1);

      expect(result).toBeNull();
    });

    it('should return null when all candidates stale', async () => {
      dbApi.getFailoverRelationships.mockResolvedValue([{ server_id: 2 }]);
      queryOne.mockResolvedValueOnce({ last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) });

      const result = await serverService.selectFailoverServer(1, 'live', 1);

      expect(result).toBeNull();
    });
  });

  describe('selectProxyServer', () => {
    it('should return null when no proxy relationships', async () => {
      dbApi.getProxyRelationships.mockResolvedValue([]);

      const result = await serverService.selectProxyServer(1);

      expect(result).toBeNull();
    });

    it('should skip stale proxies', async () => {
      dbApi.getProxyRelationships.mockResolvedValue([{ server_id: 2 }]);
      queryOne.mockResolvedValueOnce({ last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000) });

      const result = await serverService.selectProxyServer(1);

      expect(result).toBeNull();
    });

    it('should return healthy proxy', async () => {
      dbApi.getProxyRelationships.mockResolvedValue([{ server_id: 2, name: 'Proxy 2' }]);
      queryOne.mockResolvedValueOnce({ last_heartbeat_at: new Date() });

      const result = await serverService.selectProxyServer(1);

      expect(result).not.toBeNull();
      expect(result.serverId).toBe(2);
    });
  });

  describe('buildNginxUpstreamSnippet', () => {
    it('should generate nginx upstream config', async () => {
      query.mockResolvedValue([
        { id: 1, name: 'Origin 1', public_ip: '192.168.1.1', private_ip: '10.0.0.1', role: 'main', enabled: 1, meta_json: '{}' },
      ]);

      const result = await serverService.buildNginxUpstreamSnippet();

      expect(result).toContain('upstream panel_stream_origins');
      expect(result).toContain('10.0.0.1:80');
    });

    it('should use meta upstream_port', async () => {
      query.mockResolvedValue([
        { id: 1, name: 'Origin 1', public_ip: '192.168.1.1', private_ip: '', role: 'main', enabled: 1, meta_json: JSON.stringify({ upstream_port: 8080 }) },
      ]);

      const result = await serverService.buildNginxUpstreamSnippet();

      expect(result).toContain('192.168.1.1:8080');
    });

    it('should fallback to 127.0.0.1 when no IPs', async () => {
      query.mockResolvedValue([
        { id: 1, name: 'Origin 1', public_ip: '', private_ip: '', role: 'main', enabled: 1, meta_json: '{}' },
      ]);

      const result = await serverService.buildNginxUpstreamSnippet();

      expect(result).toContain('127.0.0.1:80');
    });
  });

  describe('buildFullLbNginxConfig', () => {
    it('should generate full nginx config', async () => {
      query.mockResolvedValue([]);

      const result = await serverService.buildFullLbNginxConfig();

      expect(result).toContain('upstream panel_stream_origins');
      expect(result).toContain('proxy_pass http://panel_stream_origins');
    });
  });

  describe('getRuntimeCapableServers', () => {
    it('should return servers with runtime_enabled', async () => {
      const servers = [{ id: 1 }, { id: 2 }];
      query.mockResolvedValue(servers);

      const result = await serverService.getRuntimeCapableServers();

      expect(result).toEqual(servers);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('runtime_enabled = 1'));
    });
  });

  describe('getProxyCapableServers', () => {
    it('should return servers with proxy_enabled', async () => {
      const servers = [{ id: 1 }];
      query.mockResolvedValue(servers);

      const result = await serverService.getProxyCapableServers();

      expect(result).toEqual(servers);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('proxy_enabled = 1'));
    });
  });

  describe('getRuntimePlacementsForAsset', () => {
    it('should delegate to dbApi', async () => {
      const placements = [{ id: 1 }];
      dbApi.getPlacementByAsset.mockResolvedValue(placements);

      const result = await serverService.getRuntimePlacementsForAsset('live', '1');

      expect(result).toEqual(placements);
      expect(dbApi.getPlacementByAsset).toHaveBeenCalledWith('live', '1');
    });
  });

  describe('getRuntimePlacementsForServer', () => {
    it('should delegate to dbApi', async () => {
      const placements = [{ id: 1 }];
      dbApi.getPlacementsByServer.mockResolvedValue(placements);

      const result = await serverService.getRuntimePlacementsForServer(1);

      expect(result).toEqual(placements);
      expect(dbApi.getPlacementsByServer).toHaveBeenCalledWith(1, undefined);
    });
  });

  describe('getOriginProxyRelationships', () => {
    it('should return filtered relationships', async () => {
      const rels = [
        { parent_server_id: 1, child_server_id: 2 },
        { parent_server_id: 3, child_server_id: 1 },
      ];
      dbApi.getServerRelationships.mockResolvedValue(rels);

      const result = await serverService.getOriginProxyRelationships(1);

      expect(result.asOrigin).toHaveLength(1);
      expect(result.asProxy).toHaveLength(1);
    });
  });

  describe('buildProxyUpstreamConfig', () => {
    it('should return empty string when no origins', async () => {
      dbApi.getOriginServersForProxy.mockResolvedValue([]);

      const result = await serverService.buildProxyUpstreamConfig(1);

      expect(result).toBe('');
    });

    it('should generate upstream config', async () => {
      dbApi.getOriginServersForProxy.mockResolvedValue([
        { server_id: 2, private_ip: '10.0.0.2', meta_json: '{}' },
      ]);

      const result = await serverService.buildProxyUpstreamConfig(1);

      expect(result).toContain('upstream panel_proxy_upstreams');
      expect(result).toContain('10.0.0.2:80');
    });
  });

  describe('getServerWithRelationships', () => {
    it('should return server with relationships', async () => {
      const server = { id: 1 };
      const relationships = [{ id: 1 }];
      queryOne.mockResolvedValue({ ...server, meta_json: '{}', domains: [] });
      query.mockResolvedValue([]);
      dbApi.getServerRelationships.mockResolvedValue(relationships);

      const result = await serverService.getServerWithRelationships(1);

      expect(result.server.id).toBe(1);
      expect(result.relationships).toEqual(relationships);
    });

    it('should return null server for non-existent', async () => {
      queryOne.mockResolvedValue(null);

      const result = await serverService.getServerWithRelationships(999);

      expect(result.server).toBeNull();
      expect(result.relationships).toEqual([]);
    });
  });

  describe('resolvePlaylistBaseUrl', () => {
    it('should use asset stream server if available', async () => {
      queryOne.mockResolvedValueOnce({ id: 5, enabled: 1, public_host: 'asset-server.com', meta_json: '{}' });
      query.mockResolvedValue([]);

      const result = await serverService.resolvePlaylistBaseUrl({ force_server_id: null }, 'http://fallback.com', 5);

      expect(result).toContain('asset-server.com');
    });

    it('should fall back through server selection chain', async () => {
      queryOne.mockResolvedValueOnce(null);
      query.mockResolvedValue([]);

      const result = await serverService.resolvePlaylistBaseUrl({}, 'http://fallback.com');

      expect(result).toBe('http://fallback.com');
    });
  });

  describe('resolvePublicStreamOrigin', () => {
    it('should call publicStreamOrigin with req', async () => {
      const req = { protocol: 'http', get: jest.fn((name) => (name === 'host' ? 'localhost' : 'http')) };
      publicStreamOrigin.publicStreamOrigin.mockReturnValue('http://resolved.com');

      const result = await serverService.resolvePublicStreamOrigin(req, {});

      expect(publicStreamOrigin.publicStreamOrigin).toHaveBeenCalled();
      expect(result).toBe('http://resolved.com');
    });
  });

  describe('STALE_HEARTBEAT_THRESHOLD_MS', () => {
    it('should be 5 minutes', () => {
      expect(serverService.STALE_HEARTBEAT_THRESHOLD_MS).toBe(5 * 60 * 1000);
    });
  });
});
