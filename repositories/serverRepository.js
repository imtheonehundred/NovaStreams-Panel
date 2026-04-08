'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');
const { hashApiKey, verifyApiKey } = require('../lib/crypto');
const crypto = require('crypto');
const {
  unixSecondsToMysqlDatetime,
  mysqlDatetimeToUnixSeconds,
} = require('../lib/mysql-datetime');

function normalizeRuntimeSessionRow(row) {
  if (!row) return null;
  return {
    ...row,
    date_start: mysqlDatetimeToUnixSeconds(row.date_start),
    date_end: mysqlDatetimeToUnixSeconds(row.date_end),
  };
}

async function ensureServerRelationshipsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_relationships (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      parent_server_id INT UNSIGNED NOT NULL,
      child_server_id INT UNSIGNED NOT NULL,
      relationship_type ENUM('origin-proxy','lb-member','failover') NOT NULL DEFAULT 'origin-proxy',
      priority INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_server_rel (parent_server_id, child_server_id, relationship_type),
      KEY idx_srel_child (child_server_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureStreamServerPlacementTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS stream_server_placement (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      stream_type ENUM('live','movie','episode') NOT NULL,
      stream_id VARCHAR(64) NOT NULL,
      server_id INT UNSIGNED NOT NULL,
      status ENUM('planned','starting','running','stopping','stopped','error','stale','orphaned') NOT NULL DEFAULT 'planned',
      pid INT UNSIGNED DEFAULT NULL,
      bitrate_kbps INT UNSIGNED DEFAULT NULL,
      clients INT UNSIGNED NOT NULL DEFAULT 0,
      error_text TEXT,
      started_at DATETIME DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      parent_server_id INT UNSIGNED NULL,
      desired_state ENUM('stopped','running') NOT NULL DEFAULT 'stopped',
      runtime_mode ENUM('origin','relay','direct','archive') NOT NULL DEFAULT 'origin',
      on_demand TINYINT(1) NOT NULL DEFAULT 0,
      monitor_pid INT UNSIGNED NULL,
      delay_pid INT UNSIGNED NULL,
      runtime_instance_id VARCHAR(64) NULL,
      current_source TEXT NULL,
      stream_info_json JSON NULL,
      compatible TINYINT(1) NOT NULL DEFAULT 0,
      video_codec VARCHAR(64) NULL,
      audio_codec VARCHAR(64) NULL,
      resolution VARCHAR(64) NULL,
      ready_at DATETIME NULL,
      last_runtime_report_at DATETIME NULL,
      last_command_id BIGINT UNSIGNED NULL,
      restart_count INT UNSIGNED NOT NULL DEFAULT 0,
      error_code VARCHAR(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_placement (stream_type, stream_id, server_id),
      KEY idx_placement_server (server_id, status),
      KEY idx_placement_status (status),
      KEY idx_placement_runtime_instance (runtime_instance_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const newCols = [
    ['parent_server_id', 'INT UNSIGNED NULL'],
    ['desired_state', "ENUM('stopped','running') NOT NULL DEFAULT 'stopped'"],
    [
      'runtime_mode',
      "ENUM('origin','relay','direct','archive') NOT NULL DEFAULT 'origin'",
    ],
    ['on_demand', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['monitor_pid', 'INT UNSIGNED NULL'],
    ['delay_pid', 'INT UNSIGNED NULL'],
    ['runtime_instance_id', 'VARCHAR(64) NULL'],
    ['current_source', 'TEXT NULL'],
    ['stream_info_json', 'JSON NULL'],
    ['compatible', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['video_codec', 'VARCHAR(64) NULL'],
    ['audio_codec', 'VARCHAR(64) NULL'],
    ['resolution', 'VARCHAR(64) NULL'],
    ['ready_at', 'DATETIME NULL'],
    ['last_runtime_report_at', 'DATETIME NULL'],
    ['last_command_id', 'BIGINT UNSIGNED NULL'],
    ['restart_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['error_code', 'VARCHAR(64) NULL'],
  ];
  for (const [colName, colDef] of newCols) {
    try {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stream_server_placement' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (!row || Number(row.c) === 0) {
        await execute(
          `ALTER TABLE stream_server_placement ADD COLUMN ${colName} ${colDef}`
        );
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
        continue;
      throw e;
    }
  }
  try {
    await execute(
      `UPDATE stream_server_placement SET status = 'planned' WHERE status = 'pending'`
    );
    await execute(
      `UPDATE stream_server_placement SET status = 'running' WHERE status = 'active'`
    );
  } catch (e) {}
}

async function ensureLineRuntimeSessionsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS line_runtime_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      line_id INT UNSIGNED NOT NULL,
      stream_type ENUM('live','movie','episode') NOT NULL,
      stream_id VARCHAR(64) NOT NULL,
      placement_id INT UNSIGNED NULL,
      origin_server_id INT UNSIGNED NULL,
      proxy_server_id INT UNSIGNED NULL,
      container VARCHAR(20) NOT NULL DEFAULT '',
      session_uuid VARCHAR(64) NOT NULL,
      playback_token VARCHAR(255) NULL,
      user_ip VARCHAR(45) NOT NULL DEFAULT '',
      user_agent VARCHAR(512) NOT NULL DEFAULT '',
      date_start DATETIME NULL,
      date_end DATETIME NULL,
      last_seen_at DATETIME NULL,
      geoip_country_code VARCHAR(5) NOT NULL DEFAULT '',
      isp VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_session_uuid (session_uuid),
      KEY idx_lrs_line (line_id),
      KEY idx_lrs_server (origin_server_id),
      KEY idx_lrs_placement (placement_id),
      KEY idx_lrs_last_seen (last_seen_at),
      KEY idx_lrs_date_start (date_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureServerCommandsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_commands (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      stream_type ENUM('live','movie','episode') NULL,
      stream_id VARCHAR(64) NULL,
      placement_id INT UNSIGNED NULL,
      command_type ENUM('start_stream','stop_stream','restart_stream','probe_stream','reload_proxy_config','sync_server_config','reconcile_runtime','reconcile_sessions','restart_services','reboot_server','sync_proxy_upstream') NOT NULL,
      payload_json JSON NULL,
      status ENUM('queued','leased','running','succeeded','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
      issued_by_user_id INT UNSIGNED NULL,
      lease_token VARCHAR(64) NULL,
      lease_expires_at DATETIME NULL,
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME NULL,
      finished_at DATETIME NULL,
      result_json JSON NULL,
      error_text TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_sc_server (server_id, status),
      KEY idx_sc_placement (placement_id),
      KEY idx_sc_lease_expires (lease_expires_at),
      KEY idx_sc_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(
    "ALTER TABLE server_commands MODIFY COLUMN command_type ENUM('start_stream','stop_stream','restart_stream','probe_stream','reload_proxy_config','sync_server_config','reconcile_runtime','reconcile_sessions','restart_services','reboot_server','sync_proxy_upstream') NOT NULL"
  );
}

async function ensureServerAgentCredentialsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_agent_credentials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      credential_id VARCHAR(64) NOT NULL,
      secret_hash VARCHAR(255) NOT NULL,
      status ENUM('active','rotating','revoked') NOT NULL DEFAULT 'active',
      issued_at DATETIME NOT NULL,
      rotated_at DATETIME NULL,
      last_used_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sac_server_cred (server_id, credential_id),
      UNIQUE KEY uq_sac_credential_id (credential_id),
      KEY idx_sac_status (status),
      CONSTRAINT fk_sac_server FOREIGN KEY (server_id) REFERENCES streaming_servers (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureServerProvisioningJobsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS server_provisioning_jobs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      server_id INT UNSIGNED NOT NULL,
      status ENUM('pending','running','done','error') NOT NULL DEFAULT 'pending',
      log TEXT,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_spj_server (server_id),
      KEY idx_spj_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureStreamingServersTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS streaming_servers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL DEFAULT '',
      role ENUM('main','lb','edge') NOT NULL DEFAULT 'edge',
      public_host VARCHAR(255) NOT NULL DEFAULT '',
      public_ip VARCHAR(45) NOT NULL DEFAULT '',
      private_ip VARCHAR(45) NOT NULL DEFAULT '',
      max_clients INT DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      proxied TINYINT(1) NOT NULL DEFAULT 0,
      timeshift_only TINYINT(1) NOT NULL DEFAULT 0,
      network_mbps_cap INT DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      meta_json JSON DEFAULT NULL,
      last_heartbeat_at DATETIME DEFAULT NULL,
      health_cpu_pct DECIMAL(5,2) DEFAULT NULL,
      health_mem_pct DECIMAL(5,2) DEFAULT NULL,
      health_net_mbps DECIMAL(12,4) DEFAULT NULL,
      health_ping_ms DECIMAL(10,2) DEFAULT NULL,
      agent_version VARCHAR(64) DEFAULT NULL,
      runtime_enabled TINYINT(1) NOT NULL DEFAULT 0,
      proxy_enabled TINYINT(1) NOT NULL DEFAULT 0,
      controller_enabled TINYINT(1) NOT NULL DEFAULT 0,
      base_url VARCHAR(255) NOT NULL DEFAULT '',
      server_ip VARCHAR(45) NOT NULL DEFAULT '',
      dns_1 VARCHAR(45) NOT NULL DEFAULT '',
      dns_2 VARCHAR(45) NOT NULL DEFAULT '',
      admin_password VARCHAR(255) NOT NULL DEFAULT '',
      full_duplex TINYINT(1) NOT NULL DEFAULT 0,
      boost_fpm TINYINT(1) NOT NULL DEFAULT 0,
      http_port INT UNSIGNED NOT NULL DEFAULT 8080,
      https_m3u_lines TINYINT(1) NOT NULL DEFAULT 0,
      force_ssl_port TINYINT(1) NOT NULL DEFAULT 0,
      https_port INT UNSIGNED NOT NULL DEFAULT 8083,
      time_difference VARCHAR(32) NOT NULL DEFAULT 'Auto',
      ssh_port INT UNSIGNED NOT NULL DEFAULT 22,
      network_interface VARCHAR(64) NOT NULL DEFAULT 'all',
      network_speed VARCHAR(64) NOT NULL DEFAULT '',
      os_info VARCHAR(128) NOT NULL DEFAULT '',
      geoip_load_balancing TINYINT(1) NOT NULL DEFAULT 0,
      geoip_countries TEXT NOT NULL DEFAULT '',
      extra_nginx_config TEXT NOT NULL DEFAULT '',
      server_guard_enabled TINYINT(1) NOT NULL DEFAULT 0,
      ip_whitelisting TINYINT(1) NOT NULL DEFAULT 0,
      botnet_fighter TINYINT(1) NOT NULL DEFAULT 0,
      under_attack TINYINT(1) NOT NULL DEFAULT 0,
      connection_limit_ports VARCHAR(255) NOT NULL DEFAULT '',
      max_conn_per_ip INT UNSIGNED NOT NULL DEFAULT 3,
      max_hits_normal_user INT UNSIGNED NOT NULL DEFAULT 1,
      max_hits_restreamer INT UNSIGNED NOT NULL DEFAULT 1,
      whitelist_username TINYINT(1) NOT NULL DEFAULT 0,
      block_user_minutes INT UNSIGNED NOT NULL DEFAULT 30,
      auto_restart_mysql TINYINT(1) NOT NULL DEFAULT 0,
      isp_enabled TINYINT(1) NOT NULL DEFAULT 0,
      isp_priority INT UNSIGNED NOT NULL DEFAULT 1,
      isp_allowed_names TEXT NOT NULL DEFAULT '',
      isp_case_sensitive ENUM('none','lower','upper') NOT NULL DEFAULT 'lower',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_streaming_servers_role (role, enabled, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const newCols = [
    ['runtime_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['proxy_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['controller_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['base_url', "VARCHAR(255) NOT NULL DEFAULT ''"],
    ['server_ip', "VARCHAR(45) NOT NULL DEFAULT ''"],
    ['dns_1', "VARCHAR(45) NOT NULL DEFAULT ''"],
    ['dns_2', "VARCHAR(45) NOT NULL DEFAULT ''"],
    ['admin_password', "VARCHAR(255) NOT NULL DEFAULT ''"],
    ['full_duplex', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['boost_fpm', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['http_port', 'INT UNSIGNED NOT NULL DEFAULT 8080'],
    ['https_m3u_lines', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['force_ssl_port', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['https_port', 'INT UNSIGNED NOT NULL DEFAULT 8083'],
    ['time_difference', "VARCHAR(32) NOT NULL DEFAULT 'Auto'"],
    ['ssh_port', 'INT UNSIGNED NOT NULL DEFAULT 22'],
    ['network_interface', "VARCHAR(64) NOT NULL DEFAULT 'all'"],
    ['network_speed', "VARCHAR(64) NOT NULL DEFAULT ''"],
    ['os_info', "VARCHAR(128) NOT NULL DEFAULT ''"],
    ['geoip_load_balancing', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['geoip_countries', "TEXT NOT NULL DEFAULT ''"],
    ['extra_nginx_config', "TEXT NOT NULL DEFAULT ''"],
    ['server_guard_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['ip_whitelisting', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['botnet_fighter', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['under_attack', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['connection_limit_ports', "VARCHAR(255) NOT NULL DEFAULT ''"],
    ['max_conn_per_ip', 'INT UNSIGNED NOT NULL DEFAULT 3'],
    ['max_hits_normal_user', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['max_hits_restreamer', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['whitelist_username', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['block_user_minutes', 'INT UNSIGNED NOT NULL DEFAULT 30'],
    ['auto_restart_mysql', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['isp_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['isp_priority', 'INT UNSIGNED NOT NULL DEFAULT 1'],
    ['isp_allowed_names', "TEXT NOT NULL DEFAULT ''"],
    [
      'isp_case_sensitive',
      "ENUM('none','lower','upper') NOT NULL DEFAULT 'lower'",
    ],
  ];
  for (const [colName, colDef] of newCols) {
    try {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_servers' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (!row || Number(row.c) === 0) {
        await execute(
          `ALTER TABLE streaming_servers ADD COLUMN ${colName} ${colDef}`
        );
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
        continue;
      throw e;
    }
  }
  try {
    // Legacy builds stored remote root passwords in plaintext. Do not retain them.
    await execute(
      `UPDATE streaming_servers SET admin_password = '' WHERE admin_password <> '' AND admin_password NOT LIKE 'v1:%'`
    );
  } catch (e) {}
}

async function addServerRelationship(parentId, childId, type) {
  const validTypes = ['origin-proxy', 'lb-member', 'failover'];
  if (!validTypes.includes(type))
    throw new Error(`invalid relationship_type: ${type}`);
  return await insert(
    `INSERT IGNORE INTO server_relationships (parent_server_id, child_server_id, relationship_type) VALUES (?, ?, ?)`,
    [parentId, childId, type]
  );
}

async function removeServerRelationship(parentId, childId, type) {
  await execute(
    `DELETE FROM server_relationships WHERE parent_server_id = ? AND child_server_id = ? AND relationship_type = ?`,
    [parentId, childId, type]
  );
}

async function getServerRelationships(serverId) {
  return await query(
    `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
     FROM server_relationships WHERE parent_server_id = ? OR child_server_id = ?
     ORDER BY relationship_type, priority ASC`,
    [serverId, serverId]
  );
}

async function getServerChildren(parentId, type) {
  if (type) {
    return await query(
      `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
       FROM server_relationships WHERE parent_server_id = ? AND relationship_type = ?
       ORDER BY priority ASC`,
      [parentId, type]
    );
  }
  return await query(
    `SELECT id, parent_server_id, child_server_id, relationship_type, priority, enabled, created_at, updated_at
     FROM server_relationships WHERE parent_server_id = ?
     ORDER BY priority ASC`,
    [parentId]
  );
}

async function createPlacement({ streamType, streamId, serverId }) {
  await execute(
    `INSERT INTO stream_server_placement (stream_type, stream_id, server_id, status, started_at)
     VALUES (?, ?, ?, 'running', NOW())
     ON DUPLICATE KEY UPDATE status = 'running', started_at = NOW()`,
    [streamType, String(streamId), serverId]
  );
}

async function updatePlacementClients(streamType, streamId, serverId, delta) {
  const d = delta > 0 ? '+' : '-';
  await execute(
    `UPDATE stream_server_placement
     SET clients = GREATEST(0, clients ${d}),
         status = CASE WHEN GREATEST(0, clients ${d}) > 0 THEN 'running' ELSE 'stopped' END,
         updated_at = NOW()
     WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

async function getPlacement(streamType, streamId, serverId) {
  return await queryOne(
    'SELECT * FROM stream_server_placement WHERE stream_type = ? AND stream_id = ? AND server_id = ?',
    [streamType, String(streamId), serverId]
  );
}

async function getActivePlacementsForServer(serverId) {
  return await query(
    'SELECT * FROM stream_server_placement WHERE server_id = ? AND clients > 0 ORDER BY stream_type, stream_id',
    [serverId]
  );
}

async function upsertPlacementRuntimeState({
  streamType,
  streamId,
  serverId,
  fields = {},
}) {
  const sets = [];
  const vals = [];
  const validFields = [
    'status',
    'pid',
    'bitrate_kbps',
    'clients',
    'error_text',
    'started_at',
    'parent_server_id',
    'desired_state',
    'runtime_mode',
    'on_demand',
    'monitor_pid',
    'delay_pid',
    'runtime_instance_id',
    'current_source',
    'stream_info_json',
    'compatible',
    'video_codec',
    'audio_codec',
    'resolution',
    'ready_at',
    'last_runtime_report_at',
    'last_command_id',
    'restart_count',
    'error_code',
  ];
  for (const k of validFields) {
    if (fields[k] !== undefined) {
      sets.push(`\`${k}\` = ?`);
      vals.push(
        k === 'stream_info_json' ? JSON.stringify(fields[k]) : fields[k]
      );
    }
  }
  if (sets.length === 0) return;
  vals.push(streamType, String(streamId), serverId);
  await execute(
    `UPDATE stream_server_placement SET ${sets.join(', ')} WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    vals
  );
}

async function setPlacementDesiredState(
  streamType,
  streamId,
  serverId,
  desiredState
) {
  const valid = ['stopped', 'running'];
  if (!valid.includes(desiredState))
    throw new Error(`invalid desired_state: ${desiredState}`);
  await execute(
    `UPDATE stream_server_placement SET desired_state = ? WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [desiredState, streamType, String(streamId), serverId]
  );
}

async function markPlacementStarting(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'starting' WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

async function markPlacementRunning(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'running', ready_at = NOW() WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

async function markPlacementStopped(streamType, streamId, serverId) {
  await execute(
    `UPDATE stream_server_placement SET status = 'stopped', pid = NULL, monitor_pid = NULL, delay_pid = NULL WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [streamType, String(streamId), serverId]
  );
}

async function markPlacementError(
  streamType,
  streamId,
  serverId,
  errorCode,
  errorText
) {
  await execute(
    `UPDATE stream_server_placement SET status = 'error', error_code = ?, error_text = ? WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [
      errorCode || null,
      errorText || null,
      streamType,
      String(streamId),
      serverId,
    ]
  );
}

async function getPlacementByAsset(streamType, streamId) {
  return await query(
    'SELECT * FROM stream_server_placement WHERE stream_type = ? AND stream_id = ? ORDER BY server_id',
    [streamType, String(streamId)]
  );
}

async function getPlacementsByServer(serverId, status) {
  if (status) {
    return await query(
      'SELECT * FROM stream_server_placement WHERE server_id = ? AND status = ? ORDER BY stream_type, stream_id',
      [serverId, status]
    );
  }
  return await query(
    'SELECT * FROM stream_server_placement WHERE server_id = ? ORDER BY stream_type, stream_id',
    [serverId]
  );
}

async function reportPlacementRuntimeFromNode(serverId, reports) {
  if (!Array.isArray(reports) || reports.length === 0) return;
  for (const r of reports) {
    let targetStreamType = r.stream_type || 'live';
    let targetStreamId = r.stream_id ? String(r.stream_id) : '';
    let targetPlacementId = r.placement_id;

    if (!targetStreamId && !targetPlacementId) continue;

    const fields = {};
    if (r.status !== undefined) fields.status = r.status;
    if (r.pid !== undefined) fields.pid = r.pid;
    if (r.monitor_pid !== undefined) fields.monitor_pid = r.monitor_pid;
    if (r.runtime_instance_id !== undefined)
      fields.runtime_instance_id = r.runtime_instance_id;
    if (r.ready_at !== undefined) fields.ready_at = r.ready_at;
    if (r.current_source !== undefined)
      fields.current_source = r.current_source;
    if (r.bitrate_kbps !== undefined) fields.bitrate_kbps = r.bitrate_kbps;
    if (r.compatible !== undefined) fields.compatible = r.compatible;
    if (r.video_codec !== undefined) fields.video_codec = r.video_codec;
    if (r.audio_codec !== undefined) fields.audio_codec = r.audio_codec;
    if (r.resolution !== undefined) fields.resolution = r.resolution;
    if (r.error_text !== undefined) fields.error_text = r.error_text;
    fields.last_runtime_report_at = 'NOW()';

    if (Object.keys(fields).length === 0) continue;

    if (targetPlacementId) {
      await execute(
        `UPDATE stream_server_placement SET ${Object.keys(fields)
          .map((k) => `\`${k}\` = ?`)
          .join(', ')} WHERE id = ?`,
        [...Object.values(fields), targetPlacementId]
      );
    } else if (targetStreamId) {
      await upsertPlacementRuntimeState({
        streamType: targetStreamType,
        streamId: targetStreamId,
        serverId,
        fields,
      });
    }
  }
}

async function openRuntimeSession({
  lineId,
  streamType,
  streamId,
  placementId,
  originServerId,
  proxyServerId,
  container,
  sessionUuid,
  playbackToken,
  userIp,
  userAgent,
  geoipCountryCode,
  isp,
}) {
  const id = await insert(
    `INSERT INTO line_runtime_sessions
     (line_id, stream_type, stream_id, placement_id, origin_server_id, proxy_server_id, container, session_uuid, playback_token, user_ip, user_agent, date_start, last_seen_at, geoip_country_code, isp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
    [
      lineId,
      streamType,
      String(streamId),
      placementId || null,
      originServerId || null,
      proxyServerId || null,
      container || '',
      sessionUuid,
      playbackToken || null,
      userIp || '',
      userAgent || '',
      unixSecondsToMysqlDatetime(Math.floor(Date.now() / 1000)),
      geoipCountryCode || '',
      isp || '',
    ]
  );
  return id;
}

async function touchRuntimeSession(sessionUuid) {
  await execute(
    'UPDATE line_runtime_sessions SET last_seen_at = NOW() WHERE session_uuid = ?',
    [sessionUuid]
  );
}

async function closeRuntimeSession(sessionUuid, dateEnd) {
  await execute(
    'UPDATE line_runtime_sessions SET date_end = ?, last_seen_at = NOW() WHERE session_uuid = ?',
    [
      unixSecondsToMysqlDatetime(dateEnd || Math.floor(Date.now() / 1000)),
      sessionUuid,
    ]
  );
}

async function listActiveRuntimeSessionsByServer(originServerId) {
  const rows = await query(
    'SELECT * FROM line_runtime_sessions WHERE origin_server_id = ? AND date_end IS NULL ORDER BY last_seen_at DESC',
    [originServerId]
  );
  return rows.map(normalizeRuntimeSessionRow);
}

async function countActiveRuntimeSessionsByPlacement(placementId) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM line_runtime_sessions WHERE placement_id = ? AND date_end IS NULL',
    [placementId]
  );
  return row ? Number(row.c) : 0;
}

async function countActiveRuntimeSessionsByServer(originServerId) {
  const row = await queryOne(
    'SELECT COUNT(*) AS c FROM line_runtime_sessions WHERE origin_server_id = ? AND date_end IS NULL',
    [originServerId]
  );
  return row ? Number(row.c) : 0;
}

async function getFailoverRelationships(parentServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.enabled AS server_enabled,
            s.runtime_enabled, s.last_heartbeat_at
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.child_server_id
     WHERE r.parent_server_id = ?
       AND r.relationship_type = 'failover'
       AND r.enabled = 1
       AND s.enabled = 1
     ORDER BY r.priority ASC`
  );
}

async function reconcilePlacementClients(streamType, streamId, serverId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM line_runtime_sessions
     WHERE stream_type = ? AND stream_id = ? AND origin_server_id = ? AND date_end IS NULL`,
    [streamType, String(streamId), serverId]
  );
  const clients = row ? Number(row.c) : 0;
  const status = clients > 0 ? 'running' : 'stopped';
  await execute(
    `UPDATE stream_server_placement
     SET clients = ?, status = ?, updated_at = NOW()
     WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
    [clients, status, streamType, String(streamId), serverId]
  );
}

async function reconcileAllPlacementClients() {
  const activeCounts = await query(
    `SELECT stream_type, stream_id, origin_server_id, COUNT(*) AS c
     FROM line_runtime_sessions
     WHERE date_end IS NULL
     GROUP BY stream_type, stream_id, origin_server_id`
  );

  const countMap = new Map(
    activeCounts.map((r) => [
      `${r.stream_type}:${r.stream_id}:${r.origin_server_id}`,
      Number(r.c),
    ])
  );

  const placements = await query(
    'SELECT stream_type, stream_id, server_id, clients, status FROM stream_server_placement'
  );

  let reconciled = 0;
  for (const p of placements) {
    const key = `${p.stream_type}:${p.stream_id}:${p.server_id}`;
    const expected = countMap.get(key) || 0;
    const currentClients = Number(p.clients) || 0;
    const currentStatus = String(p.status || '');
    const expectedStatus = expected > 0 ? 'running' : 'stopped';
    if (currentClients !== expected || currentStatus !== expectedStatus) {
      await execute(
        `UPDATE stream_server_placement
         SET clients = ?, status = ?, updated_at = NOW()
         WHERE stream_type = ? AND stream_id = ? AND server_id = ?`,
        [
          expected,
          expectedStatus,
          p.stream_type,
          String(p.stream_id),
          p.server_id,
        ]
      );
      reconciled++;
    }
  }
  return reconciled;
}

async function cleanStaleRuntimeSessions(maxAgeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(60, maxAgeSeconds);
  const result = await execute(
    `UPDATE line_runtime_sessions
     SET date_end = ?, last_seen_at = NOW()
     WHERE date_end IS NULL AND last_seen_at < ?`,
    [
      unixSecondsToMysqlDatetime(Math.floor(Date.now() / 1000)),
      unixSecondsToMysqlDatetime(cutoff),
    ]
  );
  return result.affectedRows || 0;
}

async function getProxyRelationships(originServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.private_ip,
            s.enabled AS server_enabled, s.proxy_enabled, s.last_heartbeat_at,
            s.meta_json
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.child_server_id
     WHERE r.parent_server_id = ?
       AND r.relationship_type = 'origin-proxy'
       AND r.enabled = 1
       AND s.enabled = 1
       AND s.proxy_enabled = 1
     ORDER BY r.priority ASC`
  );
}

async function getOriginServersForProxy(proxyServerId) {
  return await query(
    `SELECT r.id, r.parent_server_id, r.child_server_id, r.relationship_type, r.priority, r.enabled,
            s.id AS server_id, s.name, s.public_host, s.public_ip, s.private_ip,
            s.enabled AS server_enabled, s.runtime_enabled, s.last_heartbeat_at,
            s.meta_json
     FROM server_relationships r
     JOIN streaming_servers s ON s.id = r.parent_server_id
     WHERE r.child_server_id = ?
       AND r.relationship_type = 'origin-proxy'
       AND r.enabled = 1
       AND s.enabled = 1
     ORDER BY r.priority ASC`
  );
}

async function createServerCommand({
  serverId,
  streamType,
  streamId,
  placementId,
  commandType,
  payload,
  issuedByUserId,
}) {
  const validTypes = [
    'start_stream',
    'stop_stream',
    'restart_stream',
    'probe_stream',
    'reload_proxy_config',
    'sync_server_config',
    'reconcile_runtime',
    'reconcile_sessions',
    'restart_services',
    'reboot_server',
    'sync_proxy_upstream',
  ];
  if (!validTypes.includes(commandType))
    throw new Error(`invalid command_type: ${commandType}`);
  return await insert(
    `INSERT INTO server_commands
     (server_id, stream_type, stream_id, placement_id, command_type, payload_json, issued_by_user_id, status, attempt_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NOW())`,
    [
      serverId,
      streamType || null,
      streamId != null ? String(streamId) : null,
      placementId || null,
      commandType,
      payload != null ? JSON.stringify(payload) : null,
      issuedByUserId || null,
    ]
  );
}

async function leaseServerCommands(serverId, limit = 5) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  await execute(
    `UPDATE server_commands
     SET status = 'leased', lease_token = ?, lease_expires_at = ?
     WHERE id IN (
       SELECT id FROM (
         SELECT id FROM server_commands
         WHERE server_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT ?
       ) AS sub
     )`,
    [token, expiresAt, serverId, limit]
  );
  return await query(
    `SELECT * FROM server_commands WHERE server_id = ? AND status = 'leased' AND lease_token = ? ORDER BY created_at ASC`,
    [serverId, token]
  );
}

async function markServerCommandRunning(commandId) {
  await execute(
    `UPDATE server_commands SET status = 'running', attempt_count = attempt_count + 1, delivered_at = NOW() WHERE id = ? AND status = 'leased'`,
    [commandId]
  );
}

async function markServerCommandSucceeded(commandId, result) {
  await execute(
    `UPDATE server_commands SET status = 'succeeded', result_json = ?, finished_at = NOW() WHERE id = ?`,
    [result != null ? JSON.stringify(result) : null, commandId]
  );
}

async function markServerCommandFailed(commandId, errorText) {
  await execute(
    `UPDATE server_commands SET status = 'failed', error_text = ?, finished_at = NOW() WHERE id = ?`,
    [errorText || null, commandId]
  );
}

async function expireStaleLeases() {
  await execute(
    `UPDATE server_commands SET status = 'expired' WHERE status = 'leased' AND lease_expires_at < NOW()`
  );
}

async function createServerAgentCredential(serverId, plainSecret) {
  const credentialId = `cred_${crypto.randomBytes(8).toString('hex')}`;
  const secretHash = await hashApiKey(String(plainSecret));
  const id = await insert(
    `INSERT INTO server_agent_credentials
     (server_id, credential_id, secret_hash, status, issued_at)
     VALUES (?, ?, ?, 'active', NOW())`,
    [serverId, credentialId, secretHash]
  );
  return { id, credentialId, plainSecret };
}

async function getActiveServerAgentCredential(serverId) {
  return await queryOne(
    `SELECT * FROM server_agent_credentials WHERE server_id = ? AND status = 'active' ORDER BY issued_at DESC LIMIT 1`,
    [serverId]
  );
}

async function getServerAgentCredentialForValidation(credentialId) {
  return await queryOne(
    `SELECT * FROM server_agent_credentials
     WHERE credential_id = ? AND status IN ('active', 'rotating')
     ORDER BY issued_at DESC LIMIT 1`,
    [credentialId]
  );
}

async function revokeServerAgentCredential(serverId, credentialId) {
  await execute(
    `UPDATE server_agent_credentials SET status = 'revoked' WHERE server_id = ? AND credential_id = ?`,
    [serverId, credentialId]
  );
}

async function touchServerAgentCredential(credentialId) {
  await execute(
    `UPDATE server_agent_credentials SET last_used_at = NOW() WHERE credential_id = ?`,
    [credentialId]
  );
}

async function rotateServerAgentCredential(serverId, plainSecret) {
  const newPlainSecret =
    plainSecret || crypto.randomBytes(24).toString('base64url');
  const newCredentialId = `cred_${crypto.randomBytes(8).toString('hex')}`;
  const newSecretHash = await hashApiKey(newPlainSecret);

  await execute(
    `UPDATE server_agent_credentials SET status = 'rotating', rotated_at = NOW()
     WHERE server_id = ? AND status = 'active'`,
    [serverId]
  );

  const newId = await insert(
    `INSERT INTO server_agent_credentials
     (server_id, credential_id, secret_hash, status, issued_at)
     VALUES (?, ?, ?, 'active', NOW())`,
    [serverId, newCredentialId, newSecretHash]
  );

  const oldCredential = await queryOne(
    `SELECT * FROM server_agent_credentials WHERE server_id = ? AND status = 'rotating' ORDER BY issued_at DESC LIMIT 1`,
    [serverId]
  );

  return {
    newCredential: {
      id: newId,
      credentialId: newCredentialId,
      plainSecret: newPlainSecret,
    },
    oldCredential,
  };
}

async function getValidServerCredentials(serverId) {
  return await query(
    `SELECT id, server_id, credential_id, status, issued_at, rotated_at, last_used_at
     FROM server_agent_credentials
     WHERE server_id = ? AND status IN ('active', 'rotating')
     ORDER BY issued_at DESC`,
    [serverId]
  );
}

async function revokeRotatingCredentials(serverId) {
  const { affectedRows } = await execute(
    `UPDATE server_agent_credentials SET status = 'revoked' WHERE server_id = ? AND status = 'rotating'`,
    [serverId]
  );
  return affectedRows;
}

module.exports = {
  ensureServerRelationshipsTable,
  ensureStreamServerPlacementTable,
  ensureLineRuntimeSessionsTable,
  ensureServerCommandsTable,
  ensureServerAgentCredentialsTable,
  ensureServerProvisioningJobsTable,
  ensureStreamingServersTables,
  addServerRelationship,
  removeServerRelationship,
  getServerRelationships,
  getServerChildren,
  createPlacement,
  updatePlacementClients,
  getPlacement,
  getActivePlacementsForServer,
  upsertPlacementRuntimeState,
  setPlacementDesiredState,
  markPlacementStarting,
  markPlacementRunning,
  markPlacementStopped,
  markPlacementError,
  getPlacementByAsset,
  getPlacementsByServer,
  reportPlacementRuntimeFromNode,
  openRuntimeSession,
  touchRuntimeSession,
  closeRuntimeSession,
  listActiveRuntimeSessionsByServer,
  countActiveRuntimeSessionsByPlacement,
  countActiveRuntimeSessionsByServer,
  getFailoverRelationships,
  getProxyRelationships,
  getOriginServersForProxy,
  reconcilePlacementClients,
  reconcileAllPlacementClients,
  cleanStaleRuntimeSessions,
  createServerCommand,
  leaseServerCommands,
  markServerCommandRunning,
  markServerCommandSucceeded,
  markServerCommandFailed,
  expireStaleLeases,
  createServerAgentCredential,
  getActiveServerAgentCredential,
  getServerAgentCredentialForValidation,
  revokeServerAgentCredential,
  touchServerAgentCredential,
  rotateServerAgentCredential,
  getValidServerCredentials,
  revokeRotatingCredentials,
};
