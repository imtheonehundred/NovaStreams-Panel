'use strict';

const { EventEmitter } = require('events');

const mockTreeKill = jest.fn((pid, sig, cb) => {
  if (cb) cb(null);
});

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
    ws.end = jest.fn(() => {
      ws.writableEnded = true;
    });
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

function makeFakeFfmpeg() {
  const proc = new EventEmitter();
  proc.pid = 12345 + Math.random();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

function makeChannel(overrides = {}) {
  return {
    id: 'ch_test_1',
    userId: 1,
    name: 'Test Channel',
    status: 'stopped',
    error: null,
    startedAt: null,
    outputMode: 'copy',
    streamMode: 'live',
    outputFormat: 'hls',
    channelClass: 'normal',
    sourceQueue: ['http://example.com/stream.mpd'],
    mpdUrl: 'http://example.com/stream.mpd',
    sourceIndex: 0,
    maxRetries: 0,
    retryDelaySec: 5,
    streamSlot: 'a',
    ...overrides,
  };
}

function mockBuildFfmpegArgs(channel) {
  return {
    args: [
      'ffmpeg',
      '-i',
      channel.mpdUrl,
      '-c',
      'copy',
      '-f',
      'hls',
      'index.m3u8',
    ],
    playlist: 'index.m3u8',
    hlsUrl: '/streams/' + channel.id + '/index.m3u8',
  };
}

function mockActiveSourceUrl(channel) {
  const sources = channel.sourceQueue || [channel.mpdUrl];
  const idx = Number.isFinite(channel.sourceIndex)
    ? parseInt(channel.sourceIndex, 10)
    : 0;
  return sources[Math.max(0, Math.min(sources.length - 1, idx))] || '';
}

function createTestLifecycle(overrides = {}) {
  jest.resetModules();
  const state = {
    channels: new Map(),
    processes: new Map(),
    runControllers: new Map(),
    shadowProcesses: new Map(),
    tsBroadcasts: new Map(),
  };
  const mockOnDemandLive = { registerStartChannel: jest.fn() };
  const {
    MAX_FFMPEG_PROCESSES = 10,
    buildFfmpegArgs = mockBuildFfmpegArgs,
    activeSourceUrl = mockActiveSourceUrl,
    isMovieChannel = () => false,
    isInternalChannel = () => false,
    resolveEffectiveInputType = () => 'mpd',
    channelSources = (ch) => ch.sourceQueue || [ch.mpdUrl],
    sourceTitleFromUrl = (url) => {
      try {
        return new URL(url).pathname.split('/').pop() || 'Unknown';
      } catch {
        return 'Unknown';
      }
    },
    needsTranscode = () => false,
    buildNginxDualCopyFfmpegArgs = mockBuildFfmpegArgs,
    parseMpdInfo = async () => ({}),
    parseHlsInfo = async () => ({}),
    preDetectSource = async () => {},
    mergeChannelOptions = (a) => a,
    normalizeSourceQueue = (q) => (Array.isArray(q) ? q : []),
    normalizeHex32 = (s) => s,
    mpegtsMultiConflict = () => false,
    appendPrebufferChunk = () => {},
    clearPrebuffer = () => {},
    waitForPrebuffer = async () => true,
    snapshotPrebuffer = () => null,
    applyStabilityFix = () => {},
    fetchTextWithTimeout = async () => '',
    channelRuntimeInfo = () => ({}),
    streamingSettings = {
      isPrebufferEnabled: () => false,
      getEffectivePrebufferMaxBytes: () => 1000,
    },
    WS_EVENTS = { STREAM_RUNNING: 'stream:running' },
    PORT = 8000,
    STREAMING_MODE = 'node',
    IPTV_DISK_ROOT = '/tmp/ipTV',
    rootDir = '/tmp',
    treeKill = mockTreeKill,
    spawn = jest.fn(),
    PassThrough = require('stream').PassThrough,
    dbApi = { updateChannelRow: jest.fn().mockResolvedValue(true) },
    eventBus = mockEventBus,
    hlsIdle = mockHlsIdle,
    onDemandLive = mockOnDemandLive,
  } = overrides;

  function getChannel(id) {
    return state.channels.get(id);
  }
  function setChannel(id, ch) {
    state.channels.set(id, ch);
  }
  function deleteChannel(id) {
    state.channels.delete(id);
  }
  function hasChannel(id) {
    return state.channels.has(id);
  }
  function getProcess(id) {
    return state.processes.get(id);
  }
  function setProcess(id, p) {
    state.processes.set(id, p);
  }
  function deleteProcess(id) {
    state.processes.delete(id);
  }
  function hasProcess(id) {
    return state.processes.has(id);
  }
  function getProcessCount() {
    return state.processes.size;
  }
  function getRunController(id) {
    return state.runControllers.get(id);
  }
  function setRunController(id, c) {
    state.runControllers.set(id, c);
  }
  function deleteRunController(id) {
    state.runControllers.delete(id);
  }
  function hasRunController(id) {
    return state.runControllers.has(id);
  }
  function getShadowProcess(id) {
    return state.shadowProcesses.get(id);
  }
  function setShadowProcess(id, p) {
    state.shadowProcesses.set(id, p);
  }
  function deleteShadowProcess(id) {
    state.shadowProcesses.delete(id);
  }
  function hasShadowProcess(id) {
    return state.shadowProcesses.has(id);
  }
  function getTsBroadcast(id) {
    return state.tsBroadcasts.get(id);
  }
  function setTsBroadcast(id, b) {
    state.tsBroadcasts.set(id, b);
  }
  function deleteTsBroadcast(id) {
    state.tsBroadcasts.delete(id);
  }
  function hasTsBroadcast(id) {
    return state.tsBroadcasts.has(id);
  }

  const mockSetProcess = jest.fn((id, p) => {
    state.processes.set(id, p);
  });
  const mockSetShadowProcess = jest.fn((id, p) => {
    state.shadowProcesses.set(id, p);
  });
  const mockSetTsBroadcast = jest.fn((id, b) => {
    state.tsBroadcasts.set(id, b);
  });

  const realPath = require('path');
  const createFfmpegLifecycle = require(
    realPath.resolve(__dirname, '../../services/ffmpegLifecycleService')
  );

  const ffmpegLifecycle = createFfmpegLifecycle({
    dbApi,
    hlsIdle,
    onDemandLive,
    eventBus,
    WS_EVENTS,
    path: mockPath,
    fs: mockFs,
    treeKill,
    spawn,
    PassThrough,
    PORT,
    STREAMING_MODE,
    IPTV_DISK_ROOT,
    MAX_FFMPEG_PROCESSES,
    streamingSettings,
    buildFfmpegArgs,
    buildNginxDualCopyFfmpegArgs,
    needsTranscode,
    activeSourceUrl,
    isMovieChannel,
    isInternalChannel,
    resolveEffectiveInputType,
    channelSources,
    sourceTitleFromUrl,
    channelRuntimeInfo,
    fetchTextWithTimeout,
    parseMpdInfo,
    parseHlsInfo,
    preDetectSource,
    mergeChannelOptions,
    normalizeSourceQueue,
    normalizeHex32,
    mpegtsMultiConflict,
    appendPrebufferChunk,
    clearPrebuffer,
    waitForPrebuffer,
    snapshotPrebuffer,
    applyStabilityFix,
    rootDir,
    getChannel,
    setChannel,
    deleteChannel,
    hasChannel,
    getProcess,
    setProcess: mockSetProcess,
    deleteProcess,
    hasProcess,
    getProcessCount,
    getRunController,
    setRunController,
    deleteRunController,
    hasRunController,
    getShadowProcess,
    setShadowProcess: mockSetShadowProcess,
    deleteShadowProcess,
    hasShadowProcess,
    getTsBroadcast,
    setTsBroadcast: mockSetTsBroadcast,
    deleteTsBroadcast,
    hasTsBroadcast,
  });

  return {
    ffmpegLifecycle,
    state,
    spawn,
    mockFs,
    mockTreeKill,
    dbApi,
    mockSetProcess,
    mockSetShadowProcess,
    mockOnDemandLive,
  };
}

describe('Channel Lifecycle - Shadow Channels and Seamless Switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 4096 });
  });

  describe('startShadowChannel', () => {
    it('should start FFmpeg in inactive slot and add to shadowProcesses', async () => {
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_shadow_1', outputFormat: 'hls' });
      state.channels.set('ch_shadow_1', channel);
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => proc.emit('close', 0), 50);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const result = await ffmpegLifecycle.startShadowChannel(
        'ch_shadow_1',
        channel,
        'b'
      );
      expect(result.ready).toBe(true);
      expect(result.ffmpeg).toBeDefined();
      expect(state.shadowProcesses.has('ch_shadow_1')).toBe(true);
    });

    it('should return ready=false when playlist file does not appear', async () => {
      jest.useFakeTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_noready', outputFormat: 'hls' });
      state.channels.set('ch_noready', channel);
      mockFs.existsSync.mockReturnValue(false);
      spawn.mockReturnValue(makeFakeFfmpeg());
      const p = ffmpegLifecycle.startShadowChannel('ch_noready', channel, 'b');
      jest.advanceTimersByTime(13000);
      const result = await p;
      expect(result.ready).toBe(false);
      jest.useRealTimers();
    }, 15000);
  });

  describe('seamlessSwitchChannel', () => {
    it('should swap active process with shadow for HLS channels', async () => {
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({
        id: 'ch_switch',
        outputFormat: 'hls',
        status: 'running',
        streamSlot: 'a',
      });
      state.channels.set('ch_switch', channel);
      const oldProc = makeFakeFfmpeg();
      state.processes.set('ch_switch', oldProc);
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => proc.emit('close', 0), 20);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const ok = await ffmpegLifecycle.seamlessSwitchChannel(
        'ch_switch',
        channel,
        'b'
      );
      expect(ok).toBe(true);
      expect(state.processes.get('ch_switch')).toBe(captured);
      expect(state.shadowProcesses.has('ch_switch')).toBe(false);
      expect(oldProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(channel.streamSlot).toBe('b');
    });

    it('should return false for non-HLS output', async () => {
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({
        id: 'ch_nohls',
        outputFormat: 'mpegts',
        status: 'running',
      });
      state.channels.set('ch_nohls', channel);
      const oldProc = makeFakeFfmpeg();
      state.processes.set('ch_nohls', oldProc);
      const ok = await ffmpegLifecycle.seamlessSwitchChannel(
        'ch_nohls',
        channel,
        'b'
      );
      expect(ok).toBe(false);
      expect(state.processes.get('ch_nohls')).toBe(oldProc);
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('restartWithSeamlessIfPossible', () => {
    it('should prefer seamless switch for running HLS channels', async () => {
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({
        id: 'ch_seamless',
        outputFormat: 'hls',
        status: 'running',
        streamSlot: 'a',
      });
      state.channels.set('ch_seamless', channel);
      const oldProc = makeFakeFfmpeg();
      state.processes.set('ch_seamless', oldProc);
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => proc.emit('close', 0), 20);
        return proc;
      });
      mockFs.existsSync.mockReturnValue(true);
      const ok = await ffmpegLifecycle.restartWithSeamlessIfPossible(
        'ch_seamless',
        channel
      );
      expect(ok).toBe(true);
      expect(state.processes.get('ch_seamless')).toBe(captured);
    });

    it('should fall back to safeRestart when seamless switch fails', async () => {
      jest.useRealTimers();
      const { ffmpegLifecycle, state, spawn } = createTestLifecycle();
      const channel = makeChannel({
        id: 'ch_fallback',
        outputFormat: 'hls',
        status: 'running',
        streamSlot: 'a',
      });
      state.channels.set('ch_fallback', channel);
      const oldProc = makeFakeFfmpeg();
      state.processes.set('ch_fallback', oldProc);
      mockFs.existsSync.mockReturnValue(false);
      let captured;
      spawn.mockImplementation(() => {
        const proc = makeFakeFfmpeg();
        captured = proc;
        setTimeout(() => proc.stderr.emit('data', Buffer.from('Output #0')), 0);
        setTimeout(() => proc.emit('close', 0), 10);
        return proc;
      });
      const ok = await ffmpegLifecycle.restartWithSeamlessIfPossible(
        'ch_fallback',
        channel
      );
      expect(ok).toBe(false);
      expect(mockTreeKill).toHaveBeenCalled();
      expect(state.processes.has('ch_fallback')).toBe(false);
    }, 25000);
  });

  describe('streamDirFor', () => {
    it('should return path with correct slot', () => {
      const { ffmpegLifecycle } = createTestLifecycle();
      const dir = ffmpegLifecycle.streamDirFor('ch_123', 'b');
      expect(dir).toContain('ch_123');
      expect(dir).toContain('b');
    });
  });

  describe('persistChannel', () => {
    it('should call dbApi.updateChannelRow with channel data', async () => {
      const { ffmpegLifecycle, state, dbApi } = createTestLifecycle();
      const channel = makeChannel({ id: 'chpersist', userId: 42 });
      state.channels.set('chpersist', channel);
      await ffmpegLifecycle.persistChannel('chpersist');
      expect(dbApi.updateChannelRow).toHaveBeenCalledWith(
        'chpersist',
        42,
        channel,
        channel.version
      );
    });

    it('should not call dbApi if channel has no userId', async () => {
      const { ffmpegLifecycle, state, dbApi } = createTestLifecycle();
      const channel = makeChannel({ id: 'ch_nouser', userId: null });
      state.channels.set('ch_nouser', channel);
      await ffmpegLifecycle.persistChannel('ch_nouser');
      expect(dbApi.updateChannelRow).not.toHaveBeenCalled();
    });
  });
});

describe('Channel Lifecycle - On-Demand Start', () => {
  it('should register startChannel with onDemandLive', () => {
    const { mockOnDemandLive } = createTestLifecycle();
    expect(mockOnDemandLive.registerStartChannel).toHaveBeenCalled();
  });

  it('should set a function as the registered startChannel callback', () => {
    const { mockOnDemandLive } = createTestLifecycle();
    const registeredFn = mockOnDemandLive.registerStartChannel.mock.calls[0][0];
    expect(typeof registeredFn).toBe('function');
  });
});
