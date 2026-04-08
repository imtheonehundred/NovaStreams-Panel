'use strict';

// Server-side page registry - CJS version of public/js/src/core/page-registry.js
// Used by routes/registerPortalRoutes.js

const RESERVED_GATEWAY_SEGMENTS = Object.freeze([
  'api', 'streams', 'live', 'drm', 'get.php', 'css', 'js', 'assets', 'watermarks', 'logs', 'favicon.ico', 'healthz', 'readyz',
]);

const ADMIN_PAGE_SECTION_MAP = Object.freeze({
  'add-user': 'line-form',
  'manage-users': 'lines',
  'add-registered-user': 'registered-user-form',
  resellers: 'registered-users',
  'manage-channels': 'streams',
  'stream-import-tools': 'stream-import',
});

const ADMIN_PAGE_ALIASES = Object.freeze({
  resellers: 'registered-users',
  streams: 'manage-channels',
  'stream-import': 'stream-import-tools',
});

const ADMIN_CATEGORY_PAGE_MAP = Object.freeze({
  'categories-channels': 'live',
  'categories-movies': 'movie',
  'categories-series': 'series',
});

const ADMIN_PORTAL_PAGE_SEGMENTS = Object.freeze([
  'dashboard',
  'lines',
  'manage-users',
  'add-user',
  'line-form',
  'line-stats',
  'movies',
  'movie-import',
  'series',
  'series-form',
  'series-import',
  'episodes',
  'streams',
  'stream-import',
  'drm-streams',
  'add-channels',
  'manage-channels',
  'monitor-top-channels',
  'stream-import-tools',
  'providers',
  'import-users',
  'import-content',
  'categories',
  'categories-channels',
  'categories-movies',
  'categories-series',
  'bouquets',
  'packages',
  'transcode-profiles',
  'resellers',
  'registered-users',
  'add-registered-user',
  'registered-user-form',
  'member-groups',
  'member-group-form',
  'expiry-media',
  'expiry-media-edit',
  'users',
  'epg',
  'servers',
  'server-edit',
  'install-lb',
  'install-proxy',
  'manage-proxy',
  'server-order',
  'server-monitor',
  'bandwidth-monitor',
  'live-connections',
  'live-connections-map',
  'settings',
  'security',
  'monitor',
  'sharing',
  'backups',
  'plex',
  'logs',
  'access-codes',
  'db-manager',
]);

const RESELLER_PORTAL_PAGE_SEGMENTS = Object.freeze([
  'dashboard',
  'lines',
  'profile',
  'line-form',
  'expiry-media',
]);

module.exports = {
  RESERVED_GATEWAY_SEGMENTS,
  ADMIN_PAGE_SECTION_MAP,
  ADMIN_PAGE_ALIASES,
  ADMIN_CATEGORY_PAGE_MAP,
  ADMIN_PORTAL_PAGE_SEGMENTS,
  RESELLER_PORTAL_PAGE_SEGMENTS,
};
