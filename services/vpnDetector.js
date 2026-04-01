'use strict';

const { query } = require('../lib/mariadb');
const { getSetting } = require('../lib/db');

const VPN_CACHE_TTL_SEC = 60 * 60; // 1 hour

const vpnCache = new Map(); // ip → { isVpn: boolean, checkedAt: number }

async function checkVpnIp(ip) {
  if (!ip || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return false; // skip private/internal
  }

  // Check cache
  const cached = vpnCache.get(ip);
  if (cached && (Date.now() - cached.checkedAt) < VPN_CACHE_TTL_SEC * 1000) {
    return cached.isVpn;
  }

  try {
    const res = await require('node-fetch')(
      `http://ip-api.com/json/${ip}?fields=proxy,hosting`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const j = await res.json();
      const isVpn = !!(j.proxy || j.hosting);
      vpnCache.set(ip, { isVpn, checkedAt: Date.now() });
      return isVpn;
    }
  } catch (_) {}

  // Fail open — don't block on detection error
  vpnCache.set(ip, { isVpn: false, checkedAt: Date.now() });
  return false;
}

async function isVpnEnabled() {
  return (await getSetting('enable_vpn_detection')) === '1';
}

async function recordVpnCheck(ip, userId, isVpn) {
  if (!isVpn) return;
  await query(
    'INSERT INTO login_events (user_id, ip, event_type, is_vpn, created_at) VALUES (?, ?, ?, 1, NOW())',
    [userId || null, ip, 'vpn_detected']
  );
}

function clearCache() {
  vpnCache.clear();
}

module.exports = {
  checkVpnIp,
  isVpnEnabled,
  recordVpnCheck,
  clearCache,
};
