-- IPTV Panel - Database Performance Indexes
-- Run this script to add missing indexes for query performance.
-- Safe to run on production - only adds indexes, does not modify data.

-- ============================================================
-- auth_flood table - anti-brute-force queries
-- ============================================================
-- Speed up: SELECT * FROM auth_flood WHERE ip = ? AND last_attempt > ?
CREATE INDEX idx_auth_flood_ip_time ON auth_flood(ip, last_attempt);

-- Speed up: SELECT * FROM auth_flood WHERE ip = ? AND username = ?
CREATE INDEX idx_auth_flood_ip_user ON auth_flood(ip, username);

-- ============================================================
-- lines table - subscriber lookups (most frequent query)
-- ============================================================
-- Speed up: SELECT * FROM lines WHERE username = ?
CREATE INDEX idx_lines_username ON lines(username);

-- Speed up: SELECT * FROM lines WHERE member_id = ?
CREATE INDEX idx_lines_member_id ON lines(member_id);

-- Speed up: line activity updates
CREATE INDEX idx_lines_last_activity ON lines(last_activity);

-- ============================================================
-- lines_activity table - connection tracking
-- ============================================================
-- Speed up: SELECT * FROM lines_activity WHERE user_id = ? ORDER BY date_start DESC LIMIT ?
CREATE INDEX idx_activity_user_time ON lines_activity(user_id, date_start);

-- Speed up: SELECT * FROM lines_activity WHERE server_id = ?
CREATE INDEX idx_activity_server ON lines_activity(server_id);

-- ============================================================
-- channels table - restream engine
-- ============================================================
-- Speed up: SELECT * FROM channels WHERE user_id = ?
CREATE INDEX idx_channels_user_id ON channels(user_id);

-- Speed up: status-based queries for monitoring
CREATE INDEX idx_channels_status ON channels(status);

-- ============================================================
-- channel_health table - stability monitoring
-- ============================================================
-- Speed up: SELECT * FROM channel_health WHERE channel_id = ? AND user_id = ?
CREATE INDEX idx_channel_health_channel_user ON channel_health(channel_id, user_id);

-- ============================================================
-- qoe_metrics table - stream quality metrics
-- ============================================================
-- Speed up: SELECT * FROM qoe_metrics WHERE channel_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?
CREATE INDEX idx_qoe_channel_user ON qoe_metrics(channel_id, user_id);

-- Speed up: time-based cleanup queries
CREATE INDEX idx_qoe_created ON qoe_metrics(created_at);

-- ============================================================
-- qoe_agg table - aggregated QoE
-- ============================================================
-- Speed up: SELECT * FROM qoe_agg WHERE channel_id = ? AND user_id = ?
CREATE INDEX idx_qoe_agg_channel_user ON qoe_agg(channel_id, user_id);

-- ============================================================
-- movies / series / episodes - VOD catalog
-- ============================================================
CREATE INDEX idx_movies_category ON movies(category_id);
CREATE INDEX idx_series_category ON series(category_id);
CREATE INDEX idx_episodes_series ON episodes(series_id);

-- ============================================================
-- epg_data table - program guide
-- ============================================================
-- Speed up: SELECT * FROM epg_data WHERE channel_id = ? AND stop > ? AND start < ? ORDER BY start
CREATE INDEX idx_epg_channel_time ON epg_data(channel_id, stop, start);

-- ============================================================
-- panel_logs table - audit trail
-- ============================================================
-- Speed up: SELECT * FROM panel_logs ORDER BY id DESC LIMIT ?
CREATE INDEX idx_panel_logs_id ON panel_logs(id);

-- Speed up: SELECT * FROM panel_logs WHERE user_id = ?
CREATE INDEX idx_panel_logs_user ON panel_logs(user_id);

-- ============================================================
-- credits_logs table - billing/credits history
-- ============================================================
-- Speed up: SELECT * FROM credits_logs WHERE target_id = ? ORDER BY id DESC LIMIT ?
CREATE INDEX idx_credits_target ON credits_logs(target_id, id);

-- ============================================================
-- streaming_servers table - server registry
-- ============================================================
-- Speed up: SELECT * FROM streaming_servers WHERE role = ? AND enabled = ? ORDER BY sort_order
CREATE INDEX idx_servers_role_enabled ON streaming_servers(role, enabled, sort_order);

-- ============================================================
-- settings table - already has PRIMARY key on `key`
-- ============================================================
-- No changes needed

-- ============================================================
-- users table - already has PRIMARY key on `id`
-- ============================================================
-- Add index for username lookups (used in auth)
CREATE INDEX idx_users_username ON users(username);

-- ============================================================
-- blocked_ips / blocked_uas - security blocklists
-- ============================================================
CREATE INDEX idx_blocked_ips_ip ON blocked_ips(ip);
CREATE INDEX idx_blocked_uas_ua ON blocked_uas(user_agent);

-- ============================================================
-- Verification query
-- ============================================================
-- Run this to verify indexes were created:
-- SHOW INDEX FROM auth_flood;
-- SHOW INDEX FROM lines;
-- SHOW INDEX FROM channels;
