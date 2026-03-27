-- IPTV Panel MariaDB Schema
-- Optimized for high-performance with proper indexes

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── Panel admin/reseller users ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) DEFAULT '',
  `member_group_id` INT UNSIGNED DEFAULT 1,
  `credits` DECIMAL(12,2) DEFAULT 0.00,
  `status` TINYINT DEFAULT 1,
  `reseller_dns` VARCHAR(255) DEFAULT '',
  `owner_id` INT UNSIGNED DEFAULT 0,
  `theme` TINYINT DEFAULT 0,
  `lang` VARCHAR(10) DEFAULT 'en',
  `api_key` VARCHAR(255) DEFAULT '',
  `last_login` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── User groups ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `user_groups` (
  `group_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `group_name` VARCHAR(255) NOT NULL,
  `is_admin` TINYINT DEFAULT 0,
  `is_reseller` TINYINT DEFAULT 0,
  `total_allowed_gen_trials` INT DEFAULT 0,
  `total_allowed_gen_in` VARCHAR(20) DEFAULT 'day',
  `delete_users` TINYINT DEFAULT 0,
  `allowed_pages` TEXT,
  `can_delete` TINYINT DEFAULT 1,
  `create_sub_resellers` TINYINT DEFAULT 0,
  `create_sub_resellers_price` DECIMAL(12,2) DEFAULT 0.00,
  `reseller_client_connection_logs` TINYINT DEFAULT 1,
  `can_view_vod` TINYINT DEFAULT 1,
  `allow_download` TINYINT DEFAULT 1,
  `minimum_trial_credits` INT DEFAULT 1,
  `allow_restrictions` TINYINT DEFAULT 1,
  `allow_change_username` TINYINT DEFAULT 1,
  `allow_change_password` TINYINT DEFAULT 1,
  `minimum_username_length` INT DEFAULT 8,
  `minimum_password_length` INT DEFAULT 8,
  `allow_change_bouquets` TINYINT DEFAULT 0,
  `notice_html` TEXT,
  `subresellers` TEXT,
  PRIMARY KEY (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Credits logs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `credits_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_id` INT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `amount` DECIMAL(12,2) DEFAULT NULL,
  `date` INT UNSIGNED DEFAULT NULL,
  `reason` TEXT,
  PRIMARY KEY (`id`),
  KEY `idx_credits_logs_target` (`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── API keys ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `key_hash` VARCHAR(64) NOT NULL,
  `key_prefix` VARCHAR(20) NOT NULL,
  `label` VARCHAR(255) DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_apikeys_hash` (`key_hash`),
  KEY `idx_apikeys_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Subscriber lines ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `lines` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_id` INT UNSIGNED DEFAULT NULL,
  `username` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `last_ip` VARCHAR(45) DEFAULT '',
  `exp_date` INT UNSIGNED DEFAULT NULL,
  `admin_enabled` TINYINT DEFAULT 1,
  `enabled` TINYINT DEFAULT 1,
  `admin_notes` TEXT,
  `reseller_notes` TEXT,
  `bouquet` TEXT,
  `allowed_outputs` TEXT,
  `max_connections` INT DEFAULT 1,
  `is_restreamer` TINYINT DEFAULT 0,
  `is_trial` TINYINT DEFAULT 0,
  `is_mag` TINYINT DEFAULT 0,
  `is_e2` TINYINT DEFAULT 0,
  `is_stalker` TINYINT DEFAULT 0,
  `is_isplock` TINYINT DEFAULT 0,
  `allowed_ips` TEXT,
  `allowed_ua` TEXT,
  `created_at` INT UNSIGNED DEFAULT NULL,
  `pair_id` INT UNSIGNED DEFAULT NULL,
  `force_server_id` INT DEFAULT 0,
  `as_number` VARCHAR(50) DEFAULT '',
  `isp_desc` VARCHAR(255) DEFAULT '',
  `forced_country` VARCHAR(10) DEFAULT '',
  `bypass_ua` TINYINT DEFAULT 0,
  `play_token` VARCHAR(255) DEFAULT '',
  `last_expiration_video` INT UNSIGNED DEFAULT NULL,
  `package_id` INT UNSIGNED DEFAULT NULL,
  `access_token` VARCHAR(64) DEFAULT NULL,
  `contact` VARCHAR(255) DEFAULT '',
  `last_activity` INT UNSIGNED DEFAULT NULL,
  `last_activity_array` TEXT,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lines_username` (`username`),
  KEY `idx_lines_username` (`username`),
  KEY `idx_lines_member` (`member_id`),
  KEY `idx_lines_exp` (`exp_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Lines activity (history only, not live tracking) ─────────────────

CREATE TABLE IF NOT EXISTS `lines_activity` (
  `activity_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `stream_id` INT UNSIGNED DEFAULT NULL,
  `server_id` INT DEFAULT 0,
  `user_agent` VARCHAR(512) DEFAULT '',
  `user_ip` VARCHAR(45) DEFAULT '',
  `container` VARCHAR(20) DEFAULT '',
  `date_start` INT UNSIGNED DEFAULT NULL,
  `date_end` INT UNSIGNED DEFAULT NULL,
  `geoip_country_code` VARCHAR(5) DEFAULT '',
  `isp` VARCHAR(255) DEFAULT '',
  PRIMARY KEY (`activity_id`),
  KEY `idx_activity_user` (`user_id`),
  KEY `idx_activity_date` (`date_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Channels (restream engine) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS `channels` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `json_data` MEDIUMTEXT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_channels_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Channel health ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `channel_health` (
  `channel_id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `stability_score` INT DEFAULT 100,
  `last_checked` DATETIME DEFAULT NULL,
  `status_text` VARCHAR(100) DEFAULT 'Stable',
  `meta_json` TEXT,
  PRIMARY KEY (`channel_id`),
  KEY `idx_ch_health_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── QoE metrics ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `qoe_metrics` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel_id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `startup_ms` INT DEFAULT 0,
  `buffer_events` INT DEFAULT 0,
  `buffer_duration_ms` INT DEFAULT 0,
  `errors` INT DEFAULT 0,
  `latency_ms` INT DEFAULT 0,
  `bitrate_switches` INT DEFAULT 0,
  `dropped_frames` INT DEFAULT 0,
  `playback_ms` INT DEFAULT 0,
  `qoe_score` INT DEFAULT 100,
  PRIMARY KEY (`id`),
  KEY `idx_qoe_channel` (`channel_id`, `created_at`),
  KEY `idx_qoe_user` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── QoE aggregation ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `qoe_agg` (
  `channel_id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `last_qoe_at` DATETIME DEFAULT NULL,
  `qoe_score` INT DEFAULT 100,
  `final_score` INT DEFAULT 100,
  `avg_startup_ms` DOUBLE DEFAULT 0,
  `avg_buffer_ratio` DOUBLE DEFAULT 0,
  `avg_latency_ms` DOUBLE DEFAULT 0,
  PRIMARY KEY (`channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Stream categories ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `stream_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_type` VARCHAR(20) NOT NULL DEFAULT 'live',
  `category_name` VARCHAR(255) NOT NULL,
  `parent_id` INT UNSIGNED DEFAULT 0,
  `cat_order` INT DEFAULT 0,
  `is_adult` TINYINT DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_categories_type` (`category_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Bouquets ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `bouquets` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bouquet_name` VARCHAR(255) NOT NULL,
  `bouquet_channels` MEDIUMTEXT,
  `bouquet_movies` MEDIUMTEXT,
  `bouquet_radios` MEDIUMTEXT,
  `bouquet_series` MEDIUMTEXT,
  `bouquet_order` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Packages ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `packages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `package_name` VARCHAR(255) NOT NULL,
  `is_addon` TINYINT DEFAULT 0,
  `is_trial` TINYINT DEFAULT 0,
  `is_official` TINYINT DEFAULT 0,
  `trial_credits` DECIMAL(12,2) DEFAULT 0.00,
  `official_credits` DECIMAL(12,2) DEFAULT 0.00,
  `trial_duration` INT DEFAULT 0,
  `trial_duration_in` VARCHAR(20) DEFAULT 'day',
  `official_duration` INT DEFAULT 0,
  `official_duration_in` VARCHAR(20) DEFAULT 'month',
  `groups_json` TEXT,
  `bouquets_json` TEXT,
  `output_formats_json` TEXT,
  `options_json` TEXT,
  `max_connections` INT DEFAULT 1,
  `forced_country` VARCHAR(10) DEFAULT '',
  `is_line` TINYINT DEFAULT 1,
  `is_mag` TINYINT DEFAULT 0,
  `is_e2` TINYINT DEFAULT 0,
  `is_restreamer` TINYINT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Movies (VOD) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `movies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(500) NOT NULL,
  `stream_url` TEXT,
  `stream_source` TEXT,
  `category_id` VARCHAR(255) DEFAULT '',
  `stream_icon` TEXT,
  `rating` VARCHAR(20) DEFAULT '0',
  `rating_5based` DECIMAL(3,1) DEFAULT 0.0,
  `plot` TEXT,
  `movie_cast` TEXT,
  `director` VARCHAR(500) DEFAULT '',
  `genre` VARCHAR(500) DEFAULT '',
  `duration` VARCHAR(50) DEFAULT '',
  `duration_secs` INT DEFAULT 0,
  `container_extension` VARCHAR(20) DEFAULT 'mp4',
  `movie_properties` TEXT,
  `tmdb_id` INT UNSIGNED DEFAULT NULL,
  `backdrop_path` TEXT,
  `year` SMALLINT UNSIGNED DEFAULT NULL,
  `subtitles_json` TEXT,
  `release_date` VARCHAR(255) DEFAULT '',
  `youtube_trailer` VARCHAR(255) DEFAULT '',
  `country` VARCHAR(100) DEFAULT '',
  `similar` TEXT,
  `stream_server_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `added` INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_movies_category` (`category_id`(100)),
  KEY `idx_movies_added` (`added`),
  KEY `idx_movies_name` (`name`(100)),
  KEY `idx_movies_tmdb` (`tmdb_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Series ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `series` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(500) NOT NULL,
  `category_id` VARCHAR(255) DEFAULT '',
  `cover` TEXT,
  `cover_big` TEXT,
  `plot` TEXT,
  `series_cast` TEXT,
  `director` VARCHAR(500) DEFAULT '',
  `genre` VARCHAR(500) DEFAULT '',
  `rating` VARCHAR(20) DEFAULT '0',
  `rating_5based` DECIMAL(3,1) DEFAULT 0.0,
  `release_date` VARCHAR(255) DEFAULT '',
  `tmdb_id` INT UNSIGNED DEFAULT NULL,
  `backdrop_path` TEXT,
  `year` SMALLINT UNSIGNED DEFAULT NULL,
  `youtube_trailer` VARCHAR(255) DEFAULT '',
  `episode_run_time` INT DEFAULT 0,
  `seasons` TEXT,
  `similar` TEXT,
  `stream_server_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_modified` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_series_category` (`category_id`(100)),
  KEY `idx_series_title` (`title`(100)),
  KEY `idx_series_tmdb` (`tmdb_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Episodes ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `episodes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `series_id` INT UNSIGNED NOT NULL,
  `season_num` INT NOT NULL DEFAULT 1,
  `episode_num` INT NOT NULL DEFAULT 1,
  `title` VARCHAR(500) DEFAULT '',
  `stream_url` TEXT,
  `stream_source` TEXT,
  `direct_source` TINYINT DEFAULT 0,
  `container_extension` VARCHAR(20) DEFAULT 'mp4',
  `info_json` TEXT,
  `movie_properties` TEXT,
  `movie_subtitles` TEXT,
  `added` INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_episodes_series` (`series_id`),
  KEY `idx_episodes_season` (`series_id`, `season_num`, `episode_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── EPG sources ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `epg_sources` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) DEFAULT '',
  `url` TEXT NOT NULL,
  `last_updated` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── EPG data ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `epg_data` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel_id` VARCHAR(255) NOT NULL,
  `title` VARCHAR(500) DEFAULT '',
  `description` TEXT,
  `start` INT UNSIGNED NOT NULL,
  `stop` INT UNSIGNED NOT NULL,
  `lang` VARCHAR(10) DEFAULT 'en',
  PRIMARY KEY (`id`),
  KEY `idx_epg_channel_time` (`channel_id`(100), `start`, `stop`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Settings ────────────────────────────────────────────────────────

-- Panel key/value (includes streaming_* keys for MPEG-TS prebuffer / ingest; see Settings UI Streaming Performance)
CREATE TABLE IF NOT EXISTS `settings` (
  `key` VARCHAR(100) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Blocked IPs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `blocked_ips` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip` VARCHAR(45) NOT NULL,
  `notes` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_blocked_ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Blocked user agents ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `blocked_uas` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_agent` VARCHAR(512) NOT NULL,
  `notes` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Blocked ISPs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `blocked_isps` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `isp` VARCHAR(255) NOT NULL,
  `notes` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Output formats ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `output_formats` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `output_key` VARCHAR(50) NOT NULL,
  `output_name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_output_key` (`output_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Panel logs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `panel_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(100) DEFAULT '',
  `target_type` VARCHAR(50) DEFAULT '',
  `target_id` VARCHAR(100) DEFAULT '',
  `details` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_panel_logs_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Stream arguments ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `stream_arguments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `argument_cat` VARCHAR(50) DEFAULT 'fetch',
  `argument_name` VARCHAR(255) DEFAULT '',
  `argument_description` TEXT,
  `argument_wprotocol` VARCHAR(50) DEFAULT '',
  `argument_key` VARCHAR(100) DEFAULT NULL,
  `argument_cmd` TEXT,
  `argument_type` VARCHAR(20) DEFAULT 'text',
  `argument_default_value` TEXT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arg_key` (`argument_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Profiles ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_name` VARCHAR(255) NOT NULL,
  `profile_options` TEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Transcode Profiles ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `transcode_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `output_mode` ENUM('copy','transcode') DEFAULT 'copy',
  `video_encoder` VARCHAR(30) DEFAULT 'cpu_x264',
  `x264_preset` VARCHAR(20) DEFAULT 'veryfast',
  `rendition_mode` ENUM('single','multi') DEFAULT 'single',
  `renditions` JSON,
  `audio_bitrate_k` INT DEFAULT 128,
  `hls_segment_seconds` INT DEFAULT 4,
  `hls_playlist_size` INT DEFAULT 10,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Import providers (Xtream automation) ─────────────────────────────

CREATE TABLE IF NOT EXISTS `import_providers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `url` TEXT NOT NULL,
  `bouquet_id` INT DEFAULT 0,
  `update_frequency` INT DEFAULT 0 COMMENT 'hours; 0 = off',
  `last_updated` BIGINT DEFAULT 0,
  `movie_categories` JSON DEFAULT NULL,
  `series_categories` JSON DEFAULT NULL,
  `live_categories` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Access codes (XC-style URL gateway) ──────────────────────────────

CREATE TABLE IF NOT EXISTS `access_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','reseller') NOT NULL DEFAULT 'admin',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `description` VARCHAR(255) DEFAULT '',
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_access_codes_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Auth flood ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `auth_flood` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip` VARCHAR(45) NOT NULL,
  `username` VARCHAR(255) DEFAULT '',
  `attempts` INT DEFAULT 1,
  `last_attempt` INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auth_flood_ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Streaming servers / LB (panel metadata; edge proxies upstream) ─

CREATE TABLE IF NOT EXISTS `streaming_servers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `role` ENUM('main','lb','edge') NOT NULL DEFAULT 'edge',
  `public_host` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'hostname used in client URLs',
  `public_ip` VARCHAR(45) NOT NULL DEFAULT '',
  `private_ip` VARCHAR(45) NOT NULL DEFAULT '',
  `max_clients` INT DEFAULT 0 COMMENT '0 = unlimited',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `proxied` TINYINT(1) NOT NULL DEFAULT 0,
  `timeshift_only` TINYINT(1) NOT NULL DEFAULT 0,
  `network_mbps_cap` INT DEFAULT 0 COMMENT '0 = no cap',
  `sort_order` INT NOT NULL DEFAULT 0,
  `meta_json` JSON DEFAULT NULL,
  `last_heartbeat_at` DATETIME DEFAULT NULL,
  `health_cpu_pct` DECIMAL(5,2) DEFAULT NULL,
  `health_mem_pct` DECIMAL(5,2) DEFAULT NULL,
  `health_net_mbps` DECIMAL(12,4) DEFAULT NULL,
  `health_ping_ms` DECIMAL(10,2) DEFAULT NULL,
  `agent_version` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_streaming_servers_role` (`role`, `enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `streaming_server_domains` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `server_id` INT UNSIGNED NOT NULL,
  `domain` VARCHAR(255) NOT NULL DEFAULT '',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ssd_server` (`server_id`),
  CONSTRAINT `fk_ssd_server` FOREIGN KEY (`server_id`) REFERENCES `streaming_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Server provisioning jobs (SSH install wizard) ─────────────────

CREATE TABLE IF NOT EXISTS `server_provisioning_jobs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `server_id` INT UNSIGNED NOT NULL,
  `status` ENUM('pending','running','done','error') NOT NULL DEFAULT 'pending',
  `log` TEXT,
  `error` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spj_server` (`server_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
