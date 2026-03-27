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

async function redirectToLiveStream(req, res, line, channelId, ext) {
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
  const base = await serverService.resolvePublicStreamOrigin(req, line);
  if (ch.on_demand) {
    if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) hlsIdle.touch(channelId);
    else if (ch.outputFormat === 'hls') hlsIdle.touch(channelId);
  }
  let dest;
  if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
    dest = wantHls ? `${base}/hls/${channelId}/index.m3u8` : `${base}/live/${channelId}.ts`;
  } else {
    const rends = Array.isArray(ch.renditions) && ch.renditions.length ? ch.renditions : ['1080p'];
    const multi = ch.renditionMode === 'multi' && rends.length > 1;
    const playlist = multi ? 'master.m3u8' : 'index.m3u8';
    const pathSuffix = wantHls ? `/streams/${channelId}/${playlist}` : `/streams/${channelId}/stream.ts`;
    dest = `${base}${pathSuffix}`;
  }
  res.redirect(302, `${dest}?${qs}`);
}

async function trackLiveConnection(line, channelId, ext, req) {
  const ip = clientIp(req);
  const ua = String(req.get('user-agent') || '');
  const g = await securityService.checkGeoIp(ip, line);
  const geo = g && g.country ? String(g.country) : '';
  const streamIdNum = /^[a-f0-9]+$/i.test(String(channelId)) ? parseInt(String(channelId), 16) >>> 0 : parseInt(String(channelId), 10) || 0;
  await lineService.openConnection(line.id, {
    stream_id: streamIdNum, user_agent: ua, user_ip: ip,
    container: ext, geoip_country_code: geo, uuid: uuidv4(),
  });
}

async function handleLive(req, res, file) {
  const { username, password } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  const ext = parsed.ext;
  if (!lineService.checkOutputAllowed(line, ext === 'm3u8' ? 'm3u8' : 'ts')) return res.status(403).send('Output format not allowed');
  if (!(await lineService.canConnect(line.id))) return res.status(429).send('Too many connections');
  if (!(await bouquetAllows(line, parsed.id, 'live'))) return res.status(403).send('Not in bouquet');
  await trackLiveConnection(line, parsed.id, ext, req);
  return await redirectToLiveStream(req, res, line, parsed.id, ext);
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

router.get('/movie/:username/:password/:file', async (req, res) => {
  const { username, password, file } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  const movieId = parseInt(parsed.id, 10);
  if (!Number.isFinite(movieId)) return res.status(400).send('Invalid movie id');
  if (!(await bouquetAllows(line, movieId, 'movie'))) return res.status(403).send('Not in bouquet');
  const row = await dbApi.getMovieById(movieId);
  if (!row) return res.status(404).send('Not found');
  await proxyStream(req, res, getSourceUrls(row), parsed.ext || row.container_extension || 'mp4');
});

router.get('/series/:username/:password/:file', async (req, res) => {
  const { username, password, file } = req.params;
  const parsed = parseStreamFile(file);
  if (!parsed) return res.status(400).send('Invalid stream path');
  const line = await authLine(username, password, req, res);
  if (!line) return;
  const episodeId = parseInt(parsed.id, 10);
  if (!Number.isFinite(episodeId)) return res.status(400).send('Invalid episode id');
  const ep = await dbApi.getEpisodeById(episodeId);
  if (!ep) return res.status(404).send('Not found');
  if (!(await bouquetAllows(line, ep.series_id, 'series'))) return res.status(403).send('Not in bouquet');
  const sourceUrls = [];
  const src = String(ep.stream_source || '').trim();
  if (src) { try { const p2 = JSON.parse(src); if (Array.isArray(p2)) p2.forEach(u => { if (u) sourceUrls.push(String(u).trim()); }); } catch { sourceUrls.push(src); } }
  if (!sourceUrls.length) { const primary = String(ep.stream_url || '').trim(); if (primary) sourceUrls.push(primary); }
  await proxyStream(req, res, sourceUrls, parsed.ext || ep.container_extension || 'mp4');
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
