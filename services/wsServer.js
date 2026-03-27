'use strict';

/**
 * WebSocket server for IPTV Panel real-time dashboard.
 * - Auth via cookie-session (same mechanism as HTTP requireAuth)
 * - Two broadcast channels: "dashboard" (periodic metrics) and "events" (stream/sharing)
 * - Subscribes to Redis sharing:alerts and forwards to eventBus
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { eventBus, WS_EVENTS } = require('./eventBus');
const { subscribeToAlerts } = require('./sharingDetector');

const WS_PATH = '/ws';
const DASHBOARD_INTERVAL_MS = 5000;

// Parse cookie-session signed cookie value
// cookie-session v2 format: base64url(data) + '.' + hmac(key, base64url(data))
function parseSessionCookie(cookieHeader, secret) {
  if (!cookieHeader || !secret) return null;
  const { parse } = require('cookie');
  const cookies = parse(cookieHeader);
  const raw = cookies.session || cookies.sess;
  if (!raw) return null;

  try {
    const lastDot = raw.lastIndexOf('.');
    if (lastDot === -1) return null;
    const dataB64 = raw.slice(0, lastDot);
    const sigB64 = raw.slice(lastDot + 1);

    const key = crypto.createHmac('sha256', secret)
      .update('cookie-session.key').digest().slice(0, 16);
    const expectedSig = crypto.createHmac('sha256', key)
      .update(dataB64).digest('base64url');

    const sigBuf = Buffer.from(sigB64, 'base64url');
    const expBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const data = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8'));
    return data;
  } catch {
    return null;
  }
}

function createWsServer({ getSessionUserId, deps }) {
  const clients = new Set();
  let wss;
  let dashboardTimer;
  let sharingUnsubscribe;

  // Authenticate a WebSocket connection from upgrade request
  function authenticate(req) {
    const cookieHeader = req.headers.cookie || '';
    const secret = process.env.SESSION_SECRET;
    const session = parseSessionCookie(cookieHeader, secret);
    if (!session || !session.userId) return null;
    return { userId: session.userId, session };
  }

  // Broadcast a message to all authenticated clients on a channel
  function broadcast(channel, data) {
    const msg = JSON.stringify({ channel, data, ts: Date.now() });
    for (const client of clients) {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(msg);
      }
    }
  }

  // Collect and broadcast dashboard metrics
  async function broadcastDashboard() {
    try {
      const { channels, processes, userActivity, collectSystemMetrics, dbApi, maxFFmpegProcesses, formatDuration, channelRuntimeInfo } = deps;
      const now = Date.now();
      const ACTIVE_USER_TIMEOUT_MS = 5 * 60 * 1000;

      const running = [...channels.values()].filter(c => c.status === 'running');
      const m = await collectSystemMetrics();
      const activeUsers = [...userActivity.values()].filter(ts => now - ts <= ACTIVE_USER_TIMEOUT_MS).length;

      const data = {
        cards: {
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
        },
        process: {
          uptime: formatDuration ? formatDuration(process.uptime()) : String(process.uptime()),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          activeStreams: running.length,
        },
        channels: running.map(ch => ({
          id: ch.id || '',
          name: ch.name || 'channel',
          status: ch.status || 'running',
          info: channelRuntimeInfo ? channelRuntimeInfo(ch) : '',
          uptime: formatDuration && ch.startedAt
            ? formatDuration((now - new Date(ch.startedAt).getTime()) / 1000)
            : '-',
        })),
        activeUsers,
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
      const user = authenticate(req);
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

      ws.on('close', () => { clients.delete(client); });
      ws.on('error', () => { clients.delete(client); });

      // Send initial dashboard snapshot immediately
      broadcastDashboard();
    });

    // Subscribe to Redis sharing alerts
    sharingUnsubscribe = subscribeToAlerts(handleSharingAlert);

    // Periodic dashboard broadcast
    dashboardTimer = setInterval(broadcastDashboard, DASHBOARD_INTERVAL_MS);

    // Wire eventBus → broadcast
    const off = (event, handler) => eventBus.on(event, handler);
    const off1 = off(WS_EVENTS.STREAM_STARTING, d => handleStreamEvent(WS_EVENTS.STREAM_STARTING, d));
    const off2 = off(WS_EVENTS.STREAM_RUNNING, d => handleStreamEvent(WS_EVENTS.STREAM_RUNNING, d));
    const off3 = off(WS_EVENTS.STREAM_EXITED, d => handleStreamEvent(WS_EVENTS.STREAM_EXITED, d));
    const off4 = off(WS_EVENTS.STREAM_STOPPED, d => handleStreamEvent(WS_EVENTS.STREAM_STOPPED, d));
    const off5 = off(WS_EVENTS.STREAM_ERROR, d => handleStreamEvent(WS_EVENTS.STREAM_ERROR, d));
    const off6 = off(WS_EVENTS.STREAM_FATAL, d => handleStreamEvent(WS_EVENTS.STREAM_FATAL, d));
    const off7 = off(WS_EVENTS.STREAM_RECOVERY_FAILED, d => handleStreamEvent(WS_EVENTS.STREAM_RECOVERY_FAILED, d));
    const off8 = off(WS_EVENTS.STREAM_ZOMBIE, d => handleStreamEvent(WS_EVENTS.STREAM_ZOMBIE, d));
    const off9 = off(WS_EVENTS.SHARING_DETECTED, d => handleStreamEvent(WS_EVENTS.SHARING_DETECTED, d));

    // Store off functions for cleanup (not currently used but good practice)
    wss._offFns = [off1, off2, off3, off4, off5, off6, off7, off8, off9];
  }

  function handleUpgrade(req, socket, head) {
    if (wss) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
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
