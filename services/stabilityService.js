'use strict';

const { channels, tsBroadcasts } = require('../lib/state');
const { activeStreamSlot, streamDirFor, seamlessSwitchChannel, persistChannel } = require('./ffmpegLifecycleService');

async function safeRestartChannel(id, channel, startChannelFn, stopChannelFn) {
  stopChannelFn(id);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await startChannelFn(id, channel);
}

function applyStabilityFix(id, action, meta) {
  const channel = channels.get(id);
  if (!channel) return { ok: false, error: 'Channel not found' };

  const reason = meta && meta.reason ? meta.reason : action;
  const isRecover = action === 'recover';

  if (!channel.stabilityPrev) {
    channel.stabilityPrev = {
      outputMode: channel.outputMode,
      x264Preset: channel.x264Preset,
      stabilityProfile: channel.stabilityProfile || 'off',
    };
  }

  if (isRecover) {
    const prev = channel.stabilityPrev || {};
    channel.outputMode = prev.outputMode || channel.outputMode || 'copy';
    channel.x264Preset = prev.x264Preset || channel.x264Preset || 'veryfast';
    channel.stabilityProfile = prev.stabilityProfile || 'off';
    channel.stabilityPrev = null;
  } else {
    channel.outputMode = 'transcode';
    channel.x264Preset = 'ultrafast';
    channel.stabilityProfile = 'lag_fix';
  }

  channel.stabilityAction = reason;
  persistChannel(id);

  return { ok: true, channel };
}

async function restartWithSeamlessIfPossible(id, channel, startChannelFn, stopChannelFn) {
  if (channel.outputFormat === 'hls' && channel.status === 'running') {
    const nextSlot = activeStreamSlot(channel) === 'a' ? 'b' : 'a';
    const ok = await seamlessSwitchChannel(id, channel, nextSlot);
    if (ok) return true;
  }
  await safeRestartChannel(id, channel, startChannelFn, stopChannelFn);
  return false;
}

module.exports = {
  applyStabilityFix,
  restartWithSeamlessIfPossible,
  safeRestartChannel,
};