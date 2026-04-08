/**
 * Stability monitor service wrapping lib/stability-monitor.js.
 * Provides proper lifecycle start/stop methods.
 */
module.exports = function createStabilityMonitorService({ createStabilityMonitor, streamDirFor, activeStreamSlot, isMpegtsPipeOutput, tsBroadcasts, persistChannel, dbApi, applyStabilityFix, restartWithSeamlessIfPossible, intervalMs = 5000, batchSize = 40 }) {
  let monitor = null;

  function start({ getChannels, getChannelById, onAutoFix }) {
    if (monitor) return;
    monitor = createStabilityMonitor({
      getChannels,
      getChannelById,
      streamDirFor: (id) => {
        const ch = getChannelById(id);
        return streamDirFor(id, activeStreamSlot(ch));
      },
      isMpegtsPipeOutput,
      tsBroadcasts,
      persistChannel,
      dbApi,
      intervalMs,
      batchSize,
      onAutoFix,
    });
  }

  function stop() {
    monitor = null;
  }

  return { start, stop };
};
