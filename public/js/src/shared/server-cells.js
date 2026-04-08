// Shared server cells formatters - extracted from modules/shared/server-cells.js

export function serverHeartbeatFresh(s) {
  if (!s || !s.last_heartbeat_at) return false;
  const ts = new Date(s.last_heartbeat_at).getTime();
  return Number.isFinite(ts) && (Date.now() - ts) <= 5 * 60 * 1000;
}

export function serverRoleBadge(role, escHtml) {
  const r = String(role || '').toLowerCase();
  if (r === 'main') return '<span class="server-mini-badge blue">MAIN</span>';
  if (r === 'lb') return '<span class="server-mini-badge teal">LB</span>';
  if (r === 'edge') return '<span class="server-mini-badge amber">EDGE</span>';
  return `<span class="server-mini-badge slate">${escHtml(String(role || 'server').toUpperCase())}</span>`;
}

export function serverHealthLabel(s) {
  if (!s.enabled) return { cls: 'offline', label: 'Disabled' };
  if (!s.last_heartbeat_at) return { cls: 'warning', label: 'No agent' };
  if (!serverHeartbeatFresh(s)) return { cls: 'warning', label: 'Stale' };
  return { cls: 'ok', label: 'OK' };
}

export function serverStatusCell(s, escHtml) {
  const fresh = serverHeartbeatFresh(s);
  const dotCls = !s.enabled ? 'offline' : (fresh ? 'online' : 'warning');
  const text = !s.enabled ? 'Disabled' : (fresh ? 'Online' : (s.last_heartbeat_at ? 'Stale' : 'No Agent'));
  return `<div class="server-status-cell"><span class="server-status-dot ${dotCls}"></span><span>${escHtml(text)}</span></div>`;
}

export function serverPortsCell(s, escHtml) {
  const meta = s.meta_json && typeof s.meta_json === 'object' ? s.meta_json : {};
  const httpPort = meta.http_port || meta.port || 80;
  const httpsPort = meta.https_port || (meta.https ? 443 : null);
  const parts = [
    `<span class="server-port-chip">${escHtml(String(httpPort))}</span>`,
    httpsPort ? `<span class="server-port-chip is-secure">${escHtml(String(httpsPort))}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="server-port-list">${parts || '<span class="text-muted">—</span>'}</div>`;
}

export function serverDnsCell(s, escHtml) {
  const domains = Array.isArray(s.domains) ? s.domains.map((d) => d.domain).filter(Boolean) : [];
  const host = s.public_host || '';
  return `
    <div class="server-dns-cell">
      <div class="server-dns-primary">${escHtml(host || '—')}</div>
      <div class="server-dns-secondary">${domains.length > 1 ? `${domains.length} DNS entries` : (domains.length === 1 ? '1 DNS entry' : 'No DNS entries')}</div>
    </div>`;
}

export function serverClientsCell(s) {
  const active = Number(s.active_sessions || 0);
  const max = Number(s.max_clients || 0);
  return `<div class="server-clients-cell"><span class="server-clients-count">${active}</span>${max > 0 ? `<span class="server-clients-max">/ ${max}</span>` : ''}</div>`;
}

export function serverResourcesCell(s) {
  const cpu = s.health_cpu_pct != null ? Number(s.health_cpu_pct) : null;
  const mem = s.health_mem_pct != null ? Number(s.health_mem_pct) : null;
  const cpuW = cpu != null && Number.isFinite(cpu) ? Math.max(0, Math.min(100, cpu)) : 0;
  const memW = mem != null && Number.isFinite(mem) ? Math.max(0, Math.min(100, mem)) : 0;
  return `
    <div class="server-resources-cell">
      <div class="server-resource-line"><span>CPU</span><div class="server-mini-bar"><div class="server-mini-fill cpu" style="width:${cpuW}%"></div></div><strong>${cpu != null && Number.isFinite(cpu) ? cpu.toFixed(0) + '%' : '—'}</strong></div>
      <div class="server-resource-line"><span>RAM</span><div class="server-mini-bar"><div class="server-mini-fill mem" style="width:${memW}%"></div></div><strong>${mem != null && Number.isFinite(mem) ? mem.toFixed(0) + '%' : '—'}</strong></div>
    </div>`;
}

export function serverBandwidthCell(s) {
  const net = s.health_net_mbps != null ? Number(s.health_net_mbps) : null;
  const cap = s.network_mbps_cap != null ? Number(s.network_mbps_cap) : 0;
  const pct = net != null && Number.isFinite(net)
    ? (cap > 0 ? Math.max(0, Math.min(100, (net / cap) * 100)) : Math.min(100, net * 5))
    : 0;
  return `
    <div class="server-bandwidth-cell">
      <div class="server-resource-line"><span>IN</span><div class="server-mini-bar"><div class="server-mini-fill net" style="width:${pct}%"></div></div><strong>${net != null && Number.isFinite(net) ? net.toFixed(1) + ' Mb/s' : '—'}</strong></div>
      <div class="server-resource-line"><span>OUT</span><div class="server-mini-bar"><div class="server-mini-fill muted" style="width:${pct * 0.35}%"></div></div><strong>${cap > 0 ? cap + ' cap' : '—'}</strong></div>
    </div>`;
}

export function serverNameCell(s, escHtml, serverRoleBadge) {
  const host = s.public_ip || s.private_ip || '—';
  return `
    <div class="server-name-cell-rich">
      <div class="server-name-top">${serverRoleBadge(s.role, escHtml)} <span class="server-name-value">${escHtml(s.name || '')}</span></div>
      <div class="server-name-sub">${escHtml(host)}</div>
    </div>`;
}

export function serverActionsCell(s) {
  return `
    <div class="server-actions-split" data-server-action-wrap="${s.id}">
      <button type="button" class="server-actions-main" data-app-action="openServerAdvancedModal" data-app-args="${s.id}">Actions</button>
      <button type="button" class="server-actions-toggle" data-app-action="toggleServerActionMenu" data-app-args="event, ${s.id}">&#9662;</button>
      <div class="server-actions-menu" id="serverActionMenu-${s.id}">
        <button type="button" class="server-actions-menu-item" data-app-action="serverActionIpChange" data-app-args="${s.id}">IP Change</button>
        <button type="button" class="server-actions-menu-item" data-app-action="serverActionStartAllStreams" data-app-args="${s.id}">Start All Streams</button>
        <button type="button" class="server-actions-menu-item" data-app-action="serverActionStopAllStreams" data-app-args="${s.id}">Stop All Streams</button>
        <button type="button" class="server-actions-menu-item danger" data-app-action="serverActionKillConnections" data-app-args="${s.id}">Kill All Connections</button>
        <div class="server-actions-divider"></div>
        <button type="button" class="server-actions-menu-item" data-app-action="serverActionEdit" data-app-args="${s.id}">Edit Server</button>
        <button type="button" class="server-actions-menu-item" data-app-action="serverActionMonitor" data-app-args="${s.id}">Monitor</button>
      </div>
    </div>`;
}

export function providerHostLabel(url) {
  try { return new URL(url).host; } catch { return '—'; }
}

export function getTimezoneOptions() {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch (_) {}
  return ['UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Baghdad', 'Asia/Dubai', 'Asia/Istanbul', 'America/New_York'];
}
