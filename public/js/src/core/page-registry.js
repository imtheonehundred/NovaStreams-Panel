// Page registry - ES6 exports converted from IIFE pattern
// Source: public/js/modules/page-registry.js
// Note: This module is also used server-side by routes/registerPortalRoutes.js

export const RESERVED_GATEWAY_SEGMENTS = Object.freeze([
  'api', 'streams', 'live', 'drm', 'get.php', 'css', 'js', 'assets', 'watermarks', 'logs', 'favicon.ico', 'healthz', 'readyz',
]);

export const ADMIN_PAGE_SECTION_MAP = Object.freeze({
  'add-user': 'line-form',
  'manage-users': 'lines',
  'add-registered-user': 'registered-user-form',
  resellers: 'registered-users',
  'manage-channels': 'streams',
  'stream-import-tools': 'stream-import',
});

export const ADMIN_PAGE_ALIASES = Object.freeze({
  resellers: 'registered-users',
  streams: 'manage-channels',
  'stream-import': 'stream-import-tools',
});

export const ADMIN_CATEGORY_PAGE_MAP = Object.freeze({
  'categories-channels': 'live',
  'categories-movies': 'movie',
  'categories-series': 'series',
});

export const ADMIN_PORTAL_PAGE_SEGMENTS = Object.freeze([
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

export const RESELLER_PORTAL_PAGE_SEGMENTS = Object.freeze([
  'dashboard',
  'lines',
  'profile',
  'line-form',
  'expiry-media',
]);

export function normalizePageKey(raw) {
  return String(raw || '').replace(/^#/, '').split('?')[0].trim();
}

export function getCanonicalAdminPageState(page) {
  const normalized = normalizePageKey(page);
  return {
    page: ADMIN_CATEGORY_PAGE_MAP[normalized] ? 'categories' : (ADMIN_PAGE_ALIASES[normalized] || normalized),
    categoryType: ADMIN_CATEGORY_PAGE_MAP[normalized] || null,
  };
}

export function getAdminPageSectionId(page) {
  const canonical = getCanonicalAdminPageState(page);
  return ADMIN_PAGE_SECTION_MAP[canonical.page] || canonical.page;
}

export function getKnownAdminPageKeys(sectionIds) {
  const keys = new Set(ADMIN_PORTAL_PAGE_SEGMENTS);
  Object.keys(ADMIN_PAGE_ALIASES).forEach(key => keys.add(key));
  Object.keys(ADMIN_CATEGORY_PAGE_MAP).forEach(key => keys.add(key));
  (Array.isArray(sectionIds) ? sectionIds : []).forEach(key => {
    const normalized = normalizePageKey(key);
    if (normalized) keys.add(normalized);
  });
  return [...keys];
}

export function isKnownAdminPageKey(page, sectionIds) {
  const normalized = normalizePageKey(page);
  if (!normalized) return false;
  return new Set(getKnownAdminPageKeys(sectionIds)).has(normalized);
}
