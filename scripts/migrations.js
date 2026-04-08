'use strict';

const { queryOne, execute } = require('../lib/mariadb');
const { RELEASE_DATE_MAX_LEN } = require('../lib/mysql-datetime');

async function hasColumn(tableName, columnName) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return !!(row && Number(row.c) > 0);
}

async function hasTable(tableName) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return !!(row && Number(row.c) > 0);
}

async function getColumnDataType(tableName, columnName) {
  return await queryOne(
    `SELECT DATA_TYPE AS data_type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
}

async function ensureIndex(tableName, indexName, ddlSql) {
  if (!(await hasTable(tableName))) return;
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  if (row && Number(row.c) > 0) return;
  await execute(ddlSql);
}

async function migrateUnixTimestampColumnToDatetime({
  tableName,
  columnName,
  columnDefinition,
  zeroIsNull = true,
}) {
  if (!(await hasColumn(tableName, columnName))) return;
  const row = await getColumnDataType(tableName, columnName);
  const dataType = String(row?.data_type || '').toLowerCase();
  if (dataType === 'datetime' || dataType === 'timestamp') return;

  const tempColumn = `tmp_${columnName}_dt`;
  if (await hasColumn(tableName, tempColumn)) {
    await execute(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${tempColumn}\``);
  }

  await execute(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${tempColumn}\` DATETIME NULL AFTER \`${columnName}\``
  );
  await execute(
    `UPDATE \`${tableName}\`
     SET \`${tempColumn}\` = ${
       zeroIsNull
         ? `CASE WHEN \`${columnName}\` IS NULL OR \`${columnName}\` = 0 THEN NULL ELSE FROM_UNIXTIME(\`${columnName}\`) END`
         : `CASE WHEN \`${columnName}\` IS NULL THEN NULL ELSE FROM_UNIXTIME(\`${columnName}\`) END`
     }`
  );
  await execute(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
  await execute(
    `ALTER TABLE \`${tableName}\` CHANGE COLUMN \`${tempColumn}\` \`${columnName}\` ${columnDefinition}`
  );
}

/**
 * Database migration functions extracted from lib/db.js
 * These handle schema changes and default setting insertions for existing installations.
 */

// ─── Column ensure functions ──────────────────────────────────────────

/** Older installs may lack packages.options_json; package save fails without it. */
async function ensurePackagesOptionsJsonColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packages' AND COLUMN_NAME = 'options_json'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      'ALTER TABLE `packages` ADD COLUMN `options_json` TEXT NULL AFTER `output_formats_json`'
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

/** Legacy installs used VARCHAR(20) for release_date; Xtream values can be longer. */
async function ensureMoviesSeriesStreamServerIdColumns() {
  try {
    for (const { table, after } of [
      { table: 'movies', after: 'similar' },
      { table: 'series', after: 'similar' },
    ]) {
      const row = await queryOne(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'stream_server_id'`,
        [table]
      );
      if (row && Number(row.c) > 0) continue;
      await execute(
        `ALTER TABLE \`${table}\` ADD COLUMN \`stream_server_id\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`${after}\``
      );
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

/** Phase 1 LB: add stream_server_id to episodes for per-episode server override. */
async function ensureEpisodesStreamServerIdColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'episodes' AND COLUMN_NAME = 'stream_server_id'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      "ALTER TABLE `episodes` ADD COLUMN `stream_server_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = inherit from series' AFTER `movie_subtitles`"
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

async function ensureReleaseDateColumnsWide() {
  try {
    for (const table of ['movies', 'series']) {
      const row = await queryOne(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'release_date'`,
        [table]
      );
      if (row && Number(row.len) >= RELEASE_DATE_MAX_LEN) continue;
      await execute(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`release_date\` VARCHAR(${RELEASE_DATE_MAX_LEN}) NOT NULL DEFAULT ''`
      );
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/Unknown column|doesn't exist|check that it exists/i.test(msg)) return;
    throw e;
  }
}

// ─── Settings defaults ────────────────────────────────────────────────

async function ensureStreamingPerformanceDefaults() {
  const defaults = [
    ['streaming_prebuffer_enabled', '1'],
    ['streaming_prebuffer_size_mb', '6'],
    ['streaming_prebuffer_on_demand_min_bytes', '2097152'],
    ['streaming_prebuffer_on_demand_max_wait_ms', '3000'],
    ['streaming_ingest_style', 'webapp'],
    ['streaming_low_latency_enabled', '1'],
    ['streaming_minimal_ingest_enabled', '1'],
    ['streaming_prewarm_enabled', '1'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [
      k,
    ]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [
        k,
        v,
      ]);
    }
  }
}

async function ensureDefaultStreamServerIdSetting() {
  const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [
    'default_stream_server_id',
  ]);
  if (!row) {
    await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [
      'default_stream_server_id',
      '0',
    ]);
  }
}

async function ensureAdminFeatureSettingsDefaults() {
  const defaults = [
    ['enable_vpn_detection', '0'],
    ['block_vpn', '0'],
    ['enable_multilogin_detection', '0'],
    ['max_connections_per_line', '1'],
    ['block_vod_download', '0'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [
      k,
    ]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [
        k,
        v,
      ]);
    }
  }
}

async function ensureSettingsParityDefaults() {
  const defaults = [
    ['service_logo_url', ''],
    ['service_logo_sidebar_url', ''],
    ['system_timezone', 'UTC'],
    ['force_epg_timezone', 'UTC'],
    ['enigma2_bouquet_name', 'Example'],
    ['load_balancing_key', ''],
    ['geolite2_version', 'Auto'],
    ['security_patch_level', '5 Levels'],

    ['player_credentials_user', ''],
    ['player_credentials_pass', ''],
    ['tmdb_http', '0'],
    ['new_playlist_without_ts', '1'],
    ['release_parser', 'python'],
    ['logout_on_ip_change', '0'],
    ['cloudflare_connecting_ip', 'HTTP_CF_CONNECTING_IP'],
    ['maximum_login_attempts', '5'],
    ['minimum_password_length', '0'],
    ['default_entries_to_show', '25'],
    ['two_factor_authentication', '0'],
    ['localhost_api', '1'],
    ['dark_mode_login', '0'],
    ['dashboard_stats_enabled', '0'],
    ['stats_interval', '600'],
    ['dashboard_world_map_live', '1'],
    ['dashboard_world_map_activity', '1'],
    ['download_images', '0'],
    ['auto_refresh_default', '1'],
    ['alternate_scandir_cloud', '0'],
    ['show_alert_tickets', '1'],
    ['statistics_enabled', '1'],
    ['disable_get_playlist', '0'],
    ['disable_xml_epg', '0'],
    ['disable_player_api_epg', '0'],

    ['reseller_copyright', ''],
    ['reseller_disable_trials', '0'],
    ['reseller_allow_restrictions', '0'],
    ['reseller_trial_set_date_on_usage', '0'],
    ['reseller_paid_set_date_on_usage', '0'],
    ['reseller_change_usernames', '1'],
    ['reseller_change_own_dns', '0'],
    ['reseller_change_own_email', '0'],
    ['reseller_change_own_password', '1'],
    ['reseller_change_own_language', '1'],
    ['reseller_send_mag_events', '0'],
    ['reseller_use_isplock', '1'],
    ['reseller_use_reset_isp', '1'],
    ['reseller_see_manuals', '1'],
    ['reseller_view_info_dashboard', '0'],
    ['reseller_view_apps_dashboard', '1'],
    ['reseller_convert_mag_to_m3u', '0'],
    ['reseller_deny_same_user_pass', '0'],
    ['reseller_deny_weak_username_password', '0'],
    ['reseller_deny_similar_user_pass', '0'],
    ['reseller_deny_similar_percentage', '80'],
    ['reseller_generating_type', 'random_number'],
    ['reseller_min_chars', '6'],

    ['streaming_main_lb_https', '[]'],
    ['use_https_m3u_lines', '0'],
    ['secure_lb_connection', '0'],
    ['streaming_auto_kick_users', '0'],
    ['category_order_type', 'bouquet'],
    ['streaming_client_prebuffer', '30'],
    ['streaming_restreamer_prebuffer', '0'],
    ['split_clients', 'equally'],
    ['split_by', 'connections'],
    ['analysis_duration', '500000'],
    ['probe_size', '5000000'],
    ['use_custom_name_series_episodes', '0'],
    ['restart_on_audio_loss', '0'],
    ['save_connection_logs', '0'],
    ['save_client_logs', '1'],
    ['case_sensitive_details', '1'],
    ['override_country_with_first', '0'],
    ['enable_xc_firewall', '0'],
    ['enable_isps', '1'],
    ['enable_isp_lock', '0'],
    ['token_revalidate', '0'],
    ['token_validity', ''],
    ['vod_download_speed', '45000'],
    ['vod_download_limit', '20'],
    ['buffer_size_for_reading', '8192'],
    ['block_vpn_proxies_servers', '0'],
    ['always_use_first_working_stream_source', '0'],
    ['stream_down_video_enabled', '0'],
    ['stream_down_video_url', 'Default http video link .ts'],
    ['banned_video_enabled', '0'],
    ['banned_video_url', 'Default http video link .ts'],
    ['expired_video_enabled', '1'],
    ['expired_video_url', 'Default http video link .ts'],
    ['countrylock_video_enabled', '0'],
    ['countrylock_video_url', 'Default http video link .ts'],
    ['max_conn_exceed_video_enabled', '0'],
    ['max_conn_exceed_video_url', 'Default http video link .ts'],
    ['enable_connections_exceed_video_log', '0'],
    ['admin_streaming_ips', ''],
    ['adult_stream_password', ''],
    ['verify_client_ip_during_lb', '0'],
    ['user_connections_red_after_hours', '3'],
    ['restrict_player_api_devices', '0'],
    ['disallow_proxy_types', '[]'],

    ['enable_remote_secure_backups', '0'],
    ['enable_local_backups', '1'],
    ['local_backup_directory', 'data/backups'],
    ['backup_interval_unit', 'hours'],
    ['backups_to_keep', '20'],
  ];
  for (const [k, v] of defaults) {
    const row = await queryOne('SELECT `value` FROM settings WHERE `key` = ?', [
      k,
    ]);
    if (!row) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [
        k,
        v,
      ]);
    }
  }
}

// ─── Table creation functions ─────────────────────────────────────────

async function ensureBackupsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS backups (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      size_bytes BIGINT UNSIGNED DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      type ENUM('local','gdrive','dropbox','s3') DEFAULT 'local',
      cloud_url TEXT,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureBlockedAsnsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS blocked_asns (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      asn VARCHAR(50) NOT NULL,
      org VARCHAR(255) DEFAULT '',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_asn (asn)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureLoginEventsTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS login_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED DEFAULT NULL,
      ip VARCHAR(45) DEFAULT '',
      event_type VARCHAR(50) DEFAULT '',
      is_vpn TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_le_user (user_id),
      KEY idx_le_vpn (is_vpn)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureRolesPermissionsTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) DEFAULT '',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      resource VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_perm (resource, action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INT UNSIGNED NOT NULL,
      permission_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
      CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(
    `INSERT IGNORE INTO roles (id, name, description) VALUES
      (1, 'admin', 'Full administrator'),
      (2, 'reseller', 'Reseller with limited access'),
      (3, 'user', 'End user')`
  );
  await execute(
    `INSERT IGNORE INTO permissions (id, name, resource, action) VALUES
      (1, 'streams.view', 'streams', 'view'),
      (2, 'streams.edit', 'streams', 'edit'),
      (3, 'streams.delete', 'streams', 'delete'),
      (4, 'movies.view', 'movies', 'view'),
      (5, 'movies.edit', 'movies', 'edit'),
      (6, 'movies.delete', 'movies', 'delete'),
      (7, 'series.view', 'series', 'view'),
      (8, 'series.edit', 'series', 'edit'),
      (9, 'series.delete', 'series', 'delete'),
      (10, 'users.view', 'users', 'view'),
      (11, 'users.edit', 'users', 'edit'),
      (12, 'users.delete', 'users', 'delete'),
      (13, 'lines.view', 'lines', 'view'),
      (14, 'lines.edit', 'lines', 'edit'),
      (15, 'lines.delete', 'lines', 'delete'),
      (16, 'backups.view', 'backups', 'view'),
      (17, 'backups.create', 'backups', 'create'),
      (18, 'backups.restore', 'backups', 'restore'),
      (19, 'settings.view', 'settings', 'view'),
      (20, 'settings.edit', 'settings', 'edit'),
      (21, 'security.view', 'security', 'view'),
      (22, 'security.edit', 'security', 'edit'),
      (23, 'server.view', 'server', 'view'),
      (24, 'server.edit', 'server', 'edit')`
  );
  await execute(
    'INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT 1, id FROM permissions'
  );
}

async function ensureUsersNotesColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'notes'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      'ALTER TABLE `users` ADD COLUMN `notes` TEXT NULL AFTER `email`'
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

async function ensureUserGroupsManageExpiryMediaColumn() {
  try {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_groups' AND COLUMN_NAME = 'manage_expiry_media'`
    );
    if (row && Number(row.c) > 0) return;
    await execute(
      'ALTER TABLE `user_groups` ADD COLUMN `manage_expiry_media` TINYINT DEFAULT 0 AFTER `allow_change_bouquets`'
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

async function ensureChannelsVersionColumn() {
  try {
    if (!(await hasColumn('channels', 'version'))) {
      await execute(
        'ALTER TABLE `channels` ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `json_data`'
      );
    }
    await execute(
      'UPDATE `channels` SET `version` = 1 WHERE `version` IS NULL OR `version` < 1'
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('Duplicate column') || /check that it exists/i.test(msg))
      return;
    throw e;
  }
}

async function ensureAuditLogTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED DEFAULT NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50) DEFAULT NULL,
      resource_id VARCHAR(100) DEFAULT NULL,
      ip_address VARCHAR(45) DEFAULT '',
      user_agent TEXT,
      meta JSON,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_user_id (user_id),
      KEY idx_audit_action (action),
      KEY idx_audit_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function dropLegacyLinePasswordColumnIfSafe() {
  if (!(await hasColumn('lines', 'password'))) return;
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM \`lines\`
     WHERE password_hash IS NULL OR password_hash = ''
        OR password_enc IS NULL OR password_enc = ''`
  );
  const incompleteRows = row ? Number(row.c) || 0 : 0;
  if (incompleteRows > 0) {
    throw new Error(
      `Cannot drop legacy lines.password column while ${incompleteRows} rows are missing password_hash/password_enc`
    );
  }
  await execute('ALTER TABLE `lines` DROP COLUMN `password`');
}

async function normalizeLegacyTimestampColumns() {
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'users',
    columnName: 'last_login',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'credits_logs',
    columnName: 'date',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines',
    columnName: 'exp_date',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines',
    columnName: 'created_at',
    columnDefinition: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines',
    columnName: 'last_expiration_video',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines',
    columnName: 'last_activity',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await ensureIndex(
    'lines',
    'idx_lines_exp',
    'ALTER TABLE `lines` ADD KEY `idx_lines_exp` (`exp_date`)'
  );

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines_activity',
    columnName: 'date_start',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'lines_activity',
    columnName: 'date_end',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await ensureIndex(
    'lines_activity',
    'idx_activity_date',
    'ALTER TABLE `lines_activity` ADD KEY `idx_activity_date` (`date_start`)'
  );

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'movies',
    columnName: 'added',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });
  await ensureIndex(
    'movies',
    'idx_movies_added',
    'ALTER TABLE `movies` ADD KEY `idx_movies_added` (`added`)'
  );

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'episodes',
    columnName: 'added',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'epg_data',
    columnName: 'start',
    columnDefinition: 'DATETIME NOT NULL',
    zeroIsNull: false,
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'epg_data',
    columnName: 'stop',
    columnDefinition: 'DATETIME NOT NULL',
    zeroIsNull: false,
  });
  await ensureIndex(
    'epg_data',
    'idx_epg_channel_time',
    'ALTER TABLE `epg_data` ADD KEY `idx_epg_channel_time` (`channel_id`(100), `start`, `stop`)'
  );

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'import_providers',
    columnName: 'last_updated',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'auth_flood',
    columnName: 'last_attempt',
    columnDefinition: 'DATETIME DEFAULT NULL',
  });

  await migrateUnixTimestampColumnToDatetime({
    tableName: 'line_runtime_sessions',
    columnName: 'date_start',
    columnDefinition: 'DATETIME NULL',
  });
  await migrateUnixTimestampColumnToDatetime({
    tableName: 'line_runtime_sessions',
    columnName: 'date_end',
    columnDefinition: 'DATETIME NULL',
  });
  await ensureIndex(
    'line_runtime_sessions',
    'idx_lrs_date_start',
    'ALTER TABLE `line_runtime_sessions` ADD KEY `idx_lrs_date_start` (`date_start`)'
  );
}

async function ensureResellerPackageOverridesTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_package_overrides (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      package_id INT UNSIGNED NOT NULL,
      trial_credits_override DECIMAL(12,2) DEFAULT NULL,
      official_credits_override DECIMAL(12,2) DEFAULT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_reseller_package_override (user_id, package_id),
      KEY idx_rpo_user (user_id),
      KEY idx_rpo_package (package_id),
      CONSTRAINT fk_rpo_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureResellerExpiryMediaTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_expiry_media_services (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      warning_window_days INT UNSIGNED NOT NULL DEFAULT 7,
      repeat_interval_hours INT UNSIGNED NOT NULL DEFAULT 6,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_rems_user (user_id),
      KEY idx_rems_user (user_id),
      CONSTRAINT fk_rems_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS reseller_expiry_media_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      service_id INT UNSIGNED NOT NULL,
      scenario ENUM('expiring','expired') NOT NULL,
      country_code VARCHAR(5) NOT NULL DEFAULT '',
      media_type ENUM('video','image') NOT NULL DEFAULT 'video',
      media_url VARCHAR(2048) NOT NULL DEFAULT '',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_remi_service (service_id),
      KEY idx_remi_scenario (scenario),
      CONSTRAINT fk_remi_service FOREIGN KEY (service_id) REFERENCES reseller_expiry_media_services (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensurePlexServersTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS plex_servers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      url VARCHAR(500) NOT NULL,
      plex_token VARCHAR(100) DEFAULT '',
      last_seen DATETIME DEFAULT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureAdminFeatureTables() {
  await ensureBackupsTable();
  await ensureBlockedAsnsTable();
  await ensureLoginEventsTable();
  await ensureRolesPermissionsTables();
  await ensurePlexServersTable();
  await ensureAdminFeatureSettingsDefaults();
}

// ─── Run all migrations ──────────────────────────────────────────────

/**
 * Run all database migrations.
 * Called at startup after tables are created.
 */
async function runMigrations() {
  // Column alterations
  await ensurePackagesOptionsJsonColumn();
  await ensureMoviesSeriesStreamServerIdColumns();
  await ensureReleaseDateColumnsWide();
  await ensureEpisodesStreamServerIdColumn();
  await ensureUsersNotesColumn();
  await ensureUserGroupsManageExpiryMediaColumn();
  await ensureChannelsVersionColumn();
  await normalizeLegacyTimestampColumns();

  // Settings defaults
  await ensureDefaultStreamServerIdSetting();
  await ensureStreamingPerformanceDefaults();
  await ensureSettingsParityDefaults();

  // Table creation + seeded data
  await ensureAdminFeatureTables();
  await ensureResellerPackageOverridesTable();
  await ensureResellerExpiryMediaTables();
  await ensureAuditLogTable();
}

module.exports = {
  runMigrations,
  // Export individual functions for cases where only one is needed
  ensurePackagesOptionsJsonColumn,
  ensureMoviesSeriesStreamServerIdColumns,
  ensureEpisodesStreamServerIdColumn,
  ensureReleaseDateColumnsWide,
  ensureStreamingPerformanceDefaults,
  ensureDefaultStreamServerIdSetting,
  ensureAdminFeatureSettingsDefaults,
  ensureSettingsParityDefaults,
  ensureBackupsTable,
  ensureBlockedAsnsTable,
  ensureLoginEventsTable,
  ensureRolesPermissionsTables,
  ensureUsersNotesColumn,
  ensureUserGroupsManageExpiryMediaColumn,
  ensureChannelsVersionColumn,
  ensureAuditLogTable,
  normalizeLegacyTimestampColumns,
  dropLegacyLinePasswordColumnIfSafe,
  ensureResellerPackageOverridesTable,
  ensureResellerExpiryMediaTables,
  ensurePlexServersTable,
  ensureAdminFeatureTables,
};
