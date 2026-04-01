'use strict';

const { query, queryOne, execute, insert, remove } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const { publicStreamOrigin } = require('../lib/public-stream-origin');

const ROLES = new Set(['main', 'lb', 'edge']);

/** Heartbeat freshness threshold in milliseconds. Servers whose last heartbeat
 *  is older than this are considered stale. Not wired into playback selection. */
const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function parseMeta(val) {
  if (val == null || val === '') return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(String(val)); } catch { return {}; }
}

function buildServerMeta(data, baseMeta = {}) {
  const meta = { ...(baseMeta || {}) };
  const setOrDelete = (key, value) => {
    const normalized = Array.isArray(value)
      ? value.filter(Boolean)
      : (typeof value === 'string' ? value.trim() : value);
    if (normalized === undefined || normalized === null || normalized === '' || (Array.isArray(normalized) && !normalized.length)) {
      delete meta[key];
      return;
    }
    meta[key] = normalized;
  };
  if (data.private_users_cdn_lb !== undefined) setOrDelete('private_users_cdn_lb', data.private_users_cdn_lb);
  if (data.http_port_list !== undefined) setOrDelete('http_port_list', data.http_port_list);
  if (data.geoip_priority !== undefined) setOrDelete('geoip_priority', data.geoip_priority);
  if (data.server_guard_whitelist_username !== undefined) setOrDelete('server_guard_whitelist_username', data.server_guard_whitelist_username);
  if (data.server_guard_auto_restart_mysql_value !== undefined) setOrDelete('server_guard_auto_restart_mysql_value', data.server_guard_auto_restart_mysql_value);
  if (data.isp_priority_label !== undefined) setOrDelete('isp_priority_label', data.isp_priority_label);
  return meta;
}

async function listServers() {
  const rows = await query(
    'SELECT * FROM streaming_servers ORDER BY sort_order ASC, id ASC'
  );
  const domains = await query(
    'SELECT * FROM streaming_server_domains ORDER BY server_id ASC, sort_order ASC, id ASC'
  );
  const map = new Map(rows.map((r) => [r.id, { ...r, meta_json: parseMeta(r.meta_json), domains: [] }]));
  for (const d of domains) {
    const s = map.get(d.server_id);
    if (s) s.domains.push(d);
  }
  return [...map.values()];
}

async function getServer(id) {
  const row = await queryOne('SELECT * FROM streaming_servers WHERE id = ?', [id]);
  if (!row) return null;
  const domains = await query(
    'SELECT * FROM streaming_server_domains WHERE server_id = ? ORDER BY sort_order ASC, id ASC',
    [id]
  );
  return { ...row, meta_json: parseMeta(row.meta_json), domains };
}

async function getMovieStreamServerId(movieId) {
  const row = await queryOne('SELECT stream_server_id FROM movies WHERE id = ?', [movieId]);
  if (!row) return 0;
  const sid = parseInt(row.stream_server_id, 10);
  return Number.isFinite(sid) && sid > 0 ? sid : 0;
}

async function getLiveChannelStreamServerId(channelId) {
  const row = await queryOne('SELECT json_data FROM channels WHERE id = ?', [String(channelId)]);
  if (!row) return 0;
  try {
    const json = typeof row.json_data === 'string' ? JSON.parse(row.json_data) : row.json_data;
    const sid = parseInt(json && json.stream_server_id, 10);
    return Number.isFinite(sid) && sid > 0 ? sid : 0;
  } catch {
    return 0;
  }
}

async function getDefaultStreamServerId() {
  const sid = parseInt(String((await dbApi.getSetting('default_stream_server_id')) || '0'), 10);
  return Number.isFinite(sid) && sid > 0 ? sid : 0;
}

function warnServerCandidate(reason, serverId, extra) {
  const detail = extra ? ` ${extra}` : '';
  console.warn(`[serverService.selectServer] ${reason} server_id=${serverId}${detail}`);
}

async function selectServerRowById(serverId, opts = {}) {
  const sid = parseInt(serverId, 10);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const server = await getServer(sid);
  if (!server) return null;
  const health = await getServerHealthStatus(sid);
  if (!server.enabled) warnServerCandidate('using disabled', sid, opts.reason ? `reason=${opts.reason}` : '');
  else if (!health.fresh) warnServerCandidate('using stale', sid, opts.reason ? `reason=${opts.reason}` : '');
  return { serverId: sid, server, health, isOverride: !!opts.isOverride };
}

/**
 * Build a contract-compliant normalized selector result.
 * All selection paths go through this to produce a consistent output.
 * @param {Object} opts
 */
async function buildSelectorResult({ assetType, assetId, selectionSource, isOverride, serverRow, warnings = [] }) {
  const serverId = serverRow ? serverRow.serverId : 0;
  const server = serverRow ? serverRow.server : null;
  const health = serverRow ? serverRow.health : null;
  const role = server && server.role ? server.role : 'edge';
  const publicHost = server && server.public_host ? String(server.public_host).trim() : '';
  const publicBaseUrl = server ? (buildServerPublicBaseUrl(server) || '') : '';
  const enabled = server ? !!server.enabled : false;

  return {
    assetType: String(assetType || '').toLowerCase(),
    assetId: String(assetId || ''),
    selectedServerId: serverId,
    selectedServerRole: role,
    selectionSource: selectionSource || 'enabled_fallback',
    publicBaseUrl,
    publicHost,
    isOverride: !!isOverride,
    enabled,
    heartbeat: health || { fresh: false, lastHeartbeatAt: null, staleMs: Infinity },
    warnings,
    debug: {
      requestedLineId: 0,    // available from line if passed
      requestedForceServerId: 0, // filled by caller where known
      requestedLiveAssignmentServerId: 0, // filled by caller where known
      defaultServerId: 0,    // filled by caller where known
    },
  };
}

async function recordPlacementSelection(assetType, assetId, serverId) {
  const type = String(assetType || '').toLowerCase();
  if (!['live', 'movie', 'episode'].includes(type)) return;
  const sid = parseInt(serverId, 10);
  if (!Number.isFinite(sid) || sid <= 0) return;
  try {
    await dbApi.createPlacement({ streamType: type, streamId: String(assetId), serverId: sid });
  } catch {}
}

async function demoteOtherMains(exceptId) {
  await execute(
    `UPDATE streaming_servers SET role = 'edge' WHERE role = 'main' AND id != ?`,
    [exceptId]
  );
}

async function createServer(data) {
  const role = String(data.role || 'edge').toLowerCase();
  if (!ROLES.has(role)) throw new Error('invalid role');
  const name = String(data.name || '').trim() || 'Server';
  const publicHost = String(data.public_host || '').trim();
  const publicIp = String(data.public_ip || '').trim();
  const privateIp = String(data.private_ip || '').trim();
  const maxClients = parseInt(data.max_clients, 10);
  const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1;
  const proxied = data.proxied ? 1 : 0;
  const timeshiftOnly = data.timeshift_only ? 1 : 0;
  const networkCap = parseInt(data.network_mbps_cap, 10) || 0;
  const sortOrder = parseInt(data.sort_order, 10) || 0;
  let metaObj = data.meta_json !== undefined ? parseMeta(data.meta_json) : {};
  metaObj = buildServerMeta(data, metaObj);
  const metaJson = Object.keys(metaObj).length ? JSON.stringify(metaObj) : null;

  // Edit Server parity fields
  const baseUrl = String(data.base_url || '').trim();
  const serverIp = String(data.server_ip || '').trim();
  const dns1 = String(data.dns_1 || '').trim();
  const dns2 = String(data.dns_2 || '').trim();
  const adminPassword = String(data.admin_password || '').trim();
  const fullDuplex = data.full_duplex ? 1 : 0;
  const boostFpm = data.boost_fpm ? 1 : 0;
  const httpPort = parseInt(data.http_port, 10) || 8080;
  const httpsM3uLines = data.https_m3u_lines ? 1 : 0;
  const forceSslPort = data.force_ssl_port ? 1 : 0;
  const httpsPort = parseInt(data.https_port, 10) || 8083;
  const timeDiff = String(data.time_difference || 'Auto').trim();
  const sshPort = parseInt(data.ssh_port, 10) || 22;
  const netInterface = String(data.network_interface || 'all').trim();
  const netSpeed = String(data.network_speed || '').trim();
  const osInfo = String(data.os_info || '').trim();
  const geoipLb = data.geoip_load_balancing ? 1 : 0;
  const geoipCountries = String(data.geoip_countries || '').trim();
  const extraNginx = String(data.extra_nginx_config || '').trim();
  const serverGuard = data.server_guard_enabled ? 1 : 0;
  const ipWhitelist = data.ip_whitelisting ? 1 : 0;
  const botnetFighter = data.botnet_fighter ? 1 : 0;
  const underAttack = data.under_attack ? 1 : 0;
  const connLimitPorts = String(data.connection_limit_ports || '').trim();
  const maxConnPerIp = parseInt(data.max_conn_per_ip, 10) || 3;
  const maxHitsNormal = parseInt(data.max_hits_normal_user, 10) || 1;
  const maxHitsRestreamer = parseInt(data.max_hits_restreamer, 10) || 1;
  const whitelistUsername = data.whitelist_username ? 1 : 0;
  const blockUserMins = parseInt(data.block_user_minutes, 10) || 30;
  const autoRestartMysql = data.auto_restart_mysql ? 1 : 0;
  const ispEnabled = data.isp_enabled ? 1 : 0;
  const ispPriority = parseInt(data.isp_priority, 10) || 1;
  const ispAllowedNames = String(data.isp_allowed_names || '').trim();
  const ispCaseSensitive = ['none', 'lower', 'upper'].includes(data.isp_case_sensitive) ? data.isp_case_sensitive : 'lower';

  const id = await insert(
    `INSERT INTO streaming_servers (
      name, role, public_host, public_ip, private_ip, max_clients, enabled, proxied, timeshift_only,
      network_mbps_cap, sort_order, meta_json,
      base_url, server_ip, dns_1, dns_2, admin_password, full_duplex, boost_fpm,
      http_port, https_m3u_lines, force_ssl_port, https_port, time_difference, ssh_port,
      network_interface, network_speed, os_info, geoip_load_balancing, geoip_countries, extra_nginx_config,
      server_guard_enabled, ip_whitelisting, botnet_fighter, under_attack,
      connection_limit_ports, max_conn_per_ip, max_hits_normal_user, max_hits_restreamer,
      whitelist_username, block_user_minutes, auto_restart_mysql,
      isp_enabled, isp_priority, isp_allowed_names, isp_case_sensitive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name, role, publicHost, publicIp, privateIp,
      Number.isFinite(maxClients) && maxClients >= 0 ? maxClients : 0,
      enabled, proxied, timeshiftOnly, networkCap, sortOrder, metaJson,
      baseUrl, serverIp, dns1, dns2, adminPassword, fullDuplex, boostFpm,
      httpPort, httpsM3uLines, forceSslPort, httpsPort, timeDiff, sshPort,
      netInterface, netSpeed, osInfo, geoipLb, geoipCountries, extraNginx,
      serverGuard, ipWhitelist, botnetFighter, underAttack,
      connLimitPorts, maxConnPerIp, maxHitsNormal, maxHitsRestreamer,
      whitelistUsername, blockUserMins, autoRestartMysql,
      ispEnabled, ispPriority, ispAllowedNames, ispCaseSensitive,
    ]
  );

  if (role === 'main') await demoteOtherMains(id);
  await replaceDomains(id, data.domains);
  return getServer(id);
}

async function updateServer(id, data) {
  const existing = await queryOne('SELECT id, meta_json FROM streaming_servers WHERE id = ?', [id]);
  if (!existing) return null;

  const sets = [];
  const vals = [];
  const push = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };

  if (data.name !== undefined) push('name', String(data.name || '').trim() || 'Server');
  if (data.role !== undefined) {
    const role = String(data.role || '').toLowerCase();
    if (!ROLES.has(role)) throw new Error('invalid role');
    push('role', role);
  }
  if (data.public_host !== undefined) push('public_host', String(data.public_host || '').trim());
  if (data.public_ip !== undefined) push('public_ip', String(data.public_ip || '').trim());
  if (data.private_ip !== undefined) push('private_ip', String(data.private_ip || '').trim());
  if (data.max_clients !== undefined) {
    const n = parseInt(data.max_clients, 10);
    push('max_clients', Number.isFinite(n) && n >= 0 ? n : 0);
  }
  if (data.enabled !== undefined) push('enabled', data.enabled ? 1 : 0);
  if (data.proxied !== undefined) push('proxied', data.proxied ? 1 : 0);
  if (data.timeshift_only !== undefined) push('timeshift_only', data.timeshift_only ? 1 : 0);
  if (data.network_mbps_cap !== undefined) {
    const n = parseInt(data.network_mbps_cap, 10);
    push('network_mbps_cap', Number.isFinite(n) && n >= 0 ? n : 0);
  }
  if (data.sort_order !== undefined) {
    const n = parseInt(data.sort_order, 10);
    push('sort_order', Number.isFinite(n) ? n : 0);
  }
  if (data.meta_json !== undefined) {
    const mj = typeof data.meta_json === 'string' ? data.meta_json : JSON.stringify(data.meta_json || {});
    push('meta_json', mj);
  }
  // Edit Server parity fields
  if (data.base_url !== undefined) push('base_url', String(data.base_url || '').trim());
  if (data.server_ip !== undefined) push('server_ip', String(data.server_ip || '').trim());
  if (data.dns_1 !== undefined) push('dns_1', String(data.dns_1 || '').trim());
  if (data.dns_2 !== undefined) push('dns_2', String(data.dns_2 || '').trim());
  if (data.admin_password !== undefined) push('admin_password', String(data.admin_password || '').trim());
  if (data.full_duplex !== undefined) push('full_duplex', data.full_duplex ? 1 : 0);
  if (data.boost_fpm !== undefined) push('boost_fpm', data.boost_fpm ? 1 : 0);
  if (data.http_port !== undefined) push('http_port', parseInt(data.http_port, 10) || 8080);
  if (data.https_m3u_lines !== undefined) push('https_m3u_lines', data.https_m3u_lines ? 1 : 0);
  if (data.force_ssl_port !== undefined) push('force_ssl_port', data.force_ssl_port ? 1 : 0);
  if (data.https_port !== undefined) push('https_port', parseInt(data.https_port, 10) || 8083);
  if (data.time_difference !== undefined) push('time_difference', String(data.time_difference || 'Auto').trim());
  if (data.ssh_port !== undefined) push('ssh_port', parseInt(data.ssh_port, 10) || 22);
  if (data.network_interface !== undefined) push('network_interface', String(data.network_interface || 'all').trim());
  if (data.network_speed !== undefined) push('network_speed', String(data.network_speed || '').trim());
  if (data.os_info !== undefined) push('os_info', String(data.os_info || '').trim());
  if (data.geoip_load_balancing !== undefined) push('geoip_load_balancing', data.geoip_load_balancing ? 1 : 0);
  if (data.geoip_countries !== undefined) push('geoip_countries', String(data.geoip_countries || '').trim());
  if (data.extra_nginx_config !== undefined) push('extra_nginx_config', String(data.extra_nginx_config || '').trim());
  if (data.server_guard_enabled !== undefined) push('server_guard_enabled', data.server_guard_enabled ? 1 : 0);
  if (data.ip_whitelisting !== undefined) push('ip_whitelisting', data.ip_whitelisting ? 1 : 0);
  if (data.botnet_fighter !== undefined) push('botnet_fighter', data.botnet_fighter ? 1 : 0);
  if (data.under_attack !== undefined) push('under_attack', data.under_attack ? 1 : 0);
  if (data.connection_limit_ports !== undefined) push('connection_limit_ports', String(data.connection_limit_ports || '').trim());
  if (data.max_conn_per_ip !== undefined) push('max_conn_per_ip', parseInt(data.max_conn_per_ip, 10) || 3);
  if (data.max_hits_normal_user !== undefined) push('max_hits_normal_user', parseInt(data.max_hits_normal_user, 10) || 1);
  if (data.max_hits_restreamer !== undefined) push('max_hits_restreamer', parseInt(data.max_hits_restreamer, 10) || 1);
  if (data.whitelist_username !== undefined) push('whitelist_username', data.whitelist_username ? 1 : 0);
  if (data.block_user_minutes !== undefined) push('block_user_minutes', parseInt(data.block_user_minutes, 10) || 30);
  if (data.auto_restart_mysql !== undefined) push('auto_restart_mysql', data.auto_restart_mysql ? 1 : 0);
  if (data.isp_enabled !== undefined) push('isp_enabled', data.isp_enabled ? 1 : 0);
  if (data.isp_priority !== undefined) push('isp_priority', parseInt(data.isp_priority, 10) || 1);
  if (data.isp_allowed_names !== undefined) push('isp_allowed_names', String(data.isp_allowed_names || '').trim());
  if (data.isp_case_sensitive !== undefined) push('isp_case_sensitive', ['none', 'lower', 'upper'].includes(data.isp_case_sensitive) ? data.isp_case_sensitive : 'lower');

  if (
    data.private_users_cdn_lb !== undefined ||
    data.http_port_list !== undefined ||
    data.geoip_priority !== undefined ||
    data.server_guard_whitelist_username !== undefined ||
    data.server_guard_auto_restart_mysql_value !== undefined ||
    data.isp_priority_label !== undefined
  ) {
    const metaObj = buildServerMeta(data, parseMeta(existing.meta_json));
    push('meta_json', Object.keys(metaObj).length ? JSON.stringify(metaObj) : null);
  }

  if (sets.length) {
    vals.push(id);
    await execute(`UPDATE streaming_servers SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  const row = await queryOne('SELECT role FROM streaming_servers WHERE id = ?', [id]);
  if (row && row.role === 'main') await demoteOtherMains(id);

  if (data.domains !== undefined) await replaceDomains(id, data.domains);
  return getServer(id);
}

async function replaceDomains(serverId, domains) {
  if (!Array.isArray(domains)) return;
  await execute('DELETE FROM streaming_server_domains WHERE server_id = ?', [serverId]);
  let sort = 0;
  let primaryDone = false;
  for (const d of domains) {
    const domain = typeof d === 'string' ? d.trim() : String(d.domain || '').trim();
    if (!domain) continue;
    let isPrimary = 0;
    if (typeof d === 'object' && d.is_primary) isPrimary = 1;
    else if (!primaryDone) isPrimary = 1;
    if (isPrimary) primaryDone = true;
    await insert(
      `INSERT INTO streaming_server_domains (server_id, domain, is_primary, sort_order) VALUES (?, ?, ?, ?)`,
      [serverId, domain, isPrimary, sort++]
    );
  }
}

async function deleteServer(id) {
  return await remove('DELETE FROM streaming_servers WHERE id = ?', [id]);
}

async function reorderServers(orderings) {
  if (!Array.isArray(orderings)) throw new Error('orderings must be an array');
  for (const item of orderings) {
    const id = parseInt(item.id, 10);
    const sort = parseInt(item.sort_order, 10);
    if (!Number.isFinite(id) || !Number.isFinite(sort)) continue;
    await execute('UPDATE streaming_servers SET sort_order = ? WHERE id = ?', [sort, id]);
  }
  return true;
}

function stripTrailingSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

function buildServerPublicBaseUrl(row) {
  if (!row) return null;
  const meta = parseMeta(row.meta_json);
  if (meta.public_base_url) return stripTrailingSlash(String(meta.public_base_url).trim());
  const host = String(row.public_host || '').trim();
  if (!host) return null;
  const https = meta.https === true || meta.https === 1 || meta.https === '1';
  const proto = https ? 'https' : 'http';
  let port = '';
  if (meta.port != null && String(meta.port) !== '' && String(meta.port) !== '80' && String(meta.port) !== '443') {
    const p = parseInt(meta.port, 10);
    if (Number.isFinite(p)) port = `:${p}`;
  }
  return `${proto}://${host}${port}`;
}

/**
 * M3U / Xtream base URL per asset:
 * - Optional assetStreamServerId (movie/series/live): if set and server enabled, use its public base.
 * - Else: line.force_server_id → default_stream_server_id → first enabled LB → main → request host.
 */
async function resolvePlaylistBaseUrl(line, reqFallbackUrl, assetStreamServerId) {
  const fb = stripTrailingSlash(reqFallbackUrl);
  const assetSid = assetStreamServerId != null && assetStreamServerId !== ''
    ? parseInt(assetStreamServerId, 10)
    : 0;
  if (Number.isFinite(assetSid) && assetSid > 0) {
    const s = await getServer(assetSid);
    if (s && s.enabled) {
      const b = buildServerPublicBaseUrl(s);
      if (b) return b;
    }
  }
  let sid = line && line.force_server_id != null ? parseInt(line.force_server_id, 10) : 0;
  if (!sid || sid <= 0) {
    sid = parseInt(String((await dbApi.getSetting('default_stream_server_id')) || '0'), 10) || 0;
  }
  if (sid > 0) {
    const s = await getServer(sid);
    if (s && s.enabled) {
      const b = buildServerPublicBaseUrl(s);
      if (b) return b;
    }
  }
  const lb = await queryOne(
    `SELECT * FROM streaming_servers WHERE enabled = 1 AND role = 'lb' ORDER BY sort_order ASC, id ASC LIMIT 1`
  );
  if (lb) {
    const b = buildServerPublicBaseUrl(lb);
    if (b) return b;
  }
  const main = await queryOne(
    `SELECT * FROM streaming_servers WHERE enabled = 1 AND role = 'main' ORDER BY sort_order ASC, id ASC LIMIT 1`
  );
  if (main) {
    const b = buildServerPublicBaseUrl(main);
    if (b) return b;
  }
  return fb;
}

/** Signed stream URLs: same resolution as playlist when env `PUBLIC_STREAM_BASE_URL` is unset. */
async function resolvePublicStreamOrigin(req, line) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  const fb = `${proto}://${host}`;
  const resolved = await resolvePlaylistBaseUrl(line || {}, fb);
  if (resolved === fb) return publicStreamOrigin(req);
  return publicStreamOrigin(req, { preferredBaseUrl: resolved });
}

/** Nginx upstream snippet: edge/main origins by private/public IP and meta.upstream_port. */
async function buildNginxUpstreamSnippet() {
  const rows = await query(
    `SELECT id, name, public_ip, private_ip, role, enabled, meta_json, sort_order
     FROM streaming_servers WHERE enabled = 1 AND role IN ('edge','main')
     ORDER BY sort_order ASC, id ASC`
  );
  const lines = [];
  lines.push('# Upstream to stream origins (generated by IPTV Panel)');
  lines.push('# Paste inside http {} on your load balancer, then proxy_pass http://panel_stream_origins;');
  lines.push('upstream panel_stream_origins {');
  lines.push('    least_conn;');
  let any = false;
  for (const r of rows) {
    const meta = parseMeta(r.meta_json);
    const port = parseInt(meta.upstream_port, 10) || 80;
    const backend = String(r.private_ip || r.public_ip || '').trim();
    if (!backend) continue;
    any = true;
    lines.push(`    server ${backend}:${port};  # ${r.name || r.id}`);
  }
  if (!any) {
    lines.push('    # Add public_ip or private_ip on edge/main servers, or set meta_json.upstream_port');
    lines.push('    server 127.0.0.1:80;');
  }
  lines.push('}');
  return lines.join('\n');
}

/** Full LB `conf.d` file: upstream block + default HTTP proxy to origins. */
async function buildFullLbNginxConfig() {
  const upstream = await buildNginxUpstreamSnippet();
  return `${upstream}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location / {
        proxy_pass http://panel_stream_origins;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
`;
}

/**
 * Get the health/freshness status of a server based on its last heartbeat.
 * Stale servers are flagged but NOT automatically disabled.
 * @param {number} serverId
 * @returns {Promise<{fresh: boolean, lastHeartbeatAt: Date|null, staleMs: number}>}
 */
async function getServerHealthStatus(serverId) {
  const row = await queryOne(
    'SELECT last_heartbeat_at FROM streaming_servers WHERE id = ?',
    [serverId]
  );
  if (!row || !row.last_heartbeat_at) {
    return { fresh: false, lastHeartbeatAt: null, staleMs: Infinity };
  }
  const hbTime = new Date(row.last_heartbeat_at).getTime();
  const now = Date.now();
  const staleMs = now - hbTime;
  return {
    fresh: staleMs < STALE_HEARTBEAT_THRESHOLD_MS,
    lastHeartbeatAt: new Date(hbTime),
    staleMs,
  };
}

/**
 * Get a server row together with all its relationships (parent or child).
 * Relationships are returned separately; they are NOT stored in meta_json.
 * @param {number} serverId
 * @returns {Promise<{server: Object|null, relationships: Array}>}
 */
async function getServerWithRelationships(serverId) {
  const server = await getServer(serverId);
  if (!server) return { server: null, relationships: [] };
  const relationships = await dbApi.getServerRelationships(serverId);
  return { server, relationships };
}

async function applyHeartbeat(serverId, metrics, capabilities) {
  const cpu = metrics.cpu != null ? Number(metrics.cpu) : null;
  const mem = metrics.mem != null ? Number(metrics.mem) : null;
  const net = metrics.net_mbps != null ? Number(metrics.net_mbps) : null;
  const ping = metrics.ping_ms != null ? Number(metrics.ping_ms) : null;
  const ver = metrics.version != null ? String(metrics.version).slice(0, 64) : null;

  await execute(
    `UPDATE streaming_servers SET
      last_heartbeat_at = NOW(),
      health_cpu_pct = ?,
      health_mem_pct = ?,
      health_net_mbps = ?,
      health_ping_ms = ?,
      agent_version = ?
    WHERE id = ?`,
    [
      cpu != null && Number.isFinite(cpu) ? cpu : null,
      mem != null && Number.isFinite(mem) ? mem : null,
      net != null && Number.isFinite(net) ? net : null,
      ping != null && Number.isFinite(ping) ? ping : null,
      ver,
      serverId,
    ]
  );

  // Update capability flags and agent_profile if reported by node
  if (capabilities && typeof capabilities === 'object') {
    await updateServerCapabilities(serverId, capabilities);
  }
}

/**
 * Update streaming_servers capability columns and meta_json.agent_profile
 * when a node reports its runtime profile/capabilities.
 * @param {number} serverId
 * @param {{runtime?: boolean, proxy?: boolean, controller?: boolean, profile?: string}} capabilities
 */
async function updateServerCapabilities(serverId, capabilities) {
  const runtime = capabilities.runtime ? 1 : 0;
  const proxy = capabilities.proxy ? 1 : 0;
  const controller = capabilities.controller ? 1 : 0;
  const profile = String(capabilities.profile || '');

  // Merge agent_profile into existing meta_json
  const row = await queryOne('SELECT meta_json FROM streaming_servers WHERE id = ?', [serverId]);
  let meta = {};
  if (row && row.meta_json) {
    try { meta = JSON.parse(row.meta_json); } catch (_) {}
  }
  meta.agent_profile = profile;

  await execute(
    `UPDATE streaming_servers SET
      runtime_enabled = ?,
      proxy_enabled = ?,
      controller_enabled = ?,
      meta_json = ?
    WHERE id = ?`,
    [runtime, proxy, controller, JSON.stringify(meta), serverId]
  );
}

/**
 * Check whether the panel can safely issue a given command type to a server.
 * Uses heartbeat freshness and capability flags.
 * @param {number} serverId
 * @param {string} commandType - e.g. 'reload_proxy_config', 'restart_services'
 * @returns {{ok: boolean, reason?: string}}
 */
async function canIssueCommandToServer(serverId, commandType) {
  const server = await getServer(serverId);
  if (!server) return { ok: false, reason: 'server not found' };
  if (!server.enabled) return { ok: false, reason: 'server disabled' };

  const health = await getServerHealthStatus(serverId);
  if (!health.fresh) return { ok: false, reason: 'server heartbeat stale' };

  if (
    commandType === 'start_stream' ||
    commandType === 'stop_stream' ||
    commandType === 'restart_stream' ||
    commandType === 'probe_stream' ||
    commandType === 'sync_server_config' ||
    commandType === 'reconcile_runtime' ||
    commandType === 'reconcile_sessions' ||
    commandType === 'sync_proxy_upstream'
  ) {
    return { ok: false, reason: `command de-scoped in TARGET: ${commandType}` };
  }

  // proxy config commands can go to any enabled + healthy node
  if (commandType === 'reload_proxy_config') {
    return { ok: true };
  }

  if (commandType === 'restart_services' || commandType === 'reboot_server') {
    return { ok: true };
  }

  return { ok: false, reason: `unknown command type: ${commandType}` };
}

/**
 * Canonical server selector for playback/playlist consumers.
 * Resolution order: line override → episode/series/content default → default setting → first enabled server.
 * Returns a contract-compliant normalized result (see LB_LIVE_REDIRECT_CONTRACT_SPEC.md §7).
 * @param {Object} params
 * @param {string} params.assetType  - 'live' | 'movie' | 'episode'
 * @param {number|string} params.assetId
 * @param {Object} [params.line] - optional line row
 * @returns {Promise<Object>} contract-compliant normalized selector result
 */
async function selectServer({ assetType, assetId, line = null }) {
  const type = String(assetType || '').toLowerCase();
  const aid = parseInt(assetId, 10);
  const placementStreamId = Number.isFinite(aid) && aid > 0 ? String(aid) : String(assetId || '');
  const warnings = [];
  const debug = {
    requestedLineId: line && line.id ? line.id : 0,
    requestedForceServerId: 0,
    requestedLiveAssignmentServerId: 0,
    defaultServerId: 0,
  };

  // 1. Line override
  if (line && line.force_server_id) {
    const fsid = parseInt(line.force_server_id, 10);
    if (fsid > 0) {
      debug.requestedForceServerId = fsid;
      const picked = await selectServerRowById(fsid, { reason: 'line_override', isOverride: true });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await recordPlacementSelection(type, placementStreamId, picked.serverId);
        return await buildSelectorResult({
          assetType: type, assetId: placementStreamId,
          selectionSource: 'line_override', isOverride: true,
          serverRow: picked, warnings,
        });
      }
    }
  }

  // 2. Content-level assignment
  if (type === 'episode' && Number.isFinite(aid) && aid > 0) {
    const effective = await dbApi.getEffectiveEpisodeServerId(aid);
    if (effective > 0) {
      const picked = await selectServerRowById(effective, { reason: 'episode_assignment' });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await recordPlacementSelection(type, placementStreamId, picked.serverId);
        return await buildSelectorResult({
          assetType: type, assetId: placementStreamId,
          selectionSource: 'episode_assignment', isOverride: false,
          serverRow: picked, warnings,
        });
      }
    }
  } else if (type === 'movie' && Number.isFinite(aid) && aid > 0) {
    const sid = await getMovieStreamServerId(aid);
    if (sid > 0) {
      const picked = await selectServerRowById(sid, { reason: 'movie_assignment' });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await recordPlacementSelection(type, placementStreamId, picked.serverId);
        return await buildSelectorResult({
          assetType: type, assetId: placementStreamId,
          selectionSource: 'movie_assignment', isOverride: false,
          serverRow: picked, warnings,
        });
      }
    }
  } else if (type === 'live' && Number.isFinite(aid)) {
    const sid = await getLiveChannelStreamServerId(aid);
    debug.requestedLiveAssignmentServerId = sid || 0;
    if (sid > 0) {
      const picked = await selectServerRowById(sid, { reason: 'live_assignment' });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await recordPlacementSelection(type, placementStreamId, picked.serverId);
        return await buildSelectorResult({
          assetType: type, assetId: placementStreamId,
          selectionSource: 'live_assignment', isOverride: false,
          serverRow: picked, warnings,
        });
      }
    }
  }

  // 3. Default stream server setting
  const defSid = await getDefaultStreamServerId();
  debug.defaultServerId = defSid || 0;
  if (defSid > 0) {
    const picked = await selectServerRowById(defSid, { reason: 'default_setting' });
    if (picked) {
      if (!picked.server.enabled) warnings.push('default_server_disabled');
      else if (!picked.health.fresh) warnings.push('default_server_stale');
      await recordPlacementSelection(type, placementStreamId, picked.serverId);
      return await buildSelectorResult({
        assetType: type, assetId: placementStreamId,
        selectionSource: 'default_server', isOverride: false,
        serverRow: picked, warnings,
      });
    }
  }

  // 4. Fallback: first enabled server by sort_order (lb → main → edge)
  const fb = await queryOne(
    `SELECT * FROM streaming_servers WHERE enabled = 1 ORDER BY FIELD(role,'lb','main','edge'), sort_order ASC, id ASC LIMIT 1`
  );
  if (fb) {
    const picked = {
      serverId: fb.id,
      server: { ...fb, meta_json: parseMeta(fb.meta_json), domains: [] },
      health: await getServerHealthStatus(fb.id),
      isOverride: false,
    };
    await recordPlacementSelection(type, placementStreamId, picked.serverId);
    return await buildSelectorResult({
      assetType: type, assetId: placementStreamId,
      selectionSource: 'enabled_fallback', isOverride: false,
      serverRow: picked, warnings: [],
    });
  }

  // 5. Last resort — no servers configured, build a synthetic from settings
  const domain = String((await dbApi.getSetting('domain_name')) || '').trim();
  const port = String((await dbApi.getSetting('server_port')) || '80').trim();
  const proto = String((await dbApi.getSetting('server_protocol')) || 'http').trim().toLowerCase();
  if (domain) {
    return {
      assetType: type,
      assetId: placementStreamId,
      selectedServerId: 0,
      selectedServerRole: 'main',
      selectionSource: 'panel_fallback',
      publicBaseUrl: `${proto}://${domain}:${port}`,
      publicHost: domain,
      isOverride: false,
      enabled: true,
      heartbeat: { fresh: false, lastHeartbeatAt: null, staleMs: Infinity },
      warnings: [],
      debug,
    };
  }

  const err = new Error('No server available for selection');
  err.code = 'NO_PUBLIC_ORIGIN_AVAILABLE';
  throw err;
}

// ─── Phase 1 XC Runtime: Read-Only Capability Helpers ────────────────

/** Get all servers that have runtime_enabled = 1. */
async function getRuntimeCapableServers() {
  return await query(
    'SELECT * FROM streaming_servers WHERE runtime_enabled = 1 AND enabled = 1 ORDER BY sort_order ASC, id ASC'
  );
}

/** Get all servers that have proxy_enabled = 1. */
async function getProxyCapableServers() {
  return await query(
    'SELECT * FROM streaming_servers WHERE proxy_enabled = 1 AND enabled = 1 ORDER BY sort_order ASC, id ASC'
  );
}

/**
 * Get all runtime placements for a given asset (stream_type + stream_id).
 * Wraps dbApi.getPlacementByAsset().
 */
async function getRuntimePlacementsForAsset(assetType, assetId) {
  return await dbApi.getPlacementByAsset(assetType, String(assetId));
}

/**
 * Get all placements for a given server, optionally filtered by status.
 * Wraps dbApi.getPlacementsByServer().
 */
async function getRuntimePlacementsForServer(serverId, status) {
  return await dbApi.getPlacementsByServer(serverId, status);
}

/**
 * Get origin→proxy relationships for a given server (as origin or as proxy).
 * Returns parent (origin) and child (proxy) relationships.
 */
async function getOriginProxyRelationships(serverId) {
  const rels = await dbApi.getServerRelationships(serverId);
  return {
    // servers where this server is the parent (i.e., this server is the origin)
    asOrigin: rels.filter(r => String(r.parent_server_id) === String(serverId)),
    // servers where this server is the child (i.e., this server is the proxy)
    asProxy: rels.filter(r => String(r.child_server_id) === String(serverId)),
  };
}

/**
 * Phase 4 — Live Runtime Ownership
 *
 * Check whether a specific live channel has a runtime-ready placement on a server.
 * A placement is considered runtime-ready when:
 *   - status = 'running'
 *   - runtime_instance_id is set (FFmpeg is running on the node)
 *   - ready_at is set (FFmpeg has produced at least one segment)
 *   - the server's heartbeat is fresh
 *
 * This is the runtime-truth gate used by redirectToLiveStream() before
 * redirecting a subscriber to a remote origin node. When the placement is
 * not yet runtime-ready, the route falls back to panel-local streaming
 * and may also trigger an on-demand start command.
 *
 * @param {number} serverId
 * @param {number|string} channelId  — the live stream_id
 * @returns {Promise<{ready: boolean, reason?: string, placement?: object}>}
 */
async function isRuntimeReady(serverId, channelId) {
  const health = await getServerHealthStatus(serverId);
  if (!health.fresh) {
    return { ready: false, reason: 'server heartbeat stale' };
  }
  const placements = await dbApi.getPlacementByAsset('live', String(channelId));
  const placement = placements.find(p => Number(p.server_id) === Number(serverId));
  if (!placement) {
    return { ready: false, reason: 'no placement found for this server' };
  }
  if (String(placement.status) !== 'running') {
    return { ready: false, reason: `placement status is '${placement.status}' not 'running'`, placement };
  }
  if (!placement.runtime_instance_id) {
    return { ready: false, reason: 'runtime_instance_id not set', placement };
  }
  if (!placement.ready_at) {
    return { ready: false, reason: 'ready_at not set', placement };
  }
  return { ready: true, reason: null, placement };
}

/**
 * Phase 6 — Explicit Failover Evaluation
 *
 * Select a failover candidate for a primary origin server when it is unavailable.
 * Only selects from explicit failover relationships (server_relationships.failover).
 * Evaluates candidate health and runtime readiness before returning.
 *
 * @param {number} primaryServerId
 * @param {string} assetType  — 'live' | 'movie' | 'episode'
 * @param {number|string} assetId
 * @returns {Promise<{serverId: number, server: object, health: object, placement?: object}|null>}
 *   null when no explicit failover is configured or all candidates fail health/runtime checks
 */
async function selectFailoverServer(primaryServerId, assetType, assetId) {
  const candidates = await dbApi.getFailoverRelationships(primaryServerId);
  if (!candidates || !candidates.length) return null;

  for (const row of candidates) {
    const health = await getServerHealthStatus(row.server_id);
    if (!health.fresh) continue; // stale — skip

    // Check runtime readiness for live
    if (assetType === 'live') {
      const placements = await dbApi.getPlacementByAsset('live', String(assetId));
      const placement = placements.find(p => Number(p.server_id) === Number(row.server_id));
      if (!placement) continue;
      if (String(placement.status) !== 'running') continue;
      if (!placement.runtime_instance_id) continue;
      if (!placement.ready_at) continue;
      return {
        serverId: row.server_id,
        server: {
          ...row,
          meta_json: parseMeta(row.meta_json),
          domains: [],
        },
        health,
        isFailover: true,
        placement,
      };
    }

    // For movie/episode, check the server is enabled and has heartbeat
    // Runtime readiness is less critical since movie/episode agent handles fetch errors gracefully
    return {
      serverId: row.server_id,
      server: {
        ...row,
        meta_json: parseMeta(row.meta_json),
        domains: [],
      },
      health,
      isFailover: true,
      placement: null,
    };
  }

  return null;
}

// ─── Phase 7 — Origin/Proxy Chain Execution ─────────────────────────

/**
 * Select a delivery proxy for a given origin server.
 * Returns the proxy server row if an explicit origin-proxy relationship exists,
 * ordered by priority. Only returns healthy, proxy-enabled servers.
 *
 * @param {number} originServerId  — the runtime/origin server
 * @returns {Promise<{serverId: number, server: object, health: object}|null>}
 */
async function selectProxyServer(originServerId) {
  const proxies = await dbApi.getProxyRelationships(originServerId);
  if (!proxies || !proxies.length) return null;

  for (const row of proxies) {
    const health = await getServerHealthStatus(row.server_id);
    if (!health.fresh) continue;
    return {
      serverId: row.server_id,
      server: {
        ...row,
        meta_json: parseMeta(row.meta_json),
        domains: [],
      },
      health,
    };
  }
  return null;
}

/**
 * Build an nginx upstream configuration snippet for a proxy-delivery node.
 * The upstream names the origins this proxy forwards to.
 *
 * nginx config (add to /etc/nginx/conf.d/iptv_proxy_upstream.conf on the proxy node):
 *   upstream panel_proxy_upstreams {
 *       server <origin1_ip>:<port>;
 *       server <origin2_ip>:<port>;
 *   }
 *
 * The proxy's location block should proxy_pass to this upstream.
 *
 * @param {number} proxyServerId
 * @returns {Promise<string>} nginx upstream config block
 */
async function buildProxyUpstreamConfig(proxyServerId) {
  const origins = await dbApi.getOriginServersForProxy(proxyServerId);
  if (!origins || !origins.length) return '';

  const lines = ['# Upstream origins for proxy server (generated by IPTV Panel)'];
  lines.push('upstream panel_proxy_upstreams {');
  for (const o of origins) {
    const meta = parseMeta(o.meta_json || {});
    const upstreamPort = parseInt(meta.upstream_port, 10) || 80;
    const ip = String(o.private_ip || o.public_ip || '').trim();
    if (!ip) continue;
    lines.push(`    server ${ip}:${upstreamPort};  # ${o.name || o.server_id}`);
  }
  lines.push('}');
  return lines.join('\n');
}

module.exports = {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  reorderServers,
  replaceDomains,
  applyHeartbeat,
  resolvePlaylistBaseUrl,
  resolvePublicStreamOrigin,
  buildNginxUpstreamSnippet,
  buildFullLbNginxConfig,
  buildServerPublicBaseUrl,
  getDefaultStreamServerId,
  getMovieStreamServerId,
  getLiveChannelStreamServerId,
  getServerHealthStatus,
  getServerWithRelationships,
  selectServer,
  STALE_HEARTBEAT_THRESHOLD_MS,
  // Phase 1 XC Runtime read helpers
  getRuntimeCapableServers,
  getProxyCapableServers,
  getRuntimePlacementsForAsset,
  getRuntimePlacementsForServer,
  getOriginProxyRelationships,
  updateServerCapabilities,
  canIssueCommandToServer,
  isRuntimeReady,
  // Phase 6 — explicit failover
  selectFailoverServer,
  // Phase 7 — origin/proxy chains
  selectProxyServer,
  buildProxyUpstreamConfig,
};
