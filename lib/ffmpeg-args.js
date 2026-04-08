/**
 * Build FFmpeg argument arrays for MPD → HLS (copy, single transcode, multi-bitrate ABR).
 */
const path = require('path');
const fs = require('fs');
const { resolveEffectiveInputType } = require('./input-detect');
const streamingSettings = require('./streaming-settings');

const RENDITION_ORDER = ['360p', '480p', '720p', '1080p'];

const RENDITION_PRESETS = {
  '1080p': { height: 1080, vbr: '5000k', maxrate: '5350k', bufsize: '7500k' },
  '720p': { height: 720, vbr: '2800k', maxrate: '2990k', bufsize: '4200k' },
  '480p': { height: 480, vbr: '1200k', maxrate: '1280k', bufsize: '1800k' },
  '360p': { height: 360, vbr: '800k', maxrate: '900k', bufsize: '1200k' },
};

const OVERLAY_POS = {
  br: 'W-w-10:H-h-10',
  bl: '10:H-h-10',
  tr: 'W-w-10:10',
  tl: '10:10',
  center: '(W-w)/2:(H-h)/2',
};

function sortRenditions(selected) {
  const uniq = [...new Set(selected)].filter((r) => RENDITION_PRESETS[r]);
  return uniq.sort((a, b) => RENDITION_ORDER.indexOf(a) - RENDITION_ORDER.indexOf(b));
}

function needsTranscode(channel) {
  const wm = channel.watermark && channel.watermark.enabled && channel.watermark.file;
  if (wm) return true;
  return channel.outputMode === 'transcode';
}

function resolveWatermarkPath(channel, rootDir) {
  if (!channel.watermark || !channel.watermark.enabled || !channel.watermark.file) return null;
  const safe = path.basename(channel.watermark.file);
  const full = path.join(rootDir, 'watermarks', safe);
  if (!fs.existsSync(full)) return null;
  return full;
}

/** Merge JSON headers with quick User-Agent / Referer overrides. */
function buildMergedHeaders(channel) {
  const h = { ...(channel.headers || {}) };
  if (channel.userAgent && String(channel.userAgent).trim()) {
    h['User-Agent'] = String(channel.userAgent).trim();
  }
  if (channel.referer && String(channel.referer).trim()) {
    h['Referer'] = String(channel.referer).trim();
  }
  return h;
}

function headerArgsFromChannel(channel) {
  const h = buildMergedHeaders(channel);
  if (Object.keys(h).length === 0) return [];
  const headerString = Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  return ['-headers', headerString + '\r\n'];
}

function effectiveInputType(channel) {
  return resolveEffectiveInputType(channel?.mpdUrl, channel?.inputType);
}

/** HLS / RTMP need extra demuxer options; DASH CENC stays unchanged. */
function inputProtocolArgs(channel) {
  const t = effectiveInputType(channel);
  if (t === 'hls') {
    return [
      '-protocol_whitelist',
      'file,http,https,tcp,tls,crypto,subfile',
      '-allowed_extensions',
      'ALL',
      '-allowed_segment_extensions',
      'ALL',
      '-http_persistent',
      '1',
      '-http_multiple',
      '1',
      '-http_seekable',
      '0',
      '-max_reload',
      '100000',
    ];
  }
  if (t === 'rtmp') {
    const vod = String(channel?.streamMode || 'live').toLowerCase() === 'vod';
    return vod ? [] : ['-rtmp_live', 'live'];
  }
  return [];
}

function cencArgsFromChannel(channel) {
  if (effectiveInputType(channel) !== 'dash') return [];
  const kid = normalizeHexKid(channel.kid);
  const key = normalizeHexKey(channel.key);
  if (kid && key) return ['-cenc_decryption_keys', `${kid}=${key}`];
  return [];
}

function trackV(channel) {
  const n = parseInt(channel.videoTrack, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function trackA(channel) {
  const n = parseInt(channel.audioTrack, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function trackS(channel) {
  const n = parseInt(channel.subtitleTrack, 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

function vLabel(channel) {
  return `[0:v:${trackV(channel)}]`;
}

function aLabel(channel) {
  return `[0:a:${trackA(channel)}]`;
}

/** True for http(s)/rtmp/srt/udp URLs; local paths and bare files get -re when appropriate. */
function isNetworkStreamUrl(src) {
  const s = String(src || '').trim();
  return (
    /^https?:\/\//i.test(s) ||
    /^rtmps?:\/\//i.test(s) ||
    /^srt:\/\//i.test(s) ||
    /^udp:\/\//i.test(s)
  );
}

/**
 * Xtream-style: do not use -re for HTTP HLS/TS (read toward live edge as fast as the network allows).
 * Use -re for RTMP live, local file inputs, or when channel.read_native === true (HLS only).
 */
function liveReadArgs(channel) {
  if (channel.streamMode === 'vod') return [];
  const t = effectiveInputType(channel);
  if (t === 'dash') {
    return ['-readrate', '1', '-readrate_initial_burst', '0.5', '-readrate_catchup', '1.0'];
  }
  if (t === 'hls') {
    return channel.read_native === true ? ['-re'] : [];
  }
  if (t === 'rtmp') {
    const vod = String(channel?.streamMode || 'live').toLowerCase() === 'vod';
    return vod ? [] : ['-re'];
  }
  if (t === 'srt' || t === 'udp') {
    return [];
  }
  if (t === 'ts') {
    return [];
  }
  const src = String(channel?.mpdUrl || '').trim();
  if (src && !isNetworkStreamUrl(src)) {
    return ['-re'];
  }
  return [];
}

function stabilityFixEnabled(channel) {
  return String(channel?.stabilityProfile || '').toLowerCase() === 'lag_fix';
}

function stabilityInputArgs(channel) {
  if (!stabilityFixEnabled(channel)) return [];
  return ['-fflags', '+genpts', '-use_wallclock_as_timestamps', '1', '-avoid_negative_ts', 'make_zero'];
}

function combinedFflagsArgs(channel) {
  if (stabilityFixEnabled(channel)) return [];
  const flags = [];
  if (channel.gen_timestamps !== false) flags.push('+genpts');
  if (channel.streamMode !== 'vod') flags.push('+nobuffer');
  if (flags.length === 0) return [];
  const args = ['-fflags', flags.join('')];
  if (channel.streamMode !== 'vod') args.push('-flags', 'low_delay');
  return args;
}

/** Stable profile: genpts only, no +nobuffer / low_delay on live. */
function combinedFflagsArgsSafe(channel) {
  if (stabilityFixEnabled(channel)) return [];
  if (channel.gen_timestamps === false) return [];
  return ['-fflags', '+genpts'];
}

function streamAllArgs(channel) {
  if (!channel.stream_all) return [];
  return ['-map', '0', '-copy_unknown'];
}

/** Global ingest style from settings (webapp | xc | safe). */
function webappIngestStyle() {
  return streamingSettings.getGlobalIngestStyle() === 'webapp';
}

function getEffectiveIngestStyle(channel) {
  return streamingSettings.getEffectiveIngestStyle(channel);
}

/** Minimal probe: channel override, then global DB, then env, then profile default (webapp => true). */
function minimalIngestEnabled(channel) {
  if (channel && typeof channel.minimalIngest === 'boolean') return channel.minimalIngest;
  const env = String(process.env.FFMPEG_MINIMAL_INGEST || '').toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes') return true;
  if (env === '0' || env === 'false' || env === 'no') return false;
  if (!streamingSettings.isGlobalMinimalIngestEnabled()) return false;
  return getEffectiveIngestStyle(channel) === 'webapp';
}

/** Same as webapp/lib/ffmpeg-args.js — before -i, live only. */
function lowLatencyDemuxArgs(channel) {
  if (channel.streamMode === 'vod') return [];
  if (!streamingSettings.isLowLatencyEnabled()) return [];
  return ['-fflags', '+nobuffer', '-flags', 'low_delay'];
}

/** Extra -fflags +genpts without duplicating +nobuffer (webapp path uses lowLatencyDemuxArgs for nobuffer). */
function webappGenPtsOnly(channel) {
  if (channel.streamMode === 'vod') return [];
  if (channel.gen_timestamps === false) return [];
  return ['-fflags', '+genpts'];
}

function fastStartArgs(channel) {
  if (channel.streamMode === 'vod') return [];
  if (minimalIngestEnabled(channel)) return [];
  const envAd = parseInt(process.env.FFMPEG_LIVE_ANALYZEDURATION || '', 10);
  const envPs = parseInt(process.env.FFMPEG_LIVE_PROBESIZE || '', 10);
  const ps = channel.probesize_ondemand;
  let probesize;
  if (Number.isFinite(envPs) && envPs > 0) {
    probesize = String(envPs);
  } else if (Number.isFinite(ps) && ps > 0) {
    // Large UI defaults (e.g. 5MB) slow time-to-first-frame; cap unless env overrides above.
    const LIVE_PROBE_CAP = 2000000;
    probesize = String(Math.min(ps, LIVE_PROBE_CAP));
  } else {
    probesize = '500000';
  }
  let analyzeduration = '500000';
  if (Number.isFinite(envAd) && envAd > 0) {
    analyzeduration = String(envAd);
  }
  return ['-analyzeduration', analyzeduration, '-probesize', probesize];
}

function loopInputArgs(channel) {
  if (!channel || !channel.loopInput) return [];
  return ['-stream_loop', '-1'];
}

function httpProxyArgs(channel) {
  const p = channel.httpProxy && String(channel.httpProxy).trim();
  if (!p) return [];
  return ['-http_proxy', p];
}

function networkRecoverArgs(channel) {
  // HTTP reconnect flags improve stability for DASH/HLS and direct HTTP media URLs.
  const t = effectiveInputType(channel);
  const url = String(channel?.mpdUrl || '').trim().toLowerCase();
  const isHttpUrl = url.startsWith('http://') || url.startsWith('https://');
  if (t === 'dash' || t === 'hls' || isHttpUrl) {
    return [
      '-rw_timeout',
      '30000000',
      '-timeout',
      '30000000',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_on_network_error',
      '1',
      '-reconnect_on_http_error',
      '4xx,5xx',
      '-reconnect_delay_max',
      '2',
    ];
  }
  return [];
}

function hlsListSize(channel) {
  const n = parseInt(channel.hlsPlaylistSize, 10);
  if (Number.isFinite(n) && n >= 0) return String(n);
  return '10';
}

/** Larger sliding window when serving delayed HLS (see server playlist rewrite). */
function effectiveHlsListSizeString(channel) {
  const seg = Math.max(2, Math.min(12, parseInt(channel.hlsSegmentSeconds, 10) || 4));
  const userList = parseInt(hlsListSize(channel), 10) || 10;
  if (channel.hlsIngestMode !== 'buffered') return hlsListSize(channel);
  const delay = Math.max(0, parseInt(channel.hlsBufferDelaySec, 10) || 30);
  const minList = Math.ceil(delay / seg) + 14;
  return String(Math.min(500, Math.max(userList, minList)));
}

function buildHlsFlags(channel) {
  const flags = ['delete_segments', 'temp_file', 'round_durations'];
  if (channel.streamMode !== 'vod') {
    flags.push('independent_segments', 'program_date_time', 'omit_endlist');
  }
  return flags.join('+');
}

function buildHlsMuxBase(channel) {
  const segTime = String(channel.hlsSegmentSeconds || 4);
  return [
    '-f',
    'hls',
    '-hls_time',
    segTime,
    '-hls_list_size',
    effectiveHlsListSizeString(channel),
    '-hls_flags',
    buildHlsFlags(channel),
  ];
}

/** Safe split: no shell metacharacters. */
function parseCustomFfmpegArgs(str) {
  if (!str || typeof str !== 'string') return [];
  const t = str.trim();
  if (!t) return [];
  if (/[;&|`$(){}]/.test(t)) return [];
  return t.split(/\s+/).filter(Boolean);
}

function injectBeforeOutputFile(args, extra) {
  if (!extra || extra.length === 0) return args;
  const out = [...args];
  const last = out.pop();
  out.push(...extra, last);
  return out;
}

function buildInputLead(channel, mpdUrl) {
  const profile = getEffectiveIngestStyle(channel);
  const webapp = profile === 'webapp' && !stabilityFixEnabled(channel);
  if (webapp) {
    const low = streamingSettings.isLowLatencyEnabled();
    return [
      ...fastStartArgs(channel),
      ...loopInputArgs(channel),
      ...(low ? lowLatencyDemuxArgs(channel) : webappGenPtsOnly(channel)),
      ...liveReadArgs(channel),
      ...networkRecoverArgs(channel),
      ...httpProxyArgs(channel),
      ...inputProtocolArgs(channel),
      ...headerArgsFromChannel(channel),
      ...stabilityInputArgs(channel),
      ...cencArgsFromChannel(channel),
      '-i',
      mpdUrl,
    ];
  }
  const fflags = profile === 'safe' ? combinedFflagsArgsSafe(channel) : combinedFflagsArgs(channel);
  return [
    ...fastStartArgs(channel),
    ...loopInputArgs(channel),
    ...fflags,
    ...liveReadArgs(channel),
    ...networkRecoverArgs(channel),
    ...httpProxyArgs(channel),
    ...inputProtocolArgs(channel),
    ...headerArgsFromChannel(channel),
    ...stabilityInputArgs(channel),
    ...cencArgsFromChannel(channel),
    '-i',
    mpdUrl,
  ];
}

function encoderName(channel) {
  const e = String(channel.videoEncoder || 'cpu_x264').toLowerCase();
  if (e === 'nvidia' || e === 'nvenc') return 'nvidia';
  if (e === 'intel' || e === 'qsv') return 'intel';
  if (e === 'amd' || e === 'amf') return 'amd';
  if (e === 'apple' || e === 'videotoolbox' || e === 'vt') return 'apple';
  return 'cpu';
}

function encoderArgs(channel, idx = null) {
  const e = encoderName(channel);
  const preset = channel.x264Preset || 'veryfast';
  const k = idx === null ? '' : `:${idx}`;
  if (e === 'nvidia') {
    return [`-c:v${k}`, 'h264_nvenc', `-preset${k}`, 'p4', `-rc${k}`, 'vbr', `-tune${k}`, 'll'];
  }
  if (e === 'intel') {
    return [`-c:v${k}`, 'h264_qsv', `-preset${k}`, 'medium'];
  }
  if (e === 'amd') {
    return [`-c:v${k}`, 'h264_amf', `-quality${k}`, 'balanced'];
  }
  if (e === 'apple') {
    return [`-c:v${k}`, 'h264_videotoolbox', `-realtime${k}`, '1', `-b:v${k}`, '5000k', `-r${k}`, '25'];
  }
  const tune = stabilityFixEnabled(channel) ? [`-tune${k}`, 'zerolatency'] : [];
  return [`-c:v${k}`, 'libx264', `-preset${k}`, preset, ...tune, `-pix_fmt${k}`, 'yuv420p'];
}

function stabilityGopArgs(channel, idx = null) {
  if (!stabilityFixEnabled(channel) && channel.outputFormat !== 'hls') return [];
  const segTime = parseInt(channel.hlsSegmentSeconds, 10) || 4;
  const fps = 25; // Default assumption for typical streaming
  const frames = segTime * fps;
  const k = idx === null ? '' : `:${idx}`;
  return [`-g${k}`, String(frames), `-keyint_min${k}`, String(frames), `-sc_threshold${k}`, '0'];
}

/**
 * @returns {{ args: string[], playlist: string, hlsUrl: string }}
 */
function buildFfmpegArgs(channel, streamDir, channelId, rootDir) {
  const transcode = needsTranscode(channel);
  const wmPath = resolveWatermarkPath(channel, rootDir);
  const audioBr = `${channel.audioBitrateK || 128}k`;
  const hlsBase = buildHlsMuxBase(channel);

  const streamDirFfmpeg = streamDir.replace(/\\/g, '/');
  const custom = parseCustomFfmpegArgs(channel.customFfmpegArgs);
  const mpegtsOut = channel.outputFormat === 'mpegts';
  const tsToPipe = mpegtsOut;
  const outTsPath = tsToPipe
    ? 'pipe:1'
    : path.join(streamDirFfmpeg, 'stream.ts').replace(/\\/g, '/');

  let rends = sortRenditions(
    Array.isArray(channel.renditions) && channel.renditions.length ? channel.renditions : ['1080p']
  );
  if (rends.length === 0) rends = ['1080p'];

  const multi = channel.renditionMode === 'multi' && rends.length > 1;

  if (mpegtsOut && multi) {
    throw new Error(
      'MPEG-TS output supports a single program stream only. Use HLS for multi-bitrate, or one quality + single mode.'
    );
  }

  if (!transcode) {
    const saArgs = streamAllArgs(channel);
    const maps = saArgs.length > 0
      ? saArgs
      : (() => {
          const m = ['-map', `0:v:${trackV(channel)}`, '-map', `0:a:${trackA(channel)}?`];
          const si = trackS(channel);
          if (si >= 0) m.push('-map', `0:s:${si}?`);
          return m;
        })();

    if (mpegtsOut) {
      let args = [
        ...buildInputLead(channel, channel.mpdUrl),
        ...maps,
        '-c',
        'copy',
        '-f',
        'mpegts',
        '-mpegts_flags',
        '+initial_discontinuity',
        '-pat_period',
        '2',
        '-muxdelay',
        '0',
        '-muxpreload',
        '0',
        '-flush_packets',
        '1',
        outTsPath,
      ];
      args = injectBeforeOutputFile(args, custom);
      return {
        args,
        playlist: 'stream.ts',
        hlsUrl: `/streams/${channelId}/stream.ts`,
      };
    }

    let args = [
      ...buildInputLead(channel, channel.mpdUrl),
      ...maps,
      '-c',
      'copy',
      ...hlsBase,
      '-hls_segment_filename',
      path.join(streamDirFfmpeg, 'seg_%05d.ts').replace(/\\/g, '/'),
      path.join(streamDirFfmpeg, 'index.m3u8').replace(/\\/g, '/'),
    ];
    args = injectBeforeOutputFile(args, custom);
    return {
      args,
      playlist: 'index.m3u8',
      hlsUrl: `/streams/${channelId}/index.m3u8`,
    };
  }

  const inputArgs = [...buildInputLead(channel, channel.mpdUrl)];
  if (wmPath) {
    inputArgs.push('-loop', '1', '-framerate', '25', '-i', wmPath);
  }

  if (!multi) {
    const r = rends[0];
    const p = RENDITION_PRESETS[r];
    const fc = buildSingleTranscodeFilter(channel, wmPath, p.height);
    const tailMpegts = [
      '-f',
      'mpegts',
      '-mpegts_flags',
      '+initial_discontinuity',
      '-pat_period',
      '2',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      '-flush_packets',
      '1',
      outTsPath,
    ];
    const tailHls = [
      ...hlsBase,
      '-hls_segment_filename',
      path.join(streamDirFfmpeg, 'seg_%05d.ts').replace(/\\/g, '/'),
      path.join(streamDirFfmpeg, 'index.m3u8').replace(/\\/g, '/'),
    ];
    let args = [
      ...inputArgs,
      '-filter_complex',
      fc,
      '-map',
      '[vout]',
      '-map',
      `0:a:${trackA(channel)}?`,
      ...encoderArgs(channel),
      ...stabilityGopArgs(channel),
      '-b:v',
      p.vbr,
      '-maxrate',
      p.maxrate,
      '-bufsize',
      p.bufsize,
      '-c:a',
      'aac',
      '-b:a',
      audioBr,
      '-ar',
      '48000',
      '-ac',
      '2',
      ...(mpegtsOut ? tailMpegts : tailHls),
    ];
    args = injectBeforeOutputFile(args, custom);
    return {
      args,
      playlist: mpegtsOut ? 'stream.ts' : 'index.m3u8',
      hlsUrl: mpegtsOut ? `/streams/${channelId}/stream.ts` : `/streams/${channelId}/index.m3u8`,
    };
  }

  const { filterComplex, mapArgs } = buildMultiFilterAndMaps(channel, wmPath, rends);
  const varMap = rends.map((_, i) => `v:${i},a:${i}`).join(' ');

  let args = [
    ...inputArgs,
    '-filter_complex',
    filterComplex,
    ...mapArgs,
    ...hlsBase,
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    varMap,
    '-hls_segment_filename',
    path.join(streamDirFfmpeg, 'seg_%v_%05d.ts').replace(/\\/g, '/'),
    path.join(streamDirFfmpeg, 'stream_%v.m3u8').replace(/\\/g, '/'),
  ];
  args = injectBeforeOutputFile(args, custom);

  return {
    args,
    playlist: 'master.m3u8',
    hlsUrl: `/streams/${channelId}/master.m3u8`,
  };
}

function wmOpacityFilter(channel) {
  const o = parseFloat(channel.watermark?.opacity);
  const op = Number.isFinite(o) ? Math.min(1, Math.max(0.05, o)) : 1;
  if (op >= 0.999) return '';
  return `format=rgba,colorchannelmixer=aa=${op},`;
}

function buildSingleTranscodeFilter(channel, wmPath, height) {
  const scale = Math.max(0.01, parseFloat(channel.watermark?.scale) || 0.12);
  const posKey = channel.watermark?.position || 'br';
  const xy = OVERLAY_POS[posKey] || OVERLAY_POS.br;
  const vl = vLabel(channel);

  if (wmPath) {
    const opF = wmOpacityFilter(channel);
    return `[1:v]${opF}null[wm_pre];[wm_pre]${vl}scale2ref=w='iw*${scale}':h='ow/mdar'[wm][base];[base][wm]overlay=${xy}:shortest=1[tmp];[tmp]scale=-2:${height}:flags=lanczos[vout]`;
  }
  return `${vl}scale=-2:${height}:flags=lanczos[vout]`;
}

function buildMultiFilterAndMaps(channel, wmPath, rends) {
  const n = rends.length;
  const scale = Math.max(0.01, parseFloat(channel.watermark?.scale) || 0.12);
  const posKey = channel.watermark?.position || 'br';
  const xy = OVERLAY_POS[posKey] || OVERLAY_POS.br;
  const vl = vLabel(channel);
  const al = aLabel(channel);

  const opF = wmOpacityFilter(channel);
  let videoChain = vl;
  if (wmPath) {
    videoChain = `[1:v]${opF}null[wm_pre];[wm_pre]${vl}scale2ref=w='iw*${scale}':h='ow/mdar'[wm][base];[base][wm]overlay=${xy}:shortest=1[base_out];[base_out]`;
  }

  const splitOut = [];
  for (let i = 0; i < n; i++) {
    splitOut.push(`[v${i}]`);
  }
  let fc = `${videoChain}split=${n}${splitOut.join('')};`;

  rends.forEach((r, i) => {
    const h = RENDITION_PRESETS[r].height;
    fc += `[v${i}]scale=-2:${h}:flags=lanczos[vo${i}];`;
  });

  const asplitOut = [];
  for (let i = 0; i < n; i++) {
    asplitOut.push(`[a${i}]`);
  }
  fc += `${al}asplit=${n}${asplitOut.join('')}`;

  const audioBr = `${channel.audioBitrateK || 128}k`;

  const mapArgs = [];
  rends.forEach((r, i) => {
    const p = RENDITION_PRESETS[r];
    mapArgs.push(
      '-map',
      `[vo${i}]`,
      '-map',
      `[a${i}]`,
      ...encoderArgs(channel, i),
      ...stabilityGopArgs(channel, i),
      `-b:v:${i}`,
      p.vbr,
      `-maxrate:v:${i}`,
      p.maxrate,
      `-bufsize:v:${i}`,
      p.bufsize,
      `-c:a:${i}`,
      'aac',
      `-b:a:${i}`,
      audioBr,
      `-ar:a:${i}`,
      '48000',
      `-ac:a:${i}`,
      '2'
    );
  });

  return { filterComplex: fc, mapArgs };
}

function normalizeHexKid(kid) {
  return String(kid || '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeHexKey(key) {
  return String(key || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Args for ffprobe (streams + format JSON). Caller runs: spawn('ffprobe', args).
 */
function buildFfprobeArgs(channel) {
  return [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    ...fastStartArgs(channel),
    ...liveReadArgs(channel),
    ...httpProxyArgs(channel),
    ...inputProtocolArgs(channel),
    ...headerArgsFromChannel(channel),
    ...cencArgsFromChannel(channel),
    '-i',
    channel.mpdUrl,
  ];
}

/**
 * Copy-mode: HLS on disk + optional MPEG-TS to stdout (pipe:1) for Node fan-out (STREAMING_MODE=nginx).
 * TS is not written to disk. HLS-only channels get a single FFmpeg output (no TS leg).
 * Requires ffmpeg with support for multiple outputs when TS is enabled; not for multi-bitrate transcoding.
 */
function buildNginxDualCopyFfmpegArgs(channel, channelId, iptvRoot) {
  const fs = require('fs');
  const hlsDir = path.join(iptvRoot, 'hls', channelId);
  fs.mkdirSync(hlsDir, { recursive: true });
  const hlsDirF = hlsDir.replace(/\\/g, '/');
  const saArgs = streamAllArgs(channel);
  const maps = saArgs.length > 0
    ? saArgs
    : ['-map', `0:v:${trackV(channel)}`, '-map', `0:a:${trackA(channel)}?`];
  const hlsTime = String(Math.max(1, Math.min(6, parseInt(channel.hlsSegmentSeconds, 10) || 2)));
  const inputAndMaps = [...buildInputLead(channel, channel.mpdUrl), ...maps];
  // Full stream copy (same as Node copy path). Re-encoding audio to AAC here added startup delay
  // and CPU before the first TS byte reached clients; remux-only matches XC-style proxy speed.
  const copyCodecs = ['-c', 'copy'];
  const hlsTail = [
    '-f', 'hls',
    '-hls_time', hlsTime,
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', `${hlsDirF}/seg_%03d.ts`,
    `${hlsDirF}/index.m3u8`,
  ];
  const tsTail = [
    '-f', 'mpegts',
    '-mpegts_flags',
    '+initial_discontinuity',
    '-pat_period',
    '2',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-flush_packets', '1',
    'pipe:1',
  ];
  const mpegtsOut = channel.outputFormat === 'mpegts';
  // TS to stdout first so VLC gets bytes immediately; HLS mux buffers ~hls_time for first segment.
  const args = mpegtsOut
    ? [...inputAndMaps, ...copyCodecs, ...tsTail, ...maps, ...copyCodecs, ...hlsTail]
    : [...inputAndMaps, ...copyCodecs, ...hlsTail];
  return {
    args,
    playlist: 'index.m3u8',
    hlsPath: path.join(hlsDir, 'index.m3u8'),
    hlsUrl: `/hls/${channelId}/index.m3u8`,
    tsUrl: mpegtsOut ? `/live/${channelId}.ts` : undefined,
  };
}

module.exports = {
  buildFfmpegArgs,
  buildFfprobeArgs,
  buildMergedHeaders,
  buildNginxDualCopyFfmpegArgs,
  RENDITION_PRESETS,
  RENDITION_ORDER,
  needsTranscode,
  sortRenditions,
  parseCustomFfmpegArgs,
  minimalIngestEnabled,
  webappIngestStyle,
  getEffectiveIngestStyle,
};
