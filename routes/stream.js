'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const lineService = require('../services/lineService');
const dbApi = require('../lib/db');
const securityService = require('../services/securityService');
const streamManager = require('../services/streamManager');
const { channels } = require('../lib/state');
const hlsIdle = require('../lib/hlsIdle');
const serverService = require('../services/serverService');
const onDemandLive = require('../lib/on-demand-live');

const router = express.Router();

const STREAMING_MODE = (process.env.STREAMING_MODE || 'node').toLowerCase();

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || '';
}

async function authLine(username, password, req, res) {
  const auth = await lineService.authenticateLine(username, password);
  if (!auth.line) { res.status(403).send('Forbidden'); return null; }
  if (!auth.ok) {
    if (auth.error_code === 'EXPIRED') {
      const expiredLine = lineService.normalizeLineRow(auth.line);
      const geo = await securityService.checkGeoIp(clientIp(req), expiredLine);
      const media = expiredLine && Number(expiredLine.member_id) > 0
        ? await dbApi.getMatchingResellerExpiryMedia(Number(expiredLine.member_id), 'expired', geo && geo.country ? geo.country : '')
        : null;
      if (media && media.media_url) {
        res.redirect(302, media.media_url);
        return null;
      }
    }
    const msgs = { INVALID: 'Invalid credentials', BANNED: 'Account banned', DISABLED: 'Account disabled', EXPIRED: 'Subscription expired' };
    res.status(403).send(msgs[auth.error_code] || 'Forbidden');
    return null;
  }
  const line = lineService.normalizeLineRow(auth.line);
  if (!lineService.checkIpAllowed(line, clientIp(req))) { res.status(403).send('IP not allowed'); return null; }
  if (!lineService.checkUaAllowed(line, String(req.get('user-agent') || ''))) { res.status(403).send('User-Agent not allowed'); return null; }
  const geo = await securityService.checkGeoIp(clientIp(req), line);
  if (!geo.ok) { res.status(403).send('Geo restriction'); return null; }
  return line;
}

async function maybeRedirectExpiringSoon(req, res, line) {
  if (!line || Number(line.member_id) <= 0) return false;
  const expTs = Number(line.exp_date) || 0;
  const now = Math.floor(Date.now() / 1000);
  if (!expTs || expTs <= now) return false;
  const geo = await securityService.checkGeoIp(clientIp(req), line);
  const media = await dbApi.getMatchingResellerExpiryMedia(Number(line.member_id), 'expiring', geo && geo.country ? geo.country : '');
  if (!media || !media.media_url) return false;
  const warningWindowDays = Math.max(1, Number(media.warning_window_days) || 7);
  if ((expTs - now) > warningWindowDays * 86400) return false;
  const repeatSeconds = Math.max(1, Number(media.repeat_interval_hours) || 6) * 3600;
  const lastShown = Number(line.last_expiration_video) || 0;
  if (lastShown && (now - lastShown) < repeatSeconds) return false;
  await dbApi.touchLineExpirationMedia(line.id, now);
  res.redirect(302, media.media_url);
  return true;
}

async function bouquetAllows(line, streamId, streamType) {
  const ids = lineService.getLineBouquetIds(line);
  if (!ids.length) return true;
  return await lineService.isStreamInBouquet(line, streamId, streamType);
}

function parseStreamFile(file) {
  const m = /^(.+)\.(ts|m3u8|mp4|mkv|avi)$/i.exec(String(file || ''));
  if (!m) return null;
  return { id: m[1], ext: m[2].toLowerCase() };
}

async function buildLiveDeliveryPlan(req, line, channelId, ext, selected, failoverSelected, sessionUuid = '') {
  let ch = channels.get(channelId);
  if (!ch) return { errorStatus: 404, errorText: 'Channel not found' };
  let status = streamManager.getChannelStatus(channelId);
  let running = status.activeProcess === true || ['running', 'starting'].includes(String(ch.status || '').toLowerCase());
  if (ch.on_demand && !running) {
    try {
      await onDemandLive.ensureOnDemandStreamIfNeeded(channelId);
    } catch {
      return { errorStatus: 503, errorText: 'Stream not available' };
    }
    ch = channels.get(channelId);
    status = streamManager.getChannelStatus(channelId);
    running = status.activeProcess === true || ['running', 'starting'].includes(String(ch.status || '').toLowerCase());
  }
  if (!running) return { errorStatus: 503, errorText: 'Stream not available' };

  const wantHls = ext === 'm3u8' || ch.outputFormat === 'hls';
  const container = wantHls ? 'm3u8' : 'ts';
  const rawTtl =
    STREAMING_MODE === 'nginx' && ch.nginxStreaming
      ? parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '45', 10) || 45
      : 3600;
  const ttlSec =
    STREAMING_MODE === 'nginx' && ch.nginxStreaming ? Math.min(60, Math.max(30, rawTtl)) : rawTtl;
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(line.id, channelId, container, ttlSec, { sessionUuid, ip: req.ip });
  const sig = await securityService.signStreamUrl(token, expiresMs, channelId);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();

  const panelOrigin = await serverService.resolvePublicStreamOrigin(req, line);

  let useRemoteUrl = false;
  let remoteSelected = selected;
  let servingSelected = null;
  if (selected && selected.serverId) {
    const ready = await serverService.isRuntimeReady(selected.serverId, channelId);
    if (ready.ready) {
      useRemoteUrl = true;
      servingSelected = selected;
    } else if (failoverSelected && failoverSelected.serverId) {
      const effectiveSelected = {
        serverId: failoverSelected.serverId,
        publicBaseUrl: serverService.buildServerPublicBaseUrl(failoverSelected.server) || '',
        publicHost: failoverSelected.server.public_host || '',
        server: failoverSelected.server,
        health: failoverSelected.health,
        isOverride: false,
        isFailover: true,
      };
      remoteSelected = effectiveSelected;
      useRemoteUrl = true;
      servingSelected = effectiveSelected;
    } else if (running && ch.status === 'running') {
      useRemoteUrl = false;
      remoteSelected = null;
      servingSelected = null;
    } else {
      return { errorStatus: 503, errorText: 'Stream not available' };
    }
  }

  if (ch.on_demand) {
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) hlsIdle.touch(channelId);
    else if (ch.outputFormat === 'hls') hlsIdle.touch(channelId);
  }

  let destination;
  if (useRemoteUrl && remoteSelected && remoteSelected.publicBaseUrl) {
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
      destination = wantHls ? `${remoteSelected.publicBaseUrl}/hls/${channelId}/index.m3u8` : `${remoteSelected.publicBaseUrl}/live/${channelId}.ts`;
    } else {
      const rends = Array.isArray(ch.renditions) && ch.renditions.length ? ch.renditions : ['1080p'];
      const multi = ch.renditionMode === 'multi' && rends.length > 1;
      const playlist = multi ? 'master.m3u8' : 'index.m3u8';
      const pathSuffix = wantHls ? `/streams/${channelId}/${playlist}` : `/streams/${channelId}/stream.ts`;
      destination = `${remoteSelected.publicBaseUrl}${pathSuffix}`;
    }
  } else if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
    destination = wantHls ? `${panelOrigin}/hls/${channelId}/index.m3u8` : `${panelOrigin}/live/${channelId}.ts`;
  } else {
    const rends = Array.isArray(ch.renditions) && ch.renditions.length ? ch.renditions : ['1080p'];
    const multi = ch.renditionMode === 'multi' && rends.length > 1;
    const playlist = multi ? 'master.m3u8' : 'index.m3u8';
    const pathSuffix = wantHls ? `/streams/${channelId}/${playlist}` : `/streams/${channelId}/stream.ts`;
    destination = `${panelOrigin}${pathSuffix}`;
  }

  return { destination, qs, servingSelected };
}

async function redirectToLiveStream(req, res, line, channelId, ext, selected, failoverSelected) {
  let ch = channels.get(channelId);
  if (!ch) return res.status(404).send('Channel not found');
  let status = streamManager.getChannelStatus(channelId);
  let running = status.activeProcess === true || ['running', 'starting'].includes(String(ch.status || '').toLowerCase());
  if (ch.on_demand && !running) {
    try {
      await onDemandLive.ensureOnDemandStreamIfNeeded(channelId);
    } catch {
      return res.status(503).send('Stream not available');
    }
    ch = channels.get(channelId);
    status = streamManager.getChannelStatus(channelId);
    running = status.activeProcess === true || ['running', 'starting'].includes(String(ch.status || '').toLowerCase());
  }
  if (!running) return res.status(503).send('Stream not available');

  const wantHls = ext === 'm3u8' || ch.outputFormat === 'hls';
  const container = wantHls ? 'm3u8' : 'ts';
  const rawTtl =
    STREAMING_MODE === 'nginx' && ch.nginxStreaming
      ? parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '45', 10) || 45
      : 3600;
  const ttlSec =
    STREAMING_MODE === 'nginx' && ch.nginxStreaming ? Math.min(60, Math.max(30, rawTtl)) : rawTtl;
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(line.id, channelId, container, ttlSec, { ip: req.ip });
  const sig = await securityService.signStreamUrl(token, expiresMs, channelId);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();

  // selected is passed from handleLive() to avoid duplicate selectServer() call
  const panelOrigin = await serverService.resolvePublicStreamOrigin(req, line);
  const base = (selected && selected.publicBaseUrl) ? selected.publicBaseUrl : panelOrigin;

  /**
   * Phase 4 — Runtime-readiness gate.
   * After selectServer() picks an origin candidate, verify that the placement
   * is actually runtime-ready before redirecting to a remote node.
   *
   * Phase 6 — Explicit failover:
   * When primary is unavailable (disabled/stale/runtime-not-ready), attempt
   * failover through explicit server_relationships.failover entries before
   * falling back to panel-local or returning 503.
   *
   * Fallback chain:
   *   1. Primary remote node if runtime-ready
   *   2. Failover node (explicit relationship) if runtime-ready
   *   3. Panel-local streaming if local FFmpeg is running
   *   4. 503 if nothing is ready
   */
  let useRemoteUrl = false;
  let remoteSelected = selected;
  if (selected && selected.serverId) {
    const ready = await serverService.isRuntimeReady(selected.serverId, channelId);
    if (ready.ready) {
      useRemoteUrl = true;
    } else if (failoverSelected && failoverSelected.serverId) {
      // Phase 6: explicit failover — use the pre-resolved failover candidate
      remoteSelected = {
        serverId: failoverSelected.serverId,
        publicBaseUrl: serverService.buildServerPublicBaseUrl(failoverSelected.server) || '',
        publicHost: failoverSelected.server.public_host || '',
        server: failoverSelected.server,
        health: failoverSelected.health,
        isOverride: false,
        isFailover: true,
      };
      useRemoteUrl = true;
    } else if (running && ch.status === 'running') {
      // Local FFmpeg is active — allow panel-local fallback
      useRemoteUrl = false;
      remoteSelected = null;
    } else {
      return res.status(503).send('Stream not available');
    }
  }

  if (ch.on_demand) {
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) hlsIdle.touch(channelId);
    else if (ch.outputFormat === 'hls') hlsIdle.touch(channelId);
  }

  let dest;
  if (useRemoteUrl && remoteSelected && remoteSelected.publicBaseUrl) {
    // Live proxy-delivery remains de-scoped; use direct origin/failover URL only.
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
      dest = wantHls ? `${remoteSelected.publicBaseUrl}/hls/${channelId}/index.m3u8` : `${remoteSelected.publicBaseUrl}/live/${channelId}.ts`;
    } else {
      const rends = Array.isArray(ch.renditions) && ch.renditions.length ? ch.renditions : ['1080p'];
      const multi = ch.renditionMode === 'multi' && rends.length > 1;
      const playlist = multi ? 'master.m3u8' : 'index.m3u8';
      const pathSuffix = wantHls ? `/streams/${channelId}/${playlist}` : `/streams/${channelId}/stream.ts`;
      dest = `${remoteSelected.publicBaseUrl}${pathSuffix}`;
    }
  } else if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
    dest = wantHls ? `${base}/hls/${channelId}/index.m3u8` : `${base}/live/${channelId}.ts`;
  } else {
    const rends = Array.isArray(ch.renditions) && ch.renditions.length ? ch.renditions : ['1080p'];
    const multi = ch.renditionMode === 'multi' && rends.length > 1;
    const playlist = multi ? 'master.m3u8' : 'index.m3u8';
    const pathSuffix = wantHls ? `/streams/${channelId}/${playlist}` : `/streams/${channelId}/stream.ts`;
    dest = `${base}${pathSuffix}`;
  }
  res.redirect(302, dest.includes('?') ? dest : `${dest}?${qs}`);
}

async function trackLiveConnection(line, channelId, ext, req, selected, proxySelected) {
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  const streamIdNum = /^[a-f0-9]+$/i.test(String(channelId)) ? parseInt(String(channelId), 16) >>> 0 : parseInt(String(channelId), 10) || 0;
  const connUuid = uuidv4();
  await lineService.openConnection(line.id, {
    stream_id: streamIdNum, user_agent: ua, user_ip: ip,
    container: ext, geoip_country_code: geo, uuid: connUuid,
  });

  // Phase 4 — also record a runtime session when connecting to a remote node.
  // Live proxy-delivery remains de-scoped, so proxyServerId is currently null here.
  if (selected && selected.serverId) {
    const placements = await serverService.getRuntimePlacementsForAsset('live', String(channelId));
    const placement = placements.find(p => Number(p.server_id) === Number(selected.serverId));
    if (placement) {
      await lineService.openRuntimeSession({
        lineId: line.id,
        streamType: 'live',
        streamId: String(channelId),
        placementId: placement.id || null,
        originServerId: selected.serverId,
        proxyServerId: proxySelected ? proxySelected.serverId : null,
        container: ext,
        sessionUuid: connUuid,
        userIp: ip,
        userAgent: ua,
        geoipCountryCode: geo,
      });
      // Phase 6: reconcile placement clients from session truth after opening
      await dbApi.reconcilePlacementClients('live', String(channelId), selected.serverId);
    }
  }
  return connUuid;
}

async function handleLive(req, res, file) {
  const { username, password } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  if (await maybeRedirectExpiringSoon(req, res, line)) return;
  const ext = parsed.ext;
  if (!lineService.checkOutputAllowed(line, ext === 'm3u8' ? 'm3u8' : 'ts')) return res.status(403).send('Output format not allowed');
  if (!(await lineService.canConnect(line.id))) return res.status(429).send('Too many connections');
  if (!(await bouquetAllows(line, parsed.id, 'live'))) return res.status(403).send('Not in bouquet');

  // Phase 4/6: resolve server selection and runtime-readiness gate
  const selected = await serverService.selectServer({ assetType: 'live', assetId: parsed.id, line });

  let failoverSelected = null;
  if (selected && selected.serverId) {
    const ready = await serverService.isRuntimeReady(selected.serverId, parsed.id);
    if (!ready.ready) {
      // Phase 6: try explicit failover before falling back
      failoverSelected = await serverService.selectFailoverServer(selected.serverId, 'live', parsed.id);
    }
  }

  const plan = await buildLiveDeliveryPlan(req, line, parsed.id, ext, selected, failoverSelected);
  if (plan.errorStatus) return res.status(plan.errorStatus).send(plan.errorText);

  const sessionUuid = await trackLiveConnection(line, parsed.id, ext, req, plan.servingSelected, null);
  const finalPlan = await buildLiveDeliveryPlan(req, line, parsed.id, ext, selected, failoverSelected, sessionUuid);
  if (finalPlan.errorStatus) return res.status(finalPlan.errorStatus).send(finalPlan.errorText);
  res.redirect(302, finalPlan.destination.includes('?') ? finalPlan.destination : `${finalPlan.destination}?${finalPlan.qs}`);
}

router.get('/live/:username/:password/:file', async (req, res) => {
  await handleLive(req, res, req.params.file);
});

router.get('/movie/:username/:password/:file', async (req, res) => {
  const { username, password } = req.params;
  const parsed = parseStreamFile(req.params.file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const movieIdNum = parseInt(parsed.id, 10);
  if (!movieIdNum || isNaN(movieIdNum) || String(movieIdNum) !== parsed.id) return res.status(400).send('Invalid movie id');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  if (await maybeRedirectExpiringSoon(req, res, line)) return;
  const container = parsed.ext;
  if (!lineService.checkOutputAllowed(line, container)) return res.status(403).send('Output format not allowed');
  if (!(await lineService.canConnect(line.id))) return res.status(429).send('Too many connections');

  const movie = await dbApi.getMovieById(parsed.id);
  if (!movie) return res.status(404).send('Movie not found');

  const sessionUuid = uuidv4();
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  await lineService.openConnection(line.id, { stream_id: parsed.id, user_agent: ua, user_ip: ip, container, geoip_country_code: geo, uuid: sessionUuid });

  const ttlSec = 3600;
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(line.id, `movie:${parsed.id}`, container, ttlSec, { sessionUuid, ip: req.ip });
  const sig = await securityService.signStreamUrl(token, expiresMs, `movie:${parsed.id}`);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();
  const panelOrigin = await serverService.resolvePublicStreamOrigin(req, line);
  res.redirect(302, `${panelOrigin}/stream/movie/${username}/${password}/${parsed.id}.${container}?${qs}`);
});

router.get('/series/:username/:password/:file', async (req, res) => {
  const { username, password } = req.params;
  const parsed = parseStreamFile(req.params.file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const episodeIdNum = parseInt(parsed.id, 10);
  if (!episodeIdNum || isNaN(episodeIdNum) || String(episodeIdNum) !== parsed.id) return res.status(400).send('Invalid episode id');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  if (await maybeRedirectExpiringSoon(req, res, line)) return;
  const container = parsed.ext;
  if (!lineService.checkOutputAllowed(line, container)) return res.status(403).send('Output format not allowed');
  if (!(await lineService.canConnect(line.id))) return res.status(429).send('Too many connections');

  const episode = await dbApi.getEpisodeById(parsed.id);
  if (!episode) return res.status(404).send('Episode not found');

  const sessionUuid = uuidv4();
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  await lineService.openConnection(line.id, { stream_id: parsed.id, user_agent: ua, user_ip: ip, container, geoip_country_code: geo, uuid: sessionUuid });

  const ttlSec = 3600;
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(line.id, `episode:${parsed.id}`, container, ttlSec, { sessionUuid, ip: req.ip });
  const sig = await securityService.signStreamUrl(token, expiresMs, `episode:${parsed.id}`);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();
  const panelOrigin = await serverService.resolvePublicStreamOrigin(req, line);
  res.redirect(302, `${panelOrigin}/stream/episode/${username}/${password}/${parsed.id}.${container}?${qs}`);
});

// ─── Proxy Streaming Engine ──────────────────────────────────────

const CONTENT_TYPES = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t', m3u8: 'application/vnd.apple.mpegurl' };

/** Blocklist of IP ranges and hostnames that must never be followed as redirect targets. */
const PRIVATE_PATTERNS = [
  /^127\./,                  // Loopback
  /^10\./,                   // Class A private
  /^172\.(1[6-9]|2\d|3[0-1])\./,  // Class B private
  /^192\.168\./,              // Class C private
  /^169\.254\./,              // Link-local (AWS metadata)
  /^0\./,                    // Current network
  /^::1$/i,                  // IPv6 loopback
  /^::ffff:127\./i,          // IPv4-mapped IPv6 loopback
  /^fe80:/i,                 // IPv6 link-local
  /^fc00:/i,                 // IPv6 unique local
  /^fd00:/i,                 // IPv6 unique local
];

/** Check if a hostname resolves to a private/internal IP (basic check). */
function isPrivateHost(hostname) {
  // Numeric IPs
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return PRIVATE_PATTERNS.some(p => p.test(hostname));
  }
  // Literals that are clearly internal
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (lower === 'metadata.google.internal' || lower === '169.254.169.254') return true;
  return false;
}

/**
 * Follow redirects manually so we can validate each destination URL.
 * Blocks SSRF by rejecting redirects to private IP ranges or internal hostnames.
 */
async function fetchWithSafeRedirect(url, options, fetch) {
  let currentUrl = url;
  const maxRedirects = 5;
  for (let i = 0; i < maxRedirects; i++) {
    let parsed;
    try { parsed = new URL(currentUrl); } catch { return { ok: false, error: 'Invalid URL' }; }
    if (isPrivateHost(parsed.hostname)) {
      return { ok: false, error: `Redirect to private host blocked: ${parsed.hostname}` };
    }
    const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
    if (response.status < 300 || response.status > 399) {
      return { ok: true, response };
    }
    const location = response.headers.get('location');
    if (!location) return { ok: true, response }; // 304 etc
    // Resolve relative redirects
    try { currentUrl = new URL(location, currentUrl).toString(); } catch { return { ok: false, error: 'Invalid redirect URL' }; }
  }
  return { ok: false, error: 'Too many redirects' };
}

async function getProxyUserAgent(req) {
  const configured = await dbApi.getSetting('stream_user_agent');
  if (configured && String(configured).trim()) return String(configured).trim();
  return req.get('user-agent') || 'IPTV-Panel/1.0';
}

function getSourceUrls(row) {
  const urls = [];
  if (row.stream_source) {
    try {
      const parsed = JSON.parse(row.stream_source);
      if (Array.isArray(parsed)) for (const u of parsed) { const s = String(u || '').trim(); if (s) urls.push(s); }
    } catch {}
  }
  if (!urls.length) { const primary = String(row.stream_url || '').trim(); if (primary) urls.push(primary); }
  return urls;
}

function bindPlaybackKeepAlive(req, res, lineId, sessionUuid) {
  if (!lineId || !sessionUuid) return () => {};
  const timer = setInterval(() => {
    lineService.refreshConnection(lineId, sessionUuid).catch(() => {});
    lineService.touchRuntimeSession(sessionUuid).catch(() => {});
  }, 120000);
  if (typeof timer.unref === 'function') timer.unref();
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    lineService.closeConnection(lineId, sessionUuid).catch(() => {});
    lineService.closeRuntimeSession(sessionUuid).catch(() => {});
  };
  req.on('close', finish);
  res.on('close', finish);
  res.on('finish', finish);
  return finish;
}

async function proxyStream(req, res, sourceUrls, containerExt, keepAlive = null) {
  if (!sourceUrls.length) return res.status(503).send('No stream URL');
  const ua = await getProxyUserAgent(req);
  const rangeHeader = req.headers.range || null;
  const contentType = CONTENT_TYPES[containerExt] || 'application/octet-stream';
  const stopKeepAlive = keepAlive ? bindPlaybackKeepAlive(req, res, keepAlive.lineId, keepAlive.sessionUuid) : () => {};
  let lastError = null;
  for (const sourceUrl of sourceUrls) {
    try {
      const fetchHeaders = { 'User-Agent': ua };
      if (rangeHeader) fetchHeaders['Range'] = rangeHeader;
      const fetchOpts = { headers: fetchHeaders, timeout: 15000 };
      const result = await fetchWithSafeRedirect(sourceUrl, fetchOpts, (url, opts) => require('node-fetch')(url, opts));
      if (!result.ok) { lastError = result.error; continue; }
      const upstream = result.response;
      if (!upstream.ok && upstream.status !== 206) { lastError = `Source returned ${upstream.status}`; continue; }
      res.status(upstream.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const cl = upstream.headers.get('content-length'); if (cl) res.setHeader('Content-Length', cl);
      const cr = upstream.headers.get('content-range'); if (cr) res.setHeader('Content-Range', cr);
      const cd = upstream.headers.get('content-disposition'); if (cd) res.setHeader('Content-Disposition', cd);
      upstream.body.pipe(res);
      upstream.body.on('error', () => { try { res.end(); } catch {} });
      req.on('close', () => { try { upstream.body.destroy(); } catch {} });
      return;
    } catch (e) { lastError = e.message || 'Fetch failed'; }
  }
  stopKeepAlive();
  res.status(502).send(`Stream unavailable: ${lastError || 'all sources failed'}`);
}

/**
 * Phase 5 — Build a redirect URL for movie/episode serving by a remote node.
 *
 * The selected node's agent receives this URL and validates the token via the panel
 * before streaming. The redirect format differs from live because movie/episode files
 * don't use FFmpeg — the node's agent handles HTTP fetch-and-pipe instead.
 *
 * @param {object} selected  — result from selectServer()
 * @param {string} assetType  — 'movie' or 'episode'
 * @param {string} streamId  — movie id or episode id
 * @param {string} container  — file extension (mp4, mkv, etc.)
 * @param {string} username
 * @param {string} password
 * @param {number} ttlSec  — token TTL in seconds
 * @returns {Promise<string>} redirect URL
 */
async function buildNodeStreamRedirectUrl(selected, assetType, streamId, container, username, password, ttlSec, lineId, sessionUuid = '') {
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(lineId, `${assetType}:${streamId}`, container, ttlSec, { sessionUuid, ip: req.ip });
  const sig = await securityService.signStreamUrl(token, expiresMs, `${assetType}:${streamId}`);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();
  const base = selected && selected.publicBaseUrl
    ? selected.publicBaseUrl
    : 'http://127.0.0.1';
  return `${base}/stream/${assetType}/${username}/${password}/${streamId}.${container}?${qs}`;
}

module.exports = router;
