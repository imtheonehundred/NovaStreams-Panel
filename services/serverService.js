'use strict';

const { query, queryOne, execute, insert, remove } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const { publicStreamOrigin } = require('../lib/public-stream-origin');

const ROLES = new Set(['main', 'lb', 'edge']);

function parseMeta(val) {
  if (val == null || val === '') return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(String(val)); } catch { return {}; }
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
  let metaJson = null;
  if (data.meta_json !== undefined) {
    metaJson = typeof data.meta_json === 'string' ? data.meta_json : JSON.stringify(data.meta_json || {});
  }

  const id = await insert(
    `INSERT INTO streaming_servers (
      name, role, public_host, public_ip, private_ip, max_clients, enabled, proxied, timeshift_only,
      network_mbps_cap, sort_order, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      metaJson,
    ]
  );

  if (role === 'main') await demoteOtherMains(id);
  await replaceDomains(id, data.domains);
  return getServer(id);
}

async function updateServer(id, data) {
  const existing = await queryOne('SELECT id FROM streaming_servers WHERE id = ?', [id]);
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

async function applyHeartbeat(serverId, metrics) {
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
}

module.exports = {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  replaceDomains,
  applyHeartbeat,
  resolvePlaylistBaseUrl,
  resolvePublicStreamOrigin,
  buildNginxUpstreamSnippet,
  buildFullLbNginxConfig,
  buildServerPublicBaseUrl,
};
