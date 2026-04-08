'use strict';

const { EventEmitter } = require('events');

const mockTreeKill = jest.fn((pid, sig, cb) => { if (cb) cb(null); });

const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(() => {
    const ws = new EventEmitter();
    ws.writable = true;
    ws.writableEnded = false;
    ws.destroyed = false;
    ws.write = jest.fn(() => true);
    ws.end = jest.fn(() => { ws.writableEnded = true; });
    ws.on = jest.fn();
    return ws;
  }),
  statSync: jest.fn(() => ({ size: 4096 })),
};

const mockPath = {
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/')),
};

const mockEventBus = { emit: jest.fn() };
const mockHlsIdle = { touch: jest.fn(), get: jest.fn(), delete: jest.fn() };
const mockOnDemandLive = { registerStartChannel: jest.fn() };

function makeChannel(overrides = {}) {
  return {
    id: 'ch_test_1', userId: 1, name: 'Test Channel', status: 'stopped',
    error: null, startedAt: null, outputMode: 'copy', streamMode: 'live',
    outputFormat: 'hls', sourceQueue: ['http://example.com/stream.mpd'],
    mpdUrl: 'http://example.com/stream.mpd', sourceIndex: 0,
    maxRetries: 0, retryDelaySec: 5, streamSlot: 'a', ...overrides,
  };
}

// Only the FIRST kill() call emits 'close'; subsequent calls are no-ops.
// This simulates stopChannel killing the old process, while new processes
// (from startChannel) don't emit close on kill.
let _killedPid = null;
function makeFakeFfmpeg() {
  const proc = new EventEmitter();
  proc.pid = 12345 + Math.random();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn((sig) => {
    if (_killedPid === null) {
      _killedPid = proc.pid;
      proc.emit('close', sig === 'SIGTERM' ? 0 : 1);
    }
  });
  return proc;
}

function mockBuildFfmpegArgs(channel) {
  return { args: ['ffmpeg', '-i', channel.mpdUrl, '-c', 'copy', '-f', 'hls', 'index.m3u8'], playlist: 'index.m3u8', hlsUrl: '/streams/' + channel.id + '/index.m3u8' };
}

function mockActiveSourceUrl(channel) {
  const sources = channel.sourceQueue || [channel.mpdUrl];
  const idx = Number.isFinite(channel.sourceIndex) ? parseInt(channel.sourceIndex, 10) : 0;
  return sources[Math.max(0, Math.min(sources.length - 1, idx))] || '';
}

function createTestLifecycle(overrides = {}) {
  jest.resetModules();
  const state = {
    channels: new Map(), processes: new Map(), runControllers: new Map(),
    shadowProcesses: new Map(), tsBroadcasts: new Map(),
  };
  const {
    MAX_FFMPEG_PROCESSES = 10, buildFfmpegArgs = mockBuildFfmpegArgs,
    activeSourceUrl = mockActiveSourceUrl, isMovieChannel = () => false,
    isInternalChannel = () => false, resolveEffectiveInputType = () => 'mpd',
    channelSources = (ch) => ch.sourceQueue || [ch.mpdUrl],
    sourceTitleFromUrl = (url) => { try { return new URL(url).pathname.split('/').pop() || 'Unknown'; } catch { return 'Unknown'; } },
    needsTranscode = () => false, buildNginxDualCopyFfmpegArgs = mockBuildFfmpegArgs,
    parseMpdInfo = async () => ({}), parseHlsInfo = async () => ({}),
    preDetectSource = async () => {}, mergeChannelOptions = (a) => a,
    normalizeSourceQueue = (q) => Array.isArray(q) ? q : [],
    normalizeHex32 = (s) => s, mpegtsMultiConflict = () => false,
    appendPrebufferChunk = () => {}, clearPrebuffer = () => {},
    waitForPrebuffer = async () => true, snapshotPrebuffer = () => null,
    applyStabilityFix = () => {}, fetchTextWithTimeout = async () => '',
    channelRuntimeInfo = () => ({}),
    streamingSettings = { isPrebufferEnabled: () => false, getEffectivePrebufferMaxBytes: () => 1000 },
    WS_EVENTS = { STREAM_RUNNING: 'stream:running' },
    PORT = 8000, STREAMING_MODE = 'node', IPTV_DISK_ROOT = '/tmp/ipTV',
    rootDir = '/tmp', treeKill = mockTreeKill, spawn = jest.fn(),
    PassThrough = require('stream').PassThrough,
    dbApi = { updateChannelRow: jest.fn().mockResolvedValue(true) },
    eventBus = mockEventBus, hlsIdle = mockHlsIdle, onDemandLive = mockOnDemandLive,
  } = overrides;

  function getChannel(id) { return state.channels.get(id); }
  function setChannel(id, ch) { state.channels.set(id, ch); }
  function deleteChannel(id) { state.channels.delete(id); }
  function hasChannel(id) { return state.channels.has(id); }
  function getProcess(id) { return state.processes.get(id); }
  function setProcess(id, p) { state.processes.set(id, p); }
  function deleteProcess(id) { state.processes.delete(id); }
  function hasProcess(id) { return state.processes.has(id); }
  function getProcessCount() { return state.processes.size; }
  function getRunController(id) { return state.runControllers.get(id); }
  function setRunController(id, c) { state.runControllers.set(id, c); }
  function deleteRunController(id) { state.runControllers.delete(id); }
  function hasRunController(id) { return state.runControllers.has(id); }
  function getShadowProcess(id) { return state.shadowProcesses.get(id); }
  function setShadowProcess(id, p) { state.shadowProcesses.set(id, p); }
  function deleteShadowProcess(id) { state.shadowProcesses.delete(id); }
  function hasShadowProcess(id) { return state.shadowProcesses.has(id); }
  function getTsBroadcast(id) { return state.tsBroadcasts.get(id); }
  function setTsBroadcast(id, b) { state.tsBroadcasts.set(id, b); }
  function deleteTsBroadcast(id) { state.tsBroadcasts.delete(id); }
  function hasTsBroadcast(id) { return state.tsBroadcasts.has(id); }

  const mockSetProcess = jest.fn((id, p) => { state.processes.set(id, p); });
  const mockSetShadowProcess = jest.fn((id, p) => { state.shadowProcesses.set(id, p); });
  const mockSetTsBroadcast = jest.fn((id, b) => { state.tsBroadcasts.set(id, b); });

  const realPath = require('path');
  const createFfmpegLifecycle = require(realPath.resolve(__dirname, '../../services/ffmpegLifecycleService'));

  const ffmpegLifecycle = createFfmpegLifecycle({
    dbApi, hlsIdle, onDemandLive, eventBus, WS_EVENTS,
    path: mockPath, fs: mockFs, treeKill, spawn, PassThrough,
    PORT, STREAMING_MODE, IPTV_DISK_ROOT, MAX_FFMPEG_PROCESSES,
    streamingSettings, buildFfmpegArgs, buildNginxDualCopyFfmpegArgs,
    needsTranscode, activeSourceUrl, isMovieChannel, isInternalChannel,
    resolveEffectiveInputType, channelSources, sourceTitleFromUrl,
    channelRuntimeInfo, fetchTextWithTimeout, parseMpdInfo, parseHlsInfo,
    preDetectSource, mergeChannelOptions, normalizeSourceQueue,
    normalizeHex32, mpegtsMultiConflict, appendPrebufferChunk,
    clearPrebuffer, waitForPrebuffer, snapshotPrebuffer, applyStabilityFix,
    rootDir, getChannel, setChannel, deleteChannel, hasChannel,
    getProcess, setProcess: mockSetProcess, deleteProcess, hasProcess,
    getProcessCount,
    getRunController, setRunController, deleteRunController, hasRunController,
    getShadowProcess, setShadowProcess: mockSetShadowProcess,
    deleteShadowProcess, hasShadowProcess, getTsBroadcast,
    setTsBroadcast: mockSetTsBroadcast, deleteTsBroadcast, hasTsBroadcast,
  });

  return { ffmpegLifecycle, state, spawn, mockFs, mockTreeKill, dbApi, mockSetProcess, mockSetShadowProcess };
}

describe('FFmpeg Lifecycle Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _killedPid = null;
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 4096 });
  });

  describe('startChannel', () => {
    it('should set channel status to running and add process to state', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_start_1' });
      state.channels.set('ch_start_1', channel);
      let capturedFfmpeg;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        capturedFfmpeg = proc;
        setTimeout(() => proc.stderr.emit('data', Buffer.from('Output #0')), 0);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const startPromise = ffmpegLifecycle.startChannel('ch_start_1', channel);
      jest.advanceTimersByTime(100);
      await startPromise;
      expect(state.processes.has('ch_start_1')).toBe(true);
      expect(channel.status).toBe('running');
      expect(mockEventBus.emit).toHaveBeenCalledWith('stream:running', { channelId: 'ch_start_1' });
      jest.useRealTimers();
    });

    it('should throw when MAX_FFMPEG_PROCESSES is at capacity', async () => {
      const { ffmpegLifecycle, state } = createTestLifecycle({ MAX_FFMPEG_PROCESSES: 1 });
      state.processes.set('ch_cap', makeFakeFfmpeg());
      const channel = makeChannel({ id: 'ch_cap2' });
      state.channels.set('ch_cap2', channel);
      await expect(ffmpegLifecycle.startChannel('ch_cap2', channel)).rejects.toThrow('Server at capacity');
    });

    it('should start channel with movieLoop mode and multiple sources', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle({ isMovieChannel: () => true });
      const channel = makeChannel({
        id: 'ch_movie', channelClass: 'movie', sourceQueue: ['http://ex.com/m1.mp4', 'http://ex.com/m2.mp4'],
        sourceIndex: 0, maxRetries: 0, movieLoop: true, streamMode: 'vod',
      });
      state.channels.set('ch_movie', channel);
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => { proc.emit('close', 0); }, 10);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const p = ffmpegLifecycle.startChannel('ch_movie', channel);
      jest.advanceTimersByTime(200);
      await p;
      expect(channel.sourceIndex).toBe(1);
      expect(channel.status).toBe('running');
      jest.useRealTimers();
    });
  });

  describe('stopChannel', () => {
    it('should remove process from state and clear timers', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_stop', status: 'running' });
      state.channels.set('ch_stop', channel);
      const fakeProc = makeFakeFfmpeg();
      state.processes.set('ch_stop', fakeProc);
      const controller = { cancelled: false, timers: new Set() };
      const t1 = setTimeout(() => {}, 9999);
      const t2 = setTimeout(() => {}, 9999);
      controller.timers.add(t1); controller.timers.add(t2);
      state.runControllers.set('ch_stop', controller);
      ffmpegLifecycle.stopChannel('ch_stop');
      jest.advanceTimersByTime(5100);
      expect(state.processes.has('ch_stop')).toBe(false);
      expect(state.runControllers.has('ch_stop')).toBe(false);
      expect(channel.status).toBe('stopped');
      expect(channel.error).toBe(null);
      jest.useRealTimers();
    });

    it('should kill shadow process if present', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_shadow', status: 'running' });
      state.channels.set('ch_shadow', channel);
      state.processes.set('ch_shadow', makeFakeFfmpeg());
      state.shadowProcesses.set('ch_shadow', makeFakeFfmpeg());
      ffmpegLifecycle.stopChannel('ch_shadow');
      jest.advanceTimersByTime(5100);
      expect(state.processes.has('ch_shadow')).toBe(false);
      expect(state.shadowProcesses.has('ch_shadow')).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('restartChannel', () => {
    it('should stop then start the channel', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_restart', status: 'running' });
      state.channels.set('ch_restart', channel);
      state.processes.set('ch_restart', makeFakeFfmpeg());
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      ffmpegLifecycle.restartChannel('ch_restart');
      jest.advanceTimersByTime(100);
      expect(state.processes.has('ch_restart')).toBe(true);
      if (captured) captured.emit('close', 0);
      jest.useRealTimers();
    });
  });

  describe('safeRestartChannel', () => {
    it('should stop, wait 1.5s, then start', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_saferestart', status: 'running' });
      state.channels.set('ch_saferestart', channel);
      state.processes.set('ch_saferestart', makeFakeFfmpeg());
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => proc.stderr.emit('data', Buffer.from('Output #0')), 0);
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const restartPromise = ffmpegLifecycle.safeRestartChannel('ch_saferestart', channel);
      await jest.advanceTimersByTimeAsync(2500);
      await restartPromise;
      expect(captured).toBeDefined();
      expect(channel.status).toBe('running');
      if (captured) captured.emit('close', 0);
      jest.useRealTimers();
    });
  });

  describe('activeStreamSlot', () => {
    it('should return "b" when streamSlot is "b"', () => {
      const { ffmpegLifecycle } = createTestLifecycle();
      expect(ffmpegLifecycle.activeStreamSlot({ streamSlot: 'b' })).toBe('b');
    });
    it('should return "a" for other values', () => {
      const { ffmpegLifecycle } = createTestLifecycle();
      expect(ffmpegLifecycle.activeStreamSlot({ streamSlot: 'a' })).toBe('a');
      expect(ffmpegLifecycle.activeStreamSlot({})).toBe('a');
      expect(ffmpegLifecycle.activeStreamSlot(null)).toBe('a');
    });
  });
});
