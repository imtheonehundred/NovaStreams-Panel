(function () {
  'use strict';

  const root = window.AdminCoreModules = window.AdminCoreModules || {};

  function normalizePageKey(raw) {
    return String(raw || '').replace(/^#/, '').split('?')[0].trim();
  }

  function parseAdminHashRoute(rawHash) {
    const raw = String(rawHash || '').replace(/^#/, '').trim();
    if (!raw) return { page: '', params: new URLSearchParams() };
    const qIndex = raw.indexOf('?');
    if (qIndex === -1) return { page: normalizePageKey(raw), params: new URLSearchParams() };
    return {
      page: normalizePageKey(raw.slice(0, qIndex)),
      params: new URLSearchParams(raw.slice(qIndex + 1)),
    };
  }

  function getPortalPathSegments(pathname) {
    return String(pathname || '').split('/').filter(Boolean);
  }

  function getPortalBasePath(pathname) {
    const resolvedPath = pathname || (typeof window !== 'undefined' && window.location ? window.location.pathname : '');
    const segments = getPortalPathSegments(resolvedPath);
    return segments.length ? `/${segments[0]}` : '';
  }

  function getKnownAdminPageKeys() {
    const keys = new Set();
    document.querySelectorAll('section.page[id^="page-"]').forEach((section) => {
      keys.add(section.id.slice(5));
    });
    return keys;
  }

  function isKnownAdminPageKey(page) {
    const normalized = normalizePageKey(page);
    if (!normalized) return false;
    if (['add-user', 'manage-users', 'import-users', 'resellers', 'add-registered-user', 'manage-channels', 'stream-import-tools'].includes(normalized)) return true;
    if (normalized === 'categories-channels' || normalized === 'categories-movies' || normalized === 'categories-series') return true;
    return getKnownAdminPageKeys().has(normalized);
  }

  function getCanonicalAdminPageState(page) {
    const normalized = normalizePageKey(page);
    const categoryAliases = {
      'categories-channels': 'live',
      'categories-movies': 'movie',
      'categories-series': 'series',
    };
    const pageAliases = {
      resellers: 'registered-users',
      streams: 'manage-channels',
      'stream-import': 'stream-import-tools',
    };
    return {
      page: categoryAliases[normalized] ? 'categories' : (pageAliases[normalized] || normalized),
      categoryType: categoryAliases[normalized] || null,
    };
  }

  function getAdminPageFromPath(pathname) {
    const resolvedPath = pathname || (typeof window !== 'undefined' && window.location ? window.location.pathname : '');
    const segments = getPortalPathSegments(resolvedPath);
    return segments.length >= 2 ? normalizePageKey(segments[1]) : '';
  }

  function parsePositiveInt(raw) {
    const value = parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getServerMonitorQueryId(search) {
    const resolvedSearch = search || (typeof window !== 'undefined' && window.location ? window.location.search : '');
    const params = new URLSearchParams(resolvedSearch);
    return parsePositiveInt(params.get('server') || params.get('id'));
  }

  function buildAdminPageUrl(page, options = {}) {
    const canonical = getCanonicalAdminPageState(page);
    const basePath = getPortalBasePath();
    const targetPage = canonical.page || 'dashboard';
    const params = new URLSearchParams();
    const serverId = parsePositiveInt(options.serverId);
    if (targetPage === 'server-monitor' && serverId) params.set('server', String(serverId));
    const query = params.toString();
    return `${basePath}/${targetPage}${query ? `?${query}` : ''}`;
  }

  function syncAdminRouteLinks() {
    document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
      link.setAttribute('href', buildAdminPageUrl(link.dataset.page));
    });
  }

  function getRequestedAdminRoute(options = {}) {
    const opts = options || {};
    const hashRoute = opts.ignoreHash ? { page: '', params: new URLSearchParams() } : parseAdminHashRoute(typeof window !== 'undefined' ? window.location.hash : '');
    if (hashRoute.page && isKnownAdminPageKey(hashRoute.page)) {
      return {
        page: hashRoute.page,
        source: 'hash',
        serverId: parsePositiveInt(hashRoute.params.get('server') || hashRoute.params.get('id')),
      };
    }
    const pathPage = getAdminPageFromPath();
    if (pathPage && isKnownAdminPageKey(pathPage)) {
      return {
        page: pathPage,
        source: 'path',
        serverId: pathPage === 'server-monitor' ? getServerMonitorQueryId() : null,
      };
    }
    if (opts.ignoreSaved) return { page: '', source: 'none', serverId: null };
    const saved = normalizePageKey((function () {
      try {
        return localStorage.getItem('lastPage');
      } catch (_) {
        return '';
      }
    }()));
    if (saved && isKnownAdminPageKey(saved)) {
      return { page: saved, source: 'saved', serverId: null };
    }
    return { page: 'dashboard', source: 'default', serverId: null };
  }

  function writeAdminHistory(page, options = {}) {
    if (options.skipHistory || typeof window === 'undefined' || !window.history) return;
    const url = buildAdminPageUrl(page, options);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl === url) return;
    const method = options.replaceHistory ? 'replaceState' : 'pushState';
    window.history[method]({ page: normalizePageKey(page) }, '', url);
  }

  function normalizeLegacyAdminHashOnBoot() {
    if (typeof window === 'undefined' || !window.location || !window.history) return;
    const route = parseAdminHashRoute(window.location.hash);
    if (!route.page || !isKnownAdminPageKey(route.page)) return;
    const serverId = parsePositiveInt(route.params.get('server') || route.params.get('id'));
    const targetUrl = buildAdminPageUrl(route.page, { serverId });
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl === `${targetUrl}${window.location.hash}` || (`${window.location.pathname}${window.location.search}` === targetUrl && !window.location.hash)) return;
    window.history.replaceState({ page: normalizePageKey(route.page) }, '', targetUrl);
  }

  root.router = {
    normalizePageKey,
    parseAdminHashRoute,
    getPortalPathSegments,
    getPortalBasePath,
    getKnownAdminPageKeys,
    isKnownAdminPageKey,
    getCanonicalAdminPageState,
    getAdminPageFromPath,
    parsePositiveInt,
    getServerMonitorQueryId,
    buildAdminPageUrl,
    syncAdminRouteLinks,
    getRequestedAdminRoute,
    writeAdminHistory,
    normalizeLegacyAdminHashOnBoot,
  };
}());
