'use strict';

const express = require('express');
const { query, queryOne } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const { channels } = require('../lib/state');

const router = express.Router();

router.get('/live-connections', async (req, res) => {
  try {
    const type = String(req.query.type || '').trim();
    const serverId = parseInt(req.query.server_id, 10);
    let sql = `
      SELECT s.session_uuid, s.stream_type, s.stream_id, s.container,
             s.origin_server_id, s.proxy_server_id,
             s.geoip_country_code, s.isp, s.user_ip, s.last_seen_at,
             s.created_at,
             l.username,
             o.name AS origin_name, o.public_host AS origin_host,
             p.name AS proxy_name, p.public_host AS proxy_host
      FROM line_runtime_sessions s
      LEFT JOIN \`lines\` l ON l.id = s.line_id
      LEFT JOIN streaming_servers o ON o.id = s.origin_server_id
      LEFT JOIN streaming_servers p ON p.id = s.proxy_server_id
      WHERE s.date_end IS NULL`;
    const params = [];
    if (type && ['live', 'movie', 'episode'].includes(type)) {
      sql += ' AND s.stream_type = ?';
      params.push(type);
    }
    if (Number.isFinite(serverId)) {
      sql += ' AND s.origin_server_id = ?';
      params.push(serverId);
    }
    sql += ' ORDER BY s.last_seen_at DESC LIMIT 500';
    const sessions = await query(sql, params);
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/live-connections/summary', async (_req, res) => {
  try {
    const [typeRows, countryRows, streamRows, serverRows] = await Promise.all([
      query(`
        SELECT stream_type, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL
        GROUP BY stream_type`),
      query(`
        SELECT geoip_country_code, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL AND geoip_country_code != ''
        GROUP BY geoip_country_code
        ORDER BY cnt DESC
        LIMIT 20`),
      query(`
        SELECT stream_id, stream_type, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL
        GROUP BY stream_id, stream_type
        ORDER BY cnt DESC
        LIMIT 10`),
      query(`
        SELECT origin_server_id, COUNT(*) AS cnt
        FROM line_runtime_sessions
        WHERE date_end IS NULL AND origin_server_id IS NOT NULL
        GROUP BY origin_server_id`),
    ]);
    const byType = { live: 0, movie: 0, episode: 0 };
    for (const r of typeRows) byType[r.stream_type] = Number(r.cnt);
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    const servers = await Promise.all(serverRows.map(async (r) => {
      const srv = await queryOne('SELECT name, public_host FROM streaming_servers WHERE id = ?', [r.origin_server_id]);
      return { server_id: r.origin_server_id, name: srv ? srv.name : '#' + r.origin_server_id, host: srv ? srv.public_host : '', cnt: Number(r.cnt) };
    }));
    res.json({
      total,
      by_type: byType,
      countries: countryRows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })),
      top_streams: streamRows.map((r) => ({ stream_id: r.stream_id, stream_type: r.stream_type, cnt: Number(r.cnt) })),
      servers,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/channels/top-monitor', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT stream_id, COUNT(*) AS viewers, MAX(origin_server_id) AS origin_server_id, MAX(last_seen_at) AS last_seen_at
      FROM line_runtime_sessions
      WHERE date_end IS NULL AND stream_type = 'live'
      GROUP BY stream_id
      ORDER BY viewers DESC, last_seen_at DESC
      LIMIT 50
    `);

    const channelRows = [];
    const serverIds = new Set();
    for (const row of rows) {
      const streamId = String(row.stream_id || '');
      const ch = channels.get(streamId);
      if (!ch || ch.is_internal || ch.channelClass === 'movie') continue;
      const serverId = Number(row.origin_server_id) || Number(ch.stream_server_id) || 0;
      if (serverId > 0) serverIds.add(serverId);
      const uptimeSeconds = ch.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(ch.startedAt).getTime()) / 1000)) : 0;
      const bitrateKbps = ch.streamInfo && ch.streamInfo.bitrate ? Math.round(Number(ch.streamInfo.bitrate) / 1000) : null;
      channelRows.push({
        id: streamId,
        name: ch.name || `Channel ${streamId}`,
        viewers: Number(row.viewers || 0),
        server_id: serverId,
        uptime_seconds: uptimeSeconds,
        uptime_label: uptimeSeconds > 0
          ? `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
          : '—',
        bitrate_kbps: bitrateKbps,
        source: ch.mpdUrl || '',
      });
    }

    const serverMap = new Map();
    if (serverIds.size) {
      const ids = [...serverIds];
      const serverRows = await query(
        `SELECT id, name FROM streaming_servers WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      serverRows.forEach((server) => serverMap.set(Number(server.id), server.name || `Server ${server.id}`));
    }

    const payloadRows = channelRows.map((row) => ({
      ...row,
      server_name: row.server_id > 0 ? (serverMap.get(row.server_id) || `Server ${row.server_id}`) : 'Line / Default',
    }));

    res.json({
      totals: {
        total_viewers: payloadRows.reduce((sum, row) => sum + Number(row.viewers || 0), 0),
        active_channels: payloadRows.length,
        active_servers: new Set(payloadRows.map((row) => row.server_name)).size,
      },
      channels: payloadRows,
      refreshed_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/live-connections/geo', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT geoip_country_code, COUNT(*) AS cnt
      FROM line_runtime_sessions
      WHERE date_end IS NULL AND geoip_country_code != ''
      GROUP BY geoip_country_code
      ORDER BY cnt DESC`);
    res.json({
      total: rows.reduce((sum, r) => sum + Number(r.cnt), 0),
      countries: rows.map((r) => ({ code: r.geoip_country_code || '—', cnt: Number(r.cnt) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

module.exports = router;
