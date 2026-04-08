/**
 * Parse CDM / extension dump text (e.g. Xtream-style panel copy) into channel fields.
 */

function tryParseJsonObject(text, startIdx) {
  if (startIdx < 0 || startIdx >= text.length) return null;
  const slice = text.slice(startIdx).trim();
  if (!slice.startsWith('{')) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = slice.slice(0, i + 1);
        try {
          return { obj: JSON.parse(jsonStr), end: startIdx + i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function findHeadersObject(text) {
  const m = text.match(/Headers:\s*/i);
  if (!m) return null;
  const start = m.index + m[0].length;
  const parsed = tryParseJsonObject(text, start);
  return parsed ? parsed.obj : null;
}

/**
 * @returns {object} Partial channel fields: mpdUrl, kid, key, pssh, type, headers, pageUrl, nameHint
 */
function parseExtractionDump(text) {
  if (!text || typeof text !== 'string') return {};
  const out = {};

  const kidM = text.match(/KID:\s*([a-fA-F0-9]{32})/i);
  if (kidM) out.kid = kidM[1].toLowerCase();

  const keyLine = text.match(/(?:^|\n)\s*Key:\s*([a-fA-F0-9]{32})\b/im);
  if (keyLine) out.key = keyLine[1].toLowerCase();

  const psshBlock = text.match(/PSSH\s*(?:Data)?\s*[:\n]\s*([A-Za-z0-9+/=\s]+?)(?:\n\n|\n[^\nA-Za-z0-9+/=]|$)/i);
  if (psshBlock) out.pssh = psshBlock[1].replace(/\s+/g, '').trim();

  const mpdUrls = text.match(/https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*/gi);
  if (mpdUrls && mpdUrls.length) {
    out.mpdUrl = mpdUrls[mpdUrls.length - 1];
  }
  // Targeted fallback for dump formats that place the MPD URL on a line like:
  // "Manifest #1" ... "URL: https://example.com/manifest.mpd"
  if (!out.mpdUrl) {
    const mpdUrlLine = text.match(/(?:^|\n)\s*URL:\s*(https?:\/\/[^\s"'<>]+\.mpd[^\s"'<>]*)/im);
    if (mpdUrlLine && mpdUrlLine[1]) out.mpdUrl = mpdUrlLine[1].trim();
  }

  const hdr = findHeadersObject(text);
  if (hdr && typeof hdr === 'object') out.headers = hdr;

  const pageUrlM =
    text.match(/🔗\s*URL\s*\n\s*(https?:\/\/[^\s]+)/i) ||
    text.match(/(?:^|\n)\s*URL:\s*(https?:\/\/[^\s]+)/im);
  if (pageUrlM) out.pageUrl = pageUrlM[1].trim();

  let typeM = text.match(/(?:^|\n)\s*Type:\s*(WIDEVINE|PLAYREADY|CLEARKEY)/i);
  if (!typeM) {
    typeM = text.match(/(?:^|\n)\s*Type\s*\n\s*(WIDEVINE|PLAYREADY|CLEARKEY)/i);
  }
  if (typeM) out.type = typeM[1].toUpperCase();

  const nameFromPath = out.pageUrl && /\/([^/?#]+)\/?$/.exec(out.pageUrl.replace(/\/livestream\//i, '/'));
  if (nameFromPath && nameFromPath[1]) {
    out.nameHint = decodeURIComponent(nameFromPath[1]).replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_').slice(0, 80);
  }

  return out;
}

module.exports = { parseExtractionDump };
