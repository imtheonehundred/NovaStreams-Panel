'use strict';

const {
  info: logInfo,
  warn: logWarn,
  error: logError,
} = require('../../services/logger');

async function loadChannelsFromDb({ dbApi, channels }) {
  const rows = await dbApi.listAllChannelRows();
  for (const row of rows) {
    let channel;
    try {
      channel = JSON.parse(row.json_data);
    } catch (error) {
      logError('[BOOT] Skipping malformed channel row', {
        channelId: row.id,
        error: error.message,
      });
      continue;
    }
    delete channel.tsDelivery;
    channel.userId = row.user_id;
    channel.id = row.id;
    channel.version = Number(row.version) || 1;
    channel.status = 'stopped';
    channel.hlsUrl = null;
    channel.error = null;
    channel.startedAt = null;
    channel.stabilityScore = Number.isFinite(Number(channel.stabilityScore))
      ? Number(channel.stabilityScore)
      : 100;
    channel.stabilityStatus = channel.stabilityStatus || 'Stable';
    channel.stabilityLastChecked = channel.stabilityLastChecked || null;
    channel.stabilityMeta = channel.stabilityMeta || {};
    channel.autoFixEnabled = !!channel.autoFixEnabled;
    channel.stabilityProfile =
      channel.stabilityProfile === 'lag_fix' ? 'lag_fix' : 'off';
    channel.streamSlot = channel.streamSlot === 'b' ? 'b' : 'a';
    channel.qoeScore = Number.isFinite(Number(channel.qoeScore))
      ? Number(channel.qoeScore)
      : 100;
    channel.qoeLastChecked = channel.qoeLastChecked || null;
    channel.qoeAvgStartupMs = Number.isFinite(Number(channel.qoeAvgStartupMs))
      ? Number(channel.qoeAvgStartupMs)
      : 0;
    channel.qoeAvgBufferRatio = Number.isFinite(
      Number(channel.qoeAvgBufferRatio)
    )
      ? Number(channel.qoeAvgBufferRatio)
      : 0;
    channel.qoeAvgLatencyMs = Number.isFinite(Number(channel.qoeAvgLatencyMs))
      ? Number(channel.qoeAvgLatencyMs)
      : 0;
    channel.finalStabilityScore = Number.isFinite(
      Number(channel.finalStabilityScore)
    )
      ? Number(channel.finalStabilityScore)
      : channel.stabilityScore;
    channels.set(row.id, channel);
  }
}

async function initializeDbBoot({
  mariadb,
  redis,
  seedDefaults,
  streamingSettings,
  dbApi,
  channels,
  ffmpegLifecycle,
  isMovieChannel,
  isInternalChannel,
  getMaxFfmpegProcesses,
  processes,
}) {
  const dbOk = await mariadb.testConnection();
  if (!dbOk) {
    logError('[BOOT] MariaDB connection failed – check .env / DB_* settings');
    process.exit(1);
  }
  logInfo('[BOOT] MariaDB connected');

  const redisOk = await redis.connect();
  if (!redisOk) {
    logError('[BOOT] Redis connection failed – session store is unavailable');
    process.exit(1);
  }
  logInfo('[BOOT] Redis connected');

  await seedDefaults();
  await streamingSettings.refreshStreamingSettings(dbApi);
  streamingSettings.startPeriodicRefresh(dbApi, 45000);
  await loadChannelsFromDb({ dbApi, channels });

  let preWarmBootCount = 0;
  for (const [id, channel] of channels.entries()) {
    if (
      !streamingSettings.channelPreWarmEffective(channel) ||
      channel.on_demand
    ) {
      continue;
    }
    if (channel.userId === null || channel.userId === undefined) continue;
    if (isMovieChannel(channel) || isInternalChannel(channel)) continue;
    if (channel.status === 'running') continue;
    try {
      await ffmpegLifecycle.startChannel(id, channel);
      preWarmBootCount++;
      if (
        getMaxFfmpegProcesses() > 0 &&
        processes.size >= getMaxFfmpegProcesses()
      ) {
        logWarn(
          '[BOOT] preWarm: MAX_FFMPEG_PROCESSES reached; remaining preWarm channels not started'
        );
        break;
      }
    } catch (error) {
      logError('[BOOT] preWarm start failed', {
        channelId: id,
        error: error.message,
      });
    }
  }
  if (preWarmBootCount > 0) {
    logInfo(`[BOOT] preWarm: started ${preWarmBootCount} channel(s) at boot`);
  }
}

module.exports = {
  loadChannelsFromDb,
  initializeDbBoot,
};
