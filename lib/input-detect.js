/**
 * Infer stream input type from URL and optional explicit selection.
 * Used by server, ffmpeg builder, and (mirrored) client UI.
 */

/** True when URL suggests HLS even without `.m3u8` (Xtream-style query, playlist ext, etc.). */
function looksLikeHlsUrl(inputUrl) {
  const raw = String(inputUrl || '').trim();
  if (!raw) return false;
  const u = raw.toLowerCase();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const url = new URL(u);
    const q = url.searchParams;
    if (q.has('m3u_plus')) return true;
    const out = (q.get('output') || '').toLowerCase();
    const typ = (q.get('type') || '').toLowerCase();
    const fmt = (q.get('format') || '').toLowerCase();
    if (out === 'hls' || typ === 'm3u8' || fmt === 'hls') return true;
  } catch {
    return false;
  }
  return false;
}

function detectInputType(inputUrl) {
  const u = String(inputUrl || '').trim().toLowerCase();
  if (!u) return 'auto';
  if (u.includes('.m3u8')) return 'hls';
  if (u.includes('.m3u') && !u.includes('.m3u8')) return 'hls';
  if (looksLikeHlsUrl(inputUrl)) return 'hls';
  if (u.startsWith('rtmp://') || u.startsWith('rtmps://')) return 'rtmp';
  if (u.startsWith('srt://')) return 'srt';
  if (u.startsWith('udp://')) return 'udp';
  if (u.includes('.ts')) return 'ts';
  if (u.includes('.mpd')) return 'dash';
  return 'auto';
}

/** When UI sends "auto", infer from URL; otherwise trust explicit type. */
function resolveEffectiveInputType(inputUrl, inputType) {
  const t = String(inputType || 'auto').toLowerCase();
  if (!t || t === 'auto') return detectInputType(inputUrl);
  return t;
}

module.exports = { detectInputType, resolveEffectiveInputType, looksLikeHlsUrl };
