'use strict';

const path = require('path');
const fs = require('fs');

describe('Phase 7 — Origin-Proxy Delivery Chain', () => {
  describe('lib/db — proxy relationship helpers', () => {
    let dbApi;

    beforeEach(() => {
      jest.resetModules();
      // Use a minimal mock for lib/mariadb to avoid real DB connections
      jest.doMock('../../../lib/mariadb', () => ({
        query: jest.fn(),
        getPool: jest.fn(() => null),
      }));
      dbApi = require('../../../lib/db');
    });

    afterEach(() => {
      jest.resetModules();
    });

    it('exports getProxyRelationships', () => {
      expect(typeof dbApi.getProxyRelationships).toBe('function');
    });

    it('exports getOriginServersForProxy', () => {
      expect(typeof dbApi.getOriginServersForProxy).toBe('function');
    });

    it('getProxyRelationships returns an async function', () => {
      expect(dbApi.getProxyRelationships.constructor.name).toBe('AsyncFunction');
    });

    it('getOriginServersForProxy returns an async function', () => {
      expect(dbApi.getOriginServersForProxy.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('services/serverService — selectProxyServer and buildProxyUpstreamConfig', () => {
    let serverService;

    beforeEach(() => {
      jest.resetModules();
      jest.doMock('../../../lib/db', () => ({
        getProxyRelationships: jest.fn(),
        getOriginServersForProxy: jest.fn(),
      }));
      jest.doMock('../../../lib/mariadb', () => ({
        query: jest.fn(),
        queryOne: jest.fn(),
        getPool: jest.fn(() => null),
      }));
      jest.doMock('../../../lib/redis', () => ({
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        keys: jest.fn(() => []),
      }));
      serverService = require('../../../services/serverService');
    });

    afterEach(() => {
      jest.resetModules();
    });

    it('exports selectProxyServer', () => {
      expect(typeof serverService.selectProxyServer).toBe('function');
    });

    it('exports buildProxyUpstreamConfig', () => {
      expect(typeof serverService.buildProxyUpstreamConfig).toBe('function');
    });

    it('buildProxyUpstreamConfig is a function type', () => {
      expect(serverService.buildProxyUpstreamConfig.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('agent/index.js — sync_proxy_upstream command', () => {
    it('agent source contains handleSyncProxyUpstream', () => {
      const agentPath = path.resolve(__dirname, '../../../agent/index.js');
      const agentSrc = fs.readFileSync(agentPath, 'utf8');
      expect(agentSrc).toContain('handleSyncProxyUpstream');
    });

    it('agent source contains sync_proxy_upstream case in executeCommand', () => {
      const agentPath = path.resolve(__dirname, '../../../agent/index.js');
      const agentSrc = fs.readFileSync(agentPath, 'utf8');
      expect(agentSrc).toContain('sync_proxy_upstream');
    });

    it('agent source contains upstream config file write logic', () => {
      const agentPath = path.resolve(__dirname, '../../../agent/index.js');
      const agentSrc = fs.readFileSync(agentPath, 'utf8');
      expect(agentSrc).toContain('iptv_proxy_upstream.conf');
      expect(agentSrc).toContain('nginx -t');
    });

    it('agent source no longer exposes /stream/live/ byte-serving in current TARGET', () => {
      const agentPath = path.resolve(__dirname, '../../../agent/index.js');
      const agentSrc = fs.readFileSync(agentPath, 'utf8');
      expect(agentSrc).not.toContain('/stream/live/');
    });
  });

  describe('routes/stream.js — proxy delivery wiring', () => {
    it('stream.js source de-scopes live proxy delivery in handleLive', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).not.toContain('selectProxyServer(effectiveSelected.serverId)');
    });

    it('stream.js source contains buildProxyRedirectUrl function', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).toContain('buildProxyRedirectUrl');
    });

    it('stream.js source passes null proxySelected to live tracking', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).toContain('trackLiveConnection(line, parsed.id, ext, req, plan.servingSelected, null)');
    });

    it('trackLiveConnection still keeps proxyServerId field but live path passes null', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).toContain('proxyServerId: proxySelected ? proxySelected.serverId : null');
    });

    it('stream.js source handles proxy redirect in movie route', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).toContain('trackMovieConnection(line, movieId, parsed.ext || row.container_extension || \'mp4\', req, selected, proxyNormalized)');
    });

    it('stream.js source handles proxy redirect in episode route', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      expect(streamSrc).toContain('trackEpisodeConnection(line, episodeId, container, req, selected, proxyNormalized)');
    });

    it('stream.js source passes proxyServerId in trackMovieConnection', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      // Should have proxyServerId set in the openRuntimeSession call inside trackMovieConnection
      const trackMovieIdx = streamSrc.indexOf('async function trackMovieConnection');
      const nextFnIdx = streamSrc.indexOf('async function trackEpisodeConnection');
      const trackMovieFn = streamSrc.slice(trackMovieIdx, nextFnIdx);
      expect(trackMovieFn).toContain('proxyServerId: proxySelected ? proxySelected.serverId : null');
    });

    it('stream.js source passes proxyServerId in trackEpisodeConnection', () => {
      const streamPath = path.resolve(__dirname, '../../../routes/stream.js');
      const streamSrc = fs.readFileSync(streamPath, 'utf8');
      const trackEpIdx = streamSrc.indexOf('async function trackEpisodeConnection');
      const afterFn = streamSrc.slice(trackEpIdx);
      const endIdx = afterFn.indexOf('router.get(\'/movie/');
      const trackEpFn = afterFn.slice(0, endIdx);
      expect(trackEpFn).toContain('proxyServerId: proxySelected ? proxySelected.serverId : null');
    });
  });

  describe('services/provisionService.js — legacy /stream/live/ nginx location', () => {
    it('provisionService source may still contain legacy /stream/live/ groundwork', () => {
      const provPath = path.resolve(__dirname, '../../../services/provisionService.js');
      const provSrc = fs.readFileSync(provPath, 'utf8');
      expect(provSrc).toContain('/stream/live/');
    });
  });
});
