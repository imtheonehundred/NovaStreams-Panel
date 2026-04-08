'use strict';

const express = require('express');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const net = require('net');
const { csrfProtection } = require('../middleware/csrf');
const { ConflictError } = require('../lib/errors');
const auditService = require('../services/auditService');

module.exports = function channelRoutes({
  requireAuth,
  createImportedChannel,
  parseExtractionDump,
  channels,
  processes,
  tsBroadcasts,
  bouquetService,
  dbApi,
  isMovieChannel,
  isInternalChannel,
  serverService,
  STREAMING_MODE,
  hlsIdle,
  securityService,
  ALLOW_ADMIN_PREVIEW_UNSIGNED_TS,
  ALLOW_LOCAL_UNSIGNED_TS,
  restartWithSeamlessIfPossible,
  applyStabilityFix,
  persistChannel,
  qoeRate,
  clamp,
  computeQoeScore,
  computeFinalScore,
  startChannel,
  stopChannel,
  mergeChannelOptions,
  normalizeSourceQueue,
  resolveEffectiveInputType,
  normalizeHex32,
  WATERMARKS_DIR,
  mpegtsMultiConflict,
  rootDir,
  path,
  fs,
  uuidv4,
}) {
  const router = express.Router();

  function isPrivateIpv4(address) {
    const parts = String(address || '')
      .split('.')
      .map((part) => parseInt(part, 10));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  function isPrivateIpv6(address) {
    const normalized = String(address || '')
      .toLowerCase()
      .split('%')[0];
    if (!normalized) return true;
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith('::ffff:')) {
      return isPrivateIpv4(normalized.slice(7));
    }
    return false;
  }

  function isNonPublicAddress(address) {
    const family = net.isIP(address);
    if (family === 4) return isPrivateIpv4(address);
    if (family === 6) return isPrivateIpv6(address);
    return true;
  }

  async function assertSafeProbeUrl(rawUrl) {
    const input = String(rawUrl || '').trim();
    if (!input) throw new Error('url is required');
    if (input.length > 2048) throw new Error('url is too long');

    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error('invalid url');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('only http and https sources can be probed');
    }
    if (parsed.username || parsed.password) {
      throw new Error('url credentials are not allowed');
    }

    const hostname = String(parsed.hostname || '').trim();
    if (!hostname) throw new Error('url host is required');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      throw new Error('private or loopback hosts are not allowed');
    }

    if (net.isIP(hostname)) {
      if (isNonPublicAddress(hostname)) {
        throw new Error('private or loopback hosts are not allowed');
      }
      return parsed.toString();
    }

    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(resolved) || resolved.length === 0) {
      throw new Error('unable to resolve host');
    }
    if (resolved.some((entry) => isNonPublicAddress(entry.address))) {
      throw new Error('private or loopback hosts are not allowed');
    }

    return parsed.toString();
  }

  router.post(
    '/channels/import',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      let body = { ...(req.body || {}) };
      if (body.rawText) {
        const parsed = parseExtractionDump(body.rawText);
        body = { ...parsed, ...body };
      }
      try {
        const created = await createImportedChannel(body, req.userId);
        res.json({ id: created.id, ...created.channel });
      } catch (e) {
        res
          .status(e.statusCode || 500)
          .json({ error: e.message || 'Import failed' });
      }
    }
  );

  router.get('/channels', requireAuth, async (req, res) => {
    const list = [];
    channels.forEach((ch, id) => {
      if (ch.userId !== req.userId) return;
      if (isMovieChannel(ch)) return;
      if (isInternalChannel(ch)) return;
      const { userId, ...rest } = ch;
      const broadcast = tsBroadcasts.get(id);
      const clients = broadcast ? broadcast.consumers.size : 0;
      const si = rest.streamInfo ? { ...rest.streamInfo } : {};
      delete si._vDone;
      delete si._aDone;
      delete si._fpsDone;
      list.push({
        id,
        ...rest,
        streamInfo: si,
        clients,
        pid: processes.has(id) ? processes.get(id).pid : null,
      });
    });
    list.sort((a, b) => {
      const d = (a.sortOrder || 0) - (b.sortOrder || 0);
      return d !== 0
        ? d
        : String(a.name || '').localeCompare(String(b.name || ''));
    });
    try {
      const bmap = await bouquetService.getBouquetIdsMapForChannels(
        list.map((x) => x.id)
      );
      for (const item of list) {
        item.bouquet_ids = bmap.get(String(item.id)) || [];
      }
    } catch (_) {
      for (const item of list) item.bouquet_ids = [];
    }
    res.json(list);
  });

  router.get('/channels/logo-search', requireAuth, async (req, res) => {
    const query = String(req.query.q || '').trim();
    const excludeId = String(req.query.exclude_id || '').trim();
    if (!query) return res.json({ results: [] });
    const normalizeLogoSearch = (value) =>
      String(value || '')
        .toLowerCase()
        .replace(/\b(hd|fhd|uhd|sd|4k|channel|tv)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const normalizedQuery = normalizeLogoSearch(query);
    if (!normalizedQuery) return res.json({ results: [] });
    const terms = normalizedQuery.split(' ').filter(Boolean);
    const seen = new Set();
    const results = [];
    channels.forEach((ch, id) => {
      if (String(id) === excludeId) return;
      if (isMovieChannel(ch) || isInternalChannel(ch)) return;
      if (!ch.logoUrl) return;
      const haystack = normalizeLogoSearch(ch.name || '');
      const matches =
        haystack.includes(normalizedQuery) ||
        terms.every((term) => haystack.includes(term));
      if (!matches) return;
      if (seen.has(ch.logoUrl)) return;
      seen.add(ch.logoUrl);
      results.push({ id, name: ch.name || '', logoUrl: ch.logoUrl });
    });
    res.json({ results: results.slice(0, 18) });
  });

  router.get('/channels/:id/playback-url', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const ch = channels.get(id);
      if (!ch || ch.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      if (isMovieChannel(ch) || isInternalChannel(ch)) {
        return res
          .status(400)
          .json({ error: 'Playback URL not available for this channel type' });
      }
      const publicBase = await serverService.resolvePublicStreamOrigin(
        req,
        null
      );
      const ttlSec = Math.min(
        60,
        Math.max(
          30,
          parseInt(process.env.PLAYBACK_TOKEN_TTL_SEC || '45', 10) || 45
        )
      );
      const expiresMs = Date.now() + ttlSec * 1000;

      if (STREAMING_MODE === 'nginx' && ch.nginxStreaming) {
        if (ch.on_demand) hlsIdle.touch(id);
        const tokenHls = await securityService.generateStreamToken(
          req.userId,
          id,
          'm3u8',
          ttlSec,
          { ip: req.ip }
        );
        const sigHls = await securityService.signStreamUrl(
          tokenHls,
          expiresMs,
          id
        );
        const qsHls = new URLSearchParams({
          token: tokenHls,
          expires: String(expiresMs),
          sig: sigHls,
        }).toString();
        const hlsUrl = `${publicBase}/hls/${id}/index.m3u8?${qsHls}`;
        const tokenTs = await securityService.generateStreamToken(
          req.userId,
          id,
          'ts',
          ttlSec,
          { ip: req.ip }
        );
        const sigTs = await securityService.signStreamUrl(
          tokenTs,
          expiresMs,
          id
        );
        const qsTs = new URLSearchParams({
          token: tokenTs,
          expires: String(expiresMs),
          sig: sigTs,
        }).toString();
        const tsUrl = `${publicBase}/live/${id}.ts?${qsTs}`;
        const primary = ch.outputFormat === 'mpegts' ? tsUrl : hlsUrl;
        // Always use signed URLs — unsigned preview paths were a security risk
        const relPath =
          ch.outputFormat === 'mpegts'
            ? `/live/${id}.ts`
            : `/hls/${id}/index.m3u8`;
        const outputFormat = ch.outputFormat === 'mpegts' ? 'mpegts' : 'hls';
        const primaryKind = outputFormat === 'mpegts' ? 'ts' : 'hls';
        return res.json({
          url: primary,
          urlSigned: primary,
          relPath,
          outputFormat,
          primaryKind,
          hls: hlsUrl,
          ts: tsUrl,
          hlsUrl,
          tsUrl,
          expiresInSec: ttlSec,
          nginx: true,
        });
      }

      const ttlLegacy =
        parseInt(process.env.PLAYBACK_TOKEN_TTL_LEGACY_SEC || '3600', 10) ||
        3600;
      const expLegacy = Date.now() + ttlLegacy * 1000;
      const container = ch.outputFormat === 'hls' ? 'm3u8' : 'ts';
      if (ch.on_demand && ch.outputFormat === 'hls') hlsIdle.touch(id);
      const token = await securityService.generateStreamToken(
        req.userId,
        id,
        container,
        ttlLegacy,
        { ip: req.ip }
      );
      const sig = await securityService.signStreamUrl(token, expLegacy, id);
      const qs = new URLSearchParams({
        token,
        expires: String(expLegacy),
        sig,
      }).toString();
      let relPath;
      if (ch.outputFormat === 'mpegts') {
        relPath = `/streams/${id}/stream.ts`;
      } else {
        const rends =
          Array.isArray(ch.renditions) && ch.renditions.length
            ? ch.renditions
            : ['1080p'];
        const multi = ch.renditionMode === 'multi' && rends.length > 1;
        relPath = `/streams/${id}/${multi ? 'master.m3u8' : 'index.m3u8'}`;
      }
      const origin = await serverService.resolvePublicStreamOrigin(req, null);
      const signedUrl = `${origin}${relPath}?${qs}`;
      const isHls = ch.outputFormat === 'hls';
      // Always use signed URLs — unsigned preview paths were a security risk
      const url = signedUrl;
      const outputFormat = ch.outputFormat === 'mpegts' ? 'mpegts' : 'hls';
      const primaryKind = isHls ? 'hls' : 'ts';
      res.json({
        url,
        urlSigned: signedUrl,
        relPath,
        outputFormat,
        primaryKind,
        hls: isHls ? signedUrl : null,
        ts: isHls ? null : signedUrl,
        expiresInSec: ttlLegacy,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'playback-url failed' });
    }
  });

  router.get('/channels/:id/stability', requireAuth, async (req, res) => {
    const { id } = req.params;
    const channel = channels.get(id);
    if (!channel || channel.userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const health = await dbApi.getChannelHealth(id, req.userId);
    let meta = channel.stabilityMeta || {};
    if (health && health.meta_json) {
      try {
        meta = JSON.parse(health.meta_json);
      } catch {
        meta = channel.stabilityMeta || {};
      }
    }
    res.json({
      id,
      stability_score: health
        ? health.stability_score
        : channel.stabilityScore || 100,
      status_text: health
        ? health.status_text
        : channel.stabilityStatus || 'Stable',
      last_checked: health ? health.last_checked : channel.stabilityLastChecked,
      auto_fix_enabled: !!channel.autoFixEnabled,
      stability_profile: channel.stabilityProfile || 'off',
      meta,
    });
  });

  router.get('/channels/:id/qoe/history', requireAuth, async (req, res) => {
    const { id } = req.params;
    const channel = channels.get(id);
    if (!channel || channel.userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const limit = Math.min(
      200,
      Math.max(10, parseInt(req.query.limit, 10) || 60)
    );
    const rows = await dbApi.getQoeHistory(id, req.userId, limit);
    res.json({ id, items: rows.reverse() });
  });

  router.get('/channels/:id/qoe/summary', requireAuth, async (req, res) => {
    const { id } = req.params;
    const channel = channels.get(id);
    if (!channel || channel.userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const agg = await dbApi.getQoeAgg(id, req.userId);
    res.json({
      id,
      qoe_score: agg ? agg.qoe_score : channel.qoeScore || 100,
      final_score: agg
        ? agg.final_score
        : channel.finalStabilityScore || channel.stabilityScore || 100,
      avg_startup_ms: agg ? agg.avg_startup_ms : channel.qoeAvgStartupMs || 0,
      avg_buffer_ratio: agg
        ? agg.avg_buffer_ratio
        : channel.qoeAvgBufferRatio || 0,
      avg_latency_ms: agg ? agg.avg_latency_ms : channel.qoeAvgLatencyMs || 0,
      last_qoe_at: agg ? agg.last_qoe_at : channel.qoeLastChecked || null,
    });
  });

  router.post(
    '/channels/:id/fix',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (!channel || channel.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      const result = applyStabilityFix(id, 'degrade', { reason: 'manual' });
      if (!result.ok)
        return res.status(400).json({ error: result.error || 'Fix failed' });
      if (channel.status === 'running') {
        try {
          await restartWithSeamlessIfPossible(id, channel);
        } catch (e) {
          return res.status(500).json({ error: e.message || 'Restart failed' });
        }
      }
      res.json({
        ok: true,
        id,
        outputMode: channel.outputMode,
        stability_profile: channel.stabilityProfile,
      });
    }
  );

  router.post(
    '/channels/:id/toggle-auto-fix',
    requireAuth,
    csrfProtection,
    (req, res) => {
      const { id } = req.params;
      const channel = channels.get(id);
      if (!channel || channel.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      const enabled =
        req.body && typeof req.body.enabled === 'boolean'
          ? req.body.enabled
          : !channel.autoFixEnabled;
      channel.autoFixEnabled = !!enabled;
      persistChannel(id);
      res.json({ ok: true, id, auto_fix_enabled: channel.autoFixEnabled });
    }
  );

  router.post(
    '/channels/probe-source',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      try {
        const isAdmin = await dbApi.isAdmin(req.userId);
        if (!isAdmin)
          return res.status(403).json({ error: 'admin access required' });

        const { url, user_agent, http_proxy } = req.body || {};
        if (http_proxy)
          return res
            .status(400)
            .json({ error: 'http_proxy is not allowed for source probing' });
        if (user_agent && String(user_agent).length > 512) {
          return res.status(400).json({ error: 'user_agent is too long' });
        }

        const safeUrl = await assertSafeProbeUrl(url);
        const probeArgs = [
          '-v',
          'error',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
        ];
        if (user_agent) probeArgs.push('-user_agent', String(user_agent));
        probeArgs.push(
          '-analyzeduration',
          '3000000',
          '-probesize',
          '3000000',
          '-i',
          safeUrl
        );

        const result = await new Promise((resolve, reject) => {
          const proc = spawn('ffprobe', probeArgs, { timeout: 15000 });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (d) => {
            stdout += d;
          });
          proc.stderr.on('data', (d) => {
            stderr += d;
          });
          proc.on('close', (code) => {
            if (code !== 0)
              return reject(
                new Error(stderr || `ffprobe exited with code ${code}`)
              );
            try {
              resolve(JSON.parse(stdout));
            } catch {
              reject(new Error('Failed to parse ffprobe output'));
            }
          });
          proc.on('error', reject);
        });
        const video = (result.streams || []).find(
          (s) => s.codec_type === 'video'
        );
        const audio = (result.streams || []).find(
          (s) => s.codec_type === 'audio'
        );
        const fmt = result.format || {};
        res.json({
          video_codec: video ? video.codec_name : null,
          audio_codec: audio ? audio.codec_name : null,
          width: video ? video.width : null,
          height: video ? video.height : null,
          fps: video && video.r_frame_rate ? video.r_frame_rate : null,
          video_bitrate: video ? parseInt(video.bit_rate, 10) || null : null,
          audio_bitrate: audio ? parseInt(audio.bit_rate, 10) || null : null,
          bitrate: parseInt(fmt.bit_rate, 10) || null,
          duration: parseFloat(fmt.duration) || null,
          format: fmt.format_name || null,
        });
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        const status =
          /url|host|private|loopback|admin access|required|resolve|proxy|user_agent/i.test(
            msg
          )
            ? 400
            : 500;
        res.status(status).json({ error: msg });
      }
    }
  );

  router.post('/channels', requireAuth, csrfProtection, async (req, res) => {
    const { name, mpdUrl, headers, kid, key, pssh, type } = req.body;

    const queueIn = normalizeSourceQueue(req.body.sourceQueue);
    const primaryUrl = String(mpdUrl || queueIn[0] || '').trim();
    if (!name || !primaryUrl) {
      return res
        .status(400)
        .json({ error: 'name and at least one input url are required' });
    }

    const extra = await mergeChannelOptions(null, req.body);
    const allSources = extra.sourceQueue.length
      ? extra.sourceQueue
      : [primaryUrl];
    const hasDashInput = allSources.some(
      (u) => resolveEffectiveInputType(u, extra.inputType) === 'dash'
    );
    if (hasDashInput && (!normalizeHex32(kid) || !normalizeHex32(key))) {
      return res.status(400).json({
        error: 'For DASH input(s), kid and key are required (32 hex each)',
      });
    }

    const id = uuidv4().substring(0, 8);

    if (extra.watermark.enabled && extra.watermark.file) {
      const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
      if (!fs.existsSync(wmPath)) {
        return res.status(400).json({
          error: 'Watermark file not found. Upload one or disable watermark.',
        });
      }
    }

    if (extra.outputMode === 'copy' && extra.watermark.enabled) {
      return res.status(400).json({
        error:
          'Watermark requires transcoding. Set output to Transcode or disable watermark.',
      });
    }

    if (mpegtsMultiConflict(extra)) {
      return res.status(400).json({
        error:
          'MPEG-TS supports one program stream only. Use HLS for multi-bitrate, or single quality + single mode.',
      });
    }

    const channel = {
      name,
      mpdUrl: primaryUrl,
      headers: headers || {},
      kid,
      key,
      pssh: pssh || '',
      type: type || 'WIDEVINE',
      ...extra,
      sourceIndex: 0,
      status: 'stopped',
      createdAt: new Date().toISOString(),
      hlsUrl: null,
      error: null,
      viewers: 0,
      startedAt: null,
      channelClass: 'normal',
      is_internal: false,
      stabilityScore: 100,
      stabilityStatus: 'Stable',
      stabilityLastChecked: null,
      stabilityMeta: {},
      autoFixEnabled: extra.autoFixEnabled || false,
      stabilityProfile: extra.stabilityProfile || 'off',
      streamSlot: 'a',
      qoeScore: 100,
      qoeLastChecked: null,
      qoeAvgStartupMs: 0,
      qoeAvgBufferRatio: 0,
      qoeAvgLatencyMs: 0,
      finalStabilityScore: 100,
      userId: req.userId,
    };

    channels.set(id, channel);
    await dbApi.insertChannel(id, req.userId, channel);

    const streamDir = path.join(rootDir, 'streams', id);
    if (!fs.existsSync(streamDir)) {
      fs.mkdirSync(streamDir, { recursive: true });
    }

    const { userId, ...pub } = channel;
    const bq = req.body && req.body.bouquet_ids;
    if (Array.isArray(bq)) {
      try {
        await bouquetService.syncEntityBouquets('channels', id, bq);
      } catch (e) {
        console.error('[bouquet sync]', e.message);
      }
    }
    await auditService.log(
      req.userId,
      'admin.channel.create',
      'channel',
      id,
      { name },
      req
    );
    res.json({ id, ...pub });
  });

  router.put('/channels/:id', requireAuth, csrfProtection, async (req, res) => {
    const { id } = req.params;
    if (!channels.has(id)) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channels.get(id);

    if (channel.userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const updates = req.body || {};
    const updateKeys = Object.keys(updates);
    const logoOnlyUpdate =
      updateKeys.length > 0 && updateKeys.every((key) => key === 'logoUrl');

    if (channel.status === 'running') {
      if (logoOnlyUpdate) {
        channel.logoUrl = String(updates.logoUrl || '').trim();
        channels.set(id, channel);
        try {
          await dbApi.updateChannelRow(
            id,
            req.userId,
            channel,
            updates.version !== undefined ? updates.version : channel.version
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
          'channel',
          id,
          { fields: ['logoUrl'] },
          req
        );
        const { userId, ...pub } = channel;
        return res.json({ id, ...pub });
      }
      return res
        .status(400)
        .json({ error: 'Stop the channel first before editing' });
    }

    const extra = await mergeChannelOptions(channel, updates);

    if (extra.watermark.enabled && extra.watermark.file) {
      const wmPath = path.join(WATERMARKS_DIR, extra.watermark.file);
      if (!fs.existsSync(wmPath)) {
        return res.status(400).json({ error: 'Watermark file not found.' });
      }
    }

    if (extra.outputMode === 'copy' && extra.watermark.enabled) {
      return res.status(400).json({
        error:
          'Watermark requires transcoding. Set output to Transcode or disable watermark.',
      });
    }

    if (mpegtsMultiConflict(extra)) {
      return res.status(400).json({
        error:
          'MPEG-TS supports one program stream only. Use HLS for multi-bitrate, or single quality + single mode.',
      });
    }

    const queuePut = extra.sourceQueue.length
      ? extra.sourceQueue
      : [updates.mpdUrl || channel.mpdUrl];
    const mpdUrlFinal = String(
      updates.mpdUrl || queuePut[0] || channel.mpdUrl || ''
    ).trim();
    const hasDashPut = queuePut.some(
      (u) => resolveEffectiveInputType(u, extra.inputType) === 'dash'
    );
    const kidPut = updates.kid !== undefined ? updates.kid : channel.kid;
    const keyPut = updates.key !== undefined ? updates.key : channel.key;
    if (!mpdUrlFinal) {
      return res
        .status(400)
        .json({ error: 'at least one input url is required' });
    }
    if (hasDashPut && (!normalizeHex32(kidPut) || !normalizeHex32(keyPut))) {
      return res.status(400).json({
        error: 'For DASH input(s), kid and key are required (32 hex each)',
      });
    }

    Object.assign(channel, {
      name: updates.name || channel.name,
      mpdUrl: mpdUrlFinal,
      headers:
        updates.headers !== undefined ? updates.headers : channel.headers,
      kid: updates.kid || channel.kid,
      key: updates.key || channel.key,
      pssh: updates.pssh !== undefined ? updates.pssh : channel.pssh,
      type: updates.type || channel.type,
      ...extra,
      channelClass: 'normal',
      sourceIndex: 0,
    });

    channels.set(id, channel);
    try {
      await dbApi.updateChannelRow(
        id,
        req.userId,
        channel,
        updates.version !== undefined ? updates.version : channel.version
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
    const bqPut = updates.bouquet_ids;
    if (bqPut !== undefined) {
      try {
        await bouquetService.syncEntityBouquets(
          'channels',
          id,
          Array.isArray(bqPut) ? bqPut : []
        );
      } catch (e) {
        console.error('[bouquet sync]', e.message);
      }
    }
    await auditService.log(
      req.userId,
      'admin.channel.update',
      'channel',
      id,
      { fields: Object.keys(updates) },
      req
    );
    const { userId, ...pub } = channel;
    res.json({ id, ...pub });
  });

  router.delete(
    '/channels/:id',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      if (!channels.has(id)) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const channel = channels.get(id);
      if (channel.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      stopChannel(id);
      channels.delete(id);
      await dbApi.deleteChannelRow(id, req.userId);

      const streamDir = path.join(rootDir, 'streams', id);
      if (fs.existsSync(streamDir)) {
        fs.rmSync(streamDir, { recursive: true, force: true });
      }

      await auditService.log(
        req.userId,
        'admin.channel.delete',
        'channel',
        id,
        { name: channel.name || '' },
        req
      );
      res.json({ success: true });
    }
  );

  router.post(
    '/channels/:id/start',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      if (!channels.has(id)) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const channel = channels.get(id);

      if (channel.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      if (channel.status === 'running') {
        return res.json({ message: 'Already running', hlsUrl: channel.hlsUrl });
      }

      try {
        await startChannel(id, channel);
        res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.post('/channels/:id/stop', requireAuth, csrfProtection, (req, res) => {
    const { id } = req.params;
    if (!channels.has(id)) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channels.get(id);
    if (channel.userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    stopChannel(id);
    res.json({ id, status: 'stopped' });
  });

  router.post(
    '/channels/:id/restart',
    requireAuth,
    csrfProtection,
    async (req, res) => {
      const { id } = req.params;
      if (!channels.has(id)) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const channel = channels.get(id);
      if (channel.userId !== req.userId) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      stopChannel(id);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        await startChannel(id, channel);
        res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.get('/channels/:id/logs', requireAuth, (req, res) => {
    const { id } = req.params;
    if (!channels.has(id)) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (channels.get(id).userId !== req.userId) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const logFile = path.join(rootDir, 'logs', `${id}.log`);

    if (fs.existsSync(logFile)) {
      const logs = fs.readFileSync(logFile, 'utf-8');
      const lines = logs.split('\n').slice(-100).join('\n');
      res.json({ logs: lines });
    } else {
      res.json({ logs: '' });
    }
  });

  return router;
};
