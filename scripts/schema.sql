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
  `notes` TEXT,
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
  `manage_expiry_media` TINYINT DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS `reseller_package_overrides` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `package_id` INT UNSIGNED NOT NULL,
  `trial_credits_override` DECIMAL(12,2) DEFAULT NULL,
  `official_credits_override` DECIMAL(12,2) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reseller_package_override` (`user_id`, `package_id`),
  KEY `idx_rpo_user` (`user_id`),
  KEY `idx_rpo_package` (`package_id`),
  CONSTRAINT `fk_rpo_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reseller_expiry_media_services` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `warning_window_days` INT UNSIGNED NOT NULL DEFAULT 7,
  `repeat_interval_hours` INT UNSIGNED NOT NULL DEFAULT 6,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rems_user` (`user_id`),
  KEY `idx_rems_user` (`user_id`),
  CONSTRAINT `fk_rems_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reseller_expiry_media_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service_id` INT UNSIGNED NOT NULL,
  `scenario` ENUM('expiring','expired') NOT NULL,
  `country_code` VARCHAR(5) NOT NULL DEFAULT '',
  `media_type` ENUM('video','image') NOT NULL DEFAULT 'video',
  `media_url` VARCHAR(2048) NOT NULL DEFAULT '',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_remi_service` (`service_id`),
  KEY `idx_remi_scenario` (`scenario`),
  CONSTRAINT `fk_remi_service` FOREIGN KEY (`service_id`) REFERENCES `reseller_expiry_media_services` (`id`) ON DELETE CASCADE
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
  `password` VARCHAR(255) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `password_enc` TEXT,
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
  `stream_server_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = inherit from series',
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
  `runtime_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Phase 1 XC Runtime: node can own stream runtime',
  `proxy_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Phase 1 XC Runtime: node can serve as proxy/edge',
  `controller_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Phase 1 XC Runtime: node can dispatch commands',
  -- Edit Server parity fields
  `base_url` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Base URL for client URLs',
  `server_ip` VARCHAR(45) NOT NULL DEFAULT '' COMMENT 'Dedicated server IP',
  `dns_1` VARCHAR(45) NOT NULL DEFAULT '' COMMENT 'Primary DNS server',
  `dns_2` VARCHAR(45) NOT NULL DEFAULT '' COMMENT 'Secondary DNS server',
  `admin_password` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Server admin password',
  `full_duplex` TINYINT(1) NOT NULL DEFAULT 0,
  `boost_fpm` TINYINT(1) NOT NULL DEFAULT 0,
  -- Advanced tab
  `http_port` INT UNSIGNED NOT NULL DEFAULT 8080,
  `https_m3u_lines` TINYINT(1) NOT NULL DEFAULT 0,
  `force_ssl_port` TINYINT(1) NOT NULL DEFAULT 0,
  `https_port` INT UNSIGNED NOT NULL DEFAULT 8083,
  `time_difference` VARCHAR(32) NOT NULL DEFAULT 'Auto',
  `ssh_port` INT UNSIGNED NOT NULL DEFAULT 22,
  `network_interface` VARCHAR(64) NOT NULL DEFAULT 'all',
  `network_speed` VARCHAR(64) NOT NULL DEFAULT '',
  `os_info` VARCHAR(128) NOT NULL DEFAULT '',
  `geoip_load_balancing` TINYINT(1) NOT NULL DEFAULT 0,
  `geoip_countries` TEXT NOT NULL DEFAULT '' COMMENT 'Comma-separated country codes',
  `extra_nginx_config` TEXT NOT NULL DEFAULT '',
  -- Server Guard tab
  `server_guard_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `ip_whitelisting` TINYINT(1) NOT NULL DEFAULT 0,
  `botnet_fighter` TINYINT(1) NOT NULL DEFAULT 0,
  `under_attack` TINYINT(1) NOT NULL DEFAULT 0,
  `connection_limit_ports` VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Comma-separated ports',
  `max_conn_per_ip` INT UNSIGNED NOT NULL DEFAULT 3,
  `max_hits_normal_user` INT UNSIGNED NOT NULL DEFAULT 1,
  `max_hits_restreamer` INT UNSIGNED NOT NULL DEFAULT 1,
  `whitelist_username` TINYINT(1) NOT NULL DEFAULT 0,
  `block_user_minutes` INT UNSIGNED NOT NULL DEFAULT 30,
  `auto_restart_mysql` TINYINT(1) NOT NULL DEFAULT 0,
  -- ISP Manager tab
  `isp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `isp_priority` INT UNSIGNED NOT NULL DEFAULT 1,
  `isp_allowed_names` TEXT NOT NULL DEFAULT '' COMMENT 'Comma-separated ISP names',
  `isp_case_sensitive` ENUM('none','lower','upper') NOT NULL DEFAULT 'lower',
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
  `ssl_port` INT UNSIGNED NOT NULL DEFAULT 443,
  `ssl_status` ENUM('active','expired','missing') NOT NULL DEFAULT 'missing',
  `ssl_expiry` DATE DEFAULT NULL,
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

-- ─── Backups ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `backups` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `filename` VARCHAR(255) NOT NULL,
  `size_bytes` BIGINT UNSIGNED DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `type` ENUM('local','gdrive','dropbox','s3') DEFAULT 'local',
  `cloud_url` TEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Blocked ASNs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `blocked_asns` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asn` VARCHAR(50) NOT NULL,
  `org` VARCHAR(255) DEFAULT '',
  `notes` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asn` (`asn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Login Events (extended with VPN flag) ───────────────────────

CREATE TABLE IF NOT EXISTS `login_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT '',
  `event_type` VARCHAR(50) DEFAULT '',
  `is_vpn` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_le_user` (`user_id`),
  KEY `idx_le_vpn` (`is_vpn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Roles & Permissions (RBAC) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `permissions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `resource` VARCHAR(50) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perm` (`resource`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` INT UNSIGNED NOT NULL,
  `permission_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `permission_id`),
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rp_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Plex Servers ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `plex_servers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `plex_token` VARCHAR(100) DEFAULT '',
  `last_seen` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Server relationships (LB / origin-proxy mapping) ─────────────

CREATE TABLE IF NOT EXISTS `server_relationships` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_server_id` INT UNSIGNED NOT NULL COMMENT 'origin / upstream server',
  `child_server_id` INT UNSIGNED NOT NULL COMMENT 'proxy / edge / child server',
  `relationship_type` ENUM('origin-proxy','lb-member','failover') NOT NULL DEFAULT 'origin-proxy',
  `priority` INT NOT NULL DEFAULT 0 COMMENT 'lower = higher priority',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_server_rel` (`parent_server_id`, `child_server_id`, `relationship_type`),
  KEY `idx_srel_child` (`child_server_id`),
  CONSTRAINT `fk_srel_parent` FOREIGN KEY (`parent_server_id`) REFERENCES `streaming_servers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_srel_child` FOREIGN KEY (`child_server_id`) REFERENCES `streaming_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Stream server placement (per-stream per-server runtime state) ─
-- Phase 1 XC Runtime: evolved with explicit runtime truth fields

CREATE TABLE IF NOT EXISTS `stream_server_placement` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stream_type` ENUM('live','movie','episode') NOT NULL,
  `stream_id` VARCHAR(64) NOT NULL COMMENT 'channel id, movie id, or episode id',
  `server_id` INT UNSIGNED NOT NULL,
  `status` ENUM('planned','starting','running','stopping','stopped','error','stale','orphaned') NOT NULL DEFAULT 'planned',
  `pid` INT UNSIGNED DEFAULT NULL COMMENT 'FFmpeg PID on the server (if applicable)',
  `bitrate_kbps` INT UNSIGNED DEFAULT NULL,
  `clients` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'current viewer count on this server',
  `error_text` TEXT,
  `started_at` DATETIME DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `parent_server_id` INT UNSIGNED NULL COMMENT 'upstream/origin server for relay placements',
  `desired_state` ENUM('stopped','running') NOT NULL DEFAULT 'stopped',
  `runtime_mode` ENUM('origin','relay','direct','archive') NOT NULL DEFAULT 'origin',
  `on_demand` TINYINT(1) NOT NULL DEFAULT 0,
  `monitor_pid` INT UNSIGNED NULL,
  `delay_pid` INT UNSIGNED NULL,
  `runtime_instance_id` VARCHAR(64) NULL,
  `current_source` TEXT NULL,
  `stream_info_json` JSON NULL,
  `compatible` TINYINT(1) NOT NULL DEFAULT 0,
  `video_codec` VARCHAR(64) NULL,
  `audio_codec` VARCHAR(64) NULL,
  `resolution` VARCHAR(64) NULL,
  `ready_at` DATETIME NULL,
  `last_runtime_report_at` DATETIME NULL,
  `last_command_id` BIGINT UNSIGNED NULL,
  `restart_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_code` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_placement` (`stream_type`, `stream_id`, `server_id`),
  KEY `idx_placement_server` (`server_id`, `status`),
  KEY `idx_placement_status` (`status`),
  KEY `idx_placement_runtime_instance` (`runtime_instance_id`),
  CONSTRAINT `fk_placement_server` FOREIGN KEY (`server_id`) REFERENCES `streaming_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Line runtime sessions (active viewer occupancy truth) ─────────────
-- Phase 1 XC Runtime: canonical active session truth, equivalent to XC lines_live

CREATE TABLE IF NOT EXISTS `line_runtime_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `line_id` INT UNSIGNED NOT NULL,
  `stream_type` ENUM('live','movie','episode') NOT NULL,
  `stream_id` VARCHAR(64) NOT NULL,
  `placement_id` INT UNSIGNED NULL,
  `origin_server_id` INT UNSIGNED NULL,
  `proxy_server_id` INT UNSIGNED NULL,
  `container` VARCHAR(20) NOT NULL DEFAULT '',
  `session_uuid` VARCHAR(64) NOT NULL,
  `playback_token` VARCHAR(255) NULL,
  `user_ip` VARCHAR(45) NOT NULL DEFAULT '',
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `date_start` INT UNSIGNED NULL,
  `date_end` INT UNSIGNED NULL,
  `last_seen_at` DATETIME NULL,
  `geoip_country_code` VARCHAR(5) NOT NULL DEFAULT '',
  `isp` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_uuid` (`session_uuid`),
  KEY `idx_lrs_line` (`line_id`),
  KEY `idx_lrs_server` (`origin_server_id`),
  KEY `idx_lrs_placement` (`placement_id`),
  KEY `idx_lrs_last_seen` (`last_seen_at`),
  KEY `idx_lrs_date_start` (`date_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Server commands (command queue truth) ─────────────────────────────
-- Phase 1 XC Runtime: DB-backed command queue, delivered via heartbeat/agent transport

CREATE TABLE IF NOT EXISTS `server_commands` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `server_id` INT UNSIGNED NOT NULL,
  `stream_type` ENUM('live','movie','episode') NULL,
  `stream_id` VARCHAR(64) NULL,
  `placement_id` INT UNSIGNED NULL,
  `command_type` ENUM('start_stream','stop_stream','restart_stream','probe_stream','reload_proxy_config','sync_server_config','reconcile_runtime','reconcile_sessions') NOT NULL,
  `payload_json` JSON NULL,
  `status` ENUM('queued','leased','running','succeeded','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
  `issued_by_user_id` INT UNSIGNED NULL,
  `lease_token` VARCHAR(64) NULL,
  `lease_expires_at` DATETIME NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `result_json` JSON NULL,
  `error_text` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sc_server` (`server_id`, `status`),
  KEY `idx_sc_placement` (`placement_id`),
  KEY `idx_sc_lease_expires` (`lease_expires_at`),
  KEY `idx_sc_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Server agent credentials (per-node auth foundation) ───────────────
-- Phase 1 XC Runtime: explicit per-node credential storage, replaces meta_json secrets

CREATE TABLE IF NOT EXISTS `server_agent_credentials` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `server_id` INT UNSIGNED NOT NULL,
  `credential_id` VARCHAR(64) NOT NULL,
  `secret_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('active','rotating','revoked') NOT NULL DEFAULT 'active',
  `issued_at` DATETIME NOT NULL,
  `rotated_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sac_server_cred` (`server_id`, `credential_id`),
  UNIQUE KEY `uq_sac_credential_id` (`credential_id`),
  KEY `idx_sac_status` (`status`),
  CONSTRAINT `fk_sac_server` FOREIGN KEY (`server_id`) REFERENCES `streaming_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default roles
INSERT IGNORE INTO `roles` (`id`, `name`, `description`) VALUES
  (1, 'admin', 'Full administrator'),
  (2, 'reseller', 'Reseller with limited access'),
  (3, 'user', 'End user');

-- Insert default permissions
INSERT IGNORE INTO `permissions` (`id`, `name`, `resource`, `action`) VALUES
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
  (24, 'server.edit', 'server', 'edit');

-- Admin gets all permissions
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT 1, `id` FROM `permissions`;

SET FOREIGN_KEY_CHECKS = 1;
