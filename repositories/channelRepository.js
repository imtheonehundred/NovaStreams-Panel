'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const { toMysqlDatetimeUtc } = require('../lib/mysql-datetime');
const { ConflictError } = require('../lib/errors');

function stripVolatile(ch) {
  const o = { ...ch };
  delete o.userId;
  delete o.version;
  o.status = 'stopped';
  o.hlsUrl = null;
  o.error = null;
  return o;
}

async function insertChannel(id, userId, channel) {
  const nowIso = new Date().toISOString();
  const createdAtIso = channel.createdAt || nowIso;
  const forDb = stripVolatile({ ...channel, createdAt: createdAtIso });
  const createdAtDb = toMysqlDatetimeUtc(createdAtIso);
  const nowDb = toMysqlDatetimeUtc(nowIso);
  await execute(
    'INSERT INTO channels (id, user_id, json_data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    [id, userId, JSON.stringify(forDb), createdAtDb, nowDb]
  );
  if (channel && typeof channel === 'object') channel.version = 1;
}

async function updateChannelRow(id, userId, channel, expectedVersion = null) {
  const nowDb = toMysqlDatetimeUtc(new Date());
  const prev = await queryOne(
    'SELECT json_data, version FROM channels WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (!prev) return false;
  const currentVersion = Number(prev.version) || 1;
  const targetVersion =
    expectedVersion != null
      ? Number(expectedVersion)
      : Number(channel && channel.version);
  const safeExpectedVersion =
    Number.isFinite(targetVersion) && targetVersion > 0
      ? targetVersion
      : currentVersion;
  const merged = { ...JSON.parse(prev.json_data), ...channel };
  const forDb = stripVolatile(merged);
  const result = await execute(
    'UPDATE channels SET json_data = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?',
    [JSON.stringify(forDb), nowDb, id, userId, safeExpectedVersion]
  );
  if (!result || Number(result.affectedRows) === 0) {
    const latest = await queryOne(
      'SELECT version FROM channels WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    throw new ConflictError('Channel was modified by another process', {
      currentVersion: latest
        ? Number(latest.version) || currentVersion
        : currentVersion,
      channelId: id,
    });
  }
  const nextVersion = safeExpectedVersion + 1;
  if (channel && typeof channel === 'object') channel.version = nextVersion;
  return nextVersion;
}

async function deleteChannelRow(id, userId) {
  return await remove('DELETE FROM channels WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);
}

async function listChannelRowsForUser(userId) {
  return await query(
    'SELECT id, user_id, json_data, version FROM channels WHERE user_id = ?',
    [userId]
  );
}

async function listAllChannelRows() {
  return await query('SELECT id, user_id, json_data, version FROM channels');
}

async function listAllLiveChannelIds() {
  const rows = await query('SELECT id FROM channels');
  return rows.map((r) => r.id);
}

async function upsertChannelHealth(channelId, userId, score, statusText, meta) {
  const st = Math.max(0, Math.min(100, parseInt(score, 10) || 0));
  const nowDb = toMysqlDatetimeUtc(new Date());
  const metaJson = JSON.stringify(meta || {});
  await execute(
    `INSERT INTO channel_health (channel_id, user_id, stability_score, last_checked, status_text, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stability_score = VALUES(stability_score), last_checked = VALUES(last_checked), status_text = VALUES(status_text), meta_json = VALUES(meta_json)`,
    [channelId, userId, st, nowDb, statusText || 'Stable', metaJson]
  );
  return {
    stability_score: st,
    last_checked: nowDb,
    status_text: statusText || 'Stable',
    meta_json: metaJson,
  };
}

async function getChannelHealth(channelId, userId) {
  return await queryOne(
    'SELECT channel_id, stability_score, last_checked, status_text, meta_json FROM channel_health WHERE channel_id = ? AND user_id = ?',
    [channelId, userId]
  );
}

async function insertQoeMetric(row) {
  await execute(
    'INSERT INTO qoe_metrics (channel_id, user_id, startup_ms, buffer_events, buffer_duration_ms, errors, latency_ms, bitrate_switches, dropped_frames, playback_ms, qoe_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.channel_id,
      row.user_id,
      row.startup_ms,
      row.buffer_events,
      row.buffer_duration_ms,
      row.errors,
      row.latency_ms,
      row.bitrate_switches,
      row.dropped_frames,
      row.playback_ms,
      row.qoe_score,
    ]
  );
}

async function getQoeHistory(channelId, userId, limit = 60) {
  return await query(
    'SELECT created_at, startup_ms, buffer_events, buffer_duration_ms, errors, latency_ms, qoe_score FROM qoe_metrics WHERE channel_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?',
    [channelId, userId, limit]
  );
}

async function getQoeAgg(channelId, userId) {
  return await queryOne(
    'SELECT channel_id, last_qoe_at, qoe_score, final_score, avg_startup_ms, avg_buffer_ratio, avg_latency_ms FROM qoe_agg WHERE channel_id = ? AND user_id = ?',
    [channelId, userId]
  );
}

async function upsertQoeAgg(channelId, userId, data) {
  await execute(
    `INSERT INTO qoe_agg (channel_id, user_id, last_qoe_at, qoe_score, final_score, avg_startup_ms, avg_buffer_ratio, avg_latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_qoe_at = VALUES(last_qoe_at), qoe_score = VALUES(qoe_score), final_score = VALUES(final_score), avg_startup_ms = VALUES(avg_startup_ms), avg_buffer_ratio = VALUES(avg_buffer_ratio), avg_latency_ms = VALUES(avg_latency_ms)`,
    [
      channelId,
      userId,
      data.last_qoe_at,
      data.qoe_score,
      data.final_score,
      data.avg_startup_ms,
      data.avg_buffer_ratio,
      data.avg_latency_ms,
    ]
  );
}

module.exports = {
  insertChannel,
  updateChannelRow,
  deleteChannelRow,
  listChannelRowsForUser,
  listAllChannelRows,
  listAllLiveChannelIds,
  upsertChannelHealth,
  getChannelHealth,
  insertQoeMetric,
  getQoeHistory,
  getQoeAgg,
  upsertQoeAgg,
  ConflictError,
};
