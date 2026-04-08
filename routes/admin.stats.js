'use strict';

const express = require('express');
const dbApi = require('../lib/db');
const { queryOne } = require('../lib/mariadb');
const { channels, processes } = require('../lib/state');

const router = express.Router();

async function getDashboardCounts() {
  const nowTs = Math.floor(Date.now() / 1000);
  const [
    activeRow,
    totalChRow,
    episodeRow,
    bouquetRow,
    packageRow,
    resellerRow,
  ] = await Promise.all([
    queryOne(
      'SELECT COUNT(*) AS c FROM `lines` WHERE admin_enabled = 1 AND exp_date > FROM_UNIXTIME(?)',
      [nowTs]
    ),
    queryOne('SELECT COUNT(*) AS c FROM `channels`'),
    queryOne('SELECT COUNT(*) AS c FROM `episodes`'),
    queryOne('SELECT COUNT(*) AS c FROM `bouquets`'),
    queryOne('SELECT COUNT(*) AS c FROM `packages`'),
    queryOne(
      'SELECT COUNT(*) AS c FROM users u INNER JOIN user_groups g ON u.member_group_id = g.group_id WHERE g.is_reseller = 1'
    ),
  ]);
  const [movieCountVal, seriesCountVal] = await Promise.all([
    dbApi.movieCount(),
    dbApi.seriesCount(),
  ]);
  return {
    activeLines: activeRow ? activeRow.c : 0,
    channelsCount: totalChRow ? totalChRow.c : 0,
    episodeCount: episodeRow ? Number(episodeRow.c) || 0 : 0,
    bouquetCount: bouquetRow ? Number(bouquetRow.c) || 0 : 0,
    packageCount: packageRow ? Number(packageRow.c) || 0 : 0,
    resellerCount: resellerRow ? Number(resellerRow.c) || 0 : 0,
    movieCount: movieCountVal,
    seriesCount: seriesCountVal,
  };
}

router.get('/stats', async (req, res) => {
  try {
    const si = require('systeminformation');
    const [cpu, mem, disk, net] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
    ]);
    const counts = await getDashboardCounts();
    const runningCount = channels
      ? [...channels.values()].filter((c) => c.status === 'running').length
      : 0;
    const totalNetIn = net.reduce((a, n) => a + (n.rx_sec || 0), 0) / 1024;
    const totalNetOut = net.reduce((a, n) => a + (n.tx_sec || 0), 0) / 1024;
    res.json({
      activeLines: counts.activeLines,
      connections: processes ? processes.size : 0,
      liveStreams: runningCount,
      channelsCount: counts.channelsCount,
      movieCount: counts.movieCount,
      seriesCount: counts.seriesCount,
      episodeCount: counts.episodeCount,
      bouquetCount: counts.bouquetCount,
      packageCount: counts.packageCount,
      resellerCount: counts.resellerCount,
      cpu: Math.round(cpu.currentLoad || 0),
      memUsed: mem.used,
      memTotal: mem.total,
      memPercent: Math.round((mem.used / mem.total) * 100),
      diskUsed: disk[0] ? disk[0].used : 0,
      diskTotal: disk[0] ? disk[0].size : 0,
      diskPercent: disk[0] ? Math.round(disk[0].use) : 0,
      diskUsedGB: disk[0]
        ? +((disk[0].used || 0) / (1024 * 1024 * 1024)).toFixed(1)
        : 0,
      diskTotalGB: disk[0]
        ? +((disk[0].size || 0) / (1024 * 1024 * 1024)).toFixed(1)
        : 0,
      netIn: parseFloat(totalNetIn.toFixed(1)),
      netOut: parseFloat(totalNetOut.toFixed(1)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
