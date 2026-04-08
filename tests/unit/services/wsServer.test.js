'use strict';

jest.mock('../../../lib/mariadb', () => ({
  queryOne: jest.fn(),
}));

jest.mock('../../../services/eventBus', () => ({
  eventBus: {
    on: jest.fn(),
    emit: jest.fn(),
  },
  WS_EVENTS: {
    STREAM_STARTING: 'stream:starting',
    STREAM_RUNNING: 'stream:running',
    STREAM_EXITED: 'stream:exited',
    STREAM_STOPPED: 'stream:stopped',
    STREAM_ERROR: 'stream:error',
    STREAM_FATAL: 'stream:fatal',
    STREAM_RECOVERY_FAILED: 'stream:recovery_failed',
    STREAM_ZOMBIE: 'stream:zombie',
    SHARING_DETECTED: 'sharing:detected',
  },
}));

jest.mock('../../../services/sharingDetector', () => ({
  subscribeToAlerts: jest.fn().mockReturnValue(jest.fn()),
}));

jest.mock('../../../services/bandwidthMonitor', () => ({
  recordSample: jest.fn().mockResolvedValue(undefined),
  getLatestSample: jest.fn().mockReturnValue({ rxMbps: 0, txMbps: 0 }),
}));

jest.mock('../../../services/healthMonitor', () => ({
  isPanelUp: jest.fn(),
  hasPanelHealthSample: jest.fn(),
  getLastCheckAt: jest.fn(),
  getLastResponseMs: jest.fn(),
  getLastError: jest.fn(),
  getConsecutiveFails: jest.fn(),
  start: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  listServers: jest.fn().mockResolvedValue([]),
}));

describe('WsServer Helper Functions', () => {
  let deps;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = {
      channels: new Map(),
      processes: new Map(),
      userActivity: new Map(),
      collectSystemMetrics: jest.fn().mockResolvedValue({
        cpuPct: 50,
        ramPct: 60,
        diskMain: { use: 45, used: 100, size: 200 },
        net: { rxSec: 1024, txSec: 2048 },
        loadAvg: [1, 2, 3],
        cores: 4,
        swapPct: 10,
      }),
      dbApi: {},
      maxFFmpegProcesses: 10,
      formatDuration: (secs) => `${secs}s`,
      channelRuntimeInfo: jest.fn().mockReturnValue('test info'),
    };
  });

  describe('clampPct', () => {
    function clampPct(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.min(100, num));
    }

    it('should clamp percentage values to 0-100', () => {
      expect(clampPct(50)).toBe(50);
    });

    it('should return 0 for values above 100', () => {
      expect(clampPct(150)).toBe(100);
    });

    it('should return 0 for negative values', () => {
      expect(clampPct(-20)).toBe(0);
    });

    it('should return 0 for non-finite values', () => {
      expect(clampPct('abc')).toBe(0);
      expect(clampPct(NaN)).toBe(0);
      expect(clampPct(Infinity)).toBe(0);
    });
  });

  describe('metricTone', () => {
    function metricTone(pct) {
      const num = Number(pct);
      if (!Number.isFinite(num)) return 'muted';
      if (num >= 75) return 'red';
      if (num >= 50) return 'yellow';
      return 'green';
    }

    it('should return red for high percentages (>=75)', () => {
      expect(metricTone(75)).toBe('red');
      expect(metricTone(80)).toBe('red');
      expect(metricTone(100)).toBe('red');
    });

    it('should return yellow for medium percentages (>=50 and <75)', () => {
      expect(metricTone(50)).toBe('yellow');
      expect(metricTone(60)).toBe('yellow');
      expect(metricTone(74)).toBe('yellow');
    });

    it('should return green for low percentages (<50)', () => {
      expect(metricTone(0)).toBe('green');
      expect(metricTone(25)).toBe('green');
      expect(metricTone(49)).toBe('green');
    });

    it('should return muted for non-finite values', () => {
      expect(metricTone('abc')).toBe('muted');
      expect(metricTone(NaN)).toBe('muted');
      expect(metricTone(undefined)).toBe('muted');
    });
  });

  describe('formatValue', () => {
    function formatValue(value, suffix = '') {
      if (value == null || value === '') return '—';
      const num = Number(value);
      if (Number.isFinite(num)) return `${num}${suffix}`;
      return String(value);
    }

    it('should format numbers with suffix', () => {
      expect(formatValue(42, 'ms')).toBe('42ms');
      expect(formatValue(100, '%')).toBe('100%');
    });

    it('should return dash for null/undefined/empty', () => {
      expect(formatValue(null)).toBe('—');
      expect(formatValue(undefined)).toBe('—');
      expect(formatValue('')).toBe('—');
    });

    it('should format strings as-is', () => {
      expect(formatValue('hello')).toBe('hello');
    });
  });

  describe('formatFixed', () => {
    function formatFixed(value, digits, suffix = '') {
      const num = Number(value);
      if (!Number.isFinite(num)) return '—';
      return `${num.toFixed(digits)}${suffix}`;
    }

    it('should format numbers with fixed decimals', () => {
      expect(formatFixed(1.567, 1)).toBe('1.6');
      expect(formatFixed(1.234, 2)).toBe('1.23');
    });

    it('should add suffix when provided', () => {
      expect(formatFixed(1.5, 1, ' Mbps')).toBe('1.5 Mbps');
    });

    it('should return dash for non-finite values', () => {
      expect(formatFixed(NaN, 1)).toBe('—');
      expect(formatFixed(Infinity, 1)).toBe('—');
    });
  });

  describe('serverRoleLabel', () => {
    function serverRoleLabel(role, isLocal) {
      if (isLocal) return 'Panel Node';
      if (role === 'lb') return 'Load Balancer';
      if (role === 'main') return 'Main Server';
      if (role === 'edge') return 'Edge Server';
      return 'Server';
    }

    it('should return correct labels for different roles', () => {
      expect(serverRoleLabel('lb', false)).toBe('Load Balancer');
      expect(serverRoleLabel('main', false)).toBe('Main Server');
      expect(serverRoleLabel('edge', false)).toBe('Edge Server');
      expect(serverRoleLabel('unknown', false)).toBe('Server');
    });

    it('should return Panel Node for local server', () => {
      expect(serverRoleLabel('edge', true)).toBe('Panel Node');
      expect(serverRoleLabel('main', true)).toBe('Panel Node');
    });
  });

  describe('serverAccentClass', () => {
    function serverAccentClass(role, index, isLocal) {
      if (isLocal || role === 'main') return 'indigo';
      if (role === 'lb') return 'teal';
      if (role === 'edge') return index % 2 === 0 ? 'rose' : 'amber';
      return 'slate';
    }

    it('should return correct accent classes', () => {
      expect(serverAccentClass('main', 0, true)).toBe('indigo');
      expect(serverAccentClass('main', 0, false)).toBe('indigo');
      expect(serverAccentClass('lb', 0, false)).toBe('teal');
      expect(serverAccentClass('edge', 0, false)).toBe('rose');
      expect(serverAccentClass('edge', 1, false)).toBe('amber');
      expect(serverAccentClass('unknown', 0, false)).toBe('slate');
    });
  });

  describe('buildDashboardMetric', () => {
    function buildDashboardMetric(label, pct, value, tone) {
      const hasPct = Number.isFinite(Number(pct));
      return {
        label,
        pct: hasPct ? Math.max(0, Math.min(100, Number(pct))) : 0,
        value: value == null || value === '' ? '—' : String(value),
        tone: tone || (hasPct ? (Number(pct) >= 75 ? 'red' : Number(pct) >= 50 ? 'yellow' : 'green') : 'muted'),
      };
    }

    it('should build metric with correct structure', () => {
      const metric = buildDashboardMetric('CPU', 75, '75%', 'red');
      expect(metric.label).toBe('CPU');
      expect(metric.pct).toBe(75);
      expect(metric.value).toBe('75%');
      expect(metric.tone).toBe('red');
    });

    it('should auto-tone when not provided', () => {
      expect(buildDashboardMetric('CPU', 80).tone).toBe('red');
      expect(buildDashboardMetric('CPU', 60).tone).toBe('yellow');
      expect(buildDashboardMetric('CPU', 40).tone).toBe('green');
      expect(buildDashboardMetric('CPU', 'abc').tone).toBe('muted');
    });

    it('should clamp percentage to 0-100', () => {
      expect(buildDashboardMetric('CPU', 150).pct).toBe(100);
      expect(buildDashboardMetric('CPU', -10).pct).toBe(0);
    });
  });

  describe('buildLocalServerCard', () => {
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
      const statusTone = health.status === 'unknown'
        ? 'warning'
        : (health.status === 'down' ? 'offline' : 'online');
      const statusText = health.status === 'unknown'
        ? 'Pending'
        : (health.status === 'down' ? 'Down' : 'Healthy');

      return {
        name: 'Main Server',
        subtitle: 'Panel Node',
        statusTone,
        statusText,
        facts: [
          { label: 'Connections', value: connections },
          { label: 'Users', value: activeUsers },
          { label: 'Streams Live', value: runningStreams },
        ],
        metrics: [
          { label: 'CPU', pct: system.cpuPct, tone: 'yellow' },
          { label: 'MEM', pct: system.ramPct, tone: 'yellow' },
        ],
      };
    }

    it('should build local server card with correct structure', () => {
      const card = buildLocalServerCard({
        activeUsers: 5,
        activeLines: 10,
        connections: 3,
        downStreams: 1,
        health: { status: 'up', lastResponseMs: 50 },
        netInMbps: 1.5,
        netOutMbps: 2.5,
        processInfo: { uptime: '3600s' },
        runningStreams: 5,
        system: { cpuPct: 45, ramPct: 55, diskPct: 40 },
      });

      expect(card.name).toBe('Main Server');
      expect(card.subtitle).toBe('Panel Node');
      expect(card.statusTone).toBe('online');
      expect(card.statusText).toBe('Healthy');
    });

    it('should handle unknown health status', () => {
      const card = buildLocalServerCard({
        activeUsers: 0,
        activeLines: 0,
        connections: 0,
        downStreams: 0,
        health: { status: 'unknown', lastResponseMs: 0 },
        netInMbps: 0,
        netOutMbps: 0,
        processInfo: { uptime: '0s' },
        runningStreams: 0,
        system: { cpuPct: 0, ramPct: 0, diskPct: 0 },
      });
      expect(card.statusTone).toBe('warning');
      expect(card.statusText).toBe('Pending');
    });

    it('should handle down health status', () => {
      const card = buildLocalServerCard({
        activeUsers: 0,
        activeLines: 0,
        connections: 0,
        downStreams: 0,
        health: { status: 'down', lastResponseMs: 5000 },
        netInMbps: 0,
        netOutMbps: 0,
        processInfo: { uptime: '0s' },
        runningStreams: 0,
        system: { cpuPct: 0, ramPct: 0, diskPct: 0 },
      });
      expect(card.statusTone).toBe('offline');
      expect(card.statusText).toBe('Down');
    });
  });

  describe('buildRemoteServerCard', () => {
    const SERVER_HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

    function buildRemoteServerCard(server, index, runningByServer, now) {
      const role = String(server.role || '').toLowerCase();
      const cpu = server.health_cpu_pct != null ? Number(server.health_cpu_pct) : null;
      const mem = server.health_mem_pct != null ? Number(server.health_mem_pct) : null;
      const net = server.health_net_mbps != null ? Number(server.health_net_mbps) : null;
      const ping = server.health_ping_ms != null ? Number(server.health_ping_ms) : null;
      const cap = server.network_mbps_cap != null ? Number(server.network_mbps_cap) : 0;
      const ioPct = Number.isFinite(net)
        ? (cap > 0 ? Math.min(100, (net / cap) * 100) : Math.min(100, net * 5))
        : null;
      const runningStreams = runningByServer.get(Number(server.id)) || 0;
      const heartbeatAt = server.last_heartbeat_at ? new Date(server.last_heartbeat_at).getTime() : null;
      const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? now - heartbeatAt : null;

      let statusTone = 'offline';
      let statusText = 'No agent';
      if (Number(server.enabled) !== 1) {
        statusTone = 'disabled';
        statusText = 'Disabled';
      } else if (heartbeatAgeMs != null && heartbeatAgeMs <= SERVER_HEARTBEAT_FRESH_MS) {
        statusTone = 'online';
        statusText = 'Agent Live';
      } else if (heartbeatAgeMs != null) {
        statusTone = 'warning';
        statusText = 'Stale';
      }

      return {
        name: server.name || `Server ${server.id}`,
        subtitle: role === 'lb' ? 'Load Balancer' : role === 'edge' ? 'Edge Server' : 'Server',
        statusTone,
        statusText,
        facts: [
          { label: 'Connections', value: Number(server.max_clients) > 0 ? `0 / ${server.max_clients}` : '—' },
          { label: 'Streams Live', value: runningStreams },
        ],
        metrics: [
          { label: 'CPU', pct: cpu },
          { label: 'MEM', pct: mem },
        ],
      };
    }

    it('should build remote server card with correct structure', () => {
      const server = {
        id: 1,
        name: 'Edge Server 1',
        role: 'edge',
        enabled: 1,
        max_clients: 100,
        last_heartbeat_at: new Date().toISOString(),
        health_cpu_pct: 30,
        health_mem_pct: 40,
        health_net_mbps: 50,
        health_ping_ms: 20,
        network_mbps_cap: 100,
      };
      const runningByServer = new Map([[1, 3]]);
      const now = Date.now();

      const card = buildRemoteServerCard(server, 0, runningByServer, now);

      expect(card.name).toBe('Edge Server 1');
      expect(card.subtitle).toBe('Edge Server');
      expect(card.statusTone).toBe('online');
      expect(card.statusText).toBe('Agent Live');
    });

    it('should mark disabled servers', () => {
      const card = buildRemoteServerCard({
        id: 2,
        name: 'Disabled Server',
        role: 'edge',
        enabled: 0,
        max_clients: 50,
      }, 0, new Map(), Date.now());
      expect(card.statusTone).toBe('disabled');
      expect(card.statusText).toBe('Disabled');
    });

    it('should mark stale servers', () => {
      const card = buildRemoteServerCard({
        id: 3,
        name: 'Stale Server',
        role: 'lb',
        enabled: 1,
        max_clients: 50,
        last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }, 0, new Map(), Date.now());
      expect(card.statusTone).toBe('warning');
      expect(card.statusText).toBe('Stale');
    });

    it('should mark servers with no agent', () => {
      const card = buildRemoteServerCard({
        id: 4,
        name: 'No Agent Server',
        role: 'main',
        enabled: 1,
        max_clients: 0,
        last_heartbeat_at: null,
      }, 0, new Map(), Date.now());
      expect(card.statusTone).toBe('offline');
      expect(card.statusText).toBe('No agent');
    });
  });

  describe('buildDashboardCardFact', () => {
    function buildDashboardCardFact(label, value) {
      return { label, value: value == null || value === '' ? '—' : String(value) };
    }

    it('should build card fact correctly', () => {
      expect(buildDashboardCardFact('Connections', 5)).toEqual({ label: 'Connections', value: '5' });
      expect(buildDashboardCardFact('Users', null)).toEqual({ label: 'Users', value: '—' });
      expect(buildDashboardCardFact('Streams', '')).toEqual({ label: 'Streams', value: '—' });
    });
  });
});
