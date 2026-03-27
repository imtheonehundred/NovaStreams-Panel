'use strict';

const express = require('express');
const lineService = require('../services/lineService');
const xtreamService = require('../services/xtreamService');
const epgService = require('../services/epgService');

const router = express.Router();

function readCredentials(req) {
  const username = req.query.username != null ? req.query.username : req.body && req.body.username;
  const password = req.query.password != null ? req.query.password : req.body && req.body.password;
  return { username: username != null ? String(username) : '', password: password != null ? String(password) : '' };
}

function sendAuthFailure(res, result) {
  const code = result && result.error_code;
  const map = { INVALID: { s: 401, m: 'Invalid credentials' }, BANNED: { s: 403, m: 'Account banned' }, DISABLED: { s: 403, m: 'Account disabled' }, EXPIRED: { s: 403, m: 'Subscription expired' } };
  const e = map[code] || { s: 401, m: 'Unauthorized' };
  return res.status(e.s).json({ user_info: { auth: 0, status: e.m } });
}

async function authenticate(req, res) {
  const { username, password } = readCredentials(req);
  if (!username || !password) { res.status(401).json({ user_info: { auth: 0, status: 'Missing credentials' } }); return null; }
  const result = await lineService.authenticateLine(username, password);
  if (!result.ok || !result.line) { sendAuthFailure(res, result); return null; }
  return lineService.normalizeLineRow(result.line);
}

function paginate(arr, req) {
  const ipp = req.query.items_per_page;
  if (ipp === undefined || ipp === null || ipp === '') return arr;
  const per = parseInt(ipp, 10);
  if (!Number.isFinite(per) || per <= 0) return arr;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const start = (page - 1) * per;
  return arr.slice(start, start + per);
}

async function handlePlayerApi(req, res) {
  const line = await authenticate(req, res);
  if (!line) return;

  const action = req.query.action != null ? String(req.query.action) : '';

  if (!action) {
    return res.json({
      user_info: await xtreamService.userInfo(line),
      server_info: await xtreamService.serverInfo(req),
    });
  }

  switch (action) {
    case 'get_live_categories':
      return res.json(paginate(await xtreamService.liveCategories(line), req));
    case 'get_live_streams': {
      let data = await xtreamService.liveStreams(line);
      data = xtreamService.filterByCategoryId(data, req.query.category_id);
      return res.json(paginate(data, req));
    }
    case 'get_vod_categories':
      return res.json(paginate(await xtreamService.vodCategories(line), req));
    case 'get_vod_streams': {
      const data = await xtreamService.vodStreams(line, req.query.category_id, req.query.page, parseInt(req.query.items_per_page, 10) || 50);
      return res.json(data);
    }
    case 'get_vod_info': {
      const info = await xtreamService.vodInfo(line, req.query.vod_id);
      if (!info) return res.status(404).json({ error: 'VOD not found' });
      return res.json(info);
    }
    case 'get_series_categories':
      return res.json(paginate(await xtreamService.seriesCategories(line), req));
    case 'get_series': {
      const data = await xtreamService.seriesList(line, req.query.category_id, req.query.page, parseInt(req.query.items_per_page, 10) || 50);
      return res.json(data);
    }
    case 'get_series_info': {
      const info = await xtreamService.seriesInfo(line, req.query.series_id);
      if (!info) return res.status(404).json({ error: 'Series not found' });
      return res.json(info);
    }
    case 'get_short_epg':
      return res.json(await xtreamService.shortEpg(req.query.stream_id, req.query.limit));
    case 'get_simple_data_table':
      return res.json(await xtreamService.simpleDataTable(req.query.stream_id));
    case 'get_live_info': {
      const info = xtreamService.liveInfo(req.query.stream_id);
      if (!info) return res.status(404).json({ error: 'Stream not found' });
      return res.json(info);
    }
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
}

router.get('/player_api.php', handlePlayerApi);
router.post('/player_api.php', handlePlayerApi);

async function handleXmltv(req, res) {
  const line = await authenticate(req, res);
  if (!line) return;
  const bouquetIds = lineService.getLineBouquetIds(line);
  const xml = await epgService.xmltv(bouquetIds);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
}

router.get('/xmltv.php', handleXmltv);

module.exports = router;
