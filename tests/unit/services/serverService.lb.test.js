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
  getEffectiveEpisodeServerId: jest.fn(),
  createPlacement: jest.fn(),
  getServerRelationships: jest.fn(),
}));

const mariadb = require('../../../lib/mariadb');
const dbApi = require('../../../lib/db');
const serverService = require('../../../services/serverService');

describe('serverService LB selector', () => {
  let serverRows;
  let heartbeats;
  let fallbackServer;
  let movieServerId;
  let liveJson;
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    serverRows = {};
    heartbeats = {};
    fallbackServer = null;
    movieServerId = 0;
    liveJson = null;

    mariadb.query.mockImplementation(async (sql) => {
      if (sql.includes('streaming_server_domains')) return [];
      return [];
    });

    mariadb.queryOne.mockImplementation(async (sql, params = []) => {
      if (sql.includes('SELECT * FROM streaming_servers WHERE id = ?')) return serverRows[params[0]] || null;
      if (sql.includes('SELECT last_heartbeat_at FROM streaming_servers WHERE id = ?')) return heartbeats[params[0]] || null;
      if (sql.includes('SELECT stream_server_id FROM movies WHERE id = ?')) return movieServerId ? { stream_server_id: movieServerId } : null;
      if (sql.includes('SELECT json_data FROM channels WHERE id = ?')) return liveJson ? { json_data: JSON.stringify(liveJson) } : null;
      if (sql.includes("SELECT * FROM streaming_servers WHERE enabled = 1 ORDER BY FIELD(role,'lb','main','edge')")) return fallbackServer;
      return null;
    });

    dbApi.getSetting.mockImplementation(async (key) => {
      if (key === 'default_stream_server_id') return '0';
      if (key === 'domain_name') return '';
      if (key === 'server_port') return '80';
      if (key === 'server_protocol') return 'http';
      return '0';
    });
    dbApi.getEffectiveEpisodeServerId.mockResolvedValue(0);
    dbApi.createPlacement.mockResolvedValue(undefined);
    dbApi.getServerRelationships.mockResolvedValue([]);
  });

  afterEach(() => {
    if (warnSpy) warnSpy.mockRestore();
  });

  it('prefers line force_server_id over content assignment', async () => {
    serverRows[9] = { id: 9, enabled: 1, role: 'lb', public_host: 'lb.example', meta_json: '{}' };
    heartbeats[9] = { last_heartbeat_at: new Date().toISOString() };
    movieServerId = 4;

    const selected = await serverService.selectServer({
      assetType: 'movie',
      assetId: 55,
      line: { id: 1, force_server_id: 9 },
    });

    expect(selected.selectedServerId).toBe(9);
    expect(selected.isOverride).toBe(true);
    expect(selected.selectionSource).toBe('line_override');
    expect(selected.publicBaseUrl).toContain('lb.example');
    expect(dbApi.createPlacement).toHaveBeenCalledWith({ streamType: 'movie', streamId: '55', serverId: 9 });
  });

  it('uses effective episode assignment when no line override exists', async () => {
    serverRows[7] = { id: 7, enabled: 1, role: 'edge', public_host: 'edge.example', meta_json: '{}' };
    heartbeats[7] = { last_heartbeat_at: new Date().toISOString() };
    dbApi.getEffectiveEpisodeServerId.mockResolvedValue(7);

    const selected = await serverService.selectServer({ assetType: 'episode', assetId: 123 });

    expect(selected.selectedServerId).toBe(7);
    expect(selected.selectionSource).toBe('episode_assignment');
    expect(selected.assetType).toBe('episode');
    expect(dbApi.createPlacement).toHaveBeenCalledWith({ streamType: 'episode', streamId: '123', serverId: 7 });
  });

  it('falls back to the first enabled server when no assignment exists', async () => {
    fallbackServer = { id: 3, enabled: 1, role: 'lb', public_host: 'fallback.example', meta_json: '{}' };
    heartbeats[3] = { last_heartbeat_at: new Date().toISOString() };

    const selected = await serverService.selectServer({ assetType: 'live', assetId: 'abc123' });

    expect(selected.selectedServerId).toBe(3);
    expect(selected.selectionSource).toBe('enabled_fallback');
    expect(selected.publicHost).toBe('fallback.example');
    expect(dbApi.createPlacement).toHaveBeenCalledWith({ streamType: 'live', streamId: 'abc123', serverId: 3 });
  });

  it('reports stale heartbeat state without disabling the server', async () => {
    const staleAt = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
    heartbeats[11] = { last_heartbeat_at: staleAt };

    const health = await serverService.getServerHealthStatus(11);

    expect(health.fresh).toBe(false);
    expect(health.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(health.staleMs).toBeGreaterThan(5 * 60 * 1000);
  });

  it('adds assigned_server_stale warning when using stale server', async () => {
    const staleAt = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
    serverRows[5] = { id: 5, enabled: 1, role: 'lb', public_host: 'stale.example', meta_json: '{}' };
    heartbeats[5] = { last_heartbeat_at: staleAt };
    dbApi.getEffectiveEpisodeServerId.mockResolvedValue(5);

    const selected = await serverService.selectServer({ assetType: 'episode', assetId: 99 });

    expect(selected.selectedServerId).toBe(5);
    expect(selected.warnings).toContain('assigned_server_stale');
    expect(selected.heartbeat.fresh).toBe(false);
  });

  it('returns an explicitly assigned disabled server with warning', async () => {
    liveJson = { stream_server_id: 8 };
    serverRows[8] = { id: 8, enabled: 0, role: 'edge', public_host: 'disabled.example', meta_json: '{}' };
    heartbeats[8] = { last_heartbeat_at: new Date().toISOString() };

    const selected = await serverService.selectServer({ assetType: 'live', assetId: 10 });

    expect(selected.selectedServerId).toBe(8);
    expect(selected.selectionSource).toBe('live_assignment');
    expect(selected.enabled).toBe(false);
    expect(selected.warnings).toContain('assigned_server_disabled');
  });

  it('falls through from invalid line override to the default server', async () => {
    serverRows[2] = { id: 2, enabled: 1, role: 'lb', public_host: 'default.example', meta_json: '{}' };
    heartbeats[2] = { last_heartbeat_at: new Date().toISOString() };
    dbApi.getSetting.mockImplementation(async (key) => {
      if (key === 'default_stream_server_id') return '2';
      if (key === 'domain_name') return '';
      if (key === 'server_port') return '80';
      if (key === 'server_protocol') return 'http';
      return '0';
    });

    const selected = await serverService.selectServer({
      assetType: 'live',
      assetId: 77,
      line: { id: 11, force_server_id: 999 },
    });

    expect(selected.selectedServerId).toBe(2);
    expect(selected.selectionSource).toBe('default_server');
    expect(selected.isOverride).toBe(false);
  });

  it('throws NO_PUBLIC_ORIGIN_AVAILABLE when no server or panel fallback exists', async () => {
    dbApi.getSetting.mockImplementation(async (key) => {
      if (key === 'default_stream_server_id') return '0';
      if (key === 'domain_name') return '';
      if (key === 'server_port') return '80';
      if (key === 'server_protocol') return 'http';
      return '0';
    });

    await expect(serverService.selectServer({ assetType: 'live', assetId: 5 })).rejects.toMatchObject({
      code: 'NO_PUBLIC_ORIGIN_AVAILABLE',
    });
  });
});
