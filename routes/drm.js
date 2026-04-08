'use strict';

const express = require('express');
const { csrfProtection } = require('../middleware/csrf');
const { ConflictError } = require('../lib/errors');
const auditService = require('../services/auditService');

module.exports = function drmRoutes({
  requireAuth,
  channels,
  tsBroadcasts,
  isInternalChannel,
  parseExtractionDump,
  normalizeHex32,
  parseHeadersMaybe,
  mergeChannelOptions,
  dbApi,
  uuidv4,
  startChannel,
  stopChannel,
  rootDir,
  path,
  fs,
}) {
  const router = express.Router();

  router.get('/drm-restreams', requireAuth, (_req, res) => {
    const list = [];
    channels.forEach((ch, id) => {
      if (!isInternalChannel(ch)) return;
      const broadcast = tsBroadcasts.get(id);
      const clients = broadcast ? broadcast.consumers.size : 0;
      const output_url =
        ch.status === 'running' || ch.status === 'starting'
          ? `/drm/${id}/stream.ts`
          : null;
      list.push({
        id,
        version: ch.version || 1,
        name: ch.name || '',
        status: ch.status || 'stopped',
        mpdUrl: ch.mpdUrl || '',
        kid: ch.kid || '',
        key: ch.key || '',
        userAgent: ch.userAgent || '',
        headers: ch.headers || '',
        transcode_profile_id: ch.transcode_profile_id || null,
        outputFormat: 'mpegts',
        output_url,
        clients,
        createdAt: ch.createdAt || null,
      });
    });
    res.json(list);
  });

  router.post(
    '/drm-restreams/parse-preview',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const rawText =
          req.body && typeof req.body.rawText === 'string'
            ? req.body.rawText
            : '';
        if (!rawText.trim())
          return res.status(400).json({ error: 'rawText is required' });

        const parsed = parseExtractionDump(rawText);
        const mpdUrl = parsed.mpdUrl ? String(parsed.mpdUrl).trim() : '';
        const kid = parsed.kid ? String(parsed.kid).trim() : '';
        const key = parsed.key ? String(parsed.key).trim() : '';

        if (!mpdUrl || !kid || !key) {
          return res.status(400).json({
            error:
              'Could not extract MPD URL, KID, and Key from dump. Make sure it includes a DASH MPD URL plus KID and Key.',
          });
        }

        const name = parsed.nameHint ? String(parsed.nameHint).trim() : '';

        let headers =
          parsed.headers && typeof parsed.headers === 'object'
            ? { ...parsed.headers }
            : {};
        let userAgent = '';
        Object.keys(headers).forEach((k) => {
          if (String(k).toLowerCase() === 'user-agent') {
            userAgent = String(headers[k]);
            delete headers[k];
          }
        });

        res.json({
          name,
          mpdUrl,
          kid,
          key,
          userAgent,
          headers,
        });
      } catch (err) {
        res.status(500).json({ error: err.message || 'parse-preview failed' });
      }
    }
  );

  router.post(
    '/drm-restreams',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const { name, mpdUrl, kid, key, userAgent, headers } = req.body;
        if (!name || !name.trim())
          return res.status(400).json({ error: 'name is required' });
        if (!mpdUrl || !mpdUrl.trim())
          return res.status(400).json({ error: 'MPD URL is required' });
        const normKid = normalizeHex32(kid);
        const normKey = normalizeHex32(key);
        if (!normKid || !normKey)
          return res
            .status(400)
            .json({ error: 'Valid KID and Key (32 hex chars) are required' });

        const id = uuidv4().substring(0, 8);
        const headersObj = parseHeadersMaybe(headers);
        const baseChannel = {
          name: name.trim(),
          mpdUrl: mpdUrl.trim(),
          inputType: 'dash',
          headers: headersObj,
          kid: normKid,
          key: normKey,
          pssh: '',
          type: 'CLEARKEY',
          outputMode: 'copy',
          outputFormat: 'mpegts',
          userAgent: userAgent || '',
          referer: '',
          sourceQueue: [],
          sourceIndex: 0,
          channelClass: 'drm',
          is_internal: true,
          status: 'stopped',
          createdAt: new Date().toISOString(),
          hlsUrl: null,
          error: null,
          viewers: 0,
          startedAt: null,
          streamMode: 'live',
          renditionMode: 'single',
          renditions: ['1080p'],
          x264Preset: 'veryfast',
          videoEncoder: 'cpu_x264',
          audioBitrateK: 128,
          hlsSegmentSeconds: 4,
          hlsPlaylistSize: 10,
          maxRetries: 3,
          retryDelaySec: 5,
          gen_timestamps: true,
          read_native: false,
          stream_all: false,
          on_demand: false,
          stabilityScore: 100,
          stabilityStatus: 'Stable',
          stabilityLastChecked: null,
          stabilityMeta: {},
          autoFixEnabled: false,
          stabilityProfile: 'off',
          performanceProfile: 'balanced',
          streamSlot: 'a',
          watermark: { enabled: false },
          userId: req.userId,
        };

        const mergeInput = {
          ...req.body,
          mpdUrl: mpdUrl.trim(),
          inputType: 'dash',
          outputFormat: 'mpegts',
        };
        const extra = await mergeChannelOptions(baseChannel, mergeInput);
        if (
          extra &&
          extra.outputFormat === 'mpegts' &&
          extra.renditionMode === 'multi'
        ) {
          extra.renditionMode = 'single';
        }
        const channel = { ...baseChannel, ...extra };
        channel.id = id;
        channels.set(id, channel);
        await dbApi.insertChannel(id, req.userId, channel);

        const streamDir = path.join(rootDir, 'streams', id);
        if (!fs.existsSync(streamDir))
          fs.mkdirSync(streamDir, { recursive: true });

        await auditService.log(
          req.userId,
          'admin.channel.create',
          'drm_channel',
          id,
          { name: channel.name || '' },
          req
        );
        res.json({ id, output_url: `/drm/${id}/stream.ts` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.put(
    '/drm-restreams/:id',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const { id } = req.params;
        const ch = channels.get(id);
        if (!ch || !isInternalChannel(ch))
          return res.status(404).json({ error: 'DRM stream not found' });

        if (ch.status === 'running' || ch.status === 'starting') {
          stopChannel(id);
        }

        const { name, mpdUrl, kid, key, userAgent, headers } = req.body;
        if (name !== undefined) ch.name = String(name).trim();
        if (mpdUrl !== undefined) ch.mpdUrl = String(mpdUrl).trim();
        if (kid !== undefined) {
          const k = normalizeHex32(kid);
          if (k) ch.kid = k;
        }
        if (key !== undefined) {
          const k = normalizeHex32(key);
          if (k) ch.key = k;
        }
        if (userAgent !== undefined) ch.userAgent = String(userAgent);
        if (headers !== undefined) ch.headers = parseHeadersMaybe(headers);

        const mergeInput = {
          ...req.body,
          mpdUrl: ch.mpdUrl,
          inputType: 'dash',
          outputFormat: 'mpegts',
        };
        const extra = await mergeChannelOptions(ch, mergeInput);
        if (
          extra &&
          extra.outputFormat === 'mpegts' &&
          extra.renditionMode === 'multi'
        ) {
          extra.renditionMode = 'single';
        }
        Object.assign(ch, extra);

        try {
          await dbApi.updateChannelRow(
            id,
            req.userId,
            ch,
            req.body.version !== undefined ? req.body.version : ch.version
          );
        } catch (error) {
          if (error instanceof ConflictError) {
            return res.status(409).json({
              error: error.message,
              currentVersion: error.currentVersion,
            });
          }
          throw error;
        }
        await auditService.log(
          req.userId,
          'admin.channel.update',
          'drm_channel',
          id,
          { fields: Object.keys(req.body || {}) },
          req
        );
        res.json({ message: 'DRM stream updated' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.delete(
    '/drm-restreams/:id',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const { id } = req.params;
        const ch = channels.get(id);
        if (!ch || !isInternalChannel(ch))
          return res.status(404).json({ error: 'DRM stream not found' });

        if (ch.status === 'running' || ch.status === 'starting') {
          stopChannel(id);
        }
        channels.delete(id);
        await dbApi.deleteChannelRow(id, req.userId);

        const streamDir = path.join(rootDir, 'streams', id);
        try {
          fs.rmSync(streamDir, { recursive: true, force: true });
        } catch {}

        await auditService.log(
          req.userId,
          'admin.channel.delete',
          'drm_channel',
          id,
          { name: ch.name || '' },
          req
        );
        res.json({ message: 'DRM stream deleted' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.post(
    '/drm-restreams/:id/start',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const { id } = req.params;
        const ch = channels.get(id);
        if (!ch || !isInternalChannel(ch))
          return res.status(404).json({ error: 'DRM stream not found' });

        if (ch.status === 'running') {
          return res.json({
            message: 'Already running',
            output_url: `/drm/${id}/stream.ts`,
          });
        }

        await startChannel(id, ch);
        res.json({
          message: 'DRM stream started',
          output_url: `/drm/${id}/stream.ts`,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.post(
    '/drm-restreams/:id/stop',
    requireAuth,
    csrfProtection,
    (req, res) => {
      try {
        const { id } = req.params;
        const ch = channels.get(id);
        if (!ch || !isInternalChannel(ch))
          return res.status(404).json({ error: 'DRM stream not found' });

        stopChannel(id);
        res.json({ message: 'DRM stream stopped' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
};
