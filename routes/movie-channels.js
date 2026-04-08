'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { ConflictError } = require('../lib/errors');
const auditService = require('../services/auditService');
const {
  defaultWatermark,
  isMovieChannel,
  mergeChannelOptions,
  normalizeMovieUrls,
  parseM3uMovieImport,
} = require('../services/channelConfig');

function buildMovieChannelRecord({
  name,
  urls,
  reqBody,
  reqUserId,
  extra,
  parsedLogo,
}) {
  return {
    name,
    type: 'MOVIE',
    mpdUrl: urls[0],
    sourceQueue: urls,
    sourceIndex: 0,
    channelClass: 'movie',
    movieLoop: reqBody && reqBody.movieLoop === false ? false : true,
    inputType: 'auto',
    outputMode: 'copy',
    outputFormat: 'hls',
    renditionMode: 'single',
    renditions: ['1080p'],
    streamMode: 'live',
    headers: {},
    kid: '',
    key: '',
    pssh: '',
    watermark: defaultWatermark(),
    x264Preset: 'veryfast',
    videoEncoder: 'cpu_x264',
    performanceProfile: 'balanced',
    audioBitrateK: 128,
    hlsSegmentSeconds: 4,
    hlsPlaylistSize: 10,
    videoTrack: 0,
    audioTrack: 0,
    subtitleTrack: -1,
    httpProxy: null,
    userAgent: '',
    referer: '',
    customFfmpegArgs: '',
    maxRetries: 0,
    retryDelaySec: 5,
    sortOrder: 0,
    logoUrl: parsedLogo || '',
    epgChannelId: '',
    status: 'stopped',
    createdAt: new Date().toISOString(),
    hlsUrl: null,
    error: null,
    viewers: 0,
    startedAt: null,
    userId: reqUserId,
    stabilityScore: 100,
    stabilityStatus: 'Stable',
    stabilityLastChecked: null,
    stabilityMeta: {},
    autoFixEnabled: false,
    stabilityProfile: 'off',
    streamSlot: 'a',
    qoeScore: 100,
    qoeLastChecked: null,
    qoeAvgStartupMs: 0,
    qoeAvgBufferRatio: 0,
    qoeAvgLatencyMs: 0,
    finalStabilityScore: 100,
    ...extra,
    sourceQueue: urls,
    mpdUrl: urls[0],
    streamMode: 'live',
    inputType: 'auto',
  };
}

module.exports = function movieChannelRoutes({
  requireAuth,
  requireAdminAuth,
  csrfProtection,
  channels,
  processes,
  dbApi,
  startChannel,
  stopChannel,
  uuidv4,
  watermarksDir,
  rootDir,
}) {
  const router = express.Router();

  router.get('/movie-channels', requireAdminAuth, (req, res) => {
    const list = [];
    channels.forEach((ch, id) => {
      if (ch.userId !== req.userId) return;
      if (!isMovieChannel(ch)) return;
      const { userId, ...rest } = ch;
      list.push({
        id,
        ...rest,
        pid: processes.has(id) ? processes.get(id).pid : null,
      });
    });
    list.sort((a, b) => {
      const d = (a.sortOrder || 0) - (b.sortOrder || 0);
      return d !== 0
        ? d
        : String(a.name || '').localeCompare(String(b.name || ''));
    });
    res.json(list);
  });

  router.post(
    '/movie-channels',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const name = String(req.body.name || '').trim();
      const urls = normalizeMovieUrls(req.body.urls);
      if (!name || urls.length === 0) {
        return res
          .status(400)
          .json({ error: 'name and at least one mp4/mkv url are required' });
      }
      const extra = await mergeChannelOptions(null, req.body || {});
      if (
        extra.outputMode === 'copy' &&
        extra.watermark &&
        extra.watermark.enabled
      ) {
        return res
          .status(400)
          .json({ error: 'Watermark on movies requires transcode mode' });
      }
      if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
        const wmPath = path.join(watermarksDir, extra.watermark.file);
        if (!fs.existsSync(wmPath)) {
          return res.status(400).json({
            error: 'Watermark file not found. Upload/select a valid file.',
          });
        }
      }
      const id = uuidv4().substring(0, 8);
      const channel = buildMovieChannelRecord({
        name,
        urls,
        reqBody: req.body,
        reqUserId: req.userId,
        extra,
        parsedLogo: '',
      });
      channels.set(id, channel);
      await dbApi.insertChannel(id, req.userId, channel);
      const streamDir = path.join(rootDir, 'streams', id);
      if (!fs.existsSync(streamDir))
        fs.mkdirSync(streamDir, { recursive: true });
      const { userId, ...pub } = channel;
      await auditService.log(
        req.userId,
        'admin.channel.create',
        'movie_channel',
        id,
        { name },
        req
      );
      res.json({ id, ...pub });
    }
  );

  router.post(
    '/movie-channels/import',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const parsed = parseM3uMovieImport(req.body && req.body.rawText);
      const urls = normalizeMovieUrls(parsed.urls);
      const name = String(
        (req.body && req.body.name) || parsed.firstName || ''
      ).trim();
      if (!name || urls.length === 0) {
        return res.status(400).json({
          error:
            'No valid mp4/mkv/m3u8/ts URLs found in pasted text, or name is missing.',
        });
      }
      const extra = await mergeChannelOptions(null, req.body || {});
      if (
        extra.outputMode === 'copy' &&
        extra.watermark &&
        extra.watermark.enabled
      ) {
        return res
          .status(400)
          .json({ error: 'Watermark on movies requires transcode mode' });
      }
      if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
        const wmPath = path.join(watermarksDir, extra.watermark.file);
        if (!fs.existsSync(wmPath)) {
          return res.status(400).json({
            error: 'Watermark file not found. Upload/select a valid file.',
          });
        }
      }
      const id = uuidv4().substring(0, 8);
      const channel = buildMovieChannelRecord({
        name,
        urls,
        reqBody: req.body,
        reqUserId: req.userId,
        extra,
        parsedLogo: parsed.firstLogo || '',
      });
      channels.set(id, channel);
      await dbApi.insertChannel(id, req.userId, channel);
      const streamDir = path.join(rootDir, 'streams', id);
      if (!fs.existsSync(streamDir))
        fs.mkdirSync(streamDir, { recursive: true });
      const { userId, ...pub } = channel;
      await auditService.log(
        req.userId,
        'admin.channel.create',
        'movie_channel',
        id,
        { name, importedCount: urls.length },
        req
      );
      res.json({ id, ...pub, importedCount: urls.length });
    }
  );

  router.put(
    '/movie-channels/:id',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (
        !channel ||
        channel.userId !== req.userId ||
        !isMovieChannel(channel)
      ) {
        return res.status(404).json({ error: 'Movie channel not found' });
      }
      if (channel.status === 'running') {
        return res
          .status(400)
          .json({ error: 'Stop the movie channel first before editing' });
      }
      const name = String(req.body.name || '').trim();
      const urls = normalizeMovieUrls(req.body.urls);
      if (!name || urls.length === 0) {
        return res
          .status(400)
          .json({ error: 'name and at least one mp4/mkv url are required' });
      }
      const extra = await mergeChannelOptions(channel, req.body || {});
      if (
        extra.outputMode === 'copy' &&
        extra.watermark &&
        extra.watermark.enabled
      ) {
        return res
          .status(400)
          .json({ error: 'Watermark on movies requires transcode mode' });
      }
      if (extra.watermark && extra.watermark.enabled && extra.watermark.file) {
        const wmPath = path.join(watermarksDir, extra.watermark.file);
        if (!fs.existsSync(wmPath)) {
          return res.status(400).json({
            error: 'Watermark file not found. Upload/select a valid file.',
          });
        }
      }
      Object.assign(channel, {
        ...extra,
        name,
        mpdUrl: urls[0],
        sourceQueue: urls,
        sourceIndex: 0,
        movieLoop: req.body.movieLoop === false ? false : true,
        streamMode: 'live',
        inputType: 'auto',
      });
      try {
        await dbApi.updateChannelRow(
          id,
          req.userId,
          channel,
          req.body.version !== undefined ? req.body.version : channel.version
        );
      } catch (error) {
        if (error instanceof ConflictError) {
          return res
            .status(409)
            .json({
              error: error.message,
              currentVersion: error.currentVersion,
            });
        }
        throw error;
      }
      await auditService.log(
        req.userId,
        'admin.channel.update',
        'movie_channel',
        id,
        { fields: Object.keys(req.body || {}) },
        req
      );
      const { userId, ...pub } = channel;
      res.json({ id, ...pub });
    }
  );

  router.delete(
    '/movie-channels/:id',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (
        !channel ||
        channel.userId !== req.userId ||
        !isMovieChannel(channel)
      ) {
        return res.status(404).json({ error: 'Movie channel not found' });
      }
      stopChannel(id);
      channels.delete(id);
      await dbApi.deleteChannelRow(id, req.userId);
      const streamDir = path.join(rootDir, 'streams', id);
      if (fs.existsSync(streamDir))
        fs.rmSync(streamDir, { recursive: true, force: true });
      await auditService.log(
        req.userId,
        'admin.channel.delete',
        'movie_channel',
        id,
        { name: channel.name || '' },
        req
      );
      res.json({ success: true });
    }
  );

  router.post(
    '/movie-channels/:id/start',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (
        !channel ||
        channel.userId !== req.userId ||
        !isMovieChannel(channel)
      ) {
        return res.status(404).json({ error: 'Movie channel not found' });
      }
      if (channel.status === 'running')
        return res.json({ message: 'Already running', hlsUrl: channel.hlsUrl });
      try {
        await startChannel(id, channel);
        res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.post(
    '/movie-channels/:id/stop',
    requireAuth,
    csrfProtection,
    (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (
        !channel ||
        channel.userId !== req.userId ||
        !isMovieChannel(channel)
      ) {
        return res.status(404).json({ error: 'Movie channel not found' });
      }
      stopChannel(id);
      res.json({ id, status: 'stopped' });
    }
  );

  router.post(
    '/movie-channels/:id/restart',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (
        !channel ||
        channel.userId !== req.userId ||
        !isMovieChannel(channel)
      ) {
        return res.status(404).json({ error: 'Movie channel not found' });
      }
      stopChannel(id);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await startChannel(id, channel);
        res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
};
