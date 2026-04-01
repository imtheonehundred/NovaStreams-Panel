'use strict';

const { query, execute } = require('../lib/mariadb');
const { getSetting } = require('../lib/db');

const asnCache = new Map(); // ip → { asn: string, org: string, blocked: boolean, checkedAt: number }
const ASN_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function lookupAsn(ip) {
  if (!ip || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::1') {
    return null;
  }

  const cached = asnCache.get(ip);
  if (cached && (Date.now() - cached.checkedAt) < ASN_CACHE_TTL) {
    return cached;
  }

  try {
    // Team Cymru WHOIS over DNS — no API key needed
    // Alternatively use ip-api.com/asn for HTTP
    const res = await require('node-fetch')(
      `http://ip-api.com/json/${ip}?fields=org,as`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const j = await res.json();
      const asn = j.as || '';
      const org = j.org || '';
      const blocked = await isAsnBlocked(asn);
      const record = { asn, org, blocked, checkedAt: Date.now() };
      asnCache.set(ip, record);
      return record;
    }
  } catch (_) {}

  asnCache.set(ip, { asn: '', org: '', blocked: false, checkedAt: Date.now() });
  return null;
}

async function isAsnBlocked(asn) {
  if (!asn) return false;
  const rows = await query('SELECT id FROM blocked_asns WHERE asn = ? LIMIT 1', [asn]);
  return rows.length > 0;
}

async function getBlockedAsns() {
  return query('SELECT id, asn, org, notes, created_at FROM blocked_asns ORDER BY created_at DESC');
}

async function blockAsn(asn, org = '', notes = '') {
  if (!asn) return;
  await execute(
    'INSERT INTO blocked_asns (asn, org, notes, created_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE org = COALESCE(VALUES(org), org), notes = COALESCE(VALUES(notes), notes)',
    [asn, org, notes]
  );
  // Clear all cached entries for this ASN
  for (const [ip, data] of asnCache.entries()) {
    if (data.asn === asn) {
      asnCache.delete(ip);
    }
  }
}

async function unblockAsn(asn) {
  await execute('DELETE FROM blocked_asns WHERE asn = ?', [asn]);
  for (const [ip, data] of asnCache.entries()) {
    if (data.asn === asn) {
      asnCache.delete(ip);
    }
  }
}

function clearCache() {
  asnCache.clear();
}

module.exports = {
  lookupAsn,
  isAsnBlocked,
  getBlockedAsns,
  blockAsn,
  unblockAsn,
  clearCache,
};
