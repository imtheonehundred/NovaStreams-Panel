// Shared CRUD helpers - extracted from modules/shared/crud-helpers.js

export function setField(sel, value) {
  const el = document.querySelector(sel);
  if (el) el.value = value !== undefined && value !== null ? String(value) : '';
}

export function setFields(fieldMap) {
  Object.entries(fieldMap).forEach(([sel, value]) => setField(sel, value));
}

export function getField(sel) {
  const el = document.querySelector(sel);
  return el ? el.value : '';
}

export function getFieldInt(sel, fallback) {
  const el = document.querySelector(sel);
  if (!el) return fallback;
  const n = parseInt(el.value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getFieldBool(sel) {
  const el = document.querySelector(sel);
  return el ? el.checked : false;
}

export function setChecked(sel, checked) {
  const el = document.querySelector(sel);
  if (el) el.checked = !!checked;
}

export function showInline(sel) {
  const el = document.querySelector(sel);
  if (el) el.style.display = 'flex';
}

export function hideInline(sel) {
  const el = document.querySelector(sel);
  if (el) el.style.display = 'none';
}

export function toggleInline(sel, visible) {
  const el = document.querySelector(sel);
  if (el) el.style.display = visible ? 'flex' : 'none';
}
