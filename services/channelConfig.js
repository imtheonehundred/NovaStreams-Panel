'use strict';

const path = require('path');
const fetch = require('node-fetch');
const dbApi = require('../lib/db');
const { detectInputType, resolveEffectiveInputType } = require('../lib/input-detect');

function defaultWatermark() {
  return { enabled: false, file: null, position: 'br', scale: 0.12, opacity: 1 };
}

function normalizeSourceQueue(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  const s = String(input || '').trim();
  if (!s) return [];
  return [...new Set(s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean))];
}

function channelSources(channel) {
  const q = normalizeSourceQueue(channel && channel.sourceQueue);
  if (q.length > 0) return q;
  const single = String((channel && channel.mpdUrl) || '').trim();
  return single ? [single] : [];
}

function activeSourceUrl(channel) {
  const list = channelSources(channel);
  if (list.length === 0) return '';
  const idx = Number.isFinite(channel && channel.sourceIndex) ? parseInt(channel.sourceIndex, 10) : 0;
  const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.min(list.length - 1, idx)) : 0;
  return list[safeIdx];
}

function isMovieChannel(ch) {
  return String((ch && ch.channelClass) || 'normal') === 'movie';
}

function isInternalChannel(ch) {
  return !!(ch && ch.is_internal);
}

function normalizeMovieUrls(input) {
  const list = normalizeSourceQueue(input);
  return list.filter((u) => /\.(mp4|mkv|m3u8|ts)(\?|$)/i.test(u) || /^(udp|srt):\/\//i.test(u));
}

function parseM3uMovieImport(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const urls = [];
  let firstName = '';
  let firstLogo = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      if (!firstName) {
        const m1 = line.match(/tvg-name="([^"]+)"/i);
        const m2 = line.match(/,(.+)$/);
        firstName = (m1 && m1[1]) || (m2 && m2[1] ? m2[1].trim() : '') || '';
      }
      if (!firstLogo) {
        const logo = line.match(/tvg-logo="([^"]+)"/i);
        firstLogo = (logo && logo[1]) || '';
      }
      continue;
    }
    if (/^https?:\/\//i.test(line) && /\.(mp4|mkv|m3u8|ts)(\?|$)/i.test(line)) {
      urls.push(line);
    }
  }
  return {
    urls: [...new Set(urls)],
    firstName: firstName || 'Imported Movies',
    firstLogo: firstLogo || '',
  };
}

function sourceTitleFromUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const raw = decodeURIComponent((parsed.pathname || '').split('/').filter(Boolean).pop() || '');
    const clean = raw
      .replace(/\.(mpd|m3u8|mp4|mkv|ts)$/i, '')
      .replace(/[-_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || parsed.hostname || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function mpegtsMultiConflict(extra) {
  const renditions = Array.isArray(extra.renditions) ? extra.renditions : ['1080p'];
  return extra.outputFormat === 'mpegts' && extra.renditionMode === 'multi' && renditions.length > 1;
}

function parseHeadersMaybe(headersIn) {
  let headers = headersIn || {};
  if (typeof headers === 'string') {
    try {
      headers = JSON.parse(headers);
    } catch {
      headers = {};
    }
  }
  if (!headers || typeof headers !== 'object') headers = {};
  return headers;
}

function normalizeHex32(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim().toLowerCase().replace(/^0x/, '').replace(/-/g, '');
  return /^[a-f0-9]{32}$/.test(s) ? s : '';
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function computeQoeScore(input) {
  let score = 100;
  const startup = Number(input.startup_ms) || 0;
  const bufferEvents = Number(input.buffer_events) || 0;
  const bufferMs = Number(input.buffer_duration_ms) || 0;
  const errors = Number(input.errors) || 0;
  const latency = Number(input.latency_ms) || 0;
  const playbackMs = Math.max(1, Number(input.playback_ms) || 1);
  const bufferRatio = clamp(bufferMs / playbackMs, 0, 1);

  if (startup > 8000) score -= 50;
  else if (startup > 4000) score -= 35;
  else if (startup > 2000) score -= 20;
  else if (startup > 1200) score -= 10;

  score -= Math.min(35, Math.round(bufferRatio * 100));
  score -= Math.min(25, bufferEvents * 8);
  score -= Math.min(30, errors * 20);

  if (latency > 8000) score -= 35;
  else if (latency > 4000) score -= 20;
  else if (latency > 2000) score -= 10;

  return { score: clamp(score, 0, 100), bufferRatio };
}

function computeFinalScore(serverScore, qoeScore) {
  const s = Number.isFinite(Number(serverScore)) ? Number(serverScore) : 100;
  const q = Number.isFinite(Number(qoeScore)) ? Number(qoeScore) : null;
  if (q == null) return Math.round(s);
  return Math.round(0.7 * q + 0.3 * s);
}

async function fetchTextWithTimeout(url, headers, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function parseMpdInfo(xml) {
  const out = { segmentSec: null, liveDelaySec: null, codecs: [] };
  const segTpl = xml.match(/SegmentTemplate[^>]*duration="(\d+)"[^>]*timescale="(\d+)"/i);
  if (segTpl) {
    const dur = parseInt(segTpl[1], 10);
    const ts = parseInt(segTpl[2], 10) || 1;
    if (dur && ts) out.segmentSec = dur / ts;
  }
  const delay = xml.match(/suggestedPresentationDelay="PT(\d+(?:\.\d+)?)S"/i);
  if (delay) out.liveDelaySec = parseFloat(delay[1]);
  const codecMatches = xml.match(/codecs="([^"]+)"/gi) || [];
  out.codecs = codecMatches.map((m) => m.replace(/codecs="/i, '').replace(/"/g, '')).slice(0, 6);
  return out;
}

function parseHlsInfo(text) {
  const out = { targetDuration: null, isVod: false };
  const m = text.match(/#EXT-X-TARGETDURATION:(\d+)/i);
  if (m) out.targetDuration = parseInt(m[1], 10);
  if (/^#EXT-X-PLAYLIST-TYPE:VOD/im.test(text) || /#EXT-X-ENDLIST/im.test(text)) {
    out.isVod = true;
  }
  return out;
}

async function preDetectSource(channel) {
  if (!channel || channel.streamMode === 'vod' || isMovieChannel(channel)) return;
  if (channel.outputMode !== 'copy') return;
  const url = String(channel.mpdUrl || '').trim();
  if (!url) return;
  const inputType = resolveEffectiveInputType(url, channel.inputType);
  const headers = channel.headers || {};
  if (inputType === 'dash') {
    const xml = await fetchTextWithTimeout(url, headers, 3500);
    if (!xml) return;
    const info = parseMpdInfo(xml);
    const codecs = info.codecs.join(',');
    const isAvc = /avc1|h264/i.test(codecs);
    const isAac = /mp4a|aac/i.test(codecs);
    const longSeg = info.segmentSec && info.segmentSec > 4;
    if (!isAvc || !isAac || longSeg) {
      channel.outputMode = 'transcode';
      channel.x264Preset = 'ultrafast';
      channel.stabilityProfile = 'lag_fix';
    }
    channel.preDetect = { inputType, ...info };
  } else if (inputType === 'hls') {
    const text = await fetchTextWithTimeout(url, headers, 2500);
    if (!text) return;
    const info = parseHlsInfo(text);
    if (info.targetDuration && info.targetDuration > 6) {
      channel.outputMode = 'transcode';
      channel.x264Preset = 'ultrafast';
      channel.stabilityProfile = 'lag_fix';
    }
    channel.preDetect = { inputType, ...info };
  }
}

function channelRuntimeInfo(ch) {
  if (!ch) return '';
  const parts = [];
  const mode = ch.outputMode === 'transcode' ? 'transcode' : 'copy';
  parts.push(mode);
  if (ch.outputFormat) parts.push(ch.outputFormat);
  if (Array.isArray(ch.renditions) && ch.renditions.length) parts.push(ch.renditions.join(','));
  return parts.join(' / ');
}

async function mergeChannelOptions(existing, body) {
  const wm = {
    ...defaultWatermark(),
    ...(existing && existing.watermark ? existing.watermark : {}),
    ...(body.watermark && typeof body.watermark === 'object' ? body.watermark : {}),
  };
  if (wm.file) wm.file = path.basename(String(wm.file));

  let renditions = body.renditions !== undefined ? body.renditions : existing && existing.renditions;
  if (!Array.isArray(renditions) || renditions.length === 0) {
    renditions = ['1080p'];
  }

  const outputMode =
    body.outputMode !== undefined
      ? body.outputMode === 'transcode'
        ? 'transcode'
        : 'copy'
      : existing && existing.outputMode
        ? existing.outputMode
        : 'copy';

  const inputType =
    body.inputType !== undefined
      ? String(body.inputType || '').toLowerCase()
      : existing && existing.inputType
        ? String(existing.inputType || '').toLowerCase()
        : detectInputType(body.mpdUrl || (existing && existing.mpdUrl));
  const inputTypeSafe = ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(inputType)
    ? inputType
    : 'auto';

  const renditionMode =
    body.renditionMode !== undefined
      ? body.renditionMode === 'multi'
        ? 'multi'
        : 'single'
      : existing && existing.renditionMode
        ? existing.renditionMode
        : 'single';

  const presetIn =
    body.x264Preset !== undefined ? body.x264Preset : existing && existing.x264Preset;
  const x264Preset = ['ultrafast', 'veryfast', 'fast', 'medium'].includes(presetIn)
    ? presetIn
    : 'veryfast';

  const ab =
    body.audioBitrateK !== undefined ? body.audioBitrateK : existing && existing.audioBitrateK;
  const audioBitrateK = Math.min(320, Math.max(64, parseInt(ab, 10) || 128));

  const seg =
    body.hlsSegmentSeconds !== undefined
      ? body.hlsSegmentSeconds
      : existing && existing.hlsSegmentSeconds;
  const hlsSegmentSeconds = Math.min(12, Math.max(2, parseInt(seg, 10) || 4));

  const pls =
    body.hlsPlaylistSize !== undefined ? body.hlsPlaylistSize : existing && existing.hlsPlaylistSize;
  const plsN = parseInt(pls, 10);
  const hlsPlaylistSize = Number.isFinite(plsN) ? Math.min(1000, Math.max(0, plsN)) : 10;

  const streamMode =
    body.streamMode !== undefined
      ? body.streamMode === 'vod'
        ? 'vod'
        : 'live'
      : existing && existing.streamMode
        ? existing.streamMode
        : 'live';

  const vt = body.videoTrack !== undefined ? body.videoTrack : existing && existing.videoTrack;
  const videoTrack = parseInt(vt, 10);
  const at = body.audioTrack !== undefined ? body.audioTrack : existing && existing.audioTrack;
  const audioTrack = parseInt(at, 10);
  const st = body.subtitleTrack !== undefined ? body.subtitleTrack : existing && existing.subtitleTrack;
  const subtitleTrack = parseInt(st, 10);

  const httpProxy =
    body.httpProxy !== undefined
      ? String(body.httpProxy || '').trim() || null
      : existing && existing.httpProxy
        ? existing.httpProxy
        : null;

  const userAgent =
    body.userAgent !== undefined ? String(body.userAgent || '') : existing && existing.userAgent
      ? existing.userAgent
      : '';

  const referer =
    body.referer !== undefined ? String(body.referer || '') : existing && existing.referer
      ? existing.referer
      : '';

  const customFfmpegArgs =
    body.customFfmpegArgs !== undefined
      ? String(body.customFfmpegArgs || '')
      : existing && existing.customFfmpegArgs
        ? existing.customFfmpegArgs
        : '';

  const mr = body.maxRetries !== undefined ? body.maxRetries : existing && existing.maxRetries;
  const maxRetries = Math.min(100, Math.max(0, parseInt(mr, 10) || 0));

  const rd = body.retryDelaySec !== undefined ? body.retryDelaySec : existing && existing.retryDelaySec;
  const retryDelaySec = Math.min(300, Math.max(1, parseInt(rd, 10) || 5));

  const so = body.sortOrder !== undefined ? body.sortOrder : existing && existing.sortOrder;
  const sortOrder = parseInt(so, 10);
  const sortOrderN = Number.isFinite(sortOrder) ? sortOrder : 0;

  const logoUrl =
    body.logoUrl !== undefined ? String(body.logoUrl || '').trim() : existing && existing.logoUrl
      ? existing.logoUrl
      : '';

  const epgChannelId =
    body.epgChannelId !== undefined
      ? String(body.epgChannelId || '').trim()
      : existing && existing.epgChannelId
        ? existing.epgChannelId
        : '';

  const outputFormat =
    body.outputFormat !== undefined
      ? body.outputFormat === 'mpegts'
        ? 'mpegts'
        : 'hls'
      : existing && existing.outputFormat
        ? existing.outputFormat
        : 'hls';

  const rawQueue =
    body.sourceQueue !== undefined
      ? body.sourceQueue
      : existing && existing.sourceQueue
        ? existing.sourceQueue
        : [];
  const sourceQueue = normalizeSourceQueue(rawQueue);

  const sampleUrl = String(body.mpdUrl || (existing && existing.mpdUrl) || '').trim() || (sourceQueue[0] || '');

  const hlsInRaw =
    body.hlsIngestMode !== undefined ? body.hlsIngestMode : existing && existing.hlsIngestMode;
  let hlsIngestMode = String(hlsInRaw || 'direct').toLowerCase() === 'buffered' ? 'buffered' : 'direct';

  const delayRaw =
    body.hlsBufferDelaySec !== undefined
      ? body.hlsBufferDelaySec
      : existing && existing.hlsBufferDelaySec;
  let hlsBufferDelaySec = parseInt(delayRaw, 10);
  if (!Number.isFinite(hlsBufferDelaySec)) hlsBufferDelaySec = 30;
  hlsBufferDelaySec = Math.min(600, Math.max(5, hlsBufferDelaySec));

  const effInputForHls = resolveEffectiveInputType(sampleUrl, inputTypeSafe);
  if (outputFormat !== 'hls' || effInputForHls !== 'hls') {
    hlsIngestMode = 'direct';
  }

  const hlsProxyRaw =
    body.hlsProxyMode !== undefined
      ? !!body.hlsProxyMode
      : existing && existing.hlsProxyMode !== undefined
        ? !!existing.hlsProxyMode
        : true;
  const hlsProxyMode = effInputForHls === 'hls' ? hlsProxyRaw : false;

  const gen_timestamps = body.gen_timestamps !== undefined ? !!body.gen_timestamps
    : existing && existing.gen_timestamps !== undefined ? !!existing.gen_timestamps : true;

  const read_native = body.read_native !== undefined ? !!body.read_native
    : existing && existing.read_native !== undefined ? !!existing.read_native : false;

  const minimalIngest =
    body.minimalIngest !== undefined
      ? !!body.minimalIngest
      : existing && existing.minimalIngest !== undefined
        ? !!existing.minimalIngest
        : existing == null
          ? true
          : false;

  const stream_all = body.stream_all !== undefined ? !!body.stream_all
    : existing && existing.stream_all !== undefined ? !!existing.stream_all : false;

  const allow_record = body.allow_record !== undefined ? !!body.allow_record
    : existing && existing.allow_record !== undefined ? !!existing.allow_record : true;

  const fps_restart = body.fps_restart !== undefined ? !!body.fps_restart
    : existing && existing.fps_restart !== undefined ? !!existing.fps_restart : false;

  const fpsThRaw = body.fps_threshold !== undefined ? body.fps_threshold
    : existing && existing.fps_threshold;
  const fps_threshold = Math.min(100, Math.max(1, parseInt(fpsThRaw, 10) || 90));

  const custom_sid = body.custom_sid !== undefined ? String(body.custom_sid || '').trim()
    : existing && existing.custom_sid ? existing.custom_sid : '';

  const probRaw = body.probesize_ondemand !== undefined ? body.probesize_ondemand
    : existing && existing.probesize_ondemand;
  const probesize_ondemand = Math.max(0, parseInt(probRaw, 10) || 1500000);

  const delayRawMin = body.delay_minutes !== undefined ? body.delay_minutes
    : existing && existing.delay_minutes;
  const delay_minutes = Math.max(0, parseInt(delayRawMin, 10) || 0);

  const notes = body.notes !== undefined ? String(body.notes || '')
    : existing && existing.notes ? existing.notes : '';

  const join_sub_category_ids = (() => {
    const raw = body.join_sub_category_ids !== undefined
      ? body.join_sub_category_ids
      : existing && existing.join_sub_category_ids !== undefined
        ? existing.join_sub_category_ids
        : existing && existing.joinSubCategoryIds !== undefined
          ? existing.joinSubCategoryIds
          : [];
    return Array.isArray(raw)
      ? raw.map((value) => parseInt(value, 10)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
  })();

  const on_demand = body.on_demand !== undefined ? !!body.on_demand
    : existing && existing.on_demand !== undefined ? !!existing.on_demand : false;

  const preWarm =
    body.preWarm !== undefined
      ? !!body.preWarm
      : existing && existing.preWarm !== undefined
        ? !!existing.preWarm
        : false;

  let prebuffer_size_mb =
    body.prebuffer_size_mb !== undefined && body.prebuffer_size_mb !== null && body.prebuffer_size_mb !== ''
      ? parseFloat(body.prebuffer_size_mb, 10)
      : existing && existing.prebuffer_size_mb !== undefined && existing.prebuffer_size_mb !== null
        ? parseFloat(existing.prebuffer_size_mb, 10)
        : null;
  if (prebuffer_size_mb !== null && (!Number.isFinite(prebuffer_size_mb) || prebuffer_size_mb <= 0)) {
    prebuffer_size_mb = null;
  }

  let ingest_style_override = '';
  if (body.ingest_style_override !== undefined) {
    ingest_style_override = String(body.ingest_style_override || '').trim().toLowerCase();
  } else if (existing && existing.ingest_style_override !== undefined) {
    ingest_style_override = String(existing.ingest_style_override || '').trim().toLowerCase();
  }
  if (ingest_style_override && !['webapp', 'xc', 'safe'].includes(ingest_style_override)) {
    ingest_style_override = '';
  }

  const restart_on_edit = body.restart_on_edit !== undefined ? !!body.restart_on_edit
    : existing && existing.restart_on_edit !== undefined ? !!existing.restart_on_edit : false;

  const epg_offset = body.epg_offset !== undefined ? parseInt(body.epg_offset, 10) || 0
    : existing && existing.epg_offset !== undefined ? existing.epg_offset : 0;

  const epg_source_id = body.epg_source_id !== undefined
    ? Math.max(0, parseInt(body.epg_source_id, 10) || 0)
    : existing && existing.epg_source_id !== undefined
      ? Math.max(0, parseInt(existing.epg_source_id, 10) || 0)
      : 0;

  const epg_language = body.epg_language !== undefined
    ? String(body.epg_language || '').trim().toLowerCase()
    : existing && existing.epg_language
      ? String(existing.epg_language || '').trim().toLowerCase()
      : '';

  const category_id = body.category_id !== undefined ? (body.category_id || null)
    : existing && existing.category_id !== undefined ? existing.category_id : null;

  const direct_source = body.direct_source !== undefined
    ? !!body.direct_source
    : existing && existing.direct_source !== undefined
      ? !!existing.direct_source
      : false;

  const protect_stream = body.protect_stream !== undefined
    ? !!body.protect_stream
    : existing && existing.protect_stream !== undefined
      ? !!existing.protect_stream
      : false;

  const custom_map_query = body.custom_map_query !== undefined
    ? String(body.custom_map_query || '').trim()
    : existing && existing.custom_map_query
      ? String(existing.custom_map_query || '').trim()
      : '';

  const custom_map_entries = (() => {
    const raw = body.custom_map_entries !== undefined
      ? body.custom_map_entries
      : existing && existing.custom_map_entries !== undefined
        ? existing.custom_map_entries
        : [];
    return Array.isArray(raw)
      ? raw
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            return {
              type: String(entry.type || 'Manual').trim() || 'Manual',
              info: String(entry.info || '').trim(),
            };
          }
          const info = String(entry || '').trim();
          return info ? { type: 'Manual', info } : null;
        })
        .filter((entry) => entry && entry.info)
      : [];
  })();

  const restart_days = body.restart_days !== undefined
    ? String(body.restart_days || '').trim()
    : existing && existing.restart_days
      ? String(existing.restart_days || '').trim()
      : '';

  const restart_time = body.restart_time !== undefined
    ? String(body.restart_time || '').trim()
    : existing && existing.restart_time
      ? String(existing.restart_time || '').trim()
      : '';

  const timeshift_server_id = body.timeshift_server_id !== undefined
    ? Math.max(0, parseInt(body.timeshift_server_id, 10) || 0)
    : existing && existing.timeshift_server_id !== undefined
      ? Math.max(0, parseInt(existing.timeshift_server_id, 10) || 0)
      : 0;

  const timeshift_days = body.timeshift_days !== undefined
    ? Math.max(0, parseInt(body.timeshift_days, 10) || 0)
    : existing && existing.timeshift_days !== undefined
      ? Math.max(0, parseInt(existing.timeshift_days, 10) || 0)
      : 0;

  const veIn = body.videoEncoder !== undefined ? String(body.videoEncoder || '').toLowerCase() : existing && existing.videoEncoder;
  const videoEncoder = ['cpu_x264', 'apple', 'nvidia', 'intel', 'amd'].includes(veIn) ? veIn : 'cpu_x264';

  const perfIn =
    body.performanceProfile !== undefined
      ? String(body.performanceProfile || '').toLowerCase()
      : existing && existing.performanceProfile;
  const performanceProfile = ['balanced', 'low_cpu_stable', 'low_low_low'].includes(perfIn)
    ? perfIn
    : 'balanced';

  const stabilityIn =
    body.stabilityProfile !== undefined
      ? String(body.stabilityProfile || '').toLowerCase()
      : existing && existing.stabilityProfile;
  const stabilityProfile = stabilityIn === 'lag_fix' ? 'lag_fix' : 'off';

  const autoFixEnabled =
    body.autoFixEnabled !== undefined
      ? !!body.autoFixEnabled
      : existing && existing.autoFixEnabled
        ? true
        : false;

  const hlsSegDefault = performanceProfile === 'low_low_low' ? 8 : performanceProfile === 'low_cpu_stable' ? 6 : hlsSegmentSeconds;
  const hlsSegmentSecondsEff = Math.min(12, Math.max(2, parseInt(hlsSegDefault, 10) || 4));

  if (wm.opacity !== undefined && wm.opacity !== null && wm.opacity !== '') {
    const op = parseFloat(wm.opacity);
    wm.opacity = Number.isFinite(op) ? Math.min(1, Math.max(0.05, op)) : 1;
  } else if (existing && existing.watermark && existing.watermark.opacity !== undefined) {
    wm.opacity = existing.watermark.opacity;
  } else {
    wm.opacity = 1;
  }

  const tpIdRaw = body.transcode_profile_id !== undefined ? body.transcode_profile_id : existing && existing.transcode_profile_id;
  const transcode_profile_id = tpIdRaw ? parseInt(tpIdRaw, 10) || null : null;

  const stream_server_id = body.stream_server_id !== undefined
    ? (() => {
        const n = parseInt(body.stream_server_id, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })()
    : existing && existing.stream_server_id != null
      ? (() => {
          const n = parseInt(existing.stream_server_id, 10);
          return Number.isFinite(n) && n > 0 ? n : 0;
        })()
      : 0;

  let effOutputMode = outputMode;
  let effVideoEncoder = videoEncoder;
  let effX264Preset = x264Preset;
  let effRenditionMode = renditionMode;
  let effRenditions = renditions;
  let effAudioBitrateK = audioBitrateK;
  let effHlsSegmentSeconds = hlsSegmentSecondsEff;
  let effHlsPlaylistSize = hlsPlaylistSize;

  if (transcode_profile_id) {
    try {
      const tp = await dbApi.getTranscodeProfile(transcode_profile_id);
      if (tp) {
        effOutputMode = tp.output_mode || 'copy';
        effVideoEncoder = tp.video_encoder || 'cpu_x264';
        effX264Preset = tp.x264_preset || 'veryfast';
        effRenditionMode = tp.rendition_mode || 'single';
        try { effRenditions = JSON.parse(tp.renditions || '["1080p"]'); } catch { effRenditions = ['1080p']; }
        effAudioBitrateK = tp.audio_bitrate_k || 128;
        effHlsSegmentSeconds = tp.hls_segment_seconds || 4;
        effHlsPlaylistSize = tp.hls_playlist_size || 10;
      }
    } catch (e) {
      console.error('[mergeChannelOptions] Failed to load transcode profile:', e.message);
    }
  }

  return {
    inputType: inputTypeSafe,
    outputMode: effOutputMode,
    renditionMode: effRenditionMode,
    renditions: effRenditions,
    watermark: wm,
    x264Preset: effX264Preset,
    videoEncoder: effVideoEncoder,
    performanceProfile,
    stabilityProfile,
    autoFixEnabled,
    audioBitrateK: effAudioBitrateK,
    hlsSegmentSeconds: effHlsSegmentSeconds,
    hlsPlaylistSize: effHlsPlaylistSize,
    streamMode,
    videoTrack: Number.isFinite(videoTrack) && videoTrack >= 0 ? videoTrack : -1,
    audioTrack: Number.isFinite(audioTrack) && audioTrack >= 0 ? audioTrack : -1,
    subtitleTrack: Number.isFinite(subtitleTrack) && subtitleTrack >= 0 ? subtitleTrack : -1,
    httpProxy,
    userAgent,
    referer,
    customFfmpegArgs,
    maxRetries,
    retryDelaySec,
    sortOrder: sortOrderN,
    logoUrl,
    epgChannelId,
    outputFormat,
    sourceQueue,
    hlsIngestMode,
    hlsBufferDelaySec,
    hlsProxyMode,
    gen_timestamps,
    read_native,
    minimalIngest,
    stream_all,
    allow_record,
    fps_restart,
    fps_threshold,
    custom_sid,
    probesize_ondemand,
    delay_minutes,
    notes,
    join_sub_category_ids,
    on_demand,
    preWarm,
    prebuffer_size_mb,
    ingest_style_override: ingest_style_override || null,
    restart_on_edit,
    epg_offset,
    epg_source_id,
    epg_language,
    category_id,
    direct_source,
    protect_stream,
    custom_map_query,
    custom_map_entries,
    restart_days,
    restart_time,
    timeshift_server_id,
    timeshift_days,
    transcode_profile_id,
    stream_server_id,
  };
}

function createImportedChannelFactory({ channels, rootDir, watermarksDir, uuidv4, fs }) {
  return async function createImportedChannel(bodyIn, userId) {
    const body = { ...(bodyIn || {}) };
    body.headers = parseHeadersMaybe(body.headers);
    if (body.userAgent) body.headers['User-Agent'] = body.userAgent;
    if (body.referer) body.headers.Referer = body.referer;

    const name =
      body.name ||
      body.nameHint ||
      (body.pageUrl ? String(body.pageUrl).split('/').filter(Boolean).pop() : null) ||
      'Imported channel';

    const mpdUrl = body.mpdUrl;
    const inputType = ['auto', 'dash', 'hls', 'ts', 'rtmp', 'srt', 'udp'].includes(body.inputType)
      ? body.inputType
      : detectInputType(mpdUrl);
    const kid = normalizeHex32(body.kid);
    const key = normalizeHex32(body.key);
    if (!mpdUrl) {
      const err = new Error('mpdUrl is required');
      err.statusCode = 400;
      throw err;
    }
    const effectiveIn = resolveEffectiveInputType(mpdUrl, inputType);
    if (effectiveIn === 'dash' && (!kid || !key)) {
      const err = new Error('For DASH input, kid and key are required (32-hex expected)');
      err.statusCode = 400;
      throw err;
    }

    const id = uuidv4().substring(0, 8);
    const extra = await mergeChannelOptions(null, body);

    for (const [, ch] of channels.entries()) {
      if (ch.userId !== userId) continue;
      if (String(ch.mpdUrl || '') !== String(mpdUrl)) continue;
      if (normalizeHex32(ch.kid) !== kid) continue;
      if (normalizeHex32(ch.key) && normalizeHex32(ch.key) !== key) {
        const err = new Error('Conflicting key detected for same MPD/KID. Existing channel uses a different key; import blocked to avoid corrupted stream.');
        err.statusCode = 409;
        throw err;
      }
    }

    if (extra.watermark.enabled && extra.watermark.file) {
      const wmPath = path.join(watermarksDir, extra.watermark.file);
      if (!fs.existsSync(wmPath)) {
        const err = new Error('Watermark file not found; disable watermark or upload it first.');
        err.statusCode = 400;
        throw err;
      }
    }
    if (extra.outputMode === 'copy' && extra.watermark.enabled) {
      const err = new Error('Watermark requires transcode.');
      err.statusCode = 400;
      throw err;
    }
    if (mpegtsMultiConflict(extra)) {
      const err = new Error('MPEG-TS supports one program stream only. Use HLS for multi-bitrate.');
      err.statusCode = 400;
      throw err;
    }

    const channel = {
      name,
      mpdUrl,
      inputType,
      headers: body.headers || {},
      kid,
      key,
      pssh: body.pssh || '',
      type: body.type || 'WIDEVINE',
      ...extra,
      channelClass: 'normal',
      is_internal: false,
      status: 'stopped',
      createdAt: new Date().toISOString(),
      hlsUrl: null,
      error: null,
      viewers: 0,
      startedAt: null,
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
      userId,
    };
    channel.id = id;
    channels.set(id, channel);
    await dbApi.insertChannel(id, userId, channel);

    const streamDir = path.join(rootDir, 'streams', id);
    if (!fs.existsSync(streamDir)) {
      fs.mkdirSync(streamDir, { recursive: true });
    }

    const { userId: _uid, ...pub } = channel;
    return { id, channel: pub };
  };
}

module.exports = {
  defaultWatermark,
  normalizeSourceQueue,
  channelSources,
  activeSourceUrl,
  isMovieChannel,
  isInternalChannel,
  normalizeMovieUrls,
  parseM3uMovieImport,
  sourceTitleFromUrl,
  mpegtsMultiConflict,
  parseHeadersMaybe,
  normalizeHex32,
  clamp,
  computeQoeScore,
  computeFinalScore,
  fetchTextWithTimeout,
  parseMpdInfo,
  parseHlsInfo,
  preDetectSource,
  channelRuntimeInfo,
  mergeChannelOptions,
  createImportedChannelFactory,
};
