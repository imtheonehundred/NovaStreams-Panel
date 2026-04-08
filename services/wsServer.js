'use strict';

/**
 * WebSocket server for IPTV Panel real-time dashboard.
 * - Auth via express-session (same mechanism as HTTP requireAuth)
 * - Two broadcast channels: "dashboard" (periodic metrics) and "events" (stream/sharing)
 * - Subscribes to Redis sharing:alerts and forwards to eventBus
 */

const { WebSocketServer } = require('ws');
const { queryOne } = require('../lib/mariadb');
const { eventBus, WS_EVENTS } = require('./eventBus');
const { subscribeToAlerts } = require('./sharingDetector');
const {
  recordSample: bwRecordSample,
  getLatestSample: bwGetLatestSample,
} = require('./bandwidthMonitor');
const {
  isPanelUp,
  hasPanelHealthSample,
  getLastCheckAt,
  getLastResponseMs,
  getLastError,
  getConsecutiveFails,
} = require('./healthMonitor');
const serverService = require('./serverService');

const WS_PATH = '/ws';
const DASHBOARD_INTERVAL_MS = 5000;
const SERVER_HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function metricTone(pct) {
  const num = Number(pct);
  if (!Number.isFinite(num)) return 'muted';
  if (num >= 75) return 'red';
  if (num >= 50) return 'yellow';
  return 'green';
}

function formatValue(value, suffix = '') {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (Number.isFinite(num)) return `${num}${suffix}`;
  return String(value);
}

function formatFixed(value, digits, suffix = '') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(digits)}${suffix}`;
}

function formatHeartbeatAge(ts, now, formatDuration) {
  if (!ts) return '—';
  const heartbeatAt = new Date(ts).getTime();
  if (!Number.isFinite(heartbeatAt)) return '—';
  const ageSeconds = Math.max(0, Math.round((now - heartbeatAt) / 1000));
  return formatDuration ? formatDuration(ageSeconds) : `${ageSeconds}s`;
}

function serverRoleLabel(role, isLocal) {
  if (isLocal) return 'Panel Node';
  if (role === 'lb') return 'Load Balancer';
  if (role === 'main') return 'Main Server';
  if (role === 'edge') return 'Edge Server';
  return 'Server';
}

function serverAccentClass(role, index, isLocal) {
  if (isLocal || role === 'main') return 'indigo';
  if (role === 'lb') return 'teal';
  if (role === 'edge') return index % 2 === 0 ? 'rose' : 'amber';
  return 'slate';
}

function buildDashboardMetric(label, pct, value, tone) {
  const hasPct = Number.isFinite(Number(pct));
  return {
    label,
    pct: hasPct ? clampPct(pct) : 0,
    value: value == null || value === '' ? '—' : String(value),
    tone: tone || (hasPct ? metricTone(pct) : 'muted'),
  };
}

function buildDashboardCardFact(label, value) {
  return { label, value: value == null || value === '' ? '—' : String(value) };
}

function buildLocalServerCard({
  activeUsers,
  activeLines,
  connections,
  downStreams,
  health,
  netInMbps,
  netOutMbps,
  processInfo,
  runningStreams,
  system,
}) {
  const ioMbps = Math.max(Number(netInMbps) || 0, Number(netOutMbps) || 0);
  const ioPct = ioMbps > 0 ? Math.min(100, ioMbps * 2) : 0;
  const lastResponseMs = Number(health.lastResponseMs) || 0;
  const statusTone =
    health.status === 'unknown'
      ? 'warning'
      : health.status === 'down'
        ? 'offline'
        : 'online';
  const statusText =
    health.status === 'unknown'
      ? 'Pending'
      : health.status === 'down'
        ? 'Down'
        : 'Healthy';
  const statusMeta =
    health.status === 'unknown'
      ? 'Awaiting first check'
      : lastResponseMs > 0
        ? `${lastResponseMs} ms`
        : 'Realtime';

  return {
    name: 'Main Server',
    subtitle: serverRoleLabel('main', true),
    accentClass: serverAccentClass('main', 0, true),
    statusTone,
    statusText,
    statusMeta,
    facts: [
      buildDashboardCardFact('Connections', connections),
      buildDashboardCardFact('Users', activeUsers),
      buildDashboardCardFact('Streams Live', runningStreams),
      buildDashboardCardFact('Down', downStreams),
      buildDashboardCardFact('Uptime', processInfo.uptime || '—'),
      buildDashboardCardFact('Requests /sec', 0),
      buildDashboardCardFact('Input (Mbps)', formatFixed(netInMbps, 1)),
      buildDashboardCardFact('Output (Mbps)', formatFixed(netOutMbps, 1)),
    ],
    metrics: [
      buildDashboardMetric(
        'CPU',
        system.cpuPct,
        formatFixed(system.cpuPct, 0, '%')
      ),
      buildDashboardMetric(
        'MEM',
        system.ramPct,
        formatFixed(system.ramPct, 0, '%')
      ),
      buildDashboardMetric('IO', ioPct, formatFixed(ioMbps, 1, ' Mbps')),
      buildDashboardMetric(
        'DISK',
        system.diskPct,
        formatFixed(system.diskPct, 0, '%')
      ),
    ],
  };
}

function buildRemoteServerCard(
  server,
  index,
  runningByServer,
  now,
  formatDuration
) {
  const role = String(server.role || '').toLowerCase();
  const cpu =
    server.health_cpu_pct != null ? Number(server.health_cpu_pct) : null;
  const mem =
    server.health_mem_pct != null ? Number(server.health_mem_pct) : null;
  const net =
    server.health_net_mbps != null ? Number(server.health_net_mbps) : null;
  const ping =
    server.health_ping_ms != null ? Number(server.health_ping_ms) : null;
  const cap =
    server.network_mbps_cap != null ? Number(server.network_mbps_cap) : 0;
  const ioPct = Number.isFinite(net)
    ? cap > 0
      ? Math.min(100, (net / cap) * 100)
      : Math.min(100, net * 5)
    : null;
  const runningStreams = runningByServer.get(Number(server.id)) || 0;
  const heartbeatAt = server.last_heartbeat_at
    ? new Date(server.last_heartbeat_at).getTime()
    : null;
  const heartbeatAgeMs = Number.isFinite(heartbeatAt)
    ? now - heartbeatAt
    : null;

  let statusTone = 'offline';
  let statusText = 'No agent';
  if (Number(server.enabled) !== 1) {
    statusTone = 'disabled';
    statusText = 'Disabled';
  } else if (
    heartbeatAgeMs != null &&
    heartbeatAgeMs <= SERVER_HEARTBEAT_FRESH_MS
  ) {
    statusTone = 'online';
    statusText = 'Agent Live';
  } else if (heartbeatAgeMs != null) {
    statusTone = 'warning';
    statusText = 'Stale';
  }

  const heartbeatValue =
    heartbeatAgeMs != null
      ? formatHeartbeatAge(server.last_heartbeat_at, now, formatDuration)
      : '—';

  return {
    name: server.name || `Server ${server.id}`,
    subtitle: serverRoleLabel(role, false),
    accentClass: serverAccentClass(role, index, false),
    statusTone,
    statusText,
    statusMeta: Number.isFinite(ping)
      ? `${ping.toFixed(0)} ms`
      : heartbeatAgeMs != null
        ? `seen ${heartbeatValue} ago`
        : 'No telemetry',
    facts: [
      buildDashboardCardFact(
        'Connections',
        Number(server.max_clients) > 0 ? `0 / ${server.max_clients}` : '—'
      ),
      buildDashboardCardFact('Users', '—'),
      buildDashboardCardFact('Streams Live', runningStreams),
      buildDashboardCardFact('Down', '—'),
      buildDashboardCardFact('Uptime', heartbeatValue),
      buildDashboardCardFact('Requests /sec', '—'),
      buildDashboardCardFact('Input (Mbps)', formatFixed(net, 1)),
      buildDashboardCardFact('Output (Mbps)', '—'),
    ],
    metrics: [
      buildDashboardMetric('CPU', cpu, formatFixed(cpu, 0, '%')),
      buildDashboardMetric('MEM', mem, formatFixed(mem, 0, '%')),
      buildDashboardMetric('IO', ioPct, formatFixed(net, 1, ' Mbps')),
      buildDashboardMetric('DISK', null, '—', 'muted'),
    ],
  };
}

function loadSession(req, sessionMiddleware) {
  if (typeof sessionMiddleware !== 'function') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const res = {
      getHeader() {
        return undefined;
      },
      setHeader() {},
      end() {},
      writeHead() {},
    };

    sessionMiddleware(req, res, (err) => {
      if (err) return reject(err);
      return resolve(req.session || null);
    });
  });
}

function getAuthenticatedUser(req) {
  const session = req.session || null;
  if (!session || !session.userId || session.portalRole !== 'admin')
    return null;
  return { userId: session.userId, session };
}

function createWsServer({ sessionMiddleware, deps }) {
  const clients = new Set();
  let wss;
  let dashboardTimer;
  let sharingUnsubscribe;

  // Broadcast a message to all authenticated clients on a channel
  function broadcast(channel, data) {
    const msg = JSON.stringify({ channel, data, ts: Date.now() });
    for (const client of clients) {
      if (client.ws.readyState === 1) {
        // OPEN
        client.ws.send(msg);
      }
    }
  }

  // Collect and broadcast dashboard metrics
  async function broadcastDashboard() {
    try {
      const {
        channels,
        processes,
        userActivity,
        collectSystemMetrics,
        dbApi,
        maxFFmpegProcesses,
        formatDuration,
        channelRuntimeInfo,
      } = deps;
      const now = Date.now();
      const nowTs = Math.floor(now / 1000);
      const ACTIVE_USER_TIMEOUT_MS = 5 * 60 * 1000;

      const running = [...channels.values()].filter(
        (c) => c.status === 'running'
      );
      const activeUsers = [...userActivity.values()].filter(
        (ts) => now - ts <= ACTIVE_USER_TIMEOUT_MS
      ).length;
      const runningByServer = new Map();
      for (const ch of running) {
        const rawServerId =
          ch.stream_server_id != null
            ? ch.stream_server_id
            : ch.serverId != null
              ? ch.serverId
              : ch.streamServerId;
        const sid = parseInt(rawServerId, 10);
        if (Number.isFinite(sid) && sid > 0) {
          runningByServer.set(sid, (runningByServer.get(sid) || 0) + 1);
        }
      }

      const [m, activeRow, servers] = await Promise.all([
        collectSystemMetrics(),
        queryOne(
          'SELECT COUNT(*) AS c FROM `lines` WHERE admin_enabled = 1 AND exp_date > FROM_UNIXTIME(?)',
          [nowTs]
        ).catch(() => ({ c: 0 })),
        serverService.listServers().catch(() => []),
      ]);
      const activeLines = activeRow ? Number(activeRow.c) || 0 : 0;
      const downStreams = Math.max(0, channels.size - running.length);

      // Record bandwidth sample for history tracking
      const rxBps = m.net ? m.net.rxSec || 0 : 0;
      const txBps = m.net ? m.net.txSec || 0 : 0;
      bwRecordSample(rxBps, txBps).catch(() => {});

      // Get live bandwidth snapshot
      const bwLive = bwGetLatestSample();

      // Get health status
      const hasHealthSample = hasPanelHealthSample
        ? hasPanelHealthSample()
        : false;
      const panelUp = hasHealthSample && isPanelUp ? isPanelUp() : false;
      const lastCheck = getLastCheckAt ? getLastCheckAt() : 0;
      const lastRespMs = getLastResponseMs ? getLastResponseMs() : 0;
      const lastErr = getLastError ? getLastError() : '';
      const consecutiveFails = getConsecutiveFails ? getConsecutiveFails() : 0;
      const netInMbps = (m.net.rxSec || 0) / 1024 / 1024;
      const netOutMbps = (m.net.txSec || 0) / 1024 / 1024;

      const serverCards = [
        buildLocalServerCard({
          activeUsers,
          activeLines,
          connections: processes.size,
          downStreams,
          health: {
            status: hasHealthSample ? (panelUp ? 'up' : 'down') : 'unknown',
            lastResponseMs: lastRespMs,
          },
          netInMbps,
          netOutMbps,
          processInfo: {
            uptime: formatDuration
              ? formatDuration(process.uptime())
              : String(process.uptime()),
          },
          runningStreams: running.length,
          system: {
            cpuPct: m.cpuPct,
            ramPct: m.ramPct,
            diskPct: m.diskMain ? m.diskMain.use || 0 : 0,
          },
        }),
        ...servers
          .filter(
            (server) =>
              Number(server.enabled) === 1 &&
              String(server.role || '').toLowerCase() !== 'main'
          )
          .map((server, index) =>
            buildRemoteServerCard(
              server,
              index,
              runningByServer,
              now,
              formatDuration
            )
          ),
      ];

      const data = {
        cards: {
          activeLines,
          runningStreams: running.length,
          viewers: running.reduce((a, c) => a + (Number(c.viewers) || 0), 0),
          connections: processes.size,
          maxProcesses: maxFFmpegProcesses || 'unlimited',
          channels: channels.size,
        },
        system: {
          loadAvg: m.loadAvg,
          cores: m.cores,
          cpuPct: m.cpuPct,
          ramPct: m.ramPct,
          swapPct: m.swapPct,
          diskPct: m.diskMain ? m.diskMain.use || 0 : 0,
          netInKBps: (m.net.rxSec || 0) / 1024,
          netOutKBps: (m.net.txSec || 0) / 1024,
          diskUsedGB: m.diskMain
            ? +((m.diskMain.used || 0) / (1024 * 1024 * 1024)).toFixed(1)
            : 0,
          diskTotalGB: m.diskMain
            ? +((m.diskMain.size || 0) / (1024 * 1024 * 1024)).toFixed(1)
            : 0,
        },
        bandwidth: {
          rxMbps: bwLive.rxMbps,
          txMbps: bwLive.txMbps,
        },
        health: {
          status: hasHealthSample ? (panelUp ? 'up' : 'down') : 'unknown',
          lastCheckAt: lastCheck,
          lastCheckMs: lastCheck,
          lastResponseMs: lastRespMs,
          lastError: lastErr,
          consecutiveFails,
        },
        process: {
          uptime: formatDuration
            ? formatDuration(process.uptime())
            : String(process.uptime()),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          activeStreams: running.length,
        },
        channels: running.map((ch) => ({
          id: ch.id || '',
          name: ch.name || 'channel',
          status: ch.status || 'running',
          info: channelRuntimeInfo ? channelRuntimeInfo(ch) : '',
          uptime:
            formatDuration && ch.startedAt
              ? formatDuration((now - new Date(ch.startedAt).getTime()) / 1000)
              : '-',
          viewers: Number(ch.viewers) || 0,
          lineId: ch.lineId || null,
        })),
        activeUsers,
        serverCards,
      };

      broadcast('dashboard', data);
    } catch (err) {
      // Don't crash the timer
    }
  }

  // Forward sharing alerts from Redis pub/sub to eventBus
  function handleSharingAlert(userId, uniqueIps) {
    eventBus.emit(WS_EVENTS.SHARING_DETECTED, {
      userId: String(userId),
      uniqueIps,
      timestamp: new Date().toISOString(),
    });
  }

  // EventBus → WebSocket broadcast
  function handleStreamEvent(event, data) {
    broadcast('events', { event, ...data });
  }

  function init() {
    wss = new WebSocketServer({ noServer: true });

    wss.on('connection', (ws, req) => {
      const user = req.wsUser || getAuthenticatedUser(req);
      if (!user) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      const client = { ws, userId: user.userId };
      clients.add(client);

      // Track user activity
      if (userActivity) {
        userActivity.set(user.userId, Date.now());
      }

      ws.on('close', () => {
        clients.delete(client);
      });
      ws.on('error', () => {
        clients.delete(client);
      });

      // Send initial dashboard snapshot immediately
      broadcastDashboard();
    });

    // Subscribe to Redis sharing alerts
    sharingUnsubscribe = subscribeToAlerts(handleSharingAlert);

    // Start health monitor
    try {
      require('./healthMonitor').start();
    } catch {}

    // Periodic dashboard broadcast
    dashboardTimer = setInterval(broadcastDashboard, DASHBOARD_INTERVAL_MS);

    // Wire eventBus → broadcast
    const off = (event, handler) => eventBus.on(event, handler);
    const off1 = off(WS_EVENTS.STREAM_STARTING, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_STARTING, d)
    );
    const off2 = off(WS_EVENTS.STREAM_RUNNING, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_RUNNING, d)
    );
    const off3 = off(WS_EVENTS.STREAM_EXITED, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_EXITED, d)
    );
    const off4 = off(WS_EVENTS.STREAM_STOPPED, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_STOPPED, d)
    );
    const off5 = off(WS_EVENTS.STREAM_ERROR, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_ERROR, d)
    );
    const off6 = off(WS_EVENTS.STREAM_FATAL, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_FATAL, d)
    );
    const off7 = off(WS_EVENTS.STREAM_RECOVERY_FAILED, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_RECOVERY_FAILED, d)
    );
    const off8 = off(WS_EVENTS.STREAM_ZOMBIE, (d) =>
      handleStreamEvent(WS_EVENTS.STREAM_ZOMBIE, d)
    );
    const off9 = off(WS_EVENTS.SHARING_DETECTED, (d) =>
      handleStreamEvent(WS_EVENTS.SHARING_DETECTED, d)
    );

    // Store off functions for cleanup (not currently used but good practice)
    wss._offFns = [off1, off2, off3, off4, off5, off6, off7, off8, off9];
  }

  async function handleUpgrade(req, socket, head) {
    if (!wss) {
      socket.destroy();
      return;
    }

    try {
      await loadSession(req, sessionMiddleware);
      const user = getAuthenticatedUser(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      req.wsUser = user;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  }

  function close() {
    if (dashboardTimer) clearInterval(dashboardTimer);
    if (sharingUnsubscribe) sharingUnsubscribe();
    if (wss) wss.close();
    clients.clear();
  }

  return { init, handleUpgrade, close, wss: () => wss };
}

module.exports = { createWsServer };
