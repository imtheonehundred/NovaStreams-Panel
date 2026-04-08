'use strict';

const { query, queryOne, execute, insert, remove } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const { encryptSensitiveValue } = require('../lib/crypto');

const ROLES = new Set(['main', 'lb', 'edge']);

/** Heartbeat freshness threshold in milliseconds. Servers whose last heartbeat
 *  is older than this are considered stale. Not wired into playback selection. */
const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000;

function normalizeAdminPasswordForStorage(value) {
  const raw = String(value || '').trim();
  return raw ? encryptSensitiveValue(raw) : '';
}

function parseMeta(val) {
  if (val == null || val === '') return {};
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return {};
  }
}

function buildServerMeta(data, baseMeta = {}) {
  const meta = { ...(baseMeta || {}) };
  const setOrDelete = (key, value) => {
    const normalized = Array.isArray(value)
      ? value.filter(Boolean)
      : typeof value === 'string'
        ? value.trim()
        : value;
    if (
      normalized === undefined ||
      normalized === null ||
      normalized === '' ||
      (Array.isArray(normalized) && !normalized.length)
    ) {
      delete meta[key];
      return;
    }
    meta[key] = normalized;
  };
  if (data.private_users_cdn_lb !== undefined) {
    setOrDelete('private_users_cdn_lb', data.private_users_cdn_lb);
  }
  if (data.http_port_list !== undefined) {
    setOrDelete('http_port_list', data.http_port_list);
  }
  if (data.geoip_priority !== undefined) {
    setOrDelete('geoip_priority', data.geoip_priority);
  }
  if (data.server_guard_whitelist_username !== undefined) {
    setOrDelete(
      'server_guard_whitelist_username',
      data.server_guard_whitelist_username
    );
  }
  if (data.server_guard_auto_restart_mysql_value !== undefined) {
    setOrDelete(
      'server_guard_auto_restart_mysql_value',
      data.server_guard_auto_restart_mysql_value
    );
  }
  if (data.isp_priority_label !== undefined) {
    setOrDelete('isp_priority_label', data.isp_priority_label);
  }
  return meta;
}

async function listServers() {
  const rows = await query(
    'SELECT * FROM streaming_servers ORDER BY sort_order ASC, id ASC'
  );
  const domains = await query(
    'SELECT * FROM streaming_server_domains ORDER BY server_id ASC, sort_order ASC, id ASC'
  );
  const map = new Map(
    rows.map((row) => [
      row.id,
      { ...row, meta_json: parseMeta(row.meta_json), domains: [] },
    ])
  );
  for (const domain of domains) {
    const server = map.get(domain.server_id);
    if (server) server.domains.push(domain);
  }
  return [...map.values()];
}

async function getServer(id) {
  const row = await queryOne('SELECT * FROM streaming_servers WHERE id = ?', [
    id,
  ]);
  if (!row) return null;
  const domains = await query(
    'SELECT * FROM streaming_server_domains WHERE server_id = ? ORDER BY sort_order ASC, id ASC',
    [id]
  );
  return { ...row, meta_json: parseMeta(row.meta_json), domains };
}

async function getMovieStreamServerId(movieId) {
  const row = await queryOne(
    'SELECT stream_server_id FROM movies WHERE id = ?',
    [movieId]
  );
  if (!row) return 0;
  const serverId = parseInt(row.stream_server_id, 10);
  return Number.isFinite(serverId) && serverId > 0 ? serverId : 0;
}

async function getLiveChannelStreamServerId(channelId) {
  const row = await queryOne('SELECT json_data FROM channels WHERE id = ?', [
    String(channelId),
  ]);
  if (!row) return 0;
  try {
    const json =
      typeof row.json_data === 'string'
        ? JSON.parse(row.json_data)
        : row.json_data;
    const serverId = parseInt(json && json.stream_server_id, 10);
    return Number.isFinite(serverId) && serverId > 0 ? serverId : 0;
  } catch {
    return 0;
  }
}

async function getDefaultStreamServerId() {
  const serverId = parseInt(
    String((await dbApi.getSetting('default_stream_server_id')) || '0'),
    10
  );
  return Number.isFinite(serverId) && serverId > 0 ? serverId : 0;
}

async function recordPlacementSelection(assetType, assetId, serverId) {
  const type = String(assetType || '').toLowerCase();
  if (!['live', 'movie', 'episode'].includes(type)) return;
  const normalizedServerId = parseInt(serverId, 10);
  if (!Number.isFinite(normalizedServerId) || normalizedServerId <= 0) return;
  try {
    await dbApi.createPlacement({
      streamType: type,
      streamId: String(assetId),
      serverId: normalizedServerId,
    });
  } catch {}
}

async function demoteOtherMains(exceptId) {
  await execute(
    "UPDATE streaming_servers SET role = 'edge' WHERE role = 'main' AND id != ?",
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
  const runtimeEnabled = data.runtime_enabled ? 1 : 0;
  const proxyEnabled = data.proxy_enabled ? 1 : 0;
  const controllerEnabled = data.controller_enabled ? 1 : 0;
  let metaObj = data.meta_json !== undefined ? parseMeta(data.meta_json) : {};
  metaObj = buildServerMeta(data, metaObj);
  const metaJson = Object.keys(metaObj).length ? JSON.stringify(metaObj) : null;

  const baseUrl = String(data.base_url || '').trim();
  const serverIp = String(data.server_ip || '').trim();
  const dns1 = String(data.dns_1 || '').trim();
  const dns2 = String(data.dns_2 || '').trim();
  const adminPassword = normalizeAdminPasswordForStorage(data.admin_password);
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
  const ispCaseSensitive = ['none', 'lower', 'upper'].includes(
    data.isp_case_sensitive
  )
    ? data.isp_case_sensitive
    : 'lower';

  const id = await insert(
    `INSERT INTO streaming_servers (
      name, role, public_host, public_ip, private_ip, max_clients, enabled, proxied, timeshift_only,
      network_mbps_cap, sort_order, runtime_enabled, proxy_enabled, controller_enabled, meta_json,
      base_url, server_ip, dns_1, dns_2, admin_password, full_duplex, boost_fpm,
      http_port, https_m3u_lines, force_ssl_port, https_port, time_difference, ssh_port,
      network_interface, network_speed, os_info, geoip_load_balancing, geoip_countries, extra_nginx_config,
      server_guard_enabled, ip_whitelisting, botnet_fighter, under_attack,
      connection_limit_ports, max_conn_per_ip, max_hits_normal_user, max_hits_restreamer,
      whitelist_username, block_user_minutes, auto_restart_mysql,
      isp_enabled, isp_priority, isp_allowed_names, isp_case_sensitive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      role,
      publicHost,
      publicIp,
      privateIp,
      Number.isFinite(maxClients) && maxClients >= 0 ? maxClients : 0,
      enabled,
      proxied,
      timeshiftOnly,
      networkCap,
      sortOrder,
      runtimeEnabled,
      proxyEnabled,
      controllerEnabled,
      metaJson,
      baseUrl,
      serverIp,
      dns1,
      dns2,
      adminPassword,
      fullDuplex,
      boostFpm,
      httpPort,
      httpsM3uLines,
      forceSslPort,
      httpsPort,
      timeDiff,
      sshPort,
      netInterface,
      netSpeed,
      osInfo,
      geoipLb,
      geoipCountries,
      extraNginx,
      serverGuard,
      ipWhitelist,
      botnetFighter,
      underAttack,
      connLimitPorts,
      maxConnPerIp,
      maxHitsNormal,
      maxHitsRestreamer,
      whitelistUsername,
      blockUserMins,
      autoRestartMysql,
      ispEnabled,
      ispPriority,
      ispAllowedNames,
      ispCaseSensitive,
    ]
  );

  if (role === 'main') await demoteOtherMains(id);
  await replaceDomains(id, data.domains);
  return getServer(id);
}

async function updateServer(id, data) {
  const existing = await queryOne(
    'SELECT id, meta_json FROM streaming_servers WHERE id = ?',
    [id]
  );
  if (!existing) return null;

  const sets = [];
  const values = [];
  const push = (column, value) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (data.name !== undefined) {
    push('name', String(data.name || '').trim() || 'Server');
  }
  if (data.role !== undefined) {
    const role = String(data.role || '').toLowerCase();
    if (!ROLES.has(role)) throw new Error('invalid role');
    push('role', role);
  }
  if (data.public_host !== undefined) {
    push('public_host', String(data.public_host || '').trim());
  }
  if (data.public_ip !== undefined) {
    push('public_ip', String(data.public_ip || '').trim());
  }
  if (data.private_ip !== undefined) {
    push('private_ip', String(data.private_ip || '').trim());
  }
  if (data.max_clients !== undefined) {
    const value = parseInt(data.max_clients, 10);
    push('max_clients', Number.isFinite(value) && value >= 0 ? value : 0);
  }
  if (data.enabled !== undefined) push('enabled', data.enabled ? 1 : 0);
  if (data.proxied !== undefined) push('proxied', data.proxied ? 1 : 0);
  if (data.timeshift_only !== undefined) {
    push('timeshift_only', data.timeshift_only ? 1 : 0);
  }
  if (data.network_mbps_cap !== undefined) {
    const value = parseInt(data.network_mbps_cap, 10);
    push('network_mbps_cap', Number.isFinite(value) && value >= 0 ? value : 0);
  }
  if (data.sort_order !== undefined) {
    const value = parseInt(data.sort_order, 10);
    push('sort_order', Number.isFinite(value) ? value : 0);
  }
  if (data.meta_json !== undefined) {
    const metaJson =
      typeof data.meta_json === 'string'
        ? data.meta_json
        : JSON.stringify(data.meta_json || {});
    push('meta_json', metaJson);
  }
  if (data.base_url !== undefined) {
    push('base_url', String(data.base_url || '').trim());
  }
  if (data.server_ip !== undefined) {
    push('server_ip', String(data.server_ip || '').trim());
  }
  if (data.dns_1 !== undefined) push('dns_1', String(data.dns_1 || '').trim());
  if (data.dns_2 !== undefined) push('dns_2', String(data.dns_2 || '').trim());
  if (data.admin_password !== undefined) {
    push(
      'admin_password',
      normalizeAdminPasswordForStorage(data.admin_password)
    );
  }
  if (data.full_duplex !== undefined)
    push('full_duplex', data.full_duplex ? 1 : 0);
  if (data.boost_fpm !== undefined) push('boost_fpm', data.boost_fpm ? 1 : 0);
  if (data.http_port !== undefined) {
    push('http_port', parseInt(data.http_port, 10) || 8080);
  }
  if (data.https_m3u_lines !== undefined) {
    push('https_m3u_lines', data.https_m3u_lines ? 1 : 0);
  }
  if (data.force_ssl_port !== undefined) {
    push('force_ssl_port', data.force_ssl_port ? 1 : 0);
  }
  if (data.https_port !== undefined) {
    push('https_port', parseInt(data.https_port, 10) || 8083);
  }
  if (data.time_difference !== undefined) {
    push('time_difference', String(data.time_difference || 'Auto').trim());
  }
  if (data.ssh_port !== undefined) {
    push('ssh_port', parseInt(data.ssh_port, 10) || 22);
  }
  if (data.network_interface !== undefined) {
    push('network_interface', String(data.network_interface || 'all').trim());
  }
  if (data.network_speed !== undefined) {
    push('network_speed', String(data.network_speed || '').trim());
  }
  if (data.os_info !== undefined)
    push('os_info', String(data.os_info || '').trim());
  if (data.geoip_load_balancing !== undefined) {
    push('geoip_load_balancing', data.geoip_load_balancing ? 1 : 0);
  }
  if (data.geoip_countries !== undefined) {
    push('geoip_countries', String(data.geoip_countries || '').trim());
  }
  if (data.extra_nginx_config !== undefined) {
    push('extra_nginx_config', String(data.extra_nginx_config || '').trim());
  }
  if (data.server_guard_enabled !== undefined) {
    push('server_guard_enabled', data.server_guard_enabled ? 1 : 0);
  }
  if (data.ip_whitelisting !== undefined) {
    push('ip_whitelisting', data.ip_whitelisting ? 1 : 0);
  }
  if (data.botnet_fighter !== undefined) {
    push('botnet_fighter', data.botnet_fighter ? 1 : 0);
  }
  if (data.under_attack !== undefined)
    push('under_attack', data.under_attack ? 1 : 0);
  if (data.connection_limit_ports !== undefined) {
    push(
      'connection_limit_ports',
      String(data.connection_limit_ports || '').trim()
    );
  }
  if (data.max_conn_per_ip !== undefined) {
    push('max_conn_per_ip', parseInt(data.max_conn_per_ip, 10) || 3);
  }
  if (data.max_hits_normal_user !== undefined) {
    push('max_hits_normal_user', parseInt(data.max_hits_normal_user, 10) || 1);
  }
  if (data.max_hits_restreamer !== undefined) {
    push('max_hits_restreamer', parseInt(data.max_hits_restreamer, 10) || 1);
  }
  if (data.whitelist_username !== undefined) {
    push('whitelist_username', data.whitelist_username ? 1 : 0);
  }
  if (data.block_user_minutes !== undefined) {
    push('block_user_minutes', parseInt(data.block_user_minutes, 10) || 30);
  }
  if (data.auto_restart_mysql !== undefined) {
    push('auto_restart_mysql', data.auto_restart_mysql ? 1 : 0);
  }
  if (data.isp_enabled !== undefined)
    push('isp_enabled', data.isp_enabled ? 1 : 0);
  if (data.isp_priority !== undefined) {
    push('isp_priority', parseInt(data.isp_priority, 10) || 1);
  }
  if (data.isp_allowed_names !== undefined) {
    push('isp_allowed_names', String(data.isp_allowed_names || '').trim());
  }
  if (data.isp_case_sensitive !== undefined) {
    push(
      'isp_case_sensitive',
      ['none', 'lower', 'upper'].includes(data.isp_case_sensitive)
        ? data.isp_case_sensitive
        : 'lower'
    );
  }

  if (
    data.private_users_cdn_lb !== undefined ||
    data.http_port_list !== undefined ||
    data.geoip_priority !== undefined ||
    data.server_guard_whitelist_username !== undefined ||
    data.server_guard_auto_restart_mysql_value !== undefined ||
    data.isp_priority_label !== undefined
  ) {
    const metaObj = buildServerMeta(data, parseMeta(existing.meta_json));
    push(
      'meta_json',
      Object.keys(metaObj).length ? JSON.stringify(metaObj) : null
    );
  }

  if (sets.length) {
    values.push(id);
    await execute(
      `UPDATE streaming_servers SET ${sets.join(', ')} WHERE id = ?`,
      values
    );
  }

  const row = await queryOne(
    'SELECT role FROM streaming_servers WHERE id = ?',
    [id]
  );
  if (row && row.role === 'main') await demoteOtherMains(id);

  if (data.domains !== undefined) await replaceDomains(id, data.domains);
  return getServer(id);
}

async function replaceDomains(serverId, domains) {
  if (!Array.isArray(domains)) return;
  await execute('DELETE FROM streaming_server_domains WHERE server_id = ?', [
    serverId,
  ]);
  let sort = 0;
  let primaryDone = false;
  for (const entry of domains) {
    const domain =
      typeof entry === 'string'
        ? entry.trim()
        : entry && typeof entry === 'object'
          ? String(entry.domain || '').trim()
          : '';
    if (!domain) continue;
    let isPrimary = 0;
    if (typeof entry === 'object' && entry.is_primary) isPrimary = 1;
    else if (!primaryDone) isPrimary = 1;
    if (isPrimary) primaryDone = true;
    await insert(
      'INSERT INTO streaming_server_domains (server_id, domain, is_primary, sort_order) VALUES (?, ?, ?, ?)',
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
    const sortOrder = parseInt(item.sort_order, 10);
    if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) continue;
    await execute('UPDATE streaming_servers SET sort_order = ? WHERE id = ?', [
      sortOrder,
      id,
    ]);
  }
  return true;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildServerPublicBaseUrl(row) {
  if (!row) return null;
  const meta = parseMeta(row.meta_json);
  if (meta.public_base_url) {
    return stripTrailingSlash(String(meta.public_base_url).trim());
  }
  const host = String(row.public_host || '').trim();
  if (!host) return null;
  const https = meta.https === true || meta.https === 1 || meta.https === '1';
  const proto = https ? 'https' : 'http';
  let port = '';
  if (
    meta.port != null &&
    String(meta.port) !== '' &&
    String(meta.port) !== '80' &&
    String(meta.port) !== '443'
  ) {
    const parsedPort = parseInt(meta.port, 10);
    if (Number.isFinite(parsedPort)) port = `:${parsedPort}`;
  }
  return `${proto}://${host}${port}`;
}

async function getServerHealthStatus(serverId) {
  const row = await queryOne(
    'SELECT last_heartbeat_at FROM streaming_servers WHERE id = ?',
    [serverId]
  );
  if (!row || !row.last_heartbeat_at) {
    return { fresh: false, lastHeartbeatAt: null, staleMs: Infinity };
  }
  const heartbeatTime = new Date(row.last_heartbeat_at).getTime();
  const staleMs = Date.now() - heartbeatTime;
  return {
    fresh: staleMs < STALE_HEARTBEAT_THRESHOLD_MS,
    lastHeartbeatAt: new Date(heartbeatTime),
    staleMs,
  };
}

async function getServerWithRelationships(serverId) {
  const server = await getServer(serverId);
  if (!server) return { server: null, relationships: [] };
  const relationships = await dbApi.getServerRelationships(serverId);
  return { server, relationships };
}

async function applyHeartbeat(serverId, metrics = {}, capabilities) {
  const cpu = metrics.cpu != null ? Number(metrics.cpu) : null;
  const mem = metrics.mem != null ? Number(metrics.mem) : null;
  const net = metrics.net_mbps != null ? Number(metrics.net_mbps) : null;
  const ping = metrics.ping_ms != null ? Number(metrics.ping_ms) : null;
  const version =
    metrics.version != null ? String(metrics.version).slice(0, 64) : null;

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
      version,
      serverId,
    ]
  );

  if (capabilities && typeof capabilities === 'object') {
    await updateServerCapabilities(serverId, capabilities);
  }
}

async function updateServerCapabilities(serverId, capabilities) {
  const runtime = capabilities.runtime ? 1 : 0;
  const proxy = capabilities.proxy ? 1 : 0;
  const controller = capabilities.controller ? 1 : 0;
  const profile = String(capabilities.profile || '');

  const row = await queryOne(
    'SELECT meta_json FROM streaming_servers WHERE id = ?',
    [serverId]
  );
  let meta = {};
  if (row && row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json);
    } catch (_) {}
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

  if (commandType === 'reload_proxy_config') return { ok: true };
  if (commandType === 'restart_services' || commandType === 'reboot_server') {
    return { ok: true };
  }

  return { ok: false, reason: `unknown command type: ${commandType}` };
}

async function getRuntimeCapableServers() {
  return await query(
    'SELECT * FROM streaming_servers WHERE runtime_enabled = 1 AND enabled = 1 ORDER BY sort_order ASC, id ASC'
  );
}

async function getProxyCapableServers() {
  return await query(
    'SELECT * FROM streaming_servers WHERE proxy_enabled = 1 AND enabled = 1 ORDER BY sort_order ASC, id ASC'
  );
}

async function getRuntimePlacementsForAsset(assetType, assetId) {
  return await dbApi.getPlacementByAsset(assetType, String(assetId));
}

async function getRuntimePlacementsForServer(serverId, status) {
  return await dbApi.getPlacementsByServer(serverId, status);
}

async function getOriginProxyRelationships(serverId) {
  const relationships = await dbApi.getServerRelationships(serverId);
  return {
    asOrigin: relationships.filter(
      (row) => String(row.parent_server_id) === String(serverId)
    ),
    asProxy: relationships.filter(
      (row) => String(row.child_server_id) === String(serverId)
    ),
  };
}

async function isRuntimeReady(serverId, channelId) {
  const server = await getServer(serverId);
  if (!server || !server.enabled) {
    return { ready: false, reason: 'server disabled or missing' };
  }
  const health = await getServerHealthStatus(serverId);
  if (!health.fresh) {
    return { ready: false, reason: 'server heartbeat stale' };
  }
  const placements = await dbApi.getPlacementByAsset('live', String(channelId));
  const placement = placements.find(
    (row) => Number(row.server_id) === Number(serverId)
  );
  if (!placement) {
    return { ready: false, reason: 'no placement found for this server' };
  }
  if (String(placement.status) !== 'running') {
    return {
      ready: false,
      reason: `placement status is '${placement.status}' not 'running'`,
      placement,
    };
  }
  if (!placement.runtime_instance_id) {
    return { ready: false, reason: 'runtime_instance_id not set', placement };
  }
  if (!placement.ready_at) {
    return { ready: false, reason: 'ready_at not set', placement };
  }
  return { ready: true, reason: null, placement };
}

module.exports = {
  STALE_HEARTBEAT_THRESHOLD_MS,
  parseMeta,
  stripTrailingSlash,
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  reorderServers,
  recordPlacementSelection,
  demoteOtherMains,
  replaceDomains,
  buildServerPublicBaseUrl,
  getDefaultStreamServerId,
  getMovieStreamServerId,
  getLiveChannelStreamServerId,
  getServerHealthStatus,
  getServerWithRelationships,
  applyHeartbeat,
  updateServerCapabilities,
  canIssueCommandToServer,
  getRuntimeCapableServers,
  getProxyCapableServers,
  getRuntimePlacementsForAsset,
  getRuntimePlacementsForServer,
  getOriginProxyRelationships,
  isRuntimeReady,
};
