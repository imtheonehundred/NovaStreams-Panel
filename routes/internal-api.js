'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { clamp, computeQoeScore, computeFinalScore } = require('../services/channelConfig');

function getSourceUrlFromRow(row) {
  if (row.stream_source) {
    try {
      const parsed = JSON.parse(row.stream_source);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = String(parsed[0] || '').trim();
        if (first) return first;
      }
    } catch {}
  }
  return String(row.stream_url || '').trim();
}

function getSourceUrlFromEpisodeRow(ep) {
  if (ep.stream_source) {
    try {
      const parsed = JSON.parse(ep.stream_source);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = String(parsed[0] || '').trim();
        if (first) return first;
      }
    } catch {}
  }
  return String(ep.stream_url || '').trim();
}

module.exports = function internalApiRoutes({
  requireAuth,
  requireAdminAuth,
  requireApiKey,
  csrfProtection,
  dbApi,
  channels,
  qoeRate,
  processes,
  createImportedChannel,
  parseExtractionDump,
  securityService,
  detectInputType,
  resolveEffectiveInputType,
  buildFfprobeArgs,
  spawn,
  watermarksDir,
  getMaxFfmpegProcesses,
  setMaxFfmpegProcesses,
  applyStabilityFix,
  restartWithSeamlessIfPossible,
  persistChannel,
}) {
  const router = express.Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, watermarksDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? ext : '.png'}`;
        cb(null, safe);
      },
    }),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(png|jpeg|jpg)$/.test(file.mimetype);
      cb(ok ? null : new Error('Only PNG or JPEG images'), ok);
    },
  });

  router.get('/stream/node-validate', async (req, res) => {
    const { token, expires, sig, asset, id } = req.query;
    if (!token || !expires || !sig || !asset || !id) {
      return res.status(400).json({ ok: false, error: 'missing parameters' });
    }
    if (asset === 'live') {
      return res.status(410).json({ ok: false, error: 'live node validation is de-scoped in TARGET' });
    }
    const channelId = `${asset}:${id}`;
    const verdict = await securityService.validateStreamAccess({
      token: String(token),
      expires: String(expires),
      sig: String(sig),
      ip: req.ip,
      channelId,
    });
    if (!verdict.ok) {
      return res.status(401).json({ ok: false, error: verdict.error || 'unauthorized' });
    }
    let sourceUrl = '';
    let container = 'mp4';
    const lineId = verdict.session ? verdict.session.user.id : (verdict.lineUserId || null);
    if (asset === 'movie') {
      const movieId = parseInt(id, 10);
      const row = await dbApi.getMovieById(movieId);
      if (row) {
        sourceUrl = getSourceUrlFromRow(row);
        container = row.container_extension || 'mp4';
      }
    } else if (asset === 'episode') {
      const episodeId = parseInt(id, 10);
      const ep = await dbApi.getEpisodeById(episodeId);
      if (ep) {
        sourceUrl = getSourceUrlFromEpisodeRow(ep);
        container = ep.container_extension || 'mp4';
      }
    }
    if (!sourceUrl) {
      return res.status(404).json({ ok: false, error: 'source not found' });
    }
    return res.json({ ok: true, streamId: String(id), container, sourceUrl, lineId });
  });

  router.get('/extension/ping', requireApiKey, async (req, res) => {
    const u = await dbApi.findUserById(req.userId);
    res.json({
      ok: true,
      user: u ? { id: u.id, username: u.username } : null,
      ts: Date.now(),
    });
  });

  router.post('/extension/import', requireApiKey, async (req, res) => {
    let body = { ...(req.body || {}) };
    if (body.rawText) {
      const parsed = parseExtractionDump(body.rawText);
      delete body.rawText;
      body = { ...parsed, ...body };
    }
    try {
      const created = await createImportedChannel(body, req.userId);
      res.json({ id: created.id, ...created.channel });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message || 'Import failed' });
    }
  });

  router.get('/watermarks', requireAdminAuth, (_req, res) => {
    try {
      const files = fs.existsSync(watermarksDir)
        ? fs.readdirSync(watermarksDir).filter((f) => /\.(png|jpe?g)$/i.test(f))
        : [];
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/watermarks', requireAdminAuth, csrfProtection, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      return res.json({ filename: req.file.filename });
    });
  });

  router.post('/qoe/report', async (req, res) => {
    const body = req.body || {};
    const channelId = String(body.channel_id || '').trim();
    if (!channelId || !channels.has(channelId)) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const ch = channels.get(channelId);

    const key = `${req.ip || 'ip'}:${channelId}`;
    const now = Date.now();
    const last = qoeRate.get(key) || 0;
    if (now - last < 4000) {
      return res.status(429).json({ error: 'Too many reports' });
    }
    qoeRate.set(key, now);

    const startup_ms = clamp(parseInt(body.startup_ms, 10) || 0, 0, 60000);
    const buffer_events = clamp(parseInt(body.buffer_events, 10) || 0, 0, 1000);
    const buffer_duration_ms = clamp(parseInt(body.buffer_duration_ms, 10) || 0, 0, 600000);
    const errors = clamp(parseInt(body.errors, 10) || 0, 0, 100);
    const latency_ms = clamp(parseInt(body.latency_ms, 10) || 0, 0, 60000);
    const bitrate_switches = clamp(parseInt(body.bitrate_switches, 10) || 0, 0, 1000);
    const dropped_frames = clamp(parseInt(body.dropped_frames, 10) || 0, 0, 100000);
    const playback_ms = clamp(parseInt(body.playback_ms, 10) || 0, 1, 600000);

    const qoe = computeQoeScore({
      startup_ms,
      buffer_events,
      buffer_duration_ms,
      errors,
      latency_ms,
      playback_ms,
    });

    await dbApi.insertQoeMetric({
      channel_id: channelId,
      user_id: ch.userId,
      startup_ms,
      buffer_events,
      buffer_duration_ms,
      errors,
      latency_ms,
      bitrate_switches,
      dropped_frames,
      playback_ms,
      qoe_score: qoe.score,
    });

    const prev = await dbApi.getQoeAgg(channelId, ch.userId);
    const alpha = 0.2;
    const avgStartup = prev ? prev.avg_startup_ms * (1 - alpha) + startup_ms * alpha : startup_ms;
    const avgBufRatio = prev ? prev.avg_buffer_ratio * (1 - alpha) + qoe.bufferRatio * alpha : qoe.bufferRatio;
    const avgLatency = prev ? prev.avg_latency_ms * (1 - alpha) + latency_ms * alpha : latency_ms;
    const finalScore = computeFinalScore(ch.stabilityScore, qoe.score);
    const agg = {
      last_qoe_at: new Date().toISOString(),
      qoe_score: qoe.score,
      final_score: finalScore,
      avg_startup_ms: avgStartup,
      avg_buffer_ratio: avgBufRatio,
      avg_latency_ms: avgLatency,
    };
    await dbApi.upsertQoeAgg(channelId, ch.userId, agg);

    ch.qoeScore = qoe.score;
    ch.qoeLastChecked = agg.last_qoe_at;
    ch.qoeAvgStartupMs = avgStartup;
    ch.qoeAvgBufferRatio = avgBufRatio;
    ch.qoeAvgLatencyMs = avgLatency;
    ch.finalStabilityScore = finalScore;
    await persistChannel(channelId);

    if (ch.autoFixEnabled && ch.stabilityScore >= 85 && qoe.score < 60) {
      applyStabilityFix(channelId, 'degrade', { reason: 'client_qoe' });
      if (ch.status === 'running') {
        setTimeout(() => {
          restartWithSeamlessIfPossible(channelId, ch).catch(() => {});
        }, 200);
      }
    }

    res.json({ ok: true, qoe_score: qoe.score, final_score: finalScore });
  });

  router.get('/input/detect', requireAuth, (req, res) => {
    const url = String(req.query.url || '');
    const selected = String(req.query.selected || 'auto').toLowerCase();
    const detected = detectInputType(url);
    const effective = resolveEffectiveInputType(url, selected);
    res.json({
      detected,
      effective,
      selected: ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(selected) ? selected : 'auto',
    });
  });

  router.post('/probe', requireAdminAuth, csrfProtection, (req, res) => {
    const body = req.body || {};
    if (!body.mpdUrl) {
      return res.status(400).json({ error: 'mpdUrl is required' });
    }
    const ch = {
      mpdUrl: body.mpdUrl,
      inputType: body.inputType
        ? String(body.inputType).toLowerCase()
        : detectInputType(body.mpdUrl),
      headers: body.headers || {},
      kid: body.kid,
      key: body.key,
      userAgent: body.userAgent,
      referer: body.referer,
      httpProxy: body.httpProxy,
      streamMode: body.streamMode === 'vod' ? 'vod' : 'live',
    };
    const args = buildFfprobeArgs(ch);
    const pr = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    pr.stdout.on('data', (d) => {
      stdout += d;
    });
    pr.stderr.on('data', (d) => {
      stderr += d;
    });
    pr.on('error', (e) => {
      res.status(500).json({ error: e.message });
    });
    pr.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: stderr || 'ffprobe failed', code, stderr });
      }
      try {
        const json = JSON.parse(stdout);
        res.json(json);
      } catch {
        res.status(500).json({ error: 'Failed to parse ffprobe JSON', stderr, stdout });
      }
    });
  });

  router.get('/settings/ffmpeg-limits', requireAdminAuth, (_req, res) => {
    const maxProcesses = getMaxFfmpegProcesses();
    res.json({
      max_processes: maxProcesses || 0,
      current_processes: processes.size,
      unlimited: maxProcesses === 0,
    });
  });

  router.put('/settings/ffmpeg-limits', requireAdminAuth, csrfProtection, (req, res) => {
    const { max_processes } = req.body;
    const val = parseInt(max_processes, 10);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: 'max_processes must be a non-negative integer (0 = unlimited)' });
    }
    setMaxFfmpegProcesses(val);
    res.json({
      max_processes: getMaxFfmpegProcesses(),
      current_processes: processes.size,
      unlimited: getMaxFfmpegProcesses() === 0,
    });
  });

  return router;
};
