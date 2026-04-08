// Utils - ES6 exports converted from IIFE pattern
// Source: public/js/modules/utils.js

export function $(sel) {
  return document.querySelector(sel);
}

export function $$(sel) {
  return document.querySelectorAll(sel);
}

export function escHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

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
  const date = new Date(y, m - 1, d, 23, 59, 59);
  if (isNaN(date)) return null;
  if (date.getFullYear() !== y || date.getMonth() !== (m - 1) || date.getDate() !== d) return null;
  return Math.floor(date.getTime() / 1000);
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
  const parts = raw.split('-').map((part) => part.trim());
  if (parts.length !== 3) return null;
  return buildEndOfDayTimestamp(parts[0], parts[1], parts[2]);
}

export function parseDateWithFormat(raw, format) {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  const parts = cleaned.split(/[-/\.]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  let yyyy;
  let mm;
  let dd;
  if (format === 'dmy') {
    [dd, mm, yyyy] = parts;
  } else if (format === 'mdy') {
    [mm, dd, yyyy] = parts;
  } else {
    [yyyy, mm, dd] = parts;
  }
  return buildEndOfDayTimestamp(yyyy, mm, dd);
}

export function thumbImg(url, w = 40, h = 56) {
  if (!url) return '<div class="thumb-placeholder"></div>';
  return `<img src="${escHtml(url)}" class="thumb-img" width="${w}" height="${h}" loading="lazy" onerror="this.style.display='none'">`;
}