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

module.exports = {
  toMysqlDatetimeUtc,
  sanitizeSqlParamIsoToMysqlDatetime,
  sanitizeSqlParams,
};
