// Wrappers: date-wrappers - extracted from modules/wrappers/date-wrappers.js
// Re-exports from core/utils for date operations

export function formatDate(ts) {
  if (!ts) return '-';
  const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(date)) return String(ts);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function buildEndOfDayTimestamp(year, month, day) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const jsDate = new Date(y, m - 1, d, 23, 59, 59);
  if (isNaN(jsDate)) return null;
  if (jsDate.getFullYear() !== y || jsDate.getMonth() !== (m - 1) || jsDate.getDate() !== d) return null;
  return Math.floor(jsDate.getTime() / 1000);
}

export function toDateInputValue(ts) {
  if (!ts) return '';
  const date = new Date(Number(ts) * 1000);
  if (isNaN(date)) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDateInputValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

export function parseDateWithFormat(raw, format) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Simple implementation - expects format like 'YYYY-MM-DD'
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match.map(Number);
    const date = new Date(y, m - 1, d);
    if (!isNaN(date)) return Math.floor(date.getTime() / 1000);
  }
  const fallback = Date.parse(s);
  if (!isNaN(fallback)) return Math.floor(fallback / 1000);
  return null;
}
