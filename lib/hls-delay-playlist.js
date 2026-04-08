/**
 * Trim the newest segments from an HLS media playlist so the published window
 * ends ~delaySec before ffmpeg's live edge (rolling buffer on disk).
 */

function parseSegments(lines, startIdx) {
  const segs = [];
  let j = startIdx;
  while (j < lines.length) {
    const line = lines[j];
    if (!line || !line.startsWith('#EXTINF:')) {
      j++;
      continue;
    }
    const m = line.match(/^#EXTINF:([\d.]+)/);
    const dur = m ? parseFloat(m[1]) : NaN;
    const block = [];
    block.push(lines[j]);
    j++;
    while (j < lines.length && lines[j].trim() && lines[j].startsWith('#')) {
      block.push(lines[j]);
      j++;
    }
    if (j < lines.length && lines[j].trim() && !lines[j].startsWith('#')) {
      block.push(lines[j]);
      j++;
    }
    segs.push({ dur: Number.isFinite(dur) ? dur : null, block });
  }
  return segs;
}

function rewriteMediaPlaylistDelayed(text, delaySec, fallbackSegDuration) {
  const delay = Math.max(0, Number(delaySec) || 0);
  if (delay <= 0 || !text || typeof text !== 'string') return text;

  const fb = Math.max(1, Number(fallbackSegDuration) || 4);
  const lines = text.split(/\r?\n/);
  const firstSeg = lines.findIndex((l) => l && l.startsWith('#EXTINF:'));
  if (firstSeg < 0) return text;

  const hdr = lines.slice(0, firstSeg);
  const segs = parseSegments(lines, firstSeg);
  if (segs.length < 2) return text;

  let cum = 0;
  let drop = 0;
  for (let k = segs.length - 1; k >= 0; k--) {
    if (cum >= delay) break;
    cum += segs[k].dur != null ? segs[k].dur : fb;
    drop++;
  }
  if (drop === 0) return text;

  const kept = segs.slice(0, segs.length - drop);
  if (kept.length === 0) return text;

  const maxDur = Math.max(
    ...kept.map((s) => (s.dur != null ? s.dur : fb)),
    fb
  );
  const td = Math.ceil(maxDur);
  const hdrOut = hdr.map((ln) =>
    /^#EXT-X-TARGETDURATION:/i.test(ln) ? `#EXT-X-TARGETDURATION:${td}` : ln
  );

  const hadEndlist = lines.some((l) => l && l.trim() === '#EXT-X-ENDLIST');
  const parts = [...hdrOut, ...kept.flatMap((s) => s.block)];
  if (hadEndlist) parts.push('#EXT-X-ENDLIST');
  return `${parts.join('\n')}\n`;
}

module.exports = { rewriteMediaPlaylistDelayed };
