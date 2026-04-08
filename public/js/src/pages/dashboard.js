// pages/dashboard.js - Extracted from modules/dashboard.js + app.js dashboard wrappers
// NovaStreams Panel Admin Dashboard Page Module

const DASHBOARD_HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

function isFreshHeartbeatTs(ts) {
  if (!ts) return false;
  const at = new Date(ts).getTime();
  if (!Number.isFinite(at)) return false;
  return (Date.now() - at) <= DASHBOARD_HEARTBEAT_FRESH_MS;
}

function dashboardText(escHtml, value) {
  if (value == null || value === '') return '—';
  return escHtml(String(value));
}

function dashboardMetricTone(pct) {
  const num = Number(pct);
  if (!Number.isFinite(num)) return 'muted';
  if (num >= 75) return 'red';
  if (num >= 50) return 'yellow';
  return 'green';
}

function dashboardAccentClass(role, index, isLocal) {
  if (isLocal || role === 'main') return 'indigo';
  if (role === 'lb') return 'teal';
  if (role === 'edge') return index % 2 === 0 ? 'rose' : 'amber';
  return 'slate';
}

function dashboardFact(label, value) {
  return { label, value: value == null || value === '' ? '—' : String(value) };
}

function dashboardMetric(label, pct, value, tone) {
  const hasPct = Number.isFinite(Number(pct));
  return {
    label,
    pct: hasPct ? Math.max(0, Math.min(100, Number(pct))) : 0,
    value: value == null || value === '' ? '—' : String(value),
    tone: tone || (hasPct ? dashboardMetricTone(pct) : 'muted'),
  };
}

function buildDashboardInitialServerCards(stats, healthData, servers) {
  const liveStreams = Number(stats.liveStreams) || 0;
  const totalChannels = Number(stats.channelsCount) || 0;
  const downStreams = Math.max(0, totalChannels - liveStreams);
  const netInMbps = Number(stats.netIn) || 0;
  const netOutMbps = Number(stats.netOut) || 0;
  const ioMbps = Math.max(netInMbps, netOutMbps);
  const uptimeToday = healthData && healthData.today && Number(healthData.today.totalChecks || 0) > 0 && Number.isFinite(Number(healthData.today.uptimePct))
    ? `${healthData.today.uptimePct}%`
    : 'No samples yet';
  const localStatusTone = healthData && healthData.status === 'unknown'
    ? 'warning'
    : (healthData && healthData.status === 'down' ? 'offline' : 'online');
  const localStatusText = healthData && healthData.status === 'unknown'
    ? 'Pending'
    : (healthData && healthData.status === 'down' ? 'Down' : 'Healthy');
  const localStatusMeta = healthData && healthData.status === 'unknown'
    ? 'Awaiting first check'
    : (healthData && healthData.lastResponseMs ? `${healthData.lastResponseMs} ms` : 'Realtime');
  const baseCards = [{
    name: 'Main Server',
    subtitle: 'Panel Node',
    accentClass: dashboardAccentClass('main', 0, true),
    statusTone: localStatusTone,
    statusText: localStatusText,
    statusMeta: localStatusMeta,
    facts: [
      dashboardFact('Connections', stats.connections || 0),
      dashboardFact('Users', stats.activeLines || 0),
      dashboardFact('Streams Live', liveStreams),
      dashboardFact('Down', downStreams),
      dashboardFact('Uptime', uptimeToday),
      dashboardFact('Requests /sec', 0),
      dashboardFact('Input (Mbps)', netInMbps.toFixed(1)),
      dashboardFact('Output (Mbps)', netOutMbps.toFixed(1)),
    ],
    metrics: [
      dashboardMetric('CPU', stats.cpu, `${stats.cpu || 0}%`),
      dashboardMetric('MEM', stats.memPercent, `${stats.memPercent || 0}%`),
      dashboardMetric('IO', Math.min(100, ioMbps * 2), `${ioMbps.toFixed(1)} Mbps`),
      dashboardMetric('DISK', stats.diskPercent, `${stats.diskPercent || 0}%`),
    ],
  }];
  const remoteCards = (Array.isArray(servers) ? servers : []).map((server, index) => {
    const cpu = Number(server.health_cpu_pct);
    const mem = Number(server.health_mem_pct);
    const net = Number(server.health_net_mbps);
    const ping = Number(server.health_ping_ms);
    const age = dashboardRelativeAge(server.last_heartbeat_at);
    const fresh = isFreshHeartbeatTs(server.last_heartbeat_at);
    const ioPct = Number.isFinite(net) ? Math.min(100, Math.max(0, net)) : 0;
    return {
      name: server.name || `Server ${server.id}`,
      subtitle: `${server.role || 'edge'} node`,
      accentClass: dashboardAccentClass(server.role, index, false),
      statusTone: !server.enabled ? 'offline' : (fresh ? 'online' : 'warning'),
      statusText: !server.enabled ? 'Disabled' : (fresh ? 'Healthy' : 'Stale'),
      statusMeta: Number.isFinite(ping) ? `${ping.toFixed(0)} ms` : (age !== '—' ? `seen ${age} ago` : 'No telemetry'),
      facts: [
        dashboardFact('Connections', Number(server.max_clients) > 0 ? `0 / ${server.max_clients}` : '—'),
        dashboardFact('Users', '—'),
        dashboardFact('Streams Live', 0),
        dashboardFact('Down', '—'),
        dashboardFact('Uptime', age),
        dashboardFact('Requests /sec', '—'),
        dashboardFact('Input (Mbps)', Number.isFinite(net) ? net.toFixed(1) : '—'),
        dashboardFact('Output (Mbps)', '—'),
      ],
      metrics: [
        dashboardMetric('CPU', cpu, Number.isFinite(cpu) ? `${cpu.toFixed(0)}%` : '—'),
        dashboardMetric('MEM', mem, Number.isFinite(mem) ? `${mem.toFixed(0)}%` : '—'),
        dashboardMetric('IO', ioPct, Number.isFinite(net) ? `${net.toFixed(1)} Mbps` : '—'),
        dashboardMetric('DISK', null, '—', 'muted'),
      ],
    };
  });

  return baseCards.concat(remoteCards);
}

function dashboardFormatRate(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 1 : 2)} Gbps`;
  return `${num.toFixed(num >= 100 ? 1 : num >= 10 ? 2 : 3)} Mbps`;
}

function dashboardFormatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(num >= 100 ? 0 : 1)}%`;
}

function dashboardFormatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (num < 1024) return `${num.toFixed(0)} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function dashboardFormatBitrate(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1000) return `${(num / 1000).toFixed(1)} Mbps`;
  return `${num.toFixed(0)} kbps`;
}

function dashboardCalcDownStreams(totalChannels, liveStreams) {
  const total = Number(totalChannels) || 0;
  const live = Number(liveStreams) || 0;
  return Math.max(0, total - live);
}

function dashboardCalcStreamReadiness(liveStreams, totalChannels) {
  const live = Number(liveStreams) || 0;
  const total = Number(totalChannels) || 0;
  if (total <= 0) return 0;
  return (live / total) * 100;
}

function dashboardBuildActivityChartData(liveSummary) {
  const byType = (liveSummary && liveSummary.by_type) || { live: 0, movie: 0, episode: 0 };
  const chartValues = [
    Number(byType.live || 0),
    Number(byType.movie || 0),
    Number(byType.episode || 0),
  ];
  const total = chartValues.reduce((sum, v) => sum + v, 0);
  return {
    labels: ['Live', 'Movie', 'Episode'],
    values: chartValues,
    total,
    colors: ['#60a5fa', '#34d399', '#f59e0b'],
    borderColors: [
      'rgba(96,165,250,0.18)',
      'rgba(52,211,153,0.18)',
      'rgba(245,158,11,0.18)',
    ],
  };
}

function dashboardBuildGeoChartData(liveSummary, maxRows = 6) {
  const countries = Array.isArray(liveSummary && liveSummary.countries) ? liveSummary.countries : [];
  const total = Number(liveSummary && liveSummary.total) || 0;
  const topRows = countries.slice(0, maxRows);
  const topMax = Math.max.apply(null, topRows.map((c) => Number(c.cnt || 0)).concat([1]));
  const rows = topRows.map((country, index) => {
    const count = Number(country.cnt || 0);
    const width = Math.max(8, (count / topMax) * 100);
    const share = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    return {
      rank: index + 1,
      code: country.code || '—',
      count,
      width,
      share,
    };
  });
  return { total, countries: countries.length, topRows: rows, topCountry: countries[0] || null };
}

function dashboardExtractFact(card, label) {
  return ((card && Array.isArray(card.facts) ? card.facts : []).find((fact) => fact && fact.label === label) || {}).value || '—';
}

function dashboardExtractMetric(card, label) {
  return ((card && Array.isArray(card.metrics) ? card.metrics : []).find((metric) => metric && metric.label === label) || null);
}

function dashboardIcon(key) {
  const icons = {
    connections: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"></path></svg>',
    users: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    alert: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    wave: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    server: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="8" rx="2"></rect><rect x="2" y="13" width="20" height="8" rx="2"></rect><line x1="6" y1="7" x2="6.01" y2="7"></line><line x1="6" y1="17" x2="6.01" y2="17"></line></svg>',
    layers: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
    package: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
    film: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>',
    tv: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>',
    list: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
  };
  return icons[key] || icons.server;
}

function renderDashboard(state, ctx, options) {
  const opts = options || {};
  const { $, escHtml } = ctx;
  const dashStatsEl = $('#dashStats');
  if (dashStatsEl) {
    const enabledServers = Array.isArray(state.servers) ? state.servers.filter((server) => Number(server.enabled) === 1).length : 0;
    const onlineServers = Array.isArray(state.servers)
      ? state.servers.filter((server) => Number(server.enabled) === 1 && isFreshHeartbeatTs(server.last_heartbeat_at)).length
      : 0;
    const items = [
      { tone: 'violet', icon: 'connections', value: dashboardFormatNumber(state.stats && state.stats.connections || 0), label: 'Open Connections', meta: `${dashboardFormatNumber(state.liveSummary && state.liveSummary.total || 0)} runtime sessions tracked` },
      { tone: 'emerald', icon: 'users', value: dashboardFormatNumber(state.stats && state.stats.activeLines || 0), label: 'Active Lines', meta: `${dashboardFormatNumber(enabledServers)} enabled servers in rotation` },
      { tone: 'blue', icon: 'play', value: dashboardFormatNumber(state.stats && state.stats.liveStreams || 0), label: 'Live Streams', meta: `${dashboardFormatNumber(state.stats && state.stats.channelsCount || 0)} total channel records` },
      { tone: 'rose', icon: 'alert', value: dashboardFormatNumber(state.stats && state.stats.downStreams || 0), label: 'Attention Needed', meta: `${dashboardFormatNumber(Math.max(0, (state.stats && state.stats.channelsCount || 0) - (state.stats && state.stats.liveStreams || 0)))} channels not running` },
      { tone: 'cyan', icon: 'wave', value: dashboardFormatRate(state.stats && state.stats.netIn || 0), label: 'Ingress Traffic', meta: `${dashboardFormatNumber(onlineServers)} nodes reporting fresh heartbeats` },
      { tone: 'amber', icon: 'wave', value: dashboardFormatRate(state.stats && state.stats.netOut || 0), label: 'Egress Traffic', meta: `${dashboardFormatPercent((state.stats && state.stats.liveStreams || 0) && (state.stats && state.stats.channelsCount || 0) ? ((state.stats && state.stats.liveStreams || 0) / (state.stats && state.stats.channelsCount || 1)) * 100 : 0)} stream readiness` },
    ];
    dashStatsEl.innerHTML = items.map((item) => `
      <article class="dash-stat-card tone-${item.tone}">
        <div class="dash-stat-top">
          <span class="dash-stat-icon">${dashboardIcon(item.icon)}</span>
          <span class="dash-stat-chip">Live</span>
        </div>
        <div class="dash-stat-value">${dashboardText(escHtml, item.value)}</div>
        <div class="dash-stat-label">${dashboardText(escHtml, item.label)}</div>
        <div class="dash-stat-meta">${dashboardText(escHtml, item.meta)}</div>
      </article>
    `).join('');
  }

  const heroMeta = $('#dashHeroMeta');
  if (heroMeta) {
    const stats = state.stats || {};
    const health = state.health || {};
    const liveSummary = state.liveSummary || {};
    const servers = Array.isArray(state.servers) ? state.servers : [];
    const enabledServers = servers.filter((server) => Number(server.enabled) === 1).length;
    const freshServers = servers.filter((server) => Number(server.enabled) === 1 && isFreshHeartbeatTs(server.last_heartbeat_at)).length;
    const panelHealthValue = health.status === 'unknown' ? 'Awaiting checks' : (health.status === 'down' ? 'Degraded' : 'Healthy');
    const panelHealthMeta = health.status === 'unknown' ? 'Health monitor has not completed a sample yet' : (health.lastResponseMs ? `${health.lastResponseMs} ms response` : 'Realtime checks');
    const uptimeTodayValue = health.today && Number(health.today.totalChecks || 0) > 0 && Number.isFinite(Number(health.today.uptimePct)) ? `${Number(health.today.uptimePct || 0).toFixed(1)}%` : 'No samples yet';
    const items = [
      { label: 'Panel health', value: panelHealthValue, meta: panelHealthMeta },
      { label: 'Uptime today', value: uptimeTodayValue, meta: 'Availability from completed panel health checks' },
      { label: 'Fleet status', value: `${dashboardFormatNumber(freshServers)} / ${dashboardFormatNumber(enabledServers)}`, meta: 'Nodes with fresh heartbeats' },
      { label: 'Viewer activity', value: dashboardFormatNumber(liveSummary.total || 0), meta: 'Concurrent runtime sessions' },
    ];
    heroMeta.innerHTML = items.map((item) => `
      <div class="dash-hero-meta-card">
        <span class="dash-hero-meta-label">${dashboardText(escHtml, item.label)}</span>
        <strong class="dash-hero-meta-value">${dashboardText(escHtml, item.value)}</strong>
        <small class="dash-hero-meta-copy">${dashboardText(escHtml, item.meta)}</small>
      </div>
    `).join('');
  }

  const featuredEl = $('#dashFeatured');
  const opsEl = $('#dashOpsPanel');
  if (featuredEl && opsEl) {
    const cards = Array.isArray(state.serverCards) ? state.serverCards : [];
    const primary = cards[0] || null;
    const stats = state.stats || {};
    const liveSummary = state.liveSummary || { by_type: { live: 0, movie: 0, episode: 0 } };
    if (!primary) {
      featuredEl.innerHTML = '<div class="dash-empty-panel">No primary node data available yet.</div>';
      opsEl.innerHTML = '<div class="dash-empty-panel">Operational summary will appear after the first dashboard snapshot.</div>';
    } else {
      const primaryFacts = {
        connections: dashboardExtractFact(primary, 'Connections'),
        users: dashboardExtractFact(primary, 'Users'),
        streams: dashboardExtractFact(primary, 'Streams Live'),
        uptime: dashboardExtractFact(primary, 'Uptime'),
        input: dashboardExtractFact(primary, 'Input (Mbps)'),
        output: dashboardExtractFact(primary, 'Output (Mbps)'),
        requests: dashboardExtractFact(primary, 'Requests /sec'),
        down: dashboardExtractFact(primary, 'Down'),
      };
      const metrics = ['CPU', 'MEM', 'IO', 'DISK'].map((label) => dashboardExtractMetric(primary, label)).filter(Boolean);
      featuredEl.innerHTML = `
        <article class="dash-feature-card accent-${dashboardText(escHtml, primary.accentClass || 'slate')}">
          <div class="dash-feature-head">
            <div>
              <span class="dash-feature-kicker">Featured Node</span>
              <h3 class="dash-feature-title">${dashboardText(escHtml, primary.name || 'Main Server')}</h3>
              <p class="dash-feature-subtitle">${dashboardText(escHtml, primary.subtitle || 'Panel Node')} • ${dashboardText(escHtml, primary.statusMeta || 'Realtime')}</p>
            </div>
            <span class="dash-feature-status tone-${dashboardText(escHtml, primary.statusTone || 'disabled')}">${dashboardText(escHtml, primary.statusText || 'Unknown')}</span>
          </div>
          <div class="dash-feature-fact-grid">
            <div class="dash-feature-fact"><span>Connections</span><strong>${dashboardText(escHtml, primaryFacts.connections)}</strong></div>
            <div class="dash-feature-fact"><span>Users</span><strong>${dashboardText(escHtml, primaryFacts.users)}</strong></div>
            <div class="dash-feature-fact"><span>Streams Live</span><strong>${dashboardText(escHtml, primaryFacts.streams)}</strong></div>
            <div class="dash-feature-fact"><span>Uptime</span><strong>${dashboardText(escHtml, primaryFacts.uptime)}</strong></div>
          </div>
          <div class="dash-feature-signal-grid">
            <div class="dash-feature-signal"><span>Ingress</span><strong>${dashboardText(escHtml, primaryFacts.input)}</strong></div>
            <div class="dash-feature-signal"><span>Egress</span><strong>${dashboardText(escHtml, primaryFacts.output)}</strong></div>
            <div class="dash-feature-signal"><span>Requests / sec</span><strong>${dashboardText(escHtml, primaryFacts.requests)}</strong></div>
            <div class="dash-feature-signal"><span>Attention</span><strong>${dashboardText(escHtml, primaryFacts.down)}</strong></div>
          </div>
          <div class="dash-feature-metrics">
            ${metrics.map((metric) => `
              <div class="dash-feature-metric">
                <div class="dash-feature-metric-head"><span>${dashboardText(escHtml, metric.label)}</span><strong>${dashboardText(escHtml, metric.value)}</strong></div>
                <div class="dash-feature-metric-bar"><div class="dash-feature-metric-fill ${dashboardText(escHtml, metric.tone || 'muted')}" style="width:${Math.max(0, Math.min(100, Number(metric.pct || 0)))}%"></div></div>
              </div>
            `).join('')}
          </div>
        </article>`;

      const sessionMix = liveSummary.by_type || { live: 0, movie: 0, episode: 0 };
      const totalSessions = Number(liveSummary.total || 0);
      const mixRows = [
        { label: 'Live sessions', value: Number(sessionMix.live || 0) },
        { label: 'Movie sessions', value: Number(sessionMix.movie || 0) },
        { label: 'Episode sessions', value: Number(sessionMix.episode || 0) },
      ];
      const ioMetric = dashboardExtractMetric(primary, 'IO');
      const diskMetric = dashboardExtractMetric(primary, 'DISK');
      opsEl.innerHTML = `
        <article class="dash-ops-card">
          <div class="dash-ops-grid">
            <div class="dash-ops-metric"><span>Concurrent sessions</span><strong>${dashboardFormatNumber(totalSessions)}</strong><small>Runtime truth from active sessions</small></div>
            <div class="dash-ops-metric"><span>Movies library</span><strong>${dashboardFormatNumber(stats.movieCount || 0)}</strong><small>Catalog footprint on this panel</small></div>
            <div class="dash-ops-metric"><span>TV series</span><strong>${dashboardFormatNumber(stats.seriesCount || 0)}</strong><small>Series records currently available</small></div>
            <div class="dash-ops-metric"><span>Traffic ceiling</span><strong>${dashboardText(escHtml, ioMetric ? ioMetric.value : '—')}</strong><small>Current dominant node throughput</small></div>
          </div>
          <div class="dash-ops-stack">
            ${mixRows.map((row) => {
              const pct = totalSessions > 0 ? (row.value / totalSessions) * 100 : 0;
              return `
                <div class="dash-ops-row">
                  <div class="dash-ops-row-head"><span>${dashboardText(escHtml, row.label)}</span><strong>${dashboardFormatNumber(row.value)}</strong></div>
                  <div class="dash-ops-row-bar"><div class="dash-ops-row-fill" style="width:${pct}%"></div></div>
                </div>`;
            }).join('')}
            <div class="dash-ops-footnote">Disk posture: <strong>${dashboardText(escHtml, diskMetric ? diskMetric.value : '—')}</strong> • Current live/down ratio: <strong>${dashboardFormatNumber(stats.liveStreams || 0)} / ${dashboardFormatNumber(stats.downStreams || 0)}</strong></div>
          </div>
        </article>`;
    }
  }

  const analyticsEl = $('#dashAnalyticsGrid');
  if (analyticsEl && !opts.realtimeOnly) {
    const stats = state.stats || {};
    const servers = Array.isArray(state.servers) ? state.servers : [];
    const cards = [
      { tone: 'violet', icon: 'server', label: 'Active Servers', value: servers.filter((server) => Number(server.enabled) === 1).length, meta: 'Enabled nodes in selector inventory' },
      { tone: 'rose', icon: 'users', label: 'Resellers', value: stats.resellerCount || 0, meta: 'Panel reseller accounts' },
      { tone: 'amber', icon: 'layers', label: 'Available Bouquets', value: stats.bouquetCount || 0, meta: 'Live package groupings ready for sale' },
      { tone: 'green', icon: 'list', label: 'Live Channels', value: stats.channelsCount || 0, meta: 'Cataloged channels in MariaDB' },
      { tone: 'blue', icon: 'package', label: 'Packages', value: stats.packageCount || 0, meta: 'Commercial package definitions' },
      { tone: 'cyan', icon: 'film', label: 'Movies Library', value: stats.movieCount || 0, meta: 'Movie records available to playback' },
      { tone: 'teal', icon: 'tv', label: 'TV Series', value: stats.seriesCount || 0, meta: 'Series records currently stored' },
      { tone: 'indigo', icon: 'list', label: 'TV Episodes', value: stats.episodeCount || 0, meta: 'Episodes linked across all series' },
    ];
    analyticsEl.innerHTML = cards.map((card) => `
      <article class="dash-analytics-card tone-${card.tone}">
        <span class="dash-analytics-icon">${dashboardIcon(card.icon)}</span>
        <div class="dash-analytics-copy">
          <strong>${dashboardFormatNumber(card.value)}</strong>
          <span>${dashboardText(escHtml, card.label)}</span>
          <small>${dashboardText(escHtml, card.meta)}</small>
        </div>
      </article>
    `).join('');
  }

  if (!opts.realtimeOnly) {
    const geoStats = $('#dashGeoStats');
    const geoList = $('#dashGeoList');
    if (geoStats && geoList) {
      const liveSummary = state.liveSummary || {};
      const countries = Array.isArray(liveSummary.countries) ? liveSummary.countries : [];
      const total = Number(liveSummary.total || 0);
      const topCountry = countries[0] || null;
      geoStats.innerHTML = `
        <div class="dash-geo-stat"><span>Total Sessions</span><strong>${dashboardFormatNumber(total)}</strong></div>
        <div class="dash-geo-stat"><span>Countries</span><strong>${dashboardFormatNumber(countries.length)}</strong></div>
        <div class="dash-geo-stat"><span>Top Country</span><strong>${dashboardText(escHtml, topCountry ? topCountry.code : '—')}</strong></div>`;
      if (!countries.length) {
        geoList.innerHTML = '<div class="dash-empty-panel compact">No geographic session data is available yet.</div>';
      } else {
        const topRows = countries.slice(0, 6);
        const topMax = Math.max.apply(null, topRows.map((country) => Number(country.cnt || 0)).concat([1]));
        geoList.innerHTML = topRows.map((country, index) => {
          const count = Number(country.cnt || 0);
          const width = Math.max(8, (count / topMax) * 100);
          const share = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
          return `
            <div class="dash-geo-row">
              <div class="dash-geo-row-head"><span>${index + 1}. ${dashboardText(escHtml, country.code || '—')}</span><strong>${dashboardFormatNumber(count)}</strong></div>
              <div class="dash-geo-row-bar"><div class="dash-geo-row-fill" style="width:${width}%"></div></div>
              <small>${share}% of active runtime sessions</small>
            </div>`;
        }).join('');
      }
    }

    const topStreamsEl = $('#dashTopStreams');
    const serverDistEl = $('#dashServerDistribution');
    const chartWrap = $('#dashActivityChart') ? $('#dashActivityChart').parentElement : null;
    if (topStreamsEl && serverDistEl && chartWrap) {
      const currentChart = ctx.getDashActivityChart();
      if (currentChart) {
        currentChart.destroy();
        ctx.setDashActivityChart(null);
      }
      const liveSummary = state.liveSummary || { by_type: {}, top_streams: [], servers: [] };
      const byType = liveSummary.by_type || { live: 0, movie: 0, episode: 0 };
      const chartValues = [Number(byType.live || 0), Number(byType.movie || 0), Number(byType.episode || 0)];
      const total = chartValues.reduce((sum, value) => sum + value, 0);
      chartWrap.innerHTML = '<canvas id="dashActivityChart"></canvas>';
      const canvas = $('#dashActivityChart');
      if (typeof Chart !== 'undefined' && total > 0 && canvas) {
        const activityChart = new Chart(canvas.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: ['Live', 'Movie', 'Episode'],
            datasets: [{ data: chartValues, backgroundColor: ['#60a5fa', '#34d399', '#f59e0b'], borderColor: ['rgba(96,165,250,0.18)', 'rgba(52,211,153,0.18)', 'rgba(245,158,11,0.18)'], borderWidth: 2, hoverOffset: 6 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: { position: 'bottom', labels: { color: '#cfd8e5', usePointStyle: true, boxWidth: 10, padding: 16, font: { size: 11, weight: '600' } } },
              tooltip: {
                backgroundColor: 'rgba(11,21,34,0.96)',
                titleColor: '#fff',
                bodyColor: '#dbe4f0',
                borderColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                callbacks: {
                  label: (ctx2) => {
                    const value = Number(ctx2.raw || 0);
                    const share = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                    return ` ${ctx2.label}: ${dashboardFormatNumber(value)} (${share}%)`;
                  },
                },
              },
            },
          },
        });
        ctx.setDashActivityChart(activityChart);
      } else {
        chartWrap.innerHTML = '<div class="dash-empty-panel compact">No active session mix is available yet.</div>';
      }
      const topStreams = Array.isArray(liveSummary.top_streams) ? liveSummary.top_streams.slice(0, 4) : [];
      topStreamsEl.innerHTML = topStreams.length ? topStreams.map((stream) => `
        <div class="dash-mini-list-row">
          <div><strong>#${dashboardText(escHtml, stream.stream_id)}</strong><small>${dashboardText(escHtml, String(stream.stream_type || 'unknown').toUpperCase())}</small></div>
          <span>${dashboardFormatNumber(stream.cnt || 0)}</span>
        </div>`).join('') : '<div class="dash-empty-panel compact">No active top streams yet.</div>';
      const serverDist = Array.isArray(liveSummary.servers) ? liveSummary.servers.slice(0, 4) : [];
      serverDistEl.innerHTML = serverDist.length ? serverDist.map((server) => `
        <div class="dash-mini-list-row">
          <div><strong>${dashboardText(escHtml, server.name || 'Server')}</strong><small>${dashboardText(escHtml, server.host || 'No public host')}</small></div>
          <span>${dashboardFormatNumber(server.cnt || 0)}</span>
        </div>`).join('') : '<div class="dash-empty-panel compact">No server distribution data yet.</div>';
    }
  }

  const row = document.getElementById('dashServersRow');
  if (row) {
    const secondaryCards = (Array.isArray(state.serverCards) ? state.serverCards : []).slice(1);
    row.innerHTML = secondaryCards.length ? secondaryCards.map((card) => {
      const keyFacts = [
        ['Connections', dashboardExtractFact(card, 'Connections')],
        ['Streams Live', dashboardExtractFact(card, 'Streams Live')],
        ['Uptime', dashboardExtractFact(card, 'Uptime')],
        ['Input', dashboardExtractFact(card, 'Input (Mbps)')],
      ];
      const metrics = ['CPU', 'MEM', 'IO'].map((label) => dashboardExtractMetric(card, label)).filter(Boolean);
      return `
        <article class="dash-server-card accent-${dashboardText(escHtml, card.accentClass || 'slate')}">
          <div class="dash-server-card-head">
            <div>
              <span class="dash-server-card-kicker">${dashboardText(escHtml, card.subtitle || 'Server')}</span>
              <h4>${dashboardText(escHtml, card.name || 'Server')}</h4>
            </div>
            <span class="dash-server-pill tone-${dashboardText(escHtml, card.statusTone || 'disabled')}">${dashboardText(escHtml, card.statusText || 'Unknown')}</span>
          </div>
          <div class="dash-server-card-meta">${dashboardText(escHtml, card.statusMeta || 'No telemetry')}</div>
          <div class="dash-server-card-facts">
            ${keyFacts.map(([label, value]) => `<div class="dash-server-card-fact"><span>${dashboardText(escHtml, label)}</span><strong>${dashboardText(escHtml, value)}</strong></div>`).join('')}
          </div>
          <div class="dash-server-card-metrics">
            ${metrics.map((metric) => `
              <div class="dash-server-card-metric">
                <div class="dash-server-card-metric-head"><span>${dashboardText(escHtml, metric.label)}</span><strong>${dashboardText(escHtml, metric.value)}</strong></div>
                <div class="dash-server-card-metric-bar"><div class="dash-server-card-metric-fill ${dashboardText(escHtml, metric.tone || 'muted')}" style="width:${Math.max(0, Math.min(100, Number(metric.pct || 0)))}%"></div></div>
              </div>`).join('')}
          </div>
        </article>`;
    }).join('') : '<div class="dash-empty-panel">No additional remote nodes are reporting heartbeat data yet.</div>';
  }
}

function renderDashboardServerLoading(ctx, message) {
  const msg = message || 'Loading dashboard telemetry...';
  const targets = ['dashFeatured', 'dashOpsPanel', 'dashAnalyticsGrid', 'dashGeoList', 'dashTopStreams', 'dashServerDistribution', 'dashServersRow'];
  targets.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="dash-empty-panel compact"><span class="spinner"></span><span>${dashboardText(ctx.escHtml, msg)}</span></div>`;
  });
}

// Export page module functions
export async function loadDashboard(ctx) {
  renderDashboardServerLoading(ctx);
  try {
    const [stats, healthData, serversData, liveSummary] = await Promise.all([
      ctx.apiFetch('/stats').catch(() => ({})),
      ctx.apiFetch('/health').catch(() => null),
      ctx.apiFetch('/servers').catch(() => ({ servers: [] })),
      ctx.apiFetch('/live-connections/summary').catch(() => ({ total: 0, by_type: { live: 0, movie: 0, episode: 0 }, countries: [], top_streams: [], servers: [] })),
    ]);
    const liveStreams = stats.liveStreams || 0;
    const totalChannels = stats.channelsCount || 0;
    const downStreams = Math.max(0, totalChannels - liveStreams);
    const nextState = {
      stats: { ...stats, liveStreams, downStreams },
      health: healthData || null,
      servers: serversData && Array.isArray(serversData.servers) ? serversData.servers : [],
      serverCards: buildDashboardInitialServerCards(stats, healthData, serversData && serversData.servers),
      liveSummary: {
        total: Number(liveSummary.total || 0),
        by_type: {
          live: Number(liveSummary.by_type && liveSummary.by_type.live || 0),
          movie: Number(liveSummary.by_type && liveSummary.by_type.movie || 0),
          episode: Number(liveSummary.by_type && liveSummary.by_type.episode || 0),
        },
        countries: Array.isArray(liveSummary.countries) ? liveSummary.countries : [],
        top_streams: Array.isArray(liveSummary.top_streams) ? liveSummary.top_streams : [],
        servers: Array.isArray(liveSummary.servers) ? liveSummary.servers : [],
      },
    };
    ctx.setDashboardState(nextState);
    renderDashboard(nextState, ctx, {});
  } catch (e) {
    const dashStats = ctx.$('#dashStats');
    if (dashStats) dashStats.innerHTML = `<p class="text-danger" style="padding:1rem">${ctx.escHtml(e.message)}</p>`;
    renderDashboardServerLoading(ctx, 'Realtime server status unavailable.');
  }
}

export function updateDashboardFromWS(ctx, payload) {
  const currentState = ctx.getDashboardState() || ctx.createDashboardState();
  const cards = payload.cards || {};
  const system = payload.system || {};
  const runningStreams = Number(cards.runningStreams || 0);
  const totalChannels = Number(cards.channels || 0);
  const downStreams = Math.max(0, totalChannels - runningStreams);
  const nextState = {
    ...currentState,
    stats: {
      ...(currentState.stats || {}),
      connections: Number(cards.connections || 0),
      activeLines: Number(cards.activeLines || 0),
      liveStreams: runningStreams,
      channelsCount: totalChannels,
      downStreams,
      netIn: Number(((system.netInKBps || 0) / 1024).toFixed(1)),
      netOut: Number(((system.netOutKBps || 0) / 1024).toFixed(1)),
      cpu: Number(system.cpuPct || (currentState.stats && currentState.stats.cpu) || 0),
      memPercent: Number(system.ramPct || (currentState.stats && currentState.stats.memPercent) || 0),
      diskPercent: Number(system.diskPct || (currentState.stats && currentState.stats.diskPercent) || 0),
    },
    serverCards: Array.isArray(payload.serverCards) && payload.serverCards.length ? payload.serverCards : currentState.serverCards,
    health: payload.health && typeof payload.health === 'object' ? { ...(currentState.health || {}), ...payload.health } : currentState.health,
  };
  ctx.setDashboardState(nextState);
  renderDashboard(nextState, ctx, { realtimeOnly: true });
}

export function handleWSEvent(ctx, data) {
  const eventLabels = {
    'stream:starting': 'Stream started',
    'stream:running': 'Stream ready',
    'stream:exited': 'Stream crashed',
    'stream:stopped': 'Stream stopped',
    'stream:error': 'Stream error',
    'stream:fatal': 'Stream fatal error',
    'stream:recovery_failed': 'Stream recovery failed',
    'stream:zombie': 'Zombie stream detected',
    'sharing:detected': 'Sharing detected',
  };
  if (data.event === 'stream:running' && data.channelId === ctx.getPendingStreamStartId()) {
    ctx.markPendingStreamReady();
  }
  const label = eventLabels[data.event] || data.event;
  if (label) ctx.toast(`${label}: ${data.channelId || data.userId || ''}`, data.event.includes('crash') || data.event.includes('fatal') || data.event.includes('sharing') ? 'error' : 'info');
}

export function dashboardRelativeAge(ts) {
  if (!ts) return '—';
  const at = new Date(ts).getTime();
  if (!Number.isFinite(at)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function dashboardFormatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString();
}
