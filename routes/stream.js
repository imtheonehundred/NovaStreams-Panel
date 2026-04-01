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

async function buildLiveDeliveryPlan(req, line, channelId, ext, selected, failoverSelected) {
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
  const token = await securityService.generateStreamToken(line.id, channelId, container, ttlSec);
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
  const token = await securityService.generateStreamToken(line.id, channelId, container, ttlSec);
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

  await trackLiveConnection(line, parsed.id, ext, req, plan.servingSelected, null);
  res.redirect(302, plan.destination.includes('?') ? plan.destination : `${plan.destination}?${plan.qs}`);
}

router.get('/live/:username/:password/:file', async (req, res) => {
  await handleLive(req, res, req.params.file);
});

// ─── Proxy Streaming Engine ──────────────────────────────────────

const CONTENT_TYPES = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t', m3u8: 'application/vnd.apple.mpegurl' };

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

async function proxyStream(req, res, sourceUrls, containerExt) {
  if (!sourceUrls.length) return res.status(503).send('No stream URL');
  const ua = await getProxyUserAgent(req);
  const rangeHeader = req.headers.range || null;
  const contentType = CONTENT_TYPES[containerExt] || 'application/octet-stream';
  let lastError = null;
  for (const sourceUrl of sourceUrls) {
    try {
      const fetchHeaders = { 'User-Agent': ua };
      if (rangeHeader) fetchHeaders['Range'] = rangeHeader;
      const upstream = await fetch(sourceUrl, { headers: fetchHeaders, redirect: 'follow', timeout: 15000 });
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
async function buildNodeStreamRedirectUrl(selected, assetType, streamId, container, username, password, ttlSec) {
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(null, `${assetType}:${streamId}`, container, ttlSec);
  const sig = await securityService.signStreamUrl(token, expiresMs, `${assetType}:${streamId}`);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();
  const base = selected && selected.publicBaseUrl
    ? selected.publicBaseUrl
    : 'http://127.0.0.1';
  return `${base}/stream/${assetType}/${username}/${password}/${streamId}.${container}?${qs}`;
}

/**
 * Phase 7 — Build a redirect URL for proxy-delivery chains.
 *
 * When an origin-proxy chain exists, the client is redirected to the proxy node
 * instead of the origin. The proxy's agent validates the token with the panel
 * and then fetches from the origin. URL structure is identical to direct node
 * redirect — only the base host differs (proxy vs origin).
 *
 * @param {object} proxySelected  — result from selectProxyServer()
 * @param {string} assetType  — 'movie' or 'episode'
 * @param {string} streamId
 * @param {string} container
 * @param {string} username
 * @param {string} password
 * @param {number} ttlSec
 * @returns {Promise<string>} redirect URL
 */
async function buildProxyRedirectUrl(proxySelected, assetType, streamId, container, username, password, ttlSec) {
  const expiresMs = Date.now() + ttlSec * 1000;
  const token = await securityService.generateStreamToken(null, `${assetType}:${streamId}`, container, ttlSec);
  const sig = await securityService.signStreamUrl(token, expiresMs, `${assetType}:${streamId}`);
  const qs = new URLSearchParams({ token, expires: String(expiresMs), sig }).toString();
  const base = proxySelected && proxySelected.publicBaseUrl
    ? proxySelected.publicBaseUrl
    : 'http://127.0.0.1';
  return `${base}/stream/${assetType}/${username}/${password}/${streamId}.${container}?${qs}`;
}

/**
 * Phase 5 — Track a movie playback session in line_runtime_sessions.
 * Phase 7 — proxy_delivery: proxySelected is set when an origin-proxy chain exists.
 */
async function trackMovieConnection(line, movieId, container, req, selected, proxySelected) {
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  const sessionUuid = uuidv4();
  await lineService.openConnection(line.id, {
    stream_id: movieId, user_agent: ua, user_ip: ip,
    container, geoip_country_code: geo, uuid: sessionUuid,
  });
  if (selected && selected.serverId) {
    const placements = await serverService.getRuntimePlacementsForAsset('movie', String(movieId));
    const placement = placements.find(p => Number(p.server_id) === Number(selected.serverId));
    await lineService.openRuntimeSession({
      lineId: line.id,
      streamType: 'movie',
      streamId: String(movieId),
      placementId: placement ? (placement.id || null) : null,
      originServerId: selected.serverId,
      proxyServerId: proxySelected ? proxySelected.serverId : null,
      container,
      sessionUuid,
      userIp: ip,
      userAgent: ua,
      geoipCountryCode: geo,
    });
  }
  return sessionUuid;
}

/**
 * Phase 5 — Track an episode playback session in line_runtime_sessions.
 * Phase 7 — proxy_delivery: proxySelected is set when an origin-proxy chain exists.
 */
async function trackEpisodeConnection(line, episodeId, container, req, selected, proxySelected) {
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  const sessionUuid = uuidv4();
  await lineService.openConnection(line.id, {
    stream_id: episodeId, user_agent: ua, user_ip: ip,
    container, geoip_country_code: geo, uuid: sessionUuid,
  });
  if (selected && selected.serverId) {
    const placements = await serverService.getRuntimePlacementsForAsset('episode', String(episodeId));
    const placement = placements.find(p => Number(p.server_id) === Number(selected.serverId));
    await lineService.openRuntimeSession({
      lineId: line.id,
      streamType: 'episode',
      streamId: String(episodeId),
      placementId: placement ? (placement.id || null) : null,
      originServerId: selected.serverId,
      proxyServerId: proxySelected ? proxySelected.serverId : null,
      container,
      sessionUuid,
      userIp: ip,
      userAgent: ua,
      geoipCountryCode: geo,
    });
  }
  return sessionUuid;
}

router.get('/movie/:username/:password/:file', async (req, res) => {
  const { username, password, file } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  if (await maybeRedirectExpiringSoon(req, res, line)) return;
  const movieId = parseInt(parsed.id, 10);
  if (!Number.isFinite(movieId)) return res.status(400).send('Invalid movie id');
  if (!(await bouquetAllows(line, movieId, 'movie'))) return res.status(403).send('Not in bouquet');
  const selected = await serverService.selectServer({ assetType: 'movie', assetId: movieId, line });
  const row = await dbApi.getMovieById(movieId);
  if (!row) return res.status(404).send('Not found');

  /**
   * Phase 5 — Node-side serving.
   * Phase 7 — origin-proxy delivery: when a proxy exists for the selected origin,
   * redirect to the proxy instead of directly to the origin.
   *
   * When a node with a valid publicBaseUrl is selected, redirect the client
   * to the node for byte-serving. The node's agent validates the token with
   * the panel and then streams from the source URL.
   *
   * When no remote node is selected (fallback), use panel-local proxyStream.
   */
  const ttlSec = parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '3600', 10) || 3600;
  if (selected && selected.publicBaseUrl) {
    // Phase 7: check for proxy-delivery node
    let proxySelected = null;
    proxySelected = await serverService.selectProxyServer(selected.serverId);
    if (proxySelected && proxySelected.serverId) {
      const proxyNormalized = {
        serverId: proxySelected.serverId,
        publicBaseUrl: serverService.buildServerPublicBaseUrl(proxySelected.server) || '',
        publicHost: proxySelected.server.public_host || '',
        server: proxySelected.server,
        health: proxySelected.health,
        isOverride: false,
        isFailover: false,
        isProxy: true,
      };
      await trackMovieConnection(line, movieId, parsed.ext || row.container_extension || 'mp4', req, selected, proxyNormalized);
      // Redirect to proxy using the same URL structure — proxy's agent handles it
      const dest = await buildNodeStreamRedirectUrl(
        proxyNormalized, 'movie', movieId,
        parsed.ext || row.container_extension || 'mp4',
        username, password, ttlSec
      );
      return res.redirect(302, dest);
    }
    await trackMovieConnection(line, movieId, parsed.ext || row.container_extension || 'mp4', req, selected, null);
    const dest = await buildNodeStreamRedirectUrl(
      selected, 'movie', movieId,
      parsed.ext || row.container_extension || 'mp4',
      username, password, ttlSec
    );
    return res.redirect(302, dest);
  }
  // Fallback: panel-local proxy
  await proxyStream(req, res, getSourceUrls(row), parsed.ext || row.container_extension || 'mp4');
});

router.get('/series/:username/:password/:file', async (req, res) => {
  const { username, password, file } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  if (await maybeRedirectExpiringSoon(req, res, line)) return;
  const episodeId = parseInt(parsed.id, 10);
  if (!Number.isFinite(episodeId)) return res.status(400).send('Invalid episode id');
  const ep = await dbApi.getEpisodeById(episodeId);
  if (!ep) return res.status(404).send('Not found');
  if (!(await bouquetAllows(line, ep.series_id, 'series'))) return res.status(403).send('Not in bouquet');
  const selected = await serverService.selectServer({ assetType: 'episode', assetId: episodeId, line });
  const sourceUrls = [];
  const src = String(ep.stream_source || '').trim();
  if (src) { try { const p2 = JSON.parse(src); if (Array.isArray(p2)) p2.forEach(u => { if (u) sourceUrls.push(String(u).trim()); }); } catch { sourceUrls.push(src); } }
  if (!sourceUrls.length) { const primary = String(ep.stream_url || '').trim(); if (primary) sourceUrls.push(primary); }

  /**
   * Phase 5 — Node-side serving (same pattern as movies).
   * Phase 7 — origin-proxy delivery: when a proxy exists for the selected origin,
   * redirect to the proxy instead of directly to the origin.
   */
  const ttlSec = parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '3600', 10) || 3600;
  const container = parsed.ext || ep.container_extension || 'mp4';
  if (selected && selected.publicBaseUrl) {
    // Phase 7: check for proxy-delivery node
    let proxySelected = null;
    proxySelected = await serverService.selectProxyServer(selected.serverId);
    if (proxySelected && proxySelected.serverId) {
      const proxyNormalized = {
        serverId: proxySelected.serverId,
        publicBaseUrl: serverService.buildServerPublicBaseUrl(proxySelected.server) || '',
        publicHost: proxySelected.server.public_host || '',
        server: proxySelected.server,
        health: proxySelected.health,
        isOverride: false,
        isFailover: false,
        isProxy: true,
      };
      await trackEpisodeConnection(line, episodeId, container, req, selected, proxyNormalized);
      const dest = await buildNodeStreamRedirectUrl(
        proxyNormalized, 'episode', episodeId, container,
        username, password, ttlSec
      );
      return res.redirect(302, dest);
    }
    await trackEpisodeConnection(line, episodeId, container, req, selected, null);
    const dest = await buildNodeStreamRedirectUrl(
      selected, 'episode', episodeId, container,
      username, password, ttlSec
    );
    return res.redirect(302, dest);
  }
  // Fallback: panel-local proxy
  await proxyStream(req, res, sourceUrls, container);
});

const RESERVED = new Set(['api', 'streams', 'proxy', 'public', 'static', 'favicon.ico']);
router.get('/:username/:password/:streamId', async (req, res, next) => {
  const { username, streamId } = req.params;
  if (RESERVED.has(String(username).toLowerCase())) return next();
  if (String(streamId).includes('.')) return res.status(404).end();
  const synthetic = `${streamId}.ts`;
  req.params.file = synthetic;
  await handleLive(req, res, synthetic);
});

module.exports = router;
