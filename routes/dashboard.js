'use strict';

/**
 * Dashboard routes: metrics, system overview.
 * Depends on server.js state (channels, processes, userActivity).
 * Pass these as constructor dependencies to avoid tight coupling.
 */

const express = require('express');

module.exports = function dashboardRoutes({
  channels,
  processes,
  userActivity,
  collectSystemMetrics,
  dbApi,
  maxFFmpegProcesses,
  formatDuration,
  channelRuntimeInfo,
}) {
  const router = express.Router();
  const getMaxProcesses =
    typeof maxFFmpegProcesses === 'function'
      ? maxFFmpegProcesses
      : () => maxFFmpegProcesses;

  /**
   * GET /api/dashboard/metrics
   * Live dashboard metrics for the admin panel.
   */
  router.get('/metrics', async (req, res) => {
    try {
      const mine = [];
      channels.forEach((ch, id) => {
        if (ch.userId !== req.userId) return;
        mine.push({ id, ...ch });
      });

      const running = mine.filter((c) => c.status === 'running');
      const m = await collectSystemMetrics();
      const mem = m.mem;
      const diskMain = m.diskMain;
      const net = m.net;

      const now = Date.now();
      const ACTIVE_USER_TIMEOUT_MS = 5 * 60 * 1000;
      const activeUsers = [...userActivity.values()].filter(
        (ts) => now - ts <= ACTIVE_USER_TIMEOUT_MS
      ).length;

      const table = mine.map((ch) => {
        const upSec = ch.startedAt
          ? (now - new Date(ch.startedAt).getTime()) / 1000
          : 0;
        return {
          id: ch.id || '',
          name: ch.name || 'channel',
          status: ch.status || 'stopped',
          info: channelRuntimeInfo(ch),
          uptime: ch.status === 'running' ? formatDuration(upSec) : '-',
        };
      });

      res.json({
        header: {
          liveText: 'Live — real-time via polling',
        },
        cards: {
          runningStreams: running.length,
          viewers: running.reduce((a, c) => a + (Number(c.viewers) || 0), 0),
          connections: processes.size,
          maxProcesses: getMaxProcesses() || 'unlimited',
          channels: mine.length,
          channelsEnabled: mine.length,
          usersTotal: await dbApi.userCount(),
          usersActive: activeUsers,
        },
        system: {
          loadAvg: m.loadAvg,
          cores: m.cores,
          cpuPct: m.cpuPct,
          ramPct: m.ramPct,
          swapPct: m.swapPct,
          diskPct: diskMain ? diskMain.use || 0 : 0,
          loadNow: m.loadAvg[0] || 0,
          ramUsedMB: (mem.total - mem.available) / 1024 / 1024,
          ramTotalMB: mem.total / 1024 / 1024,
          swapUsedMB: (mem.swapused || 0) / 1024 / 1024,
          swapTotalMB: (mem.swaptotal || 0) / 1024 / 1024,
          diskUsedGB: diskMain ? (diskMain.used || 0) / 1024 / 1024 / 1024 : 0,
          diskTotalGB: diskMain ? (diskMain.size || 0) / 1024 / 1024 / 1024 : 0,
          netInKBps: net.rxSec / 1024,
          netOutKBps: net.txSec / 1024,
          metricsWarnings:
            m.warnings && m.warnings.length ? m.warnings : undefined,
          metricsSource: m.source,
        },
        process: {
          uptime: formatDuration(process.uptime()),
          memoryMB: process.memoryUsage().rss / 1024 / 1024,
          handles:
            (process._getActiveHandles && process._getActiveHandles().length) ||
            0,
          profiles: 0,
          activeStreams: running.length,
        },
        channels: table,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to collect metrics' });
    }
  });

  return router;
};
