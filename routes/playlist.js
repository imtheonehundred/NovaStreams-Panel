'use strict';

const express = require('express');
const lineService = require('../services/lineService');
const playlistService = require('../services/playlistService');
const serverService = require('../services/serverService');

const router = express.Router();

function buildBaseUrl(req) {
  const host = req.get('host') || 'localhost';
  const proto = req.protocol || 'http';
  return `${proto}://${host}`;
}

function sendPlaylist(res, body, filename) {
  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9_.-]/gi, '_')}"`);
  res.send(body);
}

async function handleGet(req, res) {
  const username = req.query.username != null ? String(req.query.username) : '';
  const password = req.query.password != null ? String(req.query.password) : '';
  if (!username || !password) return res.status(401).send('Missing credentials');

  const auth = await lineService.authenticateLine(username, password);
  if (!auth.ok || !auth.line) return res.status(403).send('Forbidden');

  const line = lineService.normalizeLineRow(auth.line);
  const type = req.query.type != null && String(req.query.type) !== '' ? String(req.query.type) : 'm3u_plus';
  const output = req.query.output != null && String(req.query.output) !== '' ? String(req.query.output) : 'ts';
  const key = req.query.key != null && String(req.query.key) !== '' ? String(req.query.key) : null;

  const fb = buildBaseUrl(req);
  const defaultBase = await serverService.resolvePlaylistBaseUrl(line, fb);
  const m3u = await playlistService.generatePlaylist(line, {
    type: type === 'm3u' ? 'm3u' : 'm3u_plus',
    output: output === 'm3u8' ? 'm3u8' : 'ts',
    key,
    baseUrl: defaultBase,
    resolveBaseUrl: (assetSid) => serverService.resolvePlaylistBaseUrl(line, fb, assetSid),
    resolveAssetBaseUrl: async (assetType, assetId) => {
      // Use the canonical selector — returns contract-compliant output with publicBaseUrl
      const selected = await serverService.selectServer({ assetType, assetId, line });
      // Use publicBaseUrl directly from selector; fallback to panel origin if not available
      return selected && selected.publicBaseUrl
        ? selected.publicBaseUrl
        : await serverService.resolvePublicStreamOrigin(req, line);
    },
  });

  sendPlaylist(res, m3u, key ? `playlist_${key}.m3u` : 'playlist.m3u');
}

router.get('/get.php', handleGet);
router.handleGet = handleGet;

module.exports = router;
