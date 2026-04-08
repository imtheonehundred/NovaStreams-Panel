// Shared formatters - extracted from modules/formatters.js

export function formatUptime(startedAt) {
  if (!startedAt) return '-';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export function formatSourceHost(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.hostname || String(url || '');
  } catch {
    return String(url || '');
  }
}

export function formatStreamFps(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ratio = raw.match(/^(\d+)(?:\/(\d+))?$/);
  if (!ratio) return raw;
  const num = parseInt(ratio[1], 10);
  const den = parseInt(ratio[2] || '1', 10);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return raw;
  const fps = Math.round((num / den) * 100) / 100;
  return `${fps} FPS`;
}

export function formatUserDate(raw, formatDateFn) {
  if (!raw) return 'Never';
  return formatDateFn ? formatDateFn(raw) : String(raw);
}

export function isTruthySetting(val) {
  const v = String(val ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getSettingValue(data, key, defaults = {}) {
  if (data && data[key] !== undefined && data[key] !== null && String(data[key]) !== '') return String(data[key]);
  return String(defaults[key] ?? '');
}

export function getSettingBool(data, key, defaults = {}) {
  if (data && data[key] !== undefined && data[key] !== null && String(data[key]) !== '') return isTruthySetting(data[key]);
  return isTruthySetting(defaults[key] ?? '0');
}

export function parseStoredArray(raw, fallback = []) {
  if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean);
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [...fallback];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
  } catch (_) {}
  return s.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
}

export function parseStreamHeadersText(text) {
  const headers = {};
  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(':');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    });
  return headers;
}
