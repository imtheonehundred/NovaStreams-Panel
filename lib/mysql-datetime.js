'use strict';

/**
 * Format for MariaDB/MySQL DATETIME columns (no T/Z; pool uses timezone '+00:00').
 * @param {Date|string|number} input
 * @returns {string|null}
 */
function toMysqlDatetimeUtc(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Convert unix seconds, JS Dates, or parseable date strings to MySQL DATETIME.
 * Numeric inputs are treated as unix seconds.
 * @param {Date|string|number|null|undefined} input
 * @returns {string|null}
 */
function unixSecondsToMysqlDatetime(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return toMysqlDatetimeUtc(new Date(input * 1000));
  }
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    return toMysqlDatetimeUtc(new Date(parseInt(input.trim(), 10) * 1000));
  }
  return toMysqlDatetimeUtc(input);
}

/**
 * Convert a MySQL DATETIME/Date object to unix seconds.
 * @param {Date|string|number|null|undefined} input
 * @returns {number|null}
 */
function mysqlDatetimeToUnixSeconds(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input > 1e12 ? Math.floor(input / 1000) : Math.floor(input);
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

/**
 * If a bound parameter is a full-string ISO 8601 value (e.g. from Date.toISOString()),
 * convert it to MySQL DATETIME. Leaves other strings (JSON, URLs, etc.) unchanged.
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeSqlParamIsoToMysqlDatetime(value) {
  if (typeof value !== 'string') return value;
  // Typical: 2026-03-26T02:41:56.453Z or with offset
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const s = toMysqlDatetimeUtc(d);
  return s || value;
}

/**
 * @param {unknown[]} params
 * @returns {unknown[]}
 */
function sanitizeSqlParams(params) {
  if (!Array.isArray(params) || params.length === 0) return params;
  return params.map(sanitizeSqlParamIsoToMysqlDatetime);
}

const RELEASE_DATE_MAX_LEN = 255;

function clampPagination(limit, offset, maxLimit = 100) {
  let l = parseInt(limit, 10) || 50;
  let o = parseInt(offset, 10) || 0;
  if (l < 1) l = 1;
  if (l > maxLimit) l = maxLimit;
  if (o < 0) o = 0;
  return { limit: l, offset: o };
}

function sanitizeReleaseDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return s.length > RELEASE_DATE_MAX_LEN ? s.slice(0, RELEASE_DATE_MAX_LEN) : s;
}

module.exports = {
  toMysqlDatetimeUtc,
  unixSecondsToMysqlDatetime,
  mysqlDatetimeToUnixSeconds,
  sanitizeSqlParamIsoToMysqlDatetime,
  sanitizeSqlParams,
  clampPagination,
  sanitizeReleaseDate,
  RELEASE_DATE_MAX_LEN,
};
