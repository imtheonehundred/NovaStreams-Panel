'use strict';

function createStreamingBoot({
  path,
  fs,
  rootDir,
  IPTV_DISK_ROOT,
  STREAMING_MODE,
  createStabilityMonitor,
  channels,
  tsBroadcasts,
  persistChannel,
  dbApi,
  applyStabilityFix,
  restartWithSeamlessIfPossible,
}) {
  let stabilityMonitor = null;

  function ensureDirs() {
    [
      path.join(rootDir, 'watermarks'),
      path.join(rootDir, 'logs'),
      path.join(rootDir, 'streams'),
    ].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    if (STREAMING_MODE === 'nginx') {
      const hlsRoot = path.join(IPTV_DISK_ROOT, 'hls');
      if (!fs.existsSync(hlsRoot)) fs.mkdirSync(hlsRoot, { recursive: true });
    }
  }

  function isMpegtsPipeOutput(channel) {
    return !!(channel && channel.outputFormat === 'mpegts');
  }

  function activeStreamSlot(channel) {
    return channel && channel.streamSlot === 'b' ? 'b' : 'a';
  }

  function streamDirFor(id, slot) {
    return path.join(rootDir, 'streams', id, slot);
  }

  function startStabilityService() {
    if (stabilityMonitor) return stabilityMonitor;
    stabilityMonitor = createStabilityMonitor({
      getChannels: () => [...channels.keys()],
      getChannelById: (id) => channels.get(id),
      streamDirFor: (id) => {
        const channel = channels.get(id);
        return streamDirFor(id, activeStreamSlot(channel));
      },
      isMpegtsPipeOutput,
      tsBroadcasts,
      persistChannel,
      dbApi,
      intervalMs: 5000,
      batchSize: 40,
      onAutoFix: (id, action) => {
        const channel = channels.get(id);
        if (!channel) return;
        if (action === 'degrade') {
          if (
            channel.outputMode === 'transcode' &&
            channel.stabilityProfile === 'lag_fix'
          ) {
            return;
          }
          applyStabilityFix(id, 'degrade', { reason: 'auto' });
        } else if (action === 'recover') {
          if (channel.stabilityProfile !== 'lag_fix') return;
          applyStabilityFix(id, 'recover', { reason: 'auto' });
        }
        if (channel.status === 'running') {
          setTimeout(() => {
            restartWithSeamlessIfPossible(id, channel).catch(() => {});
          }, 250);
        }
      },
    });
    return stabilityMonitor;
  }

  return {
    ensureDirs,
    isMpegtsPipeOutput,
    activeStreamSlot,
    streamDirFor,
    startStabilityService,
  };
}

module.exports = {
  createStreamingBoot,
};
