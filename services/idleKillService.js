/**
 * Idle-kill service for on-demand channels.
 * Monitors channels and stops those idle for 60s.
 */
module.exports = function createIdleKillService({ channels, hlsIdle, stopChannel, streamingSettings, STREAMING_MODE, intervalMs = 15000 }) {
  let intervalHandle = null;

  function start() {
    if (intervalHandle) return;
    intervalHandle = setInterval(() => {
      const now = Date.now();
      channels.forEach((ch, id) => {
        if (!ch.on_demand) return;
        if (streamingSettings.channelPreWarmEffective(ch)) return;
        if (ch.status !== 'running') return;
        // Node MPEG-TS fan-out: idle is handled by /streams/.../stream.ts consumer count.
        if (ch.outputFormat === 'mpegts' && !(STREAMING_MODE === 'nginx' && ch.nginxStreaming)) return;
        const lastAccess = hlsIdle.get(id);
        if (lastAccess && (now - lastAccess) > 60000) {
          console.log(`[IDLE-KILL] On-demand channel ${id} idle for 60s, stopping.`);
          hlsIdle.delete(id);
          stopChannel(id);
        }
      });
    }, intervalMs);
    if (intervalHandle.unref) intervalHandle.unref();
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return { start, stop };
};
