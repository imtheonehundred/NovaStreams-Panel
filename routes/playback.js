'use strict';

const express = require('express');
const streamManager = require('../services/streamManager');
const onDemandLive = require('../lib/on-demand-live');
const viewerService = require('../services/viewerService');
const sessionService = require('../services/sessionService');
const userService = require('../services/userService');
const securityService = require('../services/securityService');
const { channels } = require('../lib/state');
const serverService = require('../services/serverService');

const router = express.Router();

const STREAMING_MODE = (process.env.STREAMING_MODE || 'node').toLowerCase();

function isChannelRunning(channelId, ch) {
  const status = streamManager.getChannelStatus(channelId);
  const proc = status.activeProcess === true;
  const st = String((ch && ch.status) || '').toLowerCase();
  return proc || st === 'running' || st === 'starting';
}

async function authUser(req, res) {
  const { username, password } = req.body || req.query || {};
  if (!username || !password) { res.status(401).json({ error: 'username and password required' }); return null; }
  const user = await userService.verifyCredentials(String(username), String(password));
  if (!user) { res.status(401).json({ error: 'invalid credentials' }); return null; }
  const allowed = userService.isUserAllowed(user);
  if (!allowed.ok) { res.status(403).json({ error: allowed.reason }); return null; }
  return user;
}

router.post('/play/:channelId/start', async (req, res) => {
  const user = await authUser(req, res);
  if (!user) return;
  const { channelId } = req.params;
  let ch = channels.get(channelId);
  if (!ch) return res.status(404).json({ error: 'channel not found' });

  let running = isChannelRunning(channelId, ch);
  if (!running) {
    try {
      await onDemandLive.ensurePlaybackChannelReady(channelId);
    } catch (e) {
      return res.status(503).json({ error: e.message || 'Stream not available' });
    }
    ch = channels.get(channelId) || ch;
    running = isChannelRunning(channelId, ch);
  }
  if (!running) {
    return res.status(503).json({ error: 'Stream not available' });
  }

  const cur = channels.get(channelId) || ch;
  const rawTtl =
    STREAMING_MODE === 'nginx' && cur.nginxStreaming
      ? parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '45', 10) || 45
      : 3600;
  const ttlSec =
    STREAMING_MODE === 'nginx' && cur.nginxStreaming ? Math.min(60, Math.max(30, rawTtl)) : 3600;
  const tokenData = sessionService.issueToken(user, channelId, req.ip, ttlSec);
  const expires = tokenData.expiresAt;
  const sig = await securityService.signUrl(tokenData.token, expires, channelId);
  viewerService.increment(channelId);

  const qs = `token=${tokenData.token}&expires=${expires}&sig=${sig}`;
  const rends = Array.isArray(cur.renditions) && cur.renditions.length ? cur.renditions : ['1080p'];
  const multi = cur.renditionMode === 'multi' && rends.length > 1;
  const playlist = multi ? 'master.m3u8' : 'index.m3u8';
  const base = await serverService.resolvePublicStreamOrigin(req, null);
  let playbackUrl;
  if (STREAMING_MODE === 'nginx' && cur.nginxStreaming) {
    playbackUrl =
      cur.outputFormat === 'hls'
        ? `${base}/hls/${channelId}/index.m3u8?${qs}`
        : `${base}/live/${channelId}.ts?${qs}`;
  } else {
    playbackUrl =
      cur.outputFormat === 'hls'
        ? `${base}/streams/${channelId}/${playlist}?${qs}`
        : `${base}/streams/${channelId}/stream.ts?${qs}`;
  }

  res.json({ ok: true, channelId, token: tokenData.token, expiresAt: tokenData.expiresAt, url: playbackUrl, viewers: viewerService.getCount(channelId) });
});

router.post('/play/:channelId/stop', (req, res) => {
  const { channelId } = req.params;
  const { token } = req.body || req.query || {};
  if (token) sessionService.endSession(String(token));
  res.json({ ok: true, viewers: viewerService.decrement(channelId) });
});

router.get('/play/active', (_req, res) => { res.json({ viewers: viewerService.getAll() }); });

module.exports = router;
