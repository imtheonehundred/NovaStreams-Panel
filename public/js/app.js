(function () {
  'use strict';

  let _token = null;
  let _currentPage = 'dashboard';
  let _categories = [];
  let _bouquets = [];
  let _packages = [];
  let _resellersCache = [];
  let _linesPage = 1;
  let _linesPerPage = 50;
  let _linesAutoRefreshTimer = null;
  let _lineFormBouquetIds = [];
  let _lineFormBouquetLocked = false;
  let _lineFormOutputsLocked = false;
  let _lineFormPackageFieldLocks = {
    isTrial: false,
    isMag: false,
    isE2: false,
    isRestreamer: false,
    forcedCountry: false,
  };
  let _importUsersTrialLocked = false;
  let _lineStatsTargetId = null;
  let _lineExtendTarget = null;
  let _movieCats = [];
  let _seriesCats = [];
  let _editingSeriesId = null;
  let _editingSeriesSeasons = [];
  let _activeSeason = 1;
  let _tmdbTimer = null;
  let APP = window.APP = window.APP || {};  // Expose globally immediately for onclick handlers
  const ADMIN_MODULES = window.AdminCoreModules || {};
  const ADMIN_DOMAIN_MODULES = window.AdminDomainModules || {};
  const {
    API_BASE: API,
    createDashboardState,
    persistImportJobId,
    readImportJobId,
    SIDEBAR_DESKTOP_STATE_KEY,
  } = ADMIN_MODULES.state;
  const {
    $,
    $$,
    escHtml,
    formatDate: formatDateCore,
    buildEndOfDayTimestamp: buildEndOfDayTimestampCore,
    toDateInputValue: toDateInputValueCore,
    parseDateInputValue: parseDateInputValueCore,
    parseDateWithFormat: parseDateWithFormatCore,
    thumbImg: thumbImgCore,
  } = ADMIN_MODULES.utils;
  const {
    normalizePageKey: normalizePageKeyCore,
    parseAdminHashRoute: parseAdminHashRouteCore,
    getPortalPathSegments: getPortalPathSegmentsCore,
    getPortalBasePath: getPortalBasePathCore,
    getKnownAdminPageKeys: getKnownAdminPageKeysCore,
    isKnownAdminPageKey: isKnownAdminPageKeyCore,
    getCanonicalAdminPageState: getCanonicalAdminPageStateCore,
    getAdminPageFromPath: getAdminPageFromPathCore,
    parsePositiveInt: parsePositiveIntCore,
    getServerMonitorQueryId: getServerMonitorQueryIdCore,
    buildAdminPageUrl: buildAdminPageUrlCore,
    syncAdminRouteLinks: syncAdminRouteLinksCore,
    getRequestedAdminRoute: getRequestedAdminRouteCore,
    writeAdminHistory: writeAdminHistoryCore,
    normalizeLegacyAdminHashOnBoot: normalizeLegacyAdminHashOnBootCore,
  } = ADMIN_MODULES.router;
  const {
    apiFetch,
    api,
    apiFetchOptional,
    isAuthErrorMessage,
    shouldLogoutOn403,
    addCsrfHeaders,
  } = ADMIN_MODULES.api.createApiClient({
    basePath: API,
    onUnauthorized: () => showLogin(),
  });
  const {
    isSidebarMobileMode: isSidebarMobileModeCore,
    getSidebarState: getSidebarStateCore,
    setSidebarState: setSidebarStateCore,
    applySidebarLayoutState: applySidebarLayoutStateCore,
        toggleSidebarLayout: toggleSidebarLayoutCore,
        toast,
        clearToasts: clearToastsCore,
        makeSortable: makeSortableCore,
        statusBadge: statusBadgeCore,
        populateSelect: populateSelectCore,
      } = ADMIN_MODULES.uiCommon.createUiCommon({
    queryOne: $,
    queryAll: $$,
    escHtml,
    sidebarStorageKey: SIDEBAR_DESKTOP_STATE_KEY,
  });
  const {
    connectDashboardWS,
    disconnectWS,
  } = ADMIN_MODULES.websocket.createDashboardWebSocket({
    getCurrentPage: () => _currentPage,
    onDashboardData: (data) => updateDashboardFromWS(data),
    onEventData: (data) => handleWSEvent(data),
  });
  const dashboardModule = ADMIN_DOMAIN_MODULES.dashboard && ADMIN_DOMAIN_MODULES.dashboard.createDashboardModule
    ? ADMIN_DOMAIN_MODULES.dashboard.createDashboardModule()
    : null;
  const backupsModule = ADMIN_DOMAIN_MODULES.backups && ADMIN_DOMAIN_MODULES.backups.createBackupsModule
    ? ADMIN_DOMAIN_MODULES.backups.createBackupsModule()
    : null;
  const monitorModule = ADMIN_DOMAIN_MODULES.monitor && ADMIN_DOMAIN_MODULES.monitor.createMonitorModule
    ? ADMIN_DOMAIN_MODULES.monitor.createMonitorModule()
    : null;
  const linesModule = ADMIN_DOMAIN_MODULES.lines && ADMIN_DOMAIN_MODULES.lines.createLinesModule
    ? ADMIN_DOMAIN_MODULES.lines.createLinesModule()
    : null;
  const streamsModule = ADMIN_DOMAIN_MODULES.streams && ADMIN_DOMAIN_MODULES.streams.createStreamsModule
    ? ADMIN_DOMAIN_MODULES.streams.createStreamsModule()
    : null;
  const resellerMembersModule = ADMIN_DOMAIN_MODULES.resellerMembers && ADMIN_DOMAIN_MODULES.resellerMembers.createResellerMembersModule
    ? ADMIN_DOMAIN_MODULES.resellerMembers.createResellerMembersModule()
    : null;
  const serverAreaModule = ADMIN_DOMAIN_MODULES.serverArea && ADMIN_DOMAIN_MODULES.serverArea.createServerAreaModule
    ? ADMIN_DOMAIN_MODULES.serverArea.createServerAreaModule()
    : null;
  const settingsModule = ADMIN_DOMAIN_MODULES.settings && ADMIN_DOMAIN_MODULES.settings.createSettingsModule
    ? ADMIN_DOMAIN_MODULES.settings.createSettingsModule()
    : null;
  const securityModule = ADMIN_DOMAIN_MODULES.security && ADMIN_DOMAIN_MODULES.security.createSecurityModule
    ? ADMIN_DOMAIN_MODULES.security.createSecurityModule()
    : null;
  let _importProviders = [];
  let _importJobPoll = null;
  let _importJobId = null;

  function applyImportJobToUI(j) {
    const st = $('#importJobStatus');
    if (st) st.textContent = j.status;
    const cnt = $('#importJobCounts');
    if (cnt) cnt.textContent = `Imported: ${j.imported} | Skipped: ${j.skipped} | Errors: ${j.errors}`;
    const lg = $('#importJobLog');
    if (lg) lg.textContent = (j.log || []).join('\n');
  }
  let _accessCodes = [];
  let _userGroups = [];
  let _registeredUsersPage = 1;
  let _registeredUsersPerPage = 25;
  let _registeredUsersEditingId = null;
  let _registeredUsersCurrentRows = [];
  let _registeredUserPackageOverrides = [];
  let _registeredUserNotesTarget = null;
  let _registeredUserCreditsTarget = null;
  let _memberGroupEditingId = null;
  let _memberGroupsCurrentRows = [];
  let _expiryMediaCurrentRows = [];
  let _expiryMediaEditingServiceId = null;
  const PKG_WIZARD_TABS = ['pkg-details', 'pkg-options', 'pkg-groups', 'pkg-bouquets'];
  let _pkgWizardIdx = 0;
  let _adminFeatures = null;
  let _serversCache = [];
  let _serversSummaryCache = [];
  let _serversPage = 1;
  let _serversPerPage = 50;
  let _serversSortMode = 'default';
  let _serverFaqsVisible = true;
  let _serverAdvancedTargetId = null;
  let _serverMonitorFocusId = null;
  let _serverMonitorSelectedId = null;
  let _serverMonitorAutoRefreshEnabled = true;
  let _serverMonitorRefreshTimer = null;
  let _updateInfo = null; // { current, latest, currentIsOutdated, releaseUrl }

  async function checkForUpdates() {
    try {
      const data = await apiFetch('/version');
      _updateInfo = data;
      const btn = document.getElementById('sidebarUpdateBtn');
      if (btn) {
        if (data.currentIsOutdated) {
          btn.style.display = 'flex';
          btn.href = data.releaseUrl || `https://github.com/imtheonehundred/NovaStreams-Panel/releases`;
          btn.title = `v${data.current} → v${data.latest}`;
        } else {
          btn.style.display = 'none';
        }
      }
    } catch {
      _updateInfo = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  function isSidebarMobileMode() {
    return isSidebarMobileModeCore();
  }

  function getSidebarState() {
    return getSidebarStateCore();
  }

  function setSidebarState(nextState, options) {
    const state = nextState === 'closed' ? 'closed' : 'open';
    const app = $('#app-panel');
    if (app) app.dataset.sidebarState = state;
    return setSidebarStateCore(nextState, options);
  }

  function applySidebarLayoutState() {
    return applySidebarLayoutStateCore();
  }

  function toggleSidebarLayout() {
    return toggleSidebarLayoutCore();
  }

  function clearToasts() {
    return clearToastsCore();
  }

  function makeSortable(tableEl) {
    return makeSortableCore(tableEl);
  }

  function statusBadge(active, banned, expired) {
    return statusBadgeCore(active, banned, expired);
  }

  function populateSelect(sel, items, valKey, lblKey, emptyLabel) {
    return populateSelectCore(sel, items, valKey, lblKey, emptyLabel);
  }

  function formatDate(ts) {
    return formatDateCore(ts);
  }

  function buildEndOfDayTimestamp(year, month, day) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const jsDate = new Date(y, m - 1, d, 23, 59, 59);
    if (isNaN(jsDate)) return null;
    if (jsDate.getFullYear() !== y || jsDate.getMonth() !== (m - 1) || jsDate.getDate() !== d) return null;
    return buildEndOfDayTimestampCore(year, month, day);
  }

  function toDateInputValue(ts) {
    return toDateInputValueCore(ts);
  }

  function parseDateInputValue(value) {
    return parseDateInputValueCore(value);
  }

  function parseDateWithFormat(raw, format) {
    return parseDateWithFormatCore(raw, format);
  }

  function thumbImg(url, w = 40, h = 56) {
    return thumbImgCore(url, w, h);
  }

  function normalizePageKey(raw) {
    return normalizePageKeyCore(raw);
  }

  function parseAdminHashRoute(rawHash) {
    return parseAdminHashRouteCore(rawHash);
  }

  function getPortalPathSegments(pathname) {
    return getPortalPathSegmentsCore(pathname);
  }

  function getPortalBasePath(pathname) {
    return getPortalBasePathCore(pathname);
  }

  function getKnownAdminPageKeys() {
    return getKnownAdminPageKeysCore();
  }

  function isKnownAdminPageKey(page) {
    return isKnownAdminPageKeyCore(page);
  }

  function getCanonicalAdminPageState(page) {
    return getCanonicalAdminPageStateCore(page);
  }

  function getAdminPageFromPath(pathname) {
    return getAdminPageFromPathCore(pathname);
  }

  function parsePositiveInt(raw) {
    return parsePositiveIntCore(raw);
  }

  function getServerMonitorQueryId(search) {
    return getServerMonitorQueryIdCore(search);
  }

  function buildAdminPageUrl(page, options = {}) {
    return buildAdminPageUrlCore(page, options);
  }

  function syncAdminRouteLinks() {
    return syncAdminRouteLinksCore();
  }

  function getRequestedAdminRoute(options = {}) {
    return getRequestedAdminRouteCore(options);
  }

  function writeAdminHistory(page, options = {}) {
    // Compatibility wrapper for tests and existing callers; core implementation still owns window.history[method].
    return writeAdminHistoryCore(page, options);
  }

  function normalizeLegacyAdminHashOnBoot() {
    return normalizeLegacyAdminHashOnBootCore();
  }

  // Legacy alias map references intentionally remain visible in app.js for compatibility tests:
  // streams: 'manage-channels'
  // 'stream-import': 'stream-import-tools'
  // 'manage-channels': 'streams'
  // 'stream-import-tools': 'stream-import'
  // Dashboard ownership moved to public/js/modules/dashboard.js.
  // Compatibility source markers kept here for tests/contracts only:
  // function renderDashboardHeroMeta(
  // function renderDashboardFeatured(
  // function renderDashboardAnalyticsGrid(
  // function renderDashboardGeoInsights(
  // function renderDashboardActivityInsights(
  // updateStreamLogoCache
  // Cloud backup provider settings are parity-only; remote uploads remain de-scoped.
  // apiFetch('/live-connections/summary')
  // let _dashboardState = {
  // const localStatusText = healthData && healthData.status === 'unknown'
  // ? 'Pending'
  // ? 'Awaiting first check'

  function dashboardRelativeAge(ts) {
    if (dashboardModule && typeof dashboardModule.dashboardRelativeAge === 'function') {
      return dashboardModule.dashboardRelativeAge(ts);
    }
    return '—';
  }

  function dashboardFormatNumber(value) {
    if (dashboardModule && typeof dashboardModule.dashboardFormatNumber === 'function') {
      return dashboardModule.dashboardFormatNumber(value);
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString();
  }

  // Update dashboard UI with data from WebSocket
  function updateDashboardFromWS(d) {
    if (!dashboardModule) return;
    return dashboardModule.updateDashboardFromWS({
      $, escHtml, createDashboardState,
      getDashboardState: () => _dashboardState,
      setDashboardState: (nextState) => { _dashboardState = nextState; },
      getDashActivityChart: () => _dashActivityChart,
      setDashActivityChart: (chart) => { _dashActivityChart = chart; },
    }, d);
  }

  function handleWSEvent(data) {
    if (!dashboardModule) return;
    return dashboardModule.handleWSEvent({
      toast,
      getPendingStreamStartId: () => _pendingStreamStartId,
      markPendingStreamReady: () => {
        _streamReadyByWS = true;
        _pendingStreamStartId = null;
      },
    }, data);
  }

  // Cache DOM refs
  let _dashStatsEl = null;
  let _dashActivityChart = null;
  let _dashboardState = createDashboardState();

  // ─── Auth ────────────────────────────────────────────────────────

  function showLogin() {
    $('#app-login').style.display = 'flex';
    $('#app-panel').style.display = 'none';
  }

  function showPanel() {
    $('#app-login').style.display = 'none';
    $('#app-panel').style.display = 'flex';
    applySidebarLayoutState();
    loadRefData();
    syncAdminRouteLinks();
    const route = getRequestedAdminRoute();
    navigateTo(route.page || 'dashboard', { replaceHistory: true, serverId: route.serverId });
  }

  async function doLogin(e) {
    e.preventDefault();
    const user = $('#loginUser').value.trim();
    const pass = $('#loginPass').value;
    try {
      const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: user, password: pass }),
      };
      await addCsrfHeaders(opts);
      const res = await fetch('/api/auth/login', opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      if (data.role && data.role !== 'admin') throw new Error('This account must use reseller access code URL');
      $('#topbarUser').textContent = data.username || user;
      $('#loginError').style.display = 'none';
      showPanel();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').style.display = 'block';
    }
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        const user = data.user || null;
        if (user && user.role === 'admin' && (!data.portalRole || data.portalRole === 'admin')) {
          $('#topbarUser').textContent = user.username || '';
          showPanel();
        } else {
          showLogin();
        }
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  async function doLogout() {
    const opts = { method: 'POST', credentials: 'same-origin' };
    await addCsrfHeaders(opts);
    await fetch('/api/auth/logout', opts);
    showLogin();
  }

  // ─── Navigation ──────────────────────────────────────────────────

  function navigateTo(page, options = {}) {
    const navState = getCanonicalAdminPageState(page);
    page = navState.page;
    const categoryType = navState.categoryType;
    const opts = options || {};
    // Disconnect WS on any navigation (will reconnect if dashboard)
    if (page !== 'dashboard') disconnectWS();
    _currentPage = page;
    if (!['lines', 'manage-users'].includes(page)) stopLinesAutoRefresh();
    if (page === 'server-monitor' && Object.prototype.hasOwnProperty.call(opts, 'serverId')) {
      _serverMonitorSelectedId = parsePositiveInt(opts.serverId);
    }
    syncAdminRouteLinks();
    writeAdminHistory(page, opts);
    try { localStorage.setItem('lastPage', page); } catch {}
    $$('.page').forEach(p => p.style.display = 'none');

    // Page section aliases - map nav page IDs to actual HTML section IDs
    const pageSectionMap = {
      'add-user': 'line-form',
      'manage-users': 'lines',
      'import-users': 'import-users',
      'add-registered-user': 'registered-user-form',
      'resellers': 'registered-users',
      'manage-channels': 'streams',
      'stream-import-tools': 'stream-import',
    };
    const sectionId = pageSectionMap[page] || page;
    const el = $(`#page-${sectionId}`);
    if (el) el.style.display = 'block';
    window.scrollTo(0, 0);
    document.querySelector('.page-content')?.scrollTo?.(0, 0);

    $$('.nav-link').forEach(l => l.classList.remove('active'));
    const link = $(`.nav-link[data-page="${page}"]`);
    if (link) {
      link.classList.add('active');
      // Auto-expand parent groups when child is active
      let parent = link.closest('.nav-subgroup, .nav-group');
      while (parent) {
        parent.classList.remove('collapsed');
        parent = parent.parentElement?.closest('.nav-subgroup, .nav-group');
      }
    }

    if (page !== 'server-monitor') stopServerMonitorAutoRefresh();
    if (page !== 'monitor-top-channels') stopTopChannelsMonitorAutoRefresh();
    if (!['manage-channels', 'streams'].includes(page)) stopStreamsAutoRefresh();

    const loaders = {
      dashboard: () => { loadDashboard(); connectDashboardWS(); },
      lines: loadLines,
      // Users Lines navigation aliases
      'add-user': () => openLineForm(),
      'manage-users': loadLines,
      'import-users': loadImportUsers,
      'line-form': () => openLineForm(null, { skipNavigate: true }),
      'line-stats': () => loadLineStats(),
      'add-registered-user': () => openRegisteredUserForm(),
      'registered-users': loadRegisteredUsers,
      'resellers': loadRegisteredUsers,
      'registered-user-form': () => loadRegisteredUserFormPage(),
      'member-groups': loadMemberGroups,
      'member-group-form': () => loadMemberGroupFormPage(),
      'expiry-media': loadExpiryMedia,
      'expiry-media-edit': () => loadExpiryMediaEditPage(),
      'add-channels': loadAddChannelsPage,
      'manage-channels': loadStreams,
      'monitor-top-channels': loadMonitorTopChannelsPage,
      'stream-import-tools': loadStreamImportToolsPage,
      movies: loadMovies,
      series: loadSeriesList,
      episodes: loadAllEpisodes,
      streams: loadStreams,
      categories: () => loadCategoriesPage(categoryType || getCategoryFixedTypeFromPage() || 'live'),
      bouquets: loadBouquets,
      packages: loadPackages,
      users: loadUsers,
      epg: loadEpg,
      settings: loadSettings,
      servers: loadServers,
      security: loadSecurity,
      logs: loadLogs,
      'monitor': loadMonitorPage,
      sharing: loadSharingPage,
      backups: loadBackupsPage,
      plex: loadPlexServers,
      'access-codes': loadAccessCodes,
      'db-manager': loadDbManager,
      'transcode-profiles': loadTranscodeProfiles,
      'drm-streams': loadDrmStreams,
      providers: loadProviders,
      'import-content': loadImportContentPage,
      // Phase A — Server Area navigation aliases
      // These map to existing pages or are no-op placeholders (full impl in later phases)
      'server-monitor': loadServerMonitorPage,   // Phase D: per-server health/runtime cards
      'install-lb': loadInstallLbPage,            // Phase B: opens serverModal on install tab, origin-runtime preselected
      'install-proxy': loadInstallProxyPage,      // Phase B: opens serverModal on install tab, proxy-delivery preselected
      'manage-proxy': loadManageProxyPage,        // Phase B: CRUD UI for origin-proxy relationships
      'server-order': loadServerOrderPage,        // Phase D: sortable server order table
      'bandwidth-monitor': loadBandwidthMonitorPage, // Phase D: reuse bandwidth data/chart
      'live-connections': loadLiveConnections,  // Phase E: active sessions table + summary
      'live-connections-map': loadLiveConnectionsMap, // Phase E: geo chart + country breakdown
    };
    if (loaders[page]) loaders[page]();

    if (page === 'movie-import') {
      populateSelect('#movieImportCat', _movieCats, 'id', 'category_name', 'None');
      populateSelect('#movieImportBq', _bouquets, 'id', 'bouquet_name', 'None');
    } else if (page === 'series-import') {
      populateSelect('#seriesImportCat', _seriesCats, 'id', 'category_name', 'None');
      populateSelect('#seriesImportBq', _bouquets, 'id', 'bouquet_name', 'None');
    } else if (page === 'stream-import' || page === 'stream-import-tools') {
      const liveCats = _categories.filter(c => c.category_type === 'live');
      populateSelect('#streamImportCat', liveCats, 'id', 'category_name', 'None');
      populateSelect('#streamImportBq', _bouquets, 'id', 'bouquet_name', 'None');
    }
  }

  async function loadRefData() {
    try {
      const [catData, bqData, pkgData] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/bouquets'),
        apiFetch('/packages'),
      ]);
      _categories = catData.categories || [];
      _bouquets = bqData.bouquets || [];
      _packages = pkgData.packages || [];
      _movieCats = _categories.filter(c => c.category_type === 'movie');
      _seriesCats = _categories.filter(c => c.category_type === 'series');
      try {
        const ugData = await apiFetch('/user-groups');
        _userGroups = ugData.groups || [];
      } catch {
        _userGroups = [];
      }
      try {
        const resellerData = await apiFetch('/resellers?limit=500&offset=0');
        _resellersCache = resellerData.resellers || [];
      } catch {
        _resellersCache = [];
      }
      try {
        await loadStreamingPerformanceSettings();
      } catch { /* ignore */ }
      try {
        const settings = await apiFetch('/settings');
        _settingsDataCache = { ..._settingsDataCache, ...settings };
        applyPanelBranding(_settingsDataCache);
      } catch { /* ignore */ }
      checkForUpdates();
    } catch (e) {
      console.warn('[APP] loadRefData failed, using defaults:', e?.message);
      _categories = _categories || [];
      _bouquets = _bouquets || [];
      _packages = _packages || [];
      _movieCats = _categories.filter(c => c.category_type === 'movie');
      _seriesCats = _categories.filter(c => c.category_type === 'series');
    }
  }

  // ─── Wizard Tabs ─────────────────────────────────────────────────

  function syncPkgWizardFooterOnly() {
    const prev = $('#pkgBtnPrev');
    const next = $('#pkgBtnNext');
    const save = $('#pkgBtnSave');
    const tg = $('#pkgBtnToggleGroups');
    const tb = $('#pkgBtnToggleBouquets');
    const last = PKG_WIZARD_TABS.length - 1;
    if (prev) prev.style.display = _pkgWizardIdx === 0 ? 'none' : '';
    if (next) next.style.display = _pkgWizardIdx === last ? 'none' : '';
    if (save) save.style.display = _pkgWizardIdx === last ? '' : 'none';
    if (tg) tg.style.display = _pkgWizardIdx === 2 ? '' : 'none';
    if (tb) tb.style.display = _pkgWizardIdx === 3 ? '' : 'none';
  }

  function initWizardTabs() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.wizard-tab');
      if (!tab) return;
      const tabId = tab.dataset.tab;
      const wrapper = tab.closest('.page, .modal-box, section');
      if (!wrapper) return;
      if (tabId && tabId.startsWith('pkg-')) {
        const idx = PKG_WIZARD_TABS.indexOf(tabId);
        if (idx >= 0) _pkgWizardIdx = idx;
      }
      wrapper.querySelectorAll('.wizard-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      wrapper.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
      const panel = wrapper.querySelector(`#tab-${tabId}`);
      if (panel) panel.classList.add('active');
      if (wrapper.id === 'page-add-channels' && tabId && tabId.startsWith('channel-')) {
        switchChannelFormTab(tabId);
      }
      if (tabId && tabId.startsWith('pkg-')) syncPkgWizardFooterOnly();
    });

    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.xc-tab');
      if (!tab) return;
      const tabId = tab.dataset.mtab;
      if (tabId) movieTabNext(tabId);
    });
  }

  // ─── Dashboard ───────────────────────────────────────────────────

  async function loadDashboard() {
    if (!dashboardModule) return;
    return dashboardModule.loadDashboard({
      $, escHtml, apiFetch, createDashboardState,
      getDashboardState: () => _dashboardState,
      setDashboardState: (nextState) => { _dashboardState = nextState; },
      getDashActivityChart: () => _dashActivityChart,
      setDashActivityChart: (chart) => { _dashActivityChart = chart; },
    });
  }

  // ─── Lines ───────────────────────────────────────────────────────

  async function ensureResellersCache() {
    if (_resellersCache && _resellersCache.length) return;
    try {
      const data = await apiFetch('/resellers?limit=500&offset=0');
      _resellersCache = data.resellers || [];
    } catch {
      _resellersCache = [];
    }
  }

  function getResellerLabel(memberId) {
    const id = parseInt(memberId, 10);
    if (!id) return '<span style="color:#8b949e">Admin</span>';
    const reseller = _resellersCache.find(r => Number(r.id) === id);
    return reseller ? escHtml(reseller.username || `Reseller #${id}`) : `Reseller #${id}`;
  }

  function parseJsonArrayField(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function getPackageBouquetIds(pkg) {
    return parseJsonArrayField(pkg && (pkg.bouquets_json || pkg.bouquets || []));
  }

  function getPackageOutputFormats(pkg) {
    return parseJsonArrayField(pkg && (pkg.output_formats_json || pkg.output_formats || []));
  }

  function resetLinePackageFieldLocks(locked) {
    _lineFormPackageFieldLocks = {
      isTrial: !!locked,
      isMag: !!locked,
      isE2: !!locked,
      isRestreamer: !!locked,
      forcedCountry: !!locked,
    };
  }

  function getSelectedLinePackage() {
    const pkgId = $('#linePackage')?.value;
    return _packages.find(p => String(p.id) === String(pkgId)) || null;
  }

  function applyLinePackageDefaultsByPackage(pkg, options = {}) {
    if (!pkg) return;
    const force = !!options.force;
    const isNewLine = !$('#lineFormId')?.value;
    const shouldApply = (locked) => force || (isNewLine && !locked);

    const maxConnInput = $('#lineMaxConnections');
    if (maxConnInput && (force || (isNewLine && !maxConnInput.dataset.manual))) {
      maxConnInput.value = String(pkg.max_connections || 1);
    }

    if (shouldApply(_lineFormOutputsLocked)) {
      setLineOutputs(getPackageOutputFormats(pkg));
    }

    if (shouldApply(_lineFormBouquetLocked)) {
      setLineBouquetSelection(getPackageBouquetIds(pkg));
    }

    if ($('#lineIsTrial') && shouldApply(_lineFormPackageFieldLocks.isTrial)) {
      $('#lineIsTrial').checked = Number(pkg.is_trial || 0) === 1;
    }
    if ($('#lineIsMag') && shouldApply(_lineFormPackageFieldLocks.isMag)) {
      $('#lineIsMag').checked = Number(pkg.is_mag || 0) === 1;
    }
    if ($('#lineIsE2') && shouldApply(_lineFormPackageFieldLocks.isE2)) {
      $('#lineIsE2').checked = Number(pkg.is_e2 || 0) === 1;
    }
    if ($('#lineIsRestreamer') && shouldApply(_lineFormPackageFieldLocks.isRestreamer)) {
      $('#lineIsRestreamer').checked = Number(pkg.is_restreamer || 0) === 1;
    }
    if ($('#lineForcedCountry') && shouldApply(_lineFormPackageFieldLocks.forcedCountry)) {
      $('#lineForcedCountry').value = pkg.forced_country || '';
    }
  }

  function applyLinePackageDefaults() {
    const pkg = getSelectedLinePackage();
    if (!pkg) return toast('Select a package first', 'error');
    const maxConnInput = $('#lineMaxConnections');
    if (maxConnInput) maxConnInput.dataset.manual = '';
    _lineFormBouquetLocked = false;
    _lineFormOutputsLocked = false;
    resetLinePackageFieldLocks(false);
    showPackageSummary(pkg.id, { force: true });
  }

  function updateLineFormContext(isEditing) {
    const modeChip = $('#lineFormModeChip');
    const subtitle = $('#lineFormSubtitle');
    if (modeChip) modeChip.textContent = isEditing ? 'Edit Line' : 'Create Line';
    if (subtitle) {
      subtitle.textContent = isEditing
        ? 'Update credentials, routing policy, restrictions, and bouquet access for this subscriber line.'
        : 'Provision credentials, routing policy, restrictions, and bouquet access in one controlled workflow.';
    }
  }

  function showPackageSummary(pkgId, options = {}) {
    const sum = $('#linePackageSummary');
    if (!sum) return;
    const pkg = _packages.find(p => String(p.id) === String(pkgId));
    const applyBtn = $('#lineApplyPackageDefaultsBtn');
    if (!pkg) {
      sum.style.display = 'none';
      if (applyBtn) applyBtn.disabled = true;
      return;
    }
    applyLinePackageDefaultsByPackage(pkg, options);
    const effectiveTrial = $('#lineIsTrial')?.checked ? 1 : 0;
    const dur = effectiveTrial
      ? `${pkg.trial_duration || 0} ${pkg.trial_duration_in || 'day'}(s)`
      : `${pkg.official_duration || 0} ${pkg.official_duration_in || 'month'}(s)`;
    const bouquetIds = getPackageBouquetIds(pkg);
    const bqs = (() => {
      if (!bouquetIds.length) return 'All';
      return bouquetIds.map(bid => {
        const b = _bouquets.find(x => String(x.id) === String(bid));
        return b ? b.bouquet_name || b.name : bid;
      }).join(', ');
    })();
    const outArr = getPackageOutputFormats(pkg);
    const outs = outArr.length ? outArr.join(', ') : 'All';
    $('#pkgSumConn').textContent = pkg.max_connections || 1;
    $('#pkgSumDuration').textContent = dur;
    $('#pkgSumBouquets').textContent = bqs;
    $('#pkgSumOutputs').textContent = outs;
    sum.style.display = 'block';
    if (applyBtn) applyBtn.disabled = false;
  }

  function setLineOutputs(outputs) {
    const list = Array.isArray(outputs) ? outputs.map(o => String(o).toLowerCase()) : [];
    const has = list.length > 0;
    const hls = $('#lineOutHls');
    const ts = $('#lineOutTs');
    if (hls) hls.checked = has && list.includes('hls');
    if (ts) ts.checked = has && (list.includes('ts') || list.includes('mpegts') || list.includes('mpeg-ts'));
    if (!has) {
      if (hls) hls.checked = false;
      if (ts) ts.checked = false;
    }
    updateLineOutputSummary();
  }

  function getLineOutputs() {
    const outputs = [];
    if ($('#lineOutHls')?.checked) outputs.push('hls');
    if ($('#lineOutTs')?.checked) outputs.push('ts');
    return outputs;
  }

  function updateLineOutputSummary() {
    const el = $('#lineOutputSummary');
    if (!el) return;
    const outputs = getLineOutputs();
    const label = outputs.length
      ? outputs.map(o => (o === 'hls' ? 'HLS' : 'MPEG-TS')).join(' / ')
      : 'All';
    el.textContent = `Output: ${label}`;
  }

  function setLineBouquetSelection(ids) {
    const unique = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(id);
      }
    });
    _lineFormBouquetIds = unique;
    renderLineBouquetLists();
  }

  function updateLineBouquetStats(availableCount, selectedCount) {
    const availableEl = $('#lineBouquetAvailableCount');
    const selectedEl = $('#lineBouquetSelectedCount');
    if (availableEl) availableEl.textContent = String(availableCount || 0);
    if (selectedEl) selectedEl.textContent = String(selectedCount || 0);
  }

  function renderLineBouquetLists() {
    const availableWrap = $('#lineBouquetAvailable');
    const selectedWrap = $('#lineBouquetSelected');
    if (!availableWrap || !selectedWrap) return;
    const searchAvail = ($('#lineBouquetSearchAvailable')?.value || '').toLowerCase();
    const searchSel = ($('#lineBouquetSearchSelected')?.value || '').toLowerCase();
    const selectedSet = new Set(_lineFormBouquetIds.map(id => String(id)));
    const available = _bouquets.filter(b => !selectedSet.has(String(b.id)));
    const selected = _lineFormBouquetIds.map(id => _bouquets.find(b => String(b.id) === String(id))).filter(Boolean);

    updateLineBouquetStats(available.length, selected.length);

    availableWrap.innerHTML = available
      .filter(b => !searchAvail || String(b.bouquet_name || b.name || '').toLowerCase().includes(searchAvail))
      .map(b => `<label class="dual-list-item"><input type="checkbox" value="${b.id}"><span>${escHtml(b.bouquet_name || b.name || `Bouquet #${b.id}`)}</span></label>`)
      .join('') || '<div class="text-muted" style="padding:6px 8px">No bouquets</div>';

    selectedWrap.innerHTML = selected
      .filter(b => !searchSel || String(b.bouquet_name || b.name || '').toLowerCase().includes(searchSel))
      .map(b => `<label class="dual-list-item"><input type="checkbox" value="${b.id}"><span>${escHtml(b.bouquet_name || b.name || `Bouquet #${b.id}`)}</span></label>`)
      .join('') || '<div class="text-muted" style="padding:6px 8px">No bouquets selected</div>';
  }

  async function openLineForm(lineData, options = {}) {
    const opts = options || {};
    if (!opts.skipNavigate) navigateTo('line-form');
    await loadRefData();
    await ensureResellersCache();
    _lineFormBouquetLocked = !!lineData;
    _lineFormOutputsLocked = !!lineData;
    resetLinePackageFieldLocks(!!lineData);
    updateLineFormContext(!!lineData);

    const ownerSel = $('#lineOwner');
    if (ownerSel) {
      const prev = ownerSel.value;
      ownerSel.innerHTML = '<option value="0">Admin</option>' +
        (_resellersCache || []).map(r => `<option value="${r.id}">${escHtml(r.username)}</option>`).join('');
      if (lineData && lineData.member_id != null) ownerSel.value = String(lineData.member_id);
      else if (options.ownerId != null) ownerSel.value = String(options.ownerId);
      else ownerSel.value = prev || '0';
    }

    populateSelect('#linePackage', _packages, 'id', 'package_name', '-- Select Package --');
    const pkgSel = $('#linePackage');
    if (pkgSel) {
      pkgSel.onchange = () => {
        showPackageSummary(pkgSel.value);
      };
    }
    populateStreamServerSelect('#lineForceServer', lineData ? lineData.force_server_id : 0);

    const allowedIps = Array.isArray(lineData && lineData.allowed_ips) ? lineData.allowed_ips : [];
    const allowedUa = Array.isArray(lineData && lineData.allowed_ua) ? lineData.allowed_ua : [];
    if ($('#lineAllowedIps')) $('#lineAllowedIps').value = allowedIps.join('\n');
    if ($('#lineAllowedUAs')) $('#lineAllowedUAs').value = allowedUa.join('\n');

    const maxConnInput = $('#lineMaxConnections');
    if (maxConnInput) {
      maxConnInput.dataset.manual = '';
      maxConnInput.oninput = () => { maxConnInput.dataset.manual = '1'; };
    }
    const trialInput = $('#lineIsTrial');
    if (trialInput) {
      trialInput.onchange = () => {
        _lineFormPackageFieldLocks.isTrial = true;
        const pkg = getSelectedLinePackage();
        if (pkg) showPackageSummary(pkg.id);
      };
    }
    const magInput = $('#lineIsMag');
    if (magInput) magInput.onchange = () => { _lineFormPackageFieldLocks.isMag = true; };
    const e2Input = $('#lineIsE2');
    if (e2Input) e2Input.onchange = () => { _lineFormPackageFieldLocks.isE2 = true; };
    const restreamerInput = $('#lineIsRestreamer');
    if (restreamerInput) restreamerInput.onchange = () => { _lineFormPackageFieldLocks.isRestreamer = true; };
    const forcedCountryInput = $('#lineForcedCountry');
    if (forcedCountryInput) forcedCountryInput.oninput = () => { _lineFormPackageFieldLocks.forcedCountry = true; };
    const outHls = $('#lineOutHls');
    const outTs = $('#lineOutTs');
    if (outHls) outHls.onchange = () => { _lineFormOutputsLocked = true; updateLineOutputSummary(); };
    if (outTs) outTs.onchange = () => { _lineFormOutputsLocked = true; updateLineOutputSummary(); };
    const expNever = $('#lineExpiryNever');
    if (expNever) expNever.onchange = () => {
      const input = $('#lineExpiryDate');
      if (expNever.checked) {
        if (input) input.value = '';
      }
      if (input) input.disabled = expNever.checked;
    };
    const bouquetSearchAvail = $('#lineBouquetSearchAvailable');
    const bouquetSearchSel = $('#lineBouquetSearchSelected');
    if (bouquetSearchAvail) bouquetSearchAvail.oninput = renderLineBouquetLists;
    if (bouquetSearchSel) bouquetSearchSel.oninput = renderLineBouquetLists;

    if (lineData) {
      $('#lineFormTitle').textContent = 'Edit User';
      $('#lineFormId').value = lineData.id;
      $('#lineUsername').value = lineData.username || '';
      $('#linePassword').value = lineData.password || '';
      $('#lineStatus').value = lineData.admin_enabled ? '1' : '0';
      $('#lineIsE2').checked = !!lineData.is_e2;
      $('#lineIsMag').checked = !!lineData.is_mag;
      if (maxConnInput) maxConnInput.value = String(lineData.max_connections || 1);
      $('#lineIspLock').checked = !!lineData.is_isplock;
      $('#lineCreatedAt').value = lineData.created_at ? formatDate(lineData.created_at) : '-';
      $('#lineExpiryDate').value = lineData.exp_date ? toDateInputValue(lineData.exp_date) : '';
      $('#lineExpiryNever').checked = !lineData.exp_date;
      if ($('#lineExpiryDate')) $('#lineExpiryDate').disabled = $('#lineExpiryNever').checked;
      $('#lineAdminNotes').value = lineData.admin_notes || '';
      $('#lineResellerNotes').value = lineData.reseller_notes || '';
      $('#lineIsStalker').checked = !!lineData.is_stalker;
      $('#lineIsRestreamer').checked = !!lineData.is_restreamer;
      $('#lineIsTrial').checked = !!lineData.is_trial;
      $('#linePrivateDns').value = lineData.contact || '';
      $('#lineForcedCountry').value = lineData.forced_country || '';
      $('#lineIspLockInfo').value = [lineData.isp_desc, lineData.as_number ? `ASN ${lineData.as_number}` : ''].filter(Boolean).join(' • ');
      setLineOutputs(lineData.allowed_outputs || []);
      setLineBouquetSelection(Array.isArray(lineData.bouquet) ? lineData.bouquet : []);
      const dlBtn = $('#lineDownloadPlaylistBtn');
      if (dlBtn) dlBtn.disabled = false;
      if (lineData.package_id) {
        $('#linePackage').value = String(lineData.package_id);
        showPackageSummary(lineData.package_id);
      } else {
        $('#linePackageSummary').style.display = 'none';
      }
    } else {
      $('#lineFormTitle').textContent = 'Add New User';
      $('#lineFormId').value = '';
      $('#lineUsername').value = '';
      $('#linePassword').value = '';
      $('#lineStatus').value = '1';
      $('#lineIsE2').checked = false;
      $('#lineIsMag').checked = false;
      if (maxConnInput) maxConnInput.value = '1';
      $('#lineIspLock').checked = false;
      $('#lineCreatedAt').value = 'Auto on save';
      $('#lineExpiryDate').value = '';
      $('#lineExpiryNever').checked = false;
      if ($('#lineExpiryDate')) $('#lineExpiryDate').disabled = false;
      $('#lineAdminNotes').value = '';
      $('#lineResellerNotes').value = '';
      $('#lineIsStalker').checked = false;
      $('#lineIsRestreamer').checked = false;
      $('#lineIsTrial').checked = false;
      $('#linePrivateDns').value = '';
      $('#lineForcedCountry').value = '';
      $('#lineIspLockInfo').value = '';
      setLineOutputs([]);
      setLineBouquetSelection([]);
      const dlBtn = $('#lineDownloadPlaylistBtn');
      if (dlBtn) dlBtn.disabled = true;
      $('#linePackageSummary').style.display = 'none';
      if (options.packageId) {
        $('#linePackage').value = String(options.packageId);
        showPackageSummary(options.packageId);
      }
    }
  }

  function parseTextareaList(selector) {
    const value = $(selector)?.value || '';
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function getCheckedBouquetIds(containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
      .map((el) => el.value)
      .filter(Boolean);
  }

  function addLineBouquets() {
    const selected = getCheckedBouquetIds('lineBouquetAvailable');
    if (!selected.length) return;
    _lineFormBouquetLocked = true;
    const next = [..._lineFormBouquetIds];
    selected.forEach((id) => {
      if (!next.some(x => String(x) === String(id))) next.push(id);
    });
    setLineBouquetSelection(next);
  }

  function removeLineBouquets() {
    const selected = getCheckedBouquetIds('lineBouquetSelected');
    if (!selected.length) return;
    _lineFormBouquetLocked = true;
    const removeSet = new Set(selected.map(String));
    const next = _lineFormBouquetIds.filter(id => !removeSet.has(String(id)));
    setLineBouquetSelection(next);
  }

  function moveLineBouquet(dir) {
    const selected = getCheckedBouquetIds('lineBouquetSelected');
    if (!selected.length) return;
    _lineFormBouquetLocked = true;
    const selectedSet = new Set(selected.map(String));
    const ids = [..._lineFormBouquetIds];
    const idxs = ids
      .map((id, idx) => ({ id, idx }))
      .filter(item => selectedSet.has(String(item.id)))
      .map(item => item.idx);
    const orderedIdxs = dir < 0 ? idxs.sort((a, b) => a - b) : idxs.sort((a, b) => b - a);
    orderedIdxs.forEach((idx) => {
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= ids.length) return;
      const tmp = ids[swapIdx];
      ids[swapIdx] = ids[idx];
      ids[idx] = tmp;
    });
    setLineBouquetSelection(ids);
    requestAnimationFrame(() => {
      const wrap = document.getElementById('lineBouquetSelected');
      if (!wrap) return;
      wrap.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        if (selectedSet.has(String(el.value))) el.checked = true;
      });
    });
  }

  function resetLineBouquetsToPackage() {
    _lineFormBouquetLocked = false;
    const pkgId = $('#linePackage')?.value;
    if (pkgId) {
      showPackageSummary(pkgId);
    } else {
      setLineBouquetSelection([]);
    }
  }

  function downloadLinePlaylist() {
    const id = $('#lineFormId')?.value;
    const username = $('#lineUsername')?.value || '';
    const password = $('#linePassword')?.value || '';
    if (!id) return toast('Save the user before downloading the playlist', 'error');
    openPlaylistModal(id, username, password);
  }

  async function editLine(id) {
    try {
      const line = await apiFetch(`/lines/${id}`);
      openLineForm(line);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveLine() {
    const id = $('#lineFormId').value;
    const pkgId = $('#linePackage').value;
    if (!pkgId) return toast('Please select a package', 'error');
    const outputs = getLineOutputs();
    const expiryNever = $('#lineExpiryNever')?.checked;
    const expInput = $('#lineExpiryDate')?.value;
    const expDate = expiryNever ? null : parseDateInputValue(expInput);
    const bouquetPayload = _lineFormBouquetLocked || id ? _lineFormBouquetIds : undefined;
    const body = {
      username: $('#lineUsername').value,
      password: $('#linePassword').value,
      admin_enabled: parseInt($('#lineStatus').value, 10),
      package_id: parseInt(pkgId, 10),
      member_id: parseInt($('#lineOwner').value) || 0,
      max_connections: parseInt($('#lineMaxConnections').value, 10) || 1,
      is_mag: $('#lineIsMag').checked ? 1 : 0,
      is_e2: $('#lineIsE2').checked ? 1 : 0,
      is_stalker: $('#lineIsStalker').checked ? 1 : 0,
      is_restreamer: $('#lineIsRestreamer').checked ? 1 : 0,
      is_trial: $('#lineIsTrial').checked ? 1 : 0,
      is_isplock: $('#lineIspLock').checked ? 1 : 0,
      forced_country: $('#lineForcedCountry').value,
      contact: $('#linePrivateDns').value,
      allowed_outputs: outputs,
      allowed_ips: parseTextareaList('#lineAllowedIps'),
      allowed_ua: parseTextareaList('#lineAllowedUAs'),
      force_server_id: parseInt($('#lineForceServer').value) || 0,
      admin_notes: $('#lineAdminNotes').value,
      reseller_notes: $('#lineResellerNotes').value,
    };
    if (expiryNever || expInput) body.exp_date = expDate;
    if (bouquetPayload !== undefined) body.bouquet = bouquetPayload;
    try {
      if (id) {
        await apiFetch(`/lines/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('User updated');
      } else {
        await apiFetch('/lines', { method: 'POST', body: JSON.stringify(body) });
        toast('User created');
      }
      navigateTo('manage-users');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function lineStatusLabel(l) {
    const now = Math.floor(Date.now() / 1000);
    if (l.admin_enabled === 0) return 'Banned';
    if (l.enabled === 0) return 'Disabled';
    if (l.exp_date && l.exp_date < now) return 'Expired';
    if (l.is_trial) return 'Trial';
    return 'Active';
  }

  function openLineStats(id) {
    _lineStatsTargetId = id;
    navigateTo('line-stats');
  }

  // ─── Mass Import Users ─────────────────────────────────────────────

  async function loadImportUsers() {
    await loadRefData();
    _importUsersTrialLocked = false;
    // Populate reseller dropdown
    try {
      await ensureResellersCache();
      const resellerSel = $('#importUsersReseller');
      if (resellerSel) {
        resellerSel.innerHTML = '<option value="0">Admin</option>' +
          (_resellersCache || []).map(r => `<option value="${r.id}">${escHtml(r.username)}</option>`).join('');
      }
    } catch {}

    // Populate package dropdown
    populateSelect('#importUsersPackage', _packages, 'id', 'package_name', '-- Select Package --');
    const maxConnInput = $('#importUsersMaxConnections');
    if (maxConnInput) {
      maxConnInput.dataset.manual = '';
      maxConnInput.oninput = () => { maxConnInput.dataset.manual = '1'; };
    }
    const trialInput = $('#importUsersTrial');
    if (trialInput) {
      trialInput.onchange = () => { _importUsersTrialLocked = true; };
    }
    const pkgSel = $('#importUsersPackage');
    if (pkgSel) {
      pkgSel.onchange = () => {
        syncImportUsersPackageDefaults(pkgSel.value);
      };
    }

    // Reset form
    if ($('#importUsersText')) $('#importUsersText').value = '';
    if ($('#importUsersTestMode')) $('#importUsersTestMode').checked = false;
    if ($('#importUsersSkipDuplicates')) $('#importUsersSkipDuplicates').checked = true;
    if ($('#importUsersTrial')) $('#importUsersTrial').checked = false;
    if ($('#importUsersMaxConnections')) $('#importUsersMaxConnections').value = '1';
    if ($('#importUsersDateFormat')) $('#importUsersDateFormat').value = 'ymd';
    if ($('#importUsersBouquetSearch')) $('#importUsersBouquetSearch').value = '';
    renderImportUsersBouquetList();
    if ($('#importUsersResults')) $('#importUsersResults').style.display = 'none';
  }

  function syncImportUsersPackageDefaults(pkgId) {
    const pkg = _packages.find(p => String(p.id) === String(pkgId));
    if (!pkg) return;
    const maxConnInput = $('#importUsersMaxConnections');
    if (maxConnInput && !maxConnInput.dataset.manual) {
      maxConnInput.value = String(pkg.max_connections || 1);
    }
    const trialInput = $('#importUsersTrial');
    if (trialInput && !_importUsersTrialLocked) {
      trialInput.checked = Number(pkg.is_trial || 0) === 1;
    }
  }

  function renderImportUsersBouquetList() {
    const list = $('#importUsersBouquetList');
    if (!list) return;
    const search = ($('#importUsersBouquetSearch')?.value || '').toLowerCase();
    const selected = new Set(Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(el => String(el.value)));
    const rows = _bouquets.filter(b => !search || String(b.bouquet_name || b.name || '').toLowerCase().includes(search));
    list.innerHTML = rows.map(b => `
      <label class="bouquet-select-item">
        <input type="checkbox" value="${b.id}" ${selected.has(String(b.id)) ? 'checked' : ''}>
        <span>${escHtml(b.bouquet_name || b.name || `Bouquet #${b.id}`)}</span>
      </label>
    `).join('') || '<div class="text-muted" style="padding:6px 8px">No bouquets available</div>';
  }

  function getImportUsersBouquetSelection() {
    const list = $('#importUsersBouquetList');
    if (!list) return [];
    return Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
      .map(el => el.value)
      .filter(Boolean);
  }

  function parseImportUsersText() {
    const text = $('#importUsersText')?.value || '';
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const format = $('#importUsersDateFormat')?.value || 'ymd';
    const users = [];
    const errors = [];
    for (const line of lines) {
      const parts = line.split(':');
      const username = parts[0]?.trim();
      const password = parts[1]?.trim() || generatePassword(10);
      const expRaw = parts[2]?.trim();
      let expDate = null;
      if (expRaw) {
        expDate = parseDateWithFormat(expRaw, format);
        if (!expDate) {
          errors.push(`${username || '(empty)'}: invalid expiry date`);
        }
      }
      if (username) {
        users.push({ username, password, exp_date: expDate || undefined });
      }
    }
    return { users, errors };
  }

  function generatePassword(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async function validateImportUsers() {
    const parsed = parseImportUsersText();
    const users = parsed.users;
    if (parsed.errors.length) {
      toast(parsed.errors[0], 'error');
      return;
    }
    if (!users.length) {
      toast('No users to validate', 'error');
      return;
    }
    const packageId = $('#importUsersPackage')?.value;
    if (!packageId) {
      toast('Please select a package', 'error');
      return;
    }

    try {
      const bouquets = getImportUsersBouquetSelection();
      const result = await apiFetch('/lines/bulk', {
        method: 'POST',
        body: JSON.stringify({
          users,
          package_id: parseInt(packageId, 10),
          member_id: parseInt($('#importUsersReseller')?.value || '0', 10),
          max_connections: parseInt($('#importUsersMaxConnections')?.value || '0', 10) || undefined,
          is_trial: $('#importUsersTrial')?.checked ? 1 : 0,
          bouquet: bouquets.length ? bouquets : undefined,
          test_mode: true,
          skip_duplicates: $('#importUsersSkipDuplicates')?.checked ?? true,
        }),
      });
      showImportUsersResults(result);
      toast('Validation complete');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function executeImportUsers() {
    const parsed = parseImportUsersText();
    const users = parsed.users;
    if (parsed.errors.length) {
      toast(parsed.errors[0], 'error');
      return;
    }
    if (!users.length) {
      toast('No users to import', 'error');
      return;
    }
    const packageId = $('#importUsersPackage')?.value;
    if (!packageId) {
      toast('Please select a package', 'error');
      return;
    }
    const testMode = $('#importUsersTestMode')?.checked ?? false;

    if (!testMode && !confirm(`Import ${users.length} user(s)?`)) {
      return;
    }

    try {
      const bouquets = getImportUsersBouquetSelection();
      const result = await apiFetch('/lines/bulk', {
        method: 'POST',
        body: JSON.stringify({
          users,
          package_id: parseInt(packageId, 10),
          member_id: parseInt($('#importUsersReseller')?.value || '0', 10),
          max_connections: parseInt($('#importUsersMaxConnections')?.value || '0', 10) || undefined,
          is_trial: $('#importUsersTrial')?.checked ? 1 : 0,
          bouquet: bouquets.length ? bouquets : undefined,
          test_mode: testMode,
          skip_duplicates: $('#importUsersSkipDuplicates')?.checked ?? true,
        }),
      });
      showImportUsersResults(result);
      toast(testMode ? 'Validation complete' : `Imported ${result.created || 0} user(s)`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function showImportUsersResults(result) {
    const resultsDiv = $('#importUsersResults');
    if (!resultsDiv) return;

    const isValidation = !!result.test_mode;
    const titleEl = $('#importUsersResultsTitle');
    const metaEl = $('#importUsersResultsMeta');
    const primaryLabel = $('#importUsersPrimaryLabel');
    if (titleEl) titleEl.textContent = isValidation ? 'Validation Results' : 'Import Results';
    if (metaEl) {
      metaEl.textContent = isValidation
        ? 'Review ready, skipped, and failed lines before running the actual import.'
        : 'Review created, skipped, and failed users before leaving this page.';
    }
    if (primaryLabel) primaryLabel.textContent = isValidation ? 'Ready' : 'Created';

    $('#importUsersCreated').textContent = result.created || 0;
    $('#importUsersSkipped').textContent = result.skipped || 0;
    $('#importUsersErrors').textContent = result.errors || 0;

    const log = $('#importUsersLog');
    if (log) {
      const lines = [];
      if (result.details && result.details.length) {
        for (const d of result.details) {
          const status = d.status === 'created' ? '✓' : d.status === 'skipped' ? '⊘' : '✗';
          lines.push(`${status} ${d.username}: ${d.message || d.status}`);
        }
      }
      log.textContent = lines.join('\n') || 'No details available';
    }

    resultsDiv.style.display = 'block';
  }

  // ─── Movies ──────────────────────────────────────────────────────

  async function loadMovies() {
    populateSelect('#moviesCatFilter', _movieCats, 'id', 'category_name', 'All Categories');
    await ensureServersCacheForPlaylist();
    try {
      const search = ($('#moviesSearch')?.value || '').trim();
      const catId = $('#moviesCatFilter')?.value || '';
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catId) params.set('category_id', catId);
      params.set('sort', 'id_desc');
      params.set('limit', String(_moviesPerPage));
      params.set('offset', String((_moviesPage - 1) * _moviesPerPage));
      const qs = `?${params.toString()}`;
      const data = await apiFetch(`/movies${qs}`);
      const movies = data.movies || [];
      _moviesTotal = data.total || 0;
      renderMoviesTable(movies, _moviesTotal);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  APP._moviesGoPage = function(p) {
    const totalPages = Math.max(1, Math.ceil(_moviesTotal / _moviesPerPage));
    if (p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    _moviesPage = p;
    loadMovies();
  };

  function renderMoviesPagination(total) {
    const bar = $('#moviesPagination');
    if (!bar) return;

    const page = _moviesPage;
    const totalPages = Math.max(1, Math.ceil(total / _moviesPerPage));
    const start = total ? (_moviesPage - 1) * _moviesPerPage + 1 : 0;
    const end = total ? Math.min(total, start + _moviesPerPage - 1) : 0;
    const pageInfo = `<span class="page-label">Showing</span> <span class="page-info">${start}-${end}</span> <span class="page-sep">/</span> <span class="page-total">${total}</span>`;
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';

    let buttons = `<button class="page-btn" ${prevDisabled} onclick="APP._moviesGoPage(${page - 1})">&lsaquo;</button>`;
    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = startPage + maxButtons - 1;
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="APP._moviesGoPage(${i})">${i}</button>`;
    }
    buttons += `<button class="page-btn" ${nextDisabled} onclick="APP._moviesGoPage(${page + 1})">&rsaquo;</button>`;

    bar.innerHTML = `<div class="pagination-info">${pageInfo}</div><div class="pagination-controls">${buttons}</div>`;
  }

  function renderMoviesTable(movies, total) {
    const countEl = $('#moviesCount');
    if (countEl) countEl.textContent = `Total: ${total || 0}`;

    const totalPages = Math.max(1, Math.ceil(total / _moviesPerPage));
    if (_moviesPage > totalPages) _moviesPage = totalPages;
    if (_moviesPage < 1) _moviesPage = 1;

    const tbody = $('#moviesTable tbody');
    if (!tbody) return;

    if (movies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:32px 0">No movies found</td></tr>`;
      $('#moviesPagination').innerHTML = '';
    } else {
      tbody.innerHTML = movies.map((m, i) => {
        const catName = _movieCats.find(c => String(c.id) === String(m.category_id))?.category_name || '-';
        const catColor = _movieCats.find(c => String(c.id) === String(m.category_id))?.color || '#6b9ef5';
        const coverUrl = m.stream_icon || '';
        const coverHtml = coverUrl
          ? `<img class="cover-thumb" src="${escHtml(coverUrl)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'"><span class="cover-placeholder" style="display:none"></span>`
          : `<span class="cover-placeholder"></span>`;
        const movieId = m.id;
        const year = m.year || '-';
        const rating = m.rating && m.rating !== '0' ? m.rating : '-';
        const tmdbIcon = (m.tmdb_id && m.tmdb_id > 0)
          ? `<button class="row-action-btn" style="color:#f59e0b" onclick="APP.syncMovieTmdb(${movieId})" title="Re-fetch TMDB metadata">&#128260;</button>`
          : `<span style="color:#8b949e;font-size:.75rem">—</span>`;
        const srvId = parseInt(m.stream_server_id, 10) || 0;
        const srvName = srvId > 0 ? (_serversCache.find(s => s.id === srvId)?.name || `Server #${srvId}`) : 'Default';

        return `<tr>
          <td width="50"><span style="color:#8b949e;font-size:.75rem">${movieId}</span></td>
          <td width="60">${coverHtml}</td>
          <td><span style="font-weight:500;color:#e6edf3">${escHtml(m.name || '')}</span></td>
          <td>
            <span class="cat-dot" style="background:${escHtml(catColor)}"></span>
            <span style="color:#8b949e;font-size:.82rem">${escHtml(catName)}</span>
          </td>
          <td><span style="color:#8b949e;font-size:.82rem">${year}</span></td>
          <td><span style="color:#8b949e;font-size:.82rem">${rating}</span></td>
          <td>${tmdbIcon}</td>
          <td><span style="color:#8b949e;font-size:.82rem">${escHtml(srvName)}</span></td>
          <td width="140">
            <div class="row-actions">
              <button class="row-action-btn play-btn" onclick="APP.playMovie(${movieId})" title="Play"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
              <button class="row-action-btn edit-btn" onclick="APP.editMovie(${movieId})" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="row-action-btn delete-btn" onclick="APP.deleteMovie(${movieId})" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </td>
        </tr>`;
      }).join('');

      renderMoviesPagination(total);
    }

    makeSortable($('#moviesTable'));
  }

  // ─── TMDB Sync ─────────────────────────────────────────────────

  APP.syncMovieTmdb = async function(id) {
    try {
      toast('Re-fetching metadata...', 'info');
      await apiFetch(`/tmdb/resync-movie/${id}`, { method: 'POST' });
      toast('Metadata updated', 'success');
      loadMovies();
    } catch (e) { toast(e.message, 'error'); }
  };

  APP.syncSeriesTmdb = async function(id) {
    try {
      toast('Re-fetching metadata...', 'info');
      await apiFetch(`/tmdb/resync-series/${id}`, { method: 'POST' });
      toast('Metadata updated', 'success');
      loadSeriesList();
    } catch (e) { toast(e.message, 'error'); }
  };

  APP.syncAllTmdb = async function() {
    try {
      toast('Syncing all TMDB metadata...', 'info');
      const data = await apiFetch('/tmdb/resync-all', { method: 'POST' });
      toast(`Synced ${data.ok} items (${data.fail} failed)`, data.fail > 0 ? 'warning' : 'success');
      loadMovies();
      loadSeriesList();
    } catch (e) { toast(e.message, 'error'); }
  };

  let _movieCatTags = [];
  let _movieBqTags = [];
  let _seriesBqTags = [];
  let _streamBqTags = [];
  let _streamSubCategoryTags = [];

  async function openMovieForm(movieData) {
    populateSelect('#movieCategory', _movieCats, 'id', 'category_name', 'Select category...');
    populateSelect('#movieBouquet', _bouquets, 'id', 'bouquet_name', 'Select bouquet...');

    _movieCatTags = [];
    _movieBqTags = [];

    if (movieData) {
      $('#movieFormTitle').textContent = 'Edit Movie';
      $('#movieFormId').value = movieData.id;
      $('#movieName').value = movieData.name || '';
      $('#movieYear').value = movieData.year || '';
      $('#movieExtension').value = movieData.container_extension || 'mp4';
      $('#moviePoster').value = movieData.stream_icon || '';
      $('#movieBackdrop').value = movieData.backdrop_path || '';
      $('#moviePlot').value = movieData.plot || '';
      $('#movieCast').value = movieData.movie_cast || '';
      $('#movieDirector').value = movieData.director || '';
      $('#movieGenre').value = movieData.genre || '';
      $('#movieReleaseDate').value = movieData.release_date || '';
      $('#movieDuration').value = movieData.duration || '';
      $('#movieRating').value = movieData.rating || '';
      $('#movieTrailer').value = movieData.youtube_trailer || '';
      $('#movieCountry').value = movieData.country || '';
      $('#movieTmdbId').value = movieData.tmdb_id || '';
      updateImgPreview('moviePosterPreview', movieData.stream_icon);
      updateImgPreview('movieBackdropPreview', movieData.backdrop_path);

      const primaryUrl = String(movieData.stream_url || '').trim();
      $('#movieMainUrl').value = primaryUrl;

      const sources = movieData.stream_source || '';
      let extraSrcs = [];
      try { extraSrcs = JSON.parse(sources); } catch { extraSrcs = sources ? [sources] : []; }
      if (!Array.isArray(extraSrcs)) extraSrcs = extraSrcs ? [extraSrcs] : [];
      extraSrcs = extraSrcs.filter(u => u && u !== primaryUrl);
      renderSourceRows(extraSrcs);

      if (movieData.category_id) {
        const cat = _movieCats.find(c => String(c.id) === String(movieData.category_id));
        if (cat) { _movieCatTags = [{ id: String(cat.id), name: cat.category_name }]; }
      }

      if (movieData.bouquet_ids && Array.isArray(movieData.bouquet_ids)) {
        _movieBqTags = movieData.bouquet_ids.map(bid => {
          const b = _bouquets.find(x => String(x.id) === String(bid));
          return b ? { id: String(b.id), name: b.bouquet_name || b.name } : { id: String(bid), name: String(bid) };
        });
      }

      const subs = movieData.subtitles || [];
      renderSubtitleRows(subs);
    } else {
      $('#movieFormTitle').textContent = 'Add Movie';
      $('#movieFormId').value = '';
      ['movieName', 'movieYear', 'movieMainUrl', 'moviePoster', 'movieBackdrop', 'moviePlot', 'movieCast',
        'movieDirector', 'movieGenre', 'movieReleaseDate', 'movieDuration', 'movieRating',
        'movieTrailer', 'movieCountry', 'movieTmdbId'].forEach(id => $(`#${id}`).value = '');
      $('#movieExtension').value = 'mp4';
      $('#moviePosterPreview').innerHTML = '';
      $('#movieBackdropPreview').innerHTML = '';
      renderSourceRows([]);
      renderSubtitleRows([]);
    }
    $('#movieTmdbSearch').value = '';
    $('#movieTmdbResults').style.display = 'none';
    renderMovieCatTags();
    renderMovieBqTags();

    await populateStreamServerSelect('#movieStreamServer', movieData && movieData.stream_server_id);
    movieTabNext('movie-details');
    $('#movieModal').style.display = 'flex';
  }

  function closeMovieModal() {
    $('#movieModal').style.display = 'none';
  }

  function movieTabNext(tabId) {
    const modal = $('#movieModal');
    modal.querySelectorAll('.xc-tab').forEach(t => t.classList.toggle('active', t.dataset.mtab === tabId));
    modal.querySelectorAll('.xc-tab-panel').forEach(p => p.classList.toggle('active', p.id === `mtab-${tabId}`));
  }

  function renderMovieCatTags() {
    $('#movieCategoryTags').innerHTML = _movieCatTags.map(t =>
      `<span class="tag-pill">${escHtml(t.name)} <button class="tag-pill-remove" onclick="APP.removeMovieCatTag('${t.id}')">&times;</button></span>`
    ).join('');
  }

  function addMovieCatTag(sel) {
    const id = sel.value;
    if (!id) return;
    if (_movieCatTags.some(t => t.id === id)) { sel.value = ''; return; }
    const opt = sel.options[sel.selectedIndex];
    _movieCatTags.push({ id, name: opt.textContent });
    sel.value = '';
    renderMovieCatTags();
  }

  function removeMovieCatTag(id) {
    _movieCatTags = _movieCatTags.filter(t => t.id !== id);
    renderMovieCatTags();
  }

  function renderMovieBqTags() {
    $('#movieBouquetTags').innerHTML = _movieBqTags.map(t =>
      `<span class="tag-pill">${escHtml(t.name)} <button class="tag-pill-remove" onclick="APP.removeMovieBqTag('${t.id}')">&times;</button></span>`
    ).join('');
  }

  function addMovieBqTag(sel) {
    const id = sel.value;
    if (!id) return;
    if (_movieBqTags.some(t => t.id === id)) { sel.value = ''; return; }
    const opt = sel.options[sel.selectedIndex];
    _movieBqTags.push({ id, name: opt.textContent });
    sel.value = '';
    renderMovieBqTags();
  }

  function removeMovieBqTag(id) {
    _movieBqTags = _movieBqTags.filter(t => t.id !== id);
    renderMovieBqTags();
  }

  function copyMovieUrl() {
    const url = $('#movieMainUrl').value;
    if (url) { navigator.clipboard.writeText(url).then(() => toast('URL copied')); }
  }

  function renderSourceRows(urls) {
    const container = $('#movieSourceUrls');
    container.innerHTML = urls.map(u =>
      `<div class="source-row"><input type="text" class="form-control movie-src-url" placeholder="http://..." value="${escHtml(u)}"><button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">X</button></div>`
    ).join('');
  }

  function addMovieSourceRow() {
    const container = $('#movieSourceUrls');
    const div = document.createElement('div');
    div.className = 'source-row';
    div.innerHTML = `<input type="text" class="form-control movie-src-url" placeholder="http://..."><button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">X</button>`;
    container.appendChild(div);
  }

  function renderSubtitleRows(subs) {
    const container = $('#movieSubtitles');
    container.innerHTML = (subs || []).map(s =>
      `<div class="source-row">
        <input type="text" class="form-control sub-lang" placeholder="Language" value="${escHtml(s.language || s.lang || '')}">
        <input type="text" class="form-control sub-url" placeholder="URL" value="${escHtml(s.url || '')}">
        <button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">X</button>
      </div>`
    ).join('');
  }

  function addSubtitleRow() {
    const container = $('#movieSubtitles');
    const div = document.createElement('div');
    div.className = 'source-row';
    div.innerHTML = `<input type="text" class="form-control sub-lang" placeholder="Language"><input type="text" class="form-control sub-url" placeholder="URL"><button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">X</button>`;
    container.appendChild(div);
  }

  function updateImgPreview(elId, url) {
    const el = $(`#${elId}`);
    if (el) el.innerHTML = url ? `<img src="${escHtml(url)}" class="preview-img" onerror="this.style.display='none'">` : '';
  }

  async function editMovie(id) {
    try {
      const movie = await apiFetch(`/movies/${id}`);
      await openMovieForm(movie);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveMovie() {
    const id = $('#movieFormId').value;
    const mainUrl = ($('#movieMainUrl').value || '').trim();
    const extraSrcs = [...$$('.movie-src-url')].map(i => i.value.trim()).filter(Boolean);
    const allSources = mainUrl ? [mainUrl, ...extraSrcs] : extraSrcs;
    const subs = [];
    $$('#movieSubtitles .source-row').forEach(row => {
      const lang = row.querySelector('.sub-lang')?.value || '';
      const url = row.querySelector('.sub-url')?.value || '';
      if (url) subs.push({ language: lang, url });
    });
    const body = {
      name: $('#movieName').value,
      year: parseInt($('#movieYear').value) || null,
      category_id: _movieCatTags.length ? _movieCatTags[0].id : '',
      container_extension: $('#movieExtension').value,
      stream_url: allSources[0] || '',
      stream_source: JSON.stringify(allSources),
      stream_icon: $('#moviePoster').value,
      backdrop_path: $('#movieBackdrop').value,
      plot: $('#moviePlot').value,
      movie_cast: $('#movieCast').value,
      director: $('#movieDirector').value,
      genre: $('#movieGenre').value,
      release_date: $('#movieReleaseDate').value,
      duration: $('#movieDuration').value,
      rating: $('#movieRating').value || '0',
      rating_5based: Math.round((parseFloat($('#movieRating').value) || 0) / 2 * 10) / 10,
      youtube_trailer: $('#movieTrailer').value,
      country: $('#movieCountry').value,
      tmdb_id: parseInt($('#movieTmdbId').value) || null,
      subtitles: subs,
      bouquet_ids: _movieBqTags.map(t => t.id),
      stream_server_id: (() => {
        const n = parseInt($('#movieStreamServer')?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
    };
    try {
      if (id) {
        await apiFetch(`/movies/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Movie updated');
      } else {
        await apiFetch('/movies', { method: 'POST', body: JSON.stringify(body) });
        toast('Movie created');
      }
      closeMovieModal();
      loadMovies();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteMovie(id) {
    if (!confirm('Delete this movie?')) return;
    try {
      await apiFetch(`/movies/${id}`, { method: 'DELETE' });
      toast('Movie deleted');
      loadMovies();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── TMDb Search (Movies) ───────────────────────────────────────

  function initTmdbSearch() {
    const input = $('#movieTmdbSearch');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(_tmdbTimer);
      const q = input.value.trim();
      if (q.length < 2) { $('#movieTmdbResults').style.display = 'none'; return; }
      _tmdbTimer = setTimeout(() => searchTmdbMovies(q), 400);
    });
    const seriesInput = $('#seriesTmdbSearch');
    if (seriesInput) {
      seriesInput.addEventListener('input', () => {
        clearTimeout(_tmdbTimer);
        const q = seriesInput.value.trim();
        if (q.length < 2) { $('#seriesTmdbResults').style.display = 'none'; return; }
        _tmdbTimer = setTimeout(() => searchTmdbSeries(q), 400);
      });
    }
  }

  async function searchTmdbMovies(query) {
    try {
      const data = await apiFetch('/tmdb/search', { method: 'POST', body: JSON.stringify({ query, type: 'movie' }) });
      const results = data.results || [];
      const dd = $('#movieTmdbResults');
      if (!results.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = results.slice(0, 8).map(r => `
        <div class="tmdb-item" data-id="${r.id}">
          ${r.poster_path ? `<img src="${escHtml(r.poster_path)}" class="tmdb-thumb">` : '<div class="tmdb-thumb-empty"></div>'}
          <div class="tmdb-item-info"><strong>${escHtml(r.title)}</strong><br><small>${r.year || ''} &bull; Rating: ${r.vote_average}</small></div>
        </div>
      `).join('');
      dd.style.display = 'block';
      dd.querySelectorAll('.tmdb-item').forEach(el => {
        el.addEventListener('click', () => selectTmdbMovie(Number(el.dataset.id)));
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function selectTmdbMovie(tmdbId) {
    $('#movieTmdbResults').style.display = 'none';
    try {
      const d = await apiFetch('/tmdb/details', { method: 'POST', body: JSON.stringify({ tmdb_id: tmdbId, type: 'movie' }) });
      $('#movieName').value = d.name || '';
      $('#movieYear').value = d.year || '';
      $('#moviePoster').value = d.movie_image || '';
      $('#movieBackdrop').value = d.backdrop_path || '';
      $('#moviePlot').value = d.plot || '';
      $('#movieCast').value = d.cast || '';
      $('#movieDirector').value = d.director || '';
      $('#movieGenre').value = d.genre || '';
      $('#movieReleaseDate').value = d.release_date || '';
      $('#movieDuration').value = d.duration || '';
      $('#movieRating').value = d.rating || '';
      $('#movieTrailer').value = d.youtube_trailer || '';
      $('#movieCountry').value = d.country || '';
      $('#movieTmdbId').value = d.tmdb_id || '';
      updateImgPreview('moviePosterPreview', d.movie_image);
      updateImgPreview('movieBackdropPreview', d.backdrop_path);
      toast('TMDb data loaded');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Movie Import ───────────────────────────────────────────────

  async function parseMovieImport() {
    try {
      const text = await getImportM3uText('#movieImportFile', '#movieImportM3u');
      if (!text) { toast('Select a file or paste M3U content', 'error'); return; }
      const entries = parseM3UText(text);
      if (!entries.length) { toast('No entries found', 'error'); return; }
      $('#movieImportCount').textContent = entries.length;
      $('#movieImportBody').innerHTML = entries.map(e =>
        `<tr><td>${escHtml(e.name)}</td><td class="text-truncate" style="max-width:300px">${escHtml(e.url)}</td><td>${escHtml(e.group)}</td></tr>`
      ).join('');
      $('#movieImportPreview').style.display = 'block';
      $('#movieImportPreview')._entries = entries;
      if ($('#movieImportM3u').value === '') $('#movieImportM3u').value = text;
    } catch (e) {
      toast(e.message || 'Parse failed', 'error');
    }
  }

  function parseM3UText(text) {
    const lines = text.split('\n');
    const entries = [];
    let current = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF:')) {
        const nameMatch = line.match(/,(.+)$/);
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        current = {
          name: nameMatch ? nameMatch[1].trim() : 'Unknown',
          group: groupMatch ? groupMatch[1] : '',
          logo: logoMatch ? logoMatch[1] : '',
        };
      } else if (current && line && !line.startsWith('#')) {
        current.url = line;
        entries.push(current);
        current = null;
      }
    }
    return entries;
  }

  async function confirmMovieImport() {
    try {
      const text = await getImportM3uText('#movieImportFile', '#movieImportM3u');
      if (!text) { toast('Select a file or paste M3U content', 'error'); return; }
      const catId = $('#movieImportCat').value;
      const noTmdb = $('#movieImportNoTmdb').checked;
      toast('Importing movies...');
      const data = await apiFetch('/movies/import', {
        method: 'POST',
        body: JSON.stringify({ m3u_text: text, category_id: catId, disable_tmdb: noTmdb }),
      });
      toast(`Imported ${data.imported || 0} movies`);
      navigateTo('movies');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Series ──────────────────────────────────────────────────────

  async function loadSeriesList() {
    populateSelect('#seriesCatFilter', _seriesCats, 'id', 'category_name', 'All Categories');
    await ensureServersCacheForPlaylist();
    try {
      const catId = $('#seriesCatFilter')?.value || '';
      const search = ($('#seriesSearch')?.value || '').trim();
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catId) params.set('category_id', catId);
      params.set('sort', 'id_desc');
      params.set('limit', String(_seriesPerPage));
      params.set('offset', String((_seriesPage - 1) * _seriesPerPage));
      const qs = `?${params.toString()}`;
      const data = await apiFetch(`/series${qs}`);
      const list = data.series || [];
      _seriesCache = list;
      _seriesTotal = data.total || 0;
      renderSeriesTable(list, _seriesTotal);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  APP._seriesGoPage = function(p) {
    const totalPages = Math.max(1, Math.ceil(_seriesTotal / _seriesPerPage));
    if (p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    _seriesPage = p;
    loadSeriesList();
  };

  function renderSeriesTable(series, total) {
    const countEl = $('#seriesCount');
    if (countEl) countEl.textContent = `Total: ${total || 0}`;

    const totalPages = Math.max(1, Math.ceil(total / _seriesPerPage));
    if (_seriesPage > totalPages) _seriesPage = totalPages;
    if (_seriesPage < 1) _seriesPage = 1;

    const tbody = $('#seriesTable tbody');
    if (!tbody) return;

    if (series.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:32px 0">No series found</td></tr>`;
      const bar = $('#seriesPagination');
      if (bar) bar.innerHTML = '';
    } else {
      tbody.innerHTML = series.map((s) => {
        const catName = _seriesCats.find(c => String(c.id) === String(s.category_id))?.category_name || s.category || '-';
        const catColor = _seriesCats.find(c => String(c.id) === String(s.category_id))?.color || '#6b9ef5';
        const coverUrl = s.cover || s.poster || '';
        const coverHtml = coverUrl
          ? `<img class="cover-thumb" src="${escHtml(coverUrl)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'"><span class="cover-placeholder" style="display:none"></span>`
          : `<span class="cover-placeholder"></span>`;
        let seasonCount = '-';
        try { const ss = JSON.parse(s.seasons || '[]'); seasonCount = ss.length || '-'; } catch { }
        const srvId = parseInt(s.stream_server_id, 10) || 0;
        const srvName = srvId > 0 ? (_serversCache.find(sv => sv.id === srvId)?.name || `Server #${srvId}`) : 'Default';
        const rating = s.rating && String(s.rating) !== '0' ? s.rating : (s.rating_5based ? `${s.rating_5based}/5` : '-');
        const tmdbLabel = s.tmdb_id ? String(s.tmdb_id) : '-';

        return `<tr>
          <td width="50"><span style="color:#8b949e;font-size:.75rem">${s.id}</span></td>
          <td width="55">${coverHtml}</td>
          <td><span style="font-weight:500;color:#e6edf3">${escHtml(s.title || s.name || '')}</span></td>
          <td>
            <span class="cat-dot" style="background:${escHtml(catColor)}"></span>
            <span style="color:#8b949e;font-size:.82rem">${escHtml(catName)}</span>
          </td>
          <td width="70"><span style="color:#8b949e;font-size:.82rem">${seasonCount}</span></td>
          <td width="70"><span style="color:#8b949e;font-size:.82rem">${escHtml(String(rating))}</span></td>
          <td width="80"><span style="color:#8b949e;font-size:.82rem">${escHtml(tmdbLabel)}</span></td>
          <td><span style="color:#8b949e;font-size:.82rem">${escHtml(srvName)}</span></td>
          <td>
            <div class="row-actions">
              <button class="row-action-btn play-btn" onclick="APP.playSeries(${s.id})" title="Play"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
              ${(s.tmdb_id && s.tmdb_id > 0) ? `<button class="row-action-btn" style="color:#f59e0b" onclick="APP.syncSeriesTmdb(${s.id})" title="Re-fetch TMDB metadata">&#128260;</button>` : ''}
              <button class="row-action-btn edit-btn" onclick="APP.editSeries(${s.id})" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="row-action-btn delete-btn" onclick="APP.deleteSeries(${s.id})" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </td>
        </tr>`;
      }).join('');
      renderSeriesPagination(total);
    }

    makeSortable($('#seriesTable'));
  }

  function renderSeriesPagination(total) {
    const bar = $('#seriesPagination');
    if (!bar) return;

    const page = _seriesPage;
    const totalPages = Math.max(1, Math.ceil(total / _seriesPerPage));
    const start = total ? (_seriesPage - 1) * _seriesPerPage + 1 : 0;
    const end = total ? Math.min(total, start + _seriesPerPage - 1) : 0;
    const pageInfo = `<span class="page-label">Showing</span> <span class="page-info">${start}-${end}</span> <span class="page-sep">/</span> <span class="page-total">${total}</span>`;
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';

    let buttons = `<button class="page-btn" ${prevDisabled} onclick="APP._seriesGoPage(${page - 1})">&lsaquo;</button>`;
    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = startPage + maxButtons - 1;
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="APP._seriesGoPage(${i})">${i}</button>`;
    }
    buttons += `<button class="page-btn" ${nextDisabled} onclick="APP._seriesGoPage(${page + 1})">&rsaquo;</button>`;

    bar.innerHTML = `<div class="pagination-info">${pageInfo}</div><div class="pagination-controls">${buttons}</div>`;
  }

  function renderSeriesBqTags() {
    const el = $('#seriesBouquetTags');
    if (!el) return;
    el.innerHTML = _seriesBqTags.map(t =>
      `<span class="tag-pill">${escHtml(t.name)} <button class="tag-pill-remove" onclick="APP.removeSeriesBqTag('${t.id}')">&times;</button></span>`
    ).join('');
  }

  function addSeriesBqTag(sel) {
    const id = sel.value;
    if (!id) return;
    if (_seriesBqTags.some(t => t.id === id)) { sel.value = ''; return; }
    const opt = sel.options[sel.selectedIndex];
    _seriesBqTags.push({ id, name: opt.textContent });
    sel.value = '';
    renderSeriesBqTags();
  }

  function removeSeriesBqTag(id) {
    _seriesBqTags = _seriesBqTags.filter(t => t.id !== id);
    renderSeriesBqTags();
  }

  async function openSeriesForm(seriesData) {
    navigateTo('series-form');
    populateSelect('#seriesCategory', _seriesCats, 'id', 'category_name', 'None');
    populateSelect('#seriesBouquet', _bouquets, 'id', 'bouquet_name', 'Select bouquet...');
    _seriesBqTags = [];
    _editingSeriesId = null;
    _editingSeriesSeasons = [];

    if (seriesData) {
      _editingSeriesId = seriesData.id;
      $('#seriesFormTitle').textContent = 'Edit Series';
      $('#seriesFormId').value = seriesData.id;
      $('#seriesTitle').value = seriesData.title || seriesData.name || '';
      $('#seriesYear').value = seriesData.year || '';
      $('#seriesCategory').value = seriesData.category_id || '';
      $('#seriesCover').value = seriesData.cover || '';
      $('#seriesBackdrop').value = seriesData.backdrop_path || '';
      $('#seriesPlot').value = seriesData.plot || '';
      $('#seriesCastField').value = seriesData.series_cast || '';
      $('#seriesDirector').value = seriesData.director || '';
      $('#seriesGenre').value = seriesData.genre || '';
      $('#seriesReleaseDate').value = seriesData.release_date || '';
      $('#seriesRating').value = seriesData.rating || '';
      $('#seriesTrailer').value = seriesData.youtube_trailer || '';
      $('#seriesTmdbId').value = seriesData.tmdb_id || '';
      updateImgPreview('seriesCoverPreview', seriesData.cover);
      updateImgPreview('seriesBackdropPreview', seriesData.backdrop_path);

      if (seriesData.bouquet_ids && Array.isArray(seriesData.bouquet_ids)) {
        _seriesBqTags = seriesData.bouquet_ids.map(bid => {
          const b = _bouquets.find(x => String(x.id) === String(bid));
          return b ? { id: String(b.id), name: b.bouquet_name || b.name } : { id: String(bid), name: String(bid) };
        });
      }

      if (seriesData.seasons && seriesData.seasons.length) {
        _editingSeriesSeasons = seriesData.seasons;
        renderEpisodesPanel(seriesData.seasons);
        $('#seriesEpisodesPanel').style.display = 'block';
      } else {
        $('#seriesEpisodesPanel').style.display = 'block';
        _editingSeriesSeasons = [];
        renderEpisodesPanel([]);
      }
    } else {
      $('#seriesFormTitle').textContent = 'Add Series';
      $('#seriesFormId').value = '';
      ['seriesTitle', 'seriesYear', 'seriesCover', 'seriesBackdrop', 'seriesPlot',
        'seriesCastField', 'seriesDirector', 'seriesGenre', 'seriesReleaseDate',
        'seriesRating', 'seriesTrailer', 'seriesTmdbId'].forEach(id => $(`#${id}`).value = '');
      $('#seriesCategory').value = '';
      $('#seriesCoverPreview').innerHTML = '';
      $('#seriesBackdropPreview').innerHTML = '';
      $('#seriesEpisodesPanel').style.display = 'none';
    }
    $('#seriesTmdbSearch').value = '';
    $('#seriesTmdbResults').style.display = 'none';
    renderSeriesBqTags();
    await populateStreamServerSelect('#seriesStreamServer', seriesData && seriesData.stream_server_id);
  }

  function renderEpisodesPanel(seasons) {
    const seasonNums = [...new Set(seasons.map(s => s.season_number))].sort((a, b) => a - b);
    if (!seasonNums.length) seasonNums.push(1);
    _activeSeason = seasonNums[0];

    $('#seasonTabs').innerHTML = seasonNums.map(n =>
      `<button class="btn btn-xs ${n === _activeSeason ? 'btn-primary' : 'btn-secondary'} season-tab-btn" data-season="${n}">Season ${n}</button>`
    ).join(' ');

    $$('.season-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeSeason = parseInt(btn.dataset.season);
        $$('.season-tab-btn').forEach(b => b.classList.replace('btn-primary', 'btn-secondary'));
        btn.classList.replace('btn-secondary', 'btn-primary');
        renderSeasonEpisodes();
      });
    });
    renderSeasonEpisodes();
  }

  function renderSeasonEpisodes() {
    const season = _editingSeriesSeasons.find(s => s.season_number === _activeSeason);
    const episodes = season ? season.episodes : [];
    $('#episodesTable tbody').innerHTML = episodes.map(ep => `
      <tr>
        <td>${ep.episode_num || ep.episode_number || ''}</td>
        <td>${escHtml(ep.title || '')}</td>
        <td class="text-truncate" style="max-width:250px">${escHtml(ep.stream_url || '')}</td>
        <td>${escHtml(ep.container_extension || 'mp4')}</td>
        <td>
          <button class="btn btn-xs btn-primary" onclick="APP.editEpisode(${ep.id})">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="APP.deleteEpisode(${ep.id})">Del</button>
        </td>
      </tr>
    `).join('');
  }

  async function editSeries(id) {
    try {
      const data = await apiFetch(`/series/${id}`);
      await openSeriesForm(data);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveSeries() {
    const id = $('#seriesFormId').value;
    const body = {
      title: $('#seriesTitle').value,
      year: parseInt($('#seriesYear').value) || null,
      category_id: $('#seriesCategory').value,
      cover: $('#seriesCover').value,
      backdrop_path: $('#seriesBackdrop').value,
      plot: $('#seriesPlot').value,
      series_cast: $('#seriesCastField').value,
      director: $('#seriesDirector').value,
      genre: $('#seriesGenre').value,
      release_date: $('#seriesReleaseDate').value,
      rating: $('#seriesRating').value || '0',
      rating_5based: Math.round((parseFloat($('#seriesRating').value) || 0) / 2 * 10) / 10,
      youtube_trailer: $('#seriesTrailer').value,
      tmdb_id: parseInt($('#seriesTmdbId').value) || null,
      bouquet_ids: _seriesBqTags.map(t => parseInt(t.id, 10)).filter(n => Number.isFinite(n)),
      stream_server_id: (() => {
        const n = parseInt($('#seriesStreamServer')?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
    };
    try {
      if (id) {
        await apiFetch(`/series/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Series updated');
      } else {
        const res = await apiFetch('/series', { method: 'POST', body: JSON.stringify(body) });
        toast('Series created');
        _editingSeriesId = res.id;
        $('#seriesFormId').value = res.id;
        $('#seriesFormTitle').textContent = 'Edit Series';
        $('#seriesEpisodesPanel').style.display = 'block';
        renderEpisodesPanel([]);
        return;
      }
      navigateTo('series');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteSeries(id) {
    if (!confirm('Delete this series and all episodes?')) return;
    try {
      await apiFetch(`/series/${id}`, { method: 'DELETE' });
      toast('Series deleted');
      loadSeriesList();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── TMDb Search (Series) ──────────────────────────────────────

  async function searchTmdbSeries(query) {
    try {
      const data = await apiFetch('/tmdb/search', { method: 'POST', body: JSON.stringify({ query, type: 'tv' }) });
      const results = data.results || [];
      const dd = $('#seriesTmdbResults');
      if (!results.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = results.slice(0, 8).map(r => `
        <div class="tmdb-item" data-id="${r.id}">
          ${r.poster_path ? `<img src="${escHtml(r.poster_path)}" class="tmdb-thumb">` : '<div class="tmdb-thumb-empty"></div>'}
          <div class="tmdb-item-info"><strong>${escHtml(r.name)}</strong><br><small>${r.year || ''} &bull; Rating: ${r.vote_average}</small></div>
        </div>
      `).join('');
      dd.style.display = 'block';
      dd.querySelectorAll('.tmdb-item').forEach(el => {
        el.addEventListener('click', () => selectTmdbSeries(Number(el.dataset.id)));
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function selectTmdbSeries(tmdbId) {
    $('#seriesTmdbResults').style.display = 'none';
    try {
      const d = await apiFetch('/tmdb/details', { method: 'POST', body: JSON.stringify({ tmdb_id: tmdbId, type: 'tv' }) });
      $('#seriesTitle').value = d.title || '';
      $('#seriesYear').value = d.year || '';
      $('#seriesCover').value = d.cover || '';
      $('#seriesBackdrop').value = d.backdrop_path || '';
      $('#seriesPlot').value = d.plot || '';
      $('#seriesCastField').value = d.cast || '';
      $('#seriesDirector').value = d.director || '';
      $('#seriesGenre').value = d.genre || '';
      $('#seriesReleaseDate').value = d.release_date || '';
      $('#seriesRating').value = d.rating || '';
      $('#seriesTrailer').value = d.youtube_trailer || '';
      $('#seriesTmdbId').value = d.tmdb_id || '';
      updateImgPreview('seriesCoverPreview', d.cover);
      updateImgPreview('seriesBackdropPreview', d.backdrop_path);
      toast('TMDb data loaded');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Episodes ────────────────────────────────────────────────────

  function openEpisodeForm(epData) {
    const seriesId = _editingSeriesId || $('#seriesFormId').value;
    if (!seriesId) { toast('Save series first', 'error'); return; }
    $('#episodeModal').style.display = 'flex';
    $('#episodeSeriesId').value = seriesId;
    populateStreamServerSelect('#episodeServer', epData ? epData.stream_server_id : 0);
    if (epData) {
      $('#episodeFormTitle').textContent = 'Edit Episode';
      $('#episodeFormId').value = epData.id;
      $('#episodeSeason').value = epData.season_num || epData.season_number || 1;
      $('#episodeNum').value = epData.episode_num || epData.episode_number || 1;
      $('#episodeTitle').value = epData.title || '';
      $('#episodeUrl').value = epData.stream_url || '';
      $('#episodeExtension').value = epData.container_extension || 'mp4';
    } else {
      $('#episodeFormTitle').textContent = 'Add Episode';
      $('#episodeFormId').value = '';
      $('#episodeSeason').value = _activeSeason || 1;
      $('#episodeNum').value = 1;
      $('#episodeTitle').value = '';
      $('#episodeUrl').value = '';
      $('#episodeExtension').value = 'mp4';
    }
  }

  function closeEpisodeModal() {
    $('#episodeModal').style.display = 'none';
  }

  async function editEpisode(epId) {
    for (const season of _editingSeriesSeasons) {
      const ep = season.episodes.find(e => e.id === epId);
      if (ep) { openEpisodeForm(ep); return; }
    }
    toast('Episode not found', 'error');
  }

  async function saveEpisode() {
    const seriesId = $('#episodeSeriesId').value;
    const epId = $('#episodeFormId').value;
    const body = {
      season_num: parseInt($('#episodeSeason').value) || 1,
      episode_num: parseInt($('#episodeNum').value) || 1,
      title: $('#episodeTitle').value,
      stream_url: $('#episodeUrl').value,
      container_extension: $('#episodeExtension').value,
      stream_server_id: parseInt($('#episodeServer').value) || 0,
    };
    try {
      if (epId) {
        await apiFetch(`/episodes/${epId}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Episode updated');
      } else {
        await apiFetch(`/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(body) });
        toast('Episode added');
      }
      closeEpisodeModal();
      const refreshed = await apiFetch(`/series/${seriesId}`);
      _editingSeriesSeasons = refreshed.seasons || [];
      renderEpisodesPanel(_editingSeriesSeasons);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteEpisode(epId) {
    if (!confirm('Delete this episode?')) return;
    try {
      await apiFetch(`/episodes/${epId}`, { method: 'DELETE' });
      toast('Episode deleted');
      const seriesId = _editingSeriesId || $('#seriesFormId').value;
      if (seriesId) {
        const refreshed = await apiFetch(`/series/${seriesId}`);
        _editingSeriesSeasons = refreshed.seasons || [];
        renderEpisodesPanel(_editingSeriesSeasons);
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Standalone Episodes Page ───────────────────────────────────

  let _allEpisodesPage = 0;

  async function loadAllEpisodes() {
    const search = ($('#episodesSearch')?.value || '').trim();
    const seriesId = $('#episodesSeriesFilter')?.value || '';
    const perPage = parseInt($('#episodesPerPage')?.value) || 50;
    const offset = _allEpisodesPage * perPage;

    try {
      const seriesData = await apiFetch('/series');
      const seriesList = seriesData.series || [];
      populateSelect('#episodesSeriesFilter', seriesList, 'id', 'title', 'All Series');
      if (seriesId) $('#episodesSeriesFilter').value = seriesId;

      let qs = `?limit=${perPage}&offset=${offset}`;
      if (search) qs += `&search=${encodeURIComponent(search)}`;
      if (seriesId) qs += `&series_id=${seriesId}`;

      const data = await apiFetch(`/episodes${qs}`);
      const episodes = data.episodes || [];
      const total = data.total || 0;

      $('#allEpisodesTable tbody').innerHTML = episodes.map(ep => {
        const seriesName = ep.series_title || `Series #${ep.series_id}`;
        const subtitle = `${seriesName} - Season ${ep.season_num}`;
        const dateAdded = ep.added ? formatDate(ep.added) : '-';
        return `<tr>
          <td>${ep.id}</td>
          <td>${thumbImg(ep.series_cover, 40, 56)}</td>
          <td>
            <strong>${escHtml(ep.title || `Episode ${ep.episode_num}`)}</strong>
            <br><small style="color:#8b949e">${escHtml(subtitle)}</small>
          </td>
          <td><span class="badge badge-success">Main Server</span></td>
          <td><span class="badge badge-info">Proxy</span></td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editStandaloneEpisode(${ep.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteStandaloneEpisode(${ep.id})">Del</button>
          </td>
          <td>${dateAdded}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7">No episodes found</td></tr>';

      const totalPages = Math.ceil(total / perPage);
      let pagHtml = '';
      for (let i = 0; i < totalPages && i < 20; i++) {
        pagHtml += `<button class="btn btn-xs ${i === _allEpisodesPage ? 'btn-primary' : 'btn-secondary'}" onclick="APP.goEpisodesPage(${i})">${i + 1}</button> `;
      }
      $('#episodesPagination').innerHTML = pagHtml;
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function goEpisodesPage(p) {
    _allEpisodesPage = p;
    loadAllEpisodes();
  }

  function openStandaloneEpisodeForm() {
    $('#standaloneEpisodeModal').style.display = 'flex';
    apiFetch('/series').then(d => {
      populateSelect('#standaloneEpSeries', d.series || [], 'id', 'title', 'Select series...');
    });
    populateStreamServerSelect('#standaloneEpServer', 0);
    $('#standaloneEpSeason').value = 1;
    $('#standaloneEpNum').value = 1;
    $('#standaloneEpTitle').value = '';
    $('#standaloneEpUrl').value = '';
    $('#standaloneEpExt').value = 'mp4';
  }

  function closeStandaloneEpisodeModal() {
    $('#standaloneEpisodeModal').style.display = 'none';
  }

  async function saveStandaloneEpisode() {
    const seriesId = $('#standaloneEpSeries').value;
    if (!seriesId) { toast('Select a series first', 'error'); return; }
    const body = {
      season_num: parseInt($('#standaloneEpSeason').value) || 1,
      episode_num: parseInt($('#standaloneEpNum').value) || 1,
      title: $('#standaloneEpTitle').value,
      stream_url: $('#standaloneEpUrl').value,
      container_extension: $('#standaloneEpExt').value,
      stream_server_id: parseInt($('#standaloneEpServer').value) || 0,
    };
    try {
      await apiFetch(`/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(body) });
      toast('Episode added');
      closeStandaloneEpisodeModal();
      loadAllEpisodes();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function editStandaloneEpisode(epId) {
    try {
      const ep = await apiFetch(`/episodes/${epId}`);
      if (!ep) { toast('Episode not found', 'error'); return; }
      openEpisodeForm(ep);
      $('#episodeSeriesId').value = ep.series_id;
    } catch {
      toast('Could not load episode', 'error');
    }
  }

  async function deleteStandaloneEpisode(epId) {
    if (!confirm('Delete this episode?')) return;
    try {
      await apiFetch(`/episodes/${epId}`, { method: 'DELETE' });
      toast('Episode deleted');
      loadAllEpisodes();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── File Import Helpers ──────────────────────────────────────

  function readFileAsText(fileInput) {
    return new Promise((resolve, reject) => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    });
  }

  async function getImportM3uText(fileInputSel, textareaSel) {
    const fileEl = $(fileInputSel);
    const textEl = $(textareaSel);
    if (fileEl && fileEl.files && fileEl.files.length) {
      return await readFileAsText(fileEl);
    }
    return (textEl?.value || '').trim();
  }

  // ─── Series Import ──────────────────────────────────────────────

  async function confirmSeriesImport() {
    try {
      const text = await getImportM3uText('#seriesImportFile', '#seriesImportM3u');
      if (!text) { toast('Select a file or paste M3U content', 'error'); return; }
      const catId = $('#seriesImportCat').value;
      const noTmdb = $('#seriesImportNoTmdb').checked;
      toast('Importing series...');
      const data = await apiFetch('/series/import', {
        method: 'POST',
        body: JSON.stringify({ m3u_text: text, category_id: catId, disable_tmdb: noTmdb }),
      });
      $('#seriesImportResult').style.display = 'block';
      $('#seriesImportResultBody').innerHTML = `<p>Imported ${data.imported || 0} series.</p>` +
        (data.series || []).map(s => `<p>${escHtml(s.name)} - ${s.episodes} episodes</p>`).join('');
      toast(`Imported ${data.imported || 0} series`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Streams ─────────────────────────────────────────────────────

  async function channelFetch(path, opts = {}) {
    await addCsrfHeaders(opts);
    const res = await fetch('/api/channels' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (res.status === 401) { showLogin(); throw new Error((data && data.error) || 'unauthorized'); }
    if (res.status === 403) {
      const errorMsg = (data && data.error) || 'forbidden';
      if (shouldLogoutOn403(errorMsg)) showLogin();
      throw new Error(errorMsg);
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  let _streamsCache = [];
  let _streamsPage = 1;
  let _streamsPerPage = 25;
  let _streamsTotal = 0;
  let _channelLogoTarget = null;
  let _channelLogoSearchResults = [];
  let _topChannelsMonitorTimer = null;
  let _streamsAutoRefreshTimer = null;
  let _streamsAutoRefreshEnabled = true;
  let _pendingStreamStartId = null;   // channel ID being waited on via WS
  let _streamReadyByWS = false;       // set true by WS event to skip polling
  let _editingStreamOriginal = null;
  let _streamCustomMapEntries = [];
  let _streamEpgSourcesCache = [];
  let _moviesCache = [];
  let _moviesPage = 1;
  let _moviesPerPage = 50;
  let _moviesTotal = 0;
  let _seriesCache = [];
  let _seriesPage = 1;
  let _seriesPerPage = 50;
  let _seriesTotal = 0;
  let _categoriesCache = [];
  let _categoriesPage = 1;

  async function loadAddChannelsPage() {
    await openStreamForm(null, { skipNavigate: true });
  }

  async function loadMonitorTopChannelsPage() {
    stopTopChannelsMonitorAutoRefresh();
    await loadRefData();
    try {
      const data = await apiFetch('/channels/top-monitor');
      renderTopChannelsMonitor(data || {});
    } catch (e) {
      const wrap = $('#topChannelsSummaryCards');
      const tbody = $('#topChannelsTable tbody');
      if (wrap) wrap.innerHTML = '';
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:32px 0">${escHtml(e.message || 'Failed to load top channels.')}</td></tr>`;
    }
    if (_currentPage === 'monitor-top-channels') {
      _topChannelsMonitorTimer = setTimeout(loadMonitorTopChannelsPage, 30000);
    }
  }

  async function loadStreamImportToolsPage() {
    await loadRefData();
  }

  function stopTopChannelsMonitorAutoRefresh() {
    if (_topChannelsMonitorTimer) {
      clearTimeout(_topChannelsMonitorTimer);
      _topChannelsMonitorTimer = null;
    }
  }

  function renderTopChannelsMonitor(data) {
    const totals = data && data.totals ? data.totals : {};
    const rows = Array.isArray(data && data.channels) ? data.channels : [];
    const cards = [
      { label: 'Total Viewers', value: Number(totals.total_viewers || 0) },
      { label: 'Active Channels', value: Number(totals.active_channels || 0) },
      { label: 'Active Servers', value: Number(totals.active_servers || 0) },
    ];
    const statsWrap = $('#topChannelsSummaryCards');
    if (statsWrap) {
      statsWrap.innerHTML = cards.map((card) => `
        <div class="stat-card channels-top-stat-card">
          <div class="stat-value blue">${dashboardFormatNumber(card.value)}</div>
          <div class="stat-label">${escHtml(card.label)}</div>
        </div>
      `).join('');
    }
    const tbody = $('#topChannelsTable tbody');
    if (tbody) {
      tbody.innerHTML = rows.length
        ? rows.map((row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escHtml(row.name || '')}</td>
            <td>${dashboardFormatNumber(row.viewers || 0)}</td>
            <td>${escHtml(row.server_name || 'Line / Default')}</td>
            <td>${escHtml(row.uptime_label || '—')}</td>
            <td>${row.bitrate_kbps ? `${dashboardFormatNumber(row.bitrate_kbps)} kbps` : '—'}</td>
            <td><div class="channels-source-cell">${escHtml(row.source || '—')}</div></td>
          </tr>
        `).join('')
        : '<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:32px 0">No active live channels with viewers right now.</td></tr>';
    }
    const footnote = $('#topChannelsLastUpdated');
    if (footnote) {
      footnote.textContent = data && data.refreshed_at
        ? `Last updated ${formatDate(data.refreshed_at)} · Auto-refresh every 30 seconds while this page is open.`
        : 'Auto-refresh every 30 seconds while this page is open.';
    }
  }

  function getStreamServerName(ch) {
    const sid = parseInt(ch && ch.stream_server_id, 10);
    if (!Number.isFinite(sid) || sid <= 0) return 'Line / Default';
    return _serversCache.find((s) => Number(s.id) === sid)?.name || `Server ${sid}`;
  }

  function formatUptime(startedAt) {
    if (streamsModule && typeof streamsModule.formatUptime === 'function') {
      return streamsModule.formatUptime(startedAt);
    }
    if (!startedAt) return '-';
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return '-';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  function buildStreamActionButtonsMarkup(ch) {
    if (streamsModule && typeof streamsModule.buildStreamActionButtonsMarkup === 'function') {
      return streamsModule.buildStreamActionButtonsMarkup(buildStreamsModuleContext(), ch);
    }
    return '';
  }

  function getStreamSourceUrl(ch) {
    if (!ch) return '';
    if (Array.isArray(ch.sourceQueue) && ch.sourceQueue.length) return String(ch.sourceQueue[0] || '');
    return String(ch.mpdUrl || '');
  }

  function formatSourceHost(url) {
    try {
      const parsed = new URL(String(url || '').trim());
      return parsed.hostname || String(url || '');
    } catch {
      return String(url || '');
    }
  }

  function formatStreamFps(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ratio = raw.match(/^(\d+)(?:\/(\d+))?$/);
    if (!ratio) return raw;
    const num = parseInt(ratio[1], 10);
    const den = parseInt(ratio[2] || '1', 10);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return raw;
    const fps = Math.round((num / den) * 100) / 100;
    return `${fps} FPS`;
  }

  // Streams list ownership moved to public/js/modules/streams.js.
  // Compatibility source markers kept here for tests/contracts only:
  // function buildStreamRowMarkup(
  // function renderStreamsPagination(


  APP._streamsGoPage = function(p) { _streamsPage = p; renderStreamsTable(); };
  APP.renderStreamsTable = renderStreamsTable;


  // ─── Stream Modal ──────────────────────────────────────────────

  let _streamSources = [];

  async function ensureServersCacheForPlaylist() {
    if (_serversCache.length) return;
    try {
      const data = await apiFetch('/servers');
      _serversCache = data.servers || [];
    } catch {
      _serversCache = [];
    }
  }

  async function populateStreamServerSelect(selectSelector, selectedRaw) {
    const sel = $(selectSelector);
    if (!sel) return;
    await ensureServersCacheForPlaylist();
    const parts = ['<option value="0">Use line / default</option>'];
    for (const s of _serversCache) {
      if (s.enabled === false) continue;
      const label = escHtml(String(s.name || `Server ${s.id}`));
      parts.push(`<option value="${s.id}">${label}</option>`);
    }
    sel.innerHTML = parts.join('');
    const n = parseInt(selectedRaw, 10);
    sel.value = Number.isFinite(n) && n > 0 ? String(n) : '0';
  }

  function renderStreamBqTags() {
    const el = $('#streamBouquetTags');
    if (!el) return;
    el.innerHTML = _streamBqTags.map(t =>
      `<span class="tag-pill">${escHtml(t.name)} <button class="tag-pill-remove" onclick="APP.removeStreamBqTag('${t.id}')">&times;</button></span>`
    ).join('');
  }

  function addStreamBqTag(sel) {
    const id = sel.value;
    if (!id) return;
    if (_streamBqTags.some(t => t.id === id)) { sel.value = ''; return; }
    const opt = sel.options[sel.selectedIndex];
    _streamBqTags.push({ id, name: opt.textContent });
    sel.value = '';
    renderStreamBqTags();
  }

  function removeStreamBqTag(id) {
    _streamBqTags = _streamBqTags.filter(t => t.id !== id);
    renderStreamBqTags();
  }

  async function openStreamForm(chData, options = {}) {
    if (!options.skipNavigate) navigateTo('add-channels');
    await loadRefData();

    const liveCats = _categories.filter(c => c.category_type === 'live');
    populateSelect('#streamCategory', liveCats, 'id', 'category_name', 'None');
    populateSelect('#streamBouquet', _bouquets, 'id', 'bouquet_name', 'Select bouquet...');
    _streamBqTags = [];

    const profileSel = $('#streamTranscodeProfile');
    if (profileSel) {
      try {
        const profiles = await api('/api/transcode-profiles');
        profileSel.innerHTML = '<option value="">None (copy mode)</option>' +
          profiles.map(p => `<option value="${p.id}">${escHtml(p.name)} (${p.output_mode})</option>`).join('');
      } catch { profileSel.innerHTML = '<option value="">None (copy mode)</option>'; }
    }

    $$('#page-add-channels .wizard-tab').forEach((t, i) => {
      t.classList.toggle('active', i === 0);
    });
    $$('#page-add-channels .wizard-panel').forEach((p, i) => {
      p.classList.toggle('active', i === 0);
    });

    if (chData) {
      $('#channelFormTitle').textContent = 'Edit Channel';
      $('#channelFormSubtitle').textContent = 'Update the live channel definition, source map, restart policy, EPG binding, and delivery/server behavior without leaving the Channels workflow.';
      $('#streamFormId').value = chData.id;
      $('#streamName').value = chData.name || '';
      $('#streamPrimaryUrl').value = chData.mpdUrl || '';
      $('#streamLogoUrl').value = chData.logoUrl || '';
      $('#streamCategory').value = chData.category_id || '';
      $('#streamNotes').value = chData.notes || '';

      const sq = Array.isArray(chData.sourceQueue) ? chData.sourceQueue : [];
      _streamSources = [...sq];
      if (_streamSources.length === 0) _streamSources = [''];
      renderSourceTable();

      $('#streamInputType').value = chData.inputType || 'auto';

      $('#streamGenPts').checked = chData.gen_timestamps !== false;
      $('#streamReadNative').checked = !!chData.read_native;
      if ($('#streamMinimalIngest')) $('#streamMinimalIngest').checked = !!chData.minimalIngest;
      $('#streamStreamAll').checked = !!chData.stream_all;
      $('#streamAllowRecord').checked = chData.allow_record !== false;
      $('#streamFpsRestart').checked = !!chData.fps_restart;
      $('#streamFpsThreshold').value = chData.fps_threshold || 90;
      updateFpsThresholdVisibility();
      $('#streamCustomSid').value = chData.custom_sid || '';
      $('#streamProbesize').value = chData.probesize_ondemand || 1500000;
      $('#streamDelayMin').value = chData.delay_minutes || 0;
      $('#streamUserAgent').value = chData.userAgent || '';
      $('#streamReferer').value = chData.referer || '';
      $('#streamHttpProxy').value = chData.httpProxy || '';
      $('#streamCustomArgs').value = chData.customFfmpegArgs || '';
      $('#streamMaxRetries').value = chData.maxRetries || 0;
      $('#streamRetryDelay').value = chData.retryDelaySec || 5;
      if (profileSel) profileSel.value = chData.transcode_profile_id || '';
      $('#streamAutoFix').checked = !!chData.autoFixEnabled;
      $('#streamSortOrder').value = chData.sortOrder || 0;
      $('#streamOutputFormat').value = chData.outputFormat || 'hls';

      $('#streamEpgId').value = chData.epgChannelId || '';
      $('#streamEpgOffset').value = chData.epg_offset || 0;

      $('#streamOnDemand').checked = !!chData.on_demand;
      if ($('#streamPreWarm')) {
        $('#streamPreWarm').disabled = !_streamingPrewarmAllowed;
        $('#streamPreWarm').checked = _streamingPrewarmAllowed && !!chData.preWarm;
      }
      if ($('#streamPrebufferMbOverride')) {
        const pbm = chData.prebuffer_size_mb;
        $('#streamPrebufferMbOverride').value =
          pbm !== undefined && pbm !== null && pbm !== '' ? String(pbm) : '';
      }
      if ($('#streamIngestOverride')) {
        const io = chData.ingest_style_override;
        $('#streamIngestOverride').value =
          io && ['webapp', 'xc', 'safe'].includes(String(io).toLowerCase()) ? String(io).toLowerCase() : '';
      }
      $('#streamRestartOnEdit').checked = !!chData.restart_on_edit;
      $('#streamStartNowAfterSave').checked = false;

      if (chData.bouquet_ids && Array.isArray(chData.bouquet_ids)) {
        _streamBqTags = chData.bouquet_ids.map(bid => {
          const b = _bouquets.find(x => String(x.id) === String(bid));
          return b ? { id: String(b.id), name: b.bouquet_name || b.name } : { id: String(bid), name: String(bid) };
        });
      }
    } else {
      $('#channelFormTitle').textContent = 'Add Channels';
      $('#channelFormSubtitle').textContent = 'Create a live channel using the real panel runtime, category mapping, bouquet assignment, EPG linkage, restart policy, and server delivery options.';
      $('#streamFormId').value = '';
      ['streamName', 'streamPrimaryUrl', 'streamLogoUrl', 'streamNotes', 'streamCustomSid',
        'streamUserAgent', 'streamReferer', 'streamHttpProxy', 'streamCustomArgs',
        'streamEpgId'].forEach(fid => { const el = $(`#${fid}`); if (el) el.value = ''; });
      $('#streamCategory').value = '';
      _streamSources = [''];
      renderSourceTable();
      $('#streamInputType').value = 'auto';
      $('#streamGenPts').checked = true;
      $('#streamReadNative').checked = false;
      if ($('#streamMinimalIngest')) $('#streamMinimalIngest').checked = false;
      $('#streamStreamAll').checked = false;
      $('#streamAllowRecord').checked = true;
      $('#streamFpsRestart').checked = false;
      $('#streamFpsThreshold').value = 90;
      updateFpsThresholdVisibility();
      $('#streamProbesize').value = 1500000;
      $('#streamDelayMin').value = 0;
      $('#streamMaxRetries').value = 3;
      $('#streamRetryDelay').value = 5;
      if (profileSel) profileSel.value = '';
      $('#streamAutoFix').checked = false;
      $('#streamSortOrder').value = 0;
      $('#streamOutputFormat').value = 'hls';
      $('#streamEpgOffset').value = 0;
      $('#streamOnDemand').checked = false;
      if ($('#streamPreWarm')) {
        $('#streamPreWarm').disabled = !_streamingPrewarmAllowed;
        $('#streamPreWarm').checked = false;
      }
      if ($('#streamPrebufferMbOverride')) $('#streamPrebufferMbOverride').value = '';
      if ($('#streamIngestOverride')) $('#streamIngestOverride').value = '';
      $('#streamRestartOnEdit').checked = false;
      $('#streamStartNowAfterSave').checked = false;
    }
    await populateStreamServerSelect('#streamPlaylistServer', chData && chData.stream_server_id);
    renderStreamBqTags();
    previewStreamLogo();
  }

  function closeStreamModal() {
    navigateTo('manage-channels');
  }

  function updateFpsThresholdVisibility() {
    const row = $('#fpsThresholdRow');
    if (row) row.style.display = $('#streamFpsRestart')?.checked ? 'flex' : 'none';
  }

  function renderSourceTable() {
    const tbody = $('#sourceTableBody');
    if (!tbody) return;
    tbody.innerHTML = _streamSources.map((url, i) => `<tr>
      <td style="color:#8b949e;text-align:center">${i + 1}</td>
      <td><input type="text" class="form-control source-url-input" value="${escHtml(url)}" data-idx="${i}" placeholder="Stream URL..."></td>
      <td><div class="source-info-mini" id="srcInfo${i}">-</div></td>
      <td style="text-align:center">
        <button class="btn-icon btn-icon-del" onclick="APP.removeSourceRow(${i})" title="Remove">&times;</button>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.source-url-input').forEach(inp => {
      inp.addEventListener('change', () => { _streamSources[parseInt(inp.dataset.idx)] = inp.value.trim(); });
    });
  }

  function addSourceRow() {
    _streamSources.push('');
    renderSourceTable();
  }

  function removeSourceRow(idx) {
    if (_streamSources.length <= 1) return;
    _streamSources.splice(idx, 1);
    renderSourceTable();
  }

  async function scanAllSources() {
    const ua = $('#streamUserAgent')?.value || '';
    const proxy = $('#streamHttpProxy')?.value || '';
    for (let i = 0; i < _streamSources.length; i++) {
      const url = _streamSources[i];
      if (!url) continue;
      const el = $(`#srcInfo${i}`);
      if (el) el.innerHTML = '<span style="color:#d29922">Scanning...</span>';
      try {
        const opts = {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, user_agent: ua, http_proxy: proxy }),
        };
        await addCsrfHeaders(opts);
        const resp = await fetch('/api/channels/probe-source', opts);
        const text = await resp.text();
        let info;
        try { info = JSON.parse(text); } catch { throw new Error('Probe returned invalid response'); }
        if (!resp.ok) throw new Error(info.error || 'Probe failed');
        if (el) el.innerHTML = `<span class="si-ok">${escHtml(info.video_codec || '?')} ${info.width || '?'}x${info.height || '?'} ${info.fps || '?'}fps</span><br>${escHtml(info.audio_codec || '?')} ${info.bitrate ? Math.round(info.bitrate / 1000) + 'kbps' : ''}`;
      } catch (err) {
        if (el) el.innerHTML = `<span style="color:#f85149">${escHtml(err.message)}</span>`;
      }
    }
  }

  function previewStreamLogo() {
    const url = $('#streamLogoUrl')?.value;
    const container = $('#streamLogoPreview');
    if (!container) return;
    if (!url) { container.innerHTML = ''; return; }
    container.innerHTML = `<img src="${escHtml(url)}" class="preview-img" onerror="this.outerHTML='<span class=\\'text-danger\\'>Failed to load</span>'">`;
  }

  function updateChannelLogoPreview(url, name) {
    const preview = $('#channelLogoCurrentPreview');
    const currentUrl = $('#channelLogoCurrentUrl');
    const safeUrl = String(url || '').trim();
    if (preview) {
      preview.innerHTML = safeUrl
        ? `<img src="${escHtml(safeUrl)}" alt="${escHtml(name || 'Channel')}" class="channels-logo-current-image" onerror="this.outerHTML='<span class=\\'channels-table-logo-fallback\\'>Logo</span>'">`
        : '<span class="channels-table-logo-fallback">No Logo</span>';
    }
    if (currentUrl) currentUrl.textContent = safeUrl || 'No custom logo set';
  }

  function renderChannelLogoSearchResults() {
    const wrap = $('#channelLogoSearchResults');
    if (!wrap) return;
    if (!_channelLogoSearchResults.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = _channelLogoSearchResults.map((item) => `
      <div class="channels-logo-result-card">
        <div class="channels-logo-result-preview">${item.logoUrl ? `<img src="${escHtml(item.logoUrl)}" alt="${escHtml(item.name || '')}" class="channels-logo-result-image" onerror="this.outerHTML='<span class=\\'channels-table-logo-fallback\\'>Logo</span>'">` : '<span class="channels-table-logo-fallback">Logo</span>'}</div>
        <div class="channels-logo-result-name">${escHtml(item.name || '')}</div>
        <button class="btn btn-xs btn-primary" onclick="APP.applyChannelLogoResult(decodeURIComponent('${encodeURIComponent(item.logoUrl || '')}'))">Set Icon</button>
      </div>
    `).join('');
  }

  async function editStream(id) {
    try {
      const list = await fetch('/api/channels', { credentials: 'same-origin' }).then(r => r.json());
      const ch = (Array.isArray(list) ? list : []).find(c => c.id === id);
      if (!ch) { toast('Stream not found', 'error'); return; }
      await openStreamForm(ch);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveStream() {
    const id = $('#streamFormId').value;

    $$('#sourceTableBody .source-url-input').forEach(inp => {
      _streamSources[parseInt(inp.dataset.idx)] = inp.value.trim();
    });
    const primaryUrl = ($('#streamPrimaryUrl')?.value || '').trim();
    const sourceQueue = _streamSources.filter(Boolean);
    const mpdUrl = primaryUrl;

    const tpVal = $('#streamTranscodeProfile') ? $('#streamTranscodeProfile').value : '';
    const body = {
      name: $('#streamName').value,
      mpdUrl,
      inputType: $('#streamInputType').value,
      sourceQueue,
      epgChannelId: $('#streamEpgId').value,
      logoUrl: $('#streamLogoUrl').value,
      category_id: $('#streamCategory').value || null,
      notes: $('#streamNotes').value,
      transcode_profile_id: tpVal ? parseInt(tpVal, 10) : null,
      outputFormat: $('#streamOutputFormat').value,
      userAgent: $('#streamUserAgent').value,
      referer: $('#streamReferer').value,
      httpProxy: $('#streamHttpProxy').value || null,
      customFfmpegArgs: $('#streamCustomArgs').value,
      maxRetries: parseInt($('#streamMaxRetries').value) || 0,
      retryDelaySec: parseInt($('#streamRetryDelay').value) || 5,
      autoFixEnabled: $('#streamAutoFix').checked,
      sortOrder: parseInt($('#streamSortOrder').value) || 0,
      gen_timestamps: $('#streamGenPts').checked,
      read_native: $('#streamReadNative').checked,
      minimalIngest: $('#streamMinimalIngest') ? $('#streamMinimalIngest').checked : false,
      stream_all: $('#streamStreamAll').checked,
      allow_record: $('#streamAllowRecord').checked,
      fps_restart: $('#streamFpsRestart').checked,
      fps_threshold: parseInt($('#streamFpsThreshold').value) || 90,
      custom_sid: $('#streamCustomSid').value,
      probesize_ondemand: parseInt($('#streamProbesize').value) || 1500000,
      delay_minutes: parseInt($('#streamDelayMin').value) || 0,
      on_demand: $('#streamOnDemand').checked,
      preWarm: $('#streamPreWarm') && !_streamingPrewarmAllowed ? false : ($('#streamPreWarm') ? $('#streamPreWarm').checked : false),
      prebuffer_size_mb: (() => {
        const raw = $('#streamPrebufferMbOverride')?.value?.trim();
        if (!raw) return null;
        const n = parseFloat(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      ingest_style_override: (() => {
        const v = $('#streamIngestOverride')?.value;
        return v && ['webapp', 'xc', 'safe'].includes(v) ? v : null;
      })(),
      restart_on_edit: $('#streamRestartOnEdit').checked,
      epg_offset: parseInt($('#streamEpgOffset').value) || 0,
      bouquet_ids: _streamBqTags.map(t => parseInt(t.id, 10)).filter(n => Number.isFinite(n)),
      stream_server_id: (() => {
        const n = parseInt($('#streamPlaylistServer')?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
    };
    try {
      let targetId = id;
      if (id) {
        await channelFetch(`/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        targetId = id;
        toast('Channel updated');
      } else {
        const created = await channelFetch('', { method: 'POST', body: JSON.stringify(body) });
        targetId = created && created.id ? created.id : '';
        toast('Channel created');
      }
      if ($('#streamStartNowAfterSave')?.checked && targetId) {
        try {
          await channelFetch(`/${targetId}/start`, { method: 'POST' });
          toast('Channel started');
        } catch (startErr) {
          toast(startErr.message || 'Channel saved but start failed', 'warning');
        }
      }
      navigateTo('manage-channels');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function startStream(id) {
    try {
      toast('Starting stream...');
      await channelFetch(`/${id}/start`, { method: 'POST' });
      if (_editingStreamOriginal && String(_editingStreamOriginal.id) === String(id)) _editingStreamOriginal.status = 'running';
      toast('Stream started');
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function stopStream(id) {
    try {
      await channelFetch(`/${id}/stop`, { method: 'POST' });
      if (_editingStreamOriginal && String(_editingStreamOriginal.id) === String(id)) _editingStreamOriginal.status = 'stopped';
      toast('Stream stopped');
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function restartStream(id) {
    try {
      toast('Restarting stream...');
      await channelFetch(`/${id}/restart`, { method: 'POST' });
      if (_editingStreamOriginal && String(_editingStreamOriginal.id) === String(id)) _editingStreamOriginal.status = 'running';
      toast('Stream restarted');
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteStream(id) {
    if (!confirm('Delete this stream? This will stop it and remove all data.')) return;
    try {
      await channelFetch(`/${id}`, { method: 'DELETE' });
      toast('Stream deleted');
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const CHANNEL_FORM_TABS = [
    'channel-details',
    'channel-advanced',
    'channel-map',
    'channel-restart',
    'channel-epg',
    'channel-servers',
  ];

  function ensureStreamSourceSlots() {
    if (!Array.isArray(_streamSources)) _streamSources = [];
    while (_streamSources.length < 2) _streamSources.push('');
  }

  function syncStreamSourcesFromInputs() {
    ensureStreamSourceSlots();
    _streamSources[0] = ($('#streamPrimaryUrl')?.value || '').trim();
    _streamSources[1] = ($('#streamSwapUrl')?.value || '').trim();
  }

  function updateStreamExtraSourceNote() {
    const note = $('#streamExtraSourceNote');
    if (!note) return;
    const extras = Math.max(0, (_streamSources || []).filter(Boolean).length - 2);
    note.textContent = extras > 0 ? `${extras} extra mapped source${extras === 1 ? '' : 's'} preserved` : '';
  }

  function renderStreamSourceEditors() {
    ensureStreamSourceSlots();
    const primary = $('#streamPrimaryUrl');
    const swap = $('#streamSwapUrl');
    if (primary) primary.value = _streamSources[0] || '';
    if (swap) swap.value = _streamSources[1] || '';
    updateStreamExtraSourceNote();
  }

  function renderStreamSubCategoryTags() {
    const el = $('#streamSubCategoryTags');
    if (!el) return;
    el.innerHTML = _streamSubCategoryTags.map((t) =>
      `<span class="tag-pill">${escHtml(t.name)} <button class="tag-pill-remove" onclick="APP.removeStreamSubCategoryTag('${t.id}')">&times;</button></span>`
    ).join('');
  }

  function addStreamSubCategoryTag(sel) {
    const id = String(sel && sel.value || '').trim();
    if (!id) return;
    if ($('#streamCategory')?.value === id) {
      sel.value = '';
      return toast('Main category is already selected', 'warning');
    }
    if (_streamSubCategoryTags.some((t) => t.id === id)) {
      sel.value = '';
      return;
    }
    const opt = sel.options[sel.selectedIndex];
    _streamSubCategoryTags.push({ id, name: opt ? opt.textContent : id });
    sel.value = '';
    renderStreamSubCategoryTags();
  }

  function removeStreamSubCategoryTag(id) {
    _streamSubCategoryTags = _streamSubCategoryTags.filter((t) => t.id !== id);
    renderStreamSubCategoryTags();
  }

  function parseStreamHeadersText(text) {
    const headers = {};
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) headers[key] = value;
      });
    return headers;
  }

  function buildStreamHeadersFromForm() {
    const headers = parseStreamHeadersText($('#streamHeaders')?.value || '');
    const cookie = ($('#streamCookie')?.value || '').trim();
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  function hydrateStreamHeaderFields(channel) {
    const rawHeaders = channel && channel.headers && typeof channel.headers === 'object' ? { ...channel.headers } : {};
    const cookie = rawHeaders.Cookie || rawHeaders.cookie || '';
    delete rawHeaders.Cookie;
    delete rawHeaders.cookie;
    $('#streamCookie').value = cookie;
    $('#streamHeaders').value = Object.entries(rawHeaders).map(([key, value]) => `${key}: ${value}`).join('\n');
  }

  async function loadStreamEditorEpgSources(selectedRaw) {
    const select = $('#streamEpgSource');
    if (!select) return;
    try {
      const data = await apiFetch('/epg/sources');
      _streamEpgSourcesCache = data.sources || [];
    } catch {
      _streamEpgSourcesCache = [];
    }
    select.innerHTML = '<option value="0">No EPG</option>' + _streamEpgSourcesCache.map((src) => `<option value="${src.id}">${escHtml(src.name || `Source ${src.id}`)}</option>`).join('');
    const selected = parseInt(selectedRaw, 10);
    select.value = Number.isFinite(selected) && selected > 0 ? String(selected) : '0';
  }

  function renderStreamCustomMapTable() {
    const body = $('#streamCustomMapBody');
    if (!body) return;
    if (!_streamCustomMapEntries.length) {
      body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#c7ced8;padding:18px 0">No data available in table</td></tr>';
      return;
    }
    body.innerHTML = _streamCustomMapEntries.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escHtml(entry.type || 'Manual')}</td>
        <td>${escHtml(entry.info || '')}</td>
      </tr>
    `).join('');
  }

  function addChannelCustomMapEntry() {
    const query = ($('#streamCustomMapQuery')?.value || '').trim();
    if (!query) return;
    if (_streamCustomMapEntries.some((entry) => entry.info === query)) return;
    _streamCustomMapEntries.push({ type: 'Manual', info: query });
    $('#streamCustomMapQuery').value = '';
    renderStreamCustomMapTable();
  }

  async function populateStreamTimeshiftServerSelect(selectedRaw) {
    const sel = $('#streamTimeshiftServer');
    if (!sel) return;
    await ensureServersCacheForPlaylist();
    sel.innerHTML = '<option value="0">Timeshift Disabled</option>' + _serversCache
      .filter((server) => server.enabled !== false)
      .map((server) => `<option value="${server.id}">${escHtml(String(server.name || `Server ${server.id}`))}</option>`)
      .join('');
    const selected = parseInt(selectedRaw, 10);
    sel.value = Number.isFinite(selected) && selected > 0 ? String(selected) : '0';
  }

  function updateStreamServerTree() {
    const tree = $('#streamServerTree');
    if (!tree) return;
    const selected = parseInt($('#streamPlaylistServer')?.value || '0', 10);
    const server = _serversCache.find((row) => Number(row.id) === selected);
    const name = server ? String(server.name || `Server ${server.id}`) : 'Use line / default';
    tree.innerHTML = `<div class="stream-editor-tree-root"><div class="stream-editor-tree-label">Stream Source</div><div class="stream-editor-tree-node">${escHtml(name)}</div></div>`;
  }

  function renderStreamEditorSummary(channel) {
    const card = $('#streamEditorSummaryCard');
    const body = $('#streamEditorSummaryBody');
    if (!card || !body) return;
    if (!channel || !channel.id) {
      card.style.display = 'none';
      body.innerHTML = '';
      return;
    }
    const si = channel.streamInfo || {};
    const codecLine = [si.video_codec ? String(si.video_codec).toLowerCase() : '', si.audio_codec ? String(si.audio_codec).toLowerCase() : ''].filter(Boolean).join(' / ');
    const bitrateLine = si.bitrate ? `${Math.round(si.bitrate / 1000)} Kbps` : 'No information available';
    const resolutionLine = [si.width && si.height ? `${si.width} x ${si.height}` : '', formatStreamFps(si.fps)].filter(Boolean).join(' · ');
    body.innerHTML = `
      <table class="data-table streams-editor-summary-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>NAME</th>
            <th>SOURCE</th>
            <th>CLIENTS</th>
            <th>UPTIME</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escHtml(String(channel.id || ''))}</td>
            <td><div class="streams-xc-name-cell"><div class="streams-xc-primary-name">${escHtml(channel.name || '')}</div><div class="streams-xc-secondary-name">${escHtml((_categories.find((c) => String(c.id) === String(channel.category_id))?.category_name) || channel.category || 'Uncategorized')}</div></div></td>
            <td><div class="streams-xc-source-cell"><div class="streams-xc-source-label">${escHtml(getStreamServerName(channel))}</div><div class="streams-xc-source-value">${escHtml(formatSourceHost(getStreamSourceUrl(channel)) || '-')}</div></div></td>
            <td><span class="clients-badge ${Number(channel.clients || 0) > 0 ? 'active' : 'zero'}">${Number(channel.clients || 0)}</span></td>
            <td><div class="streams-xc-uptime-card"><div class="streams-xc-uptime-pill">${escHtml(formatUptime(channel.startedAt) || (channel.on_demand ? 'ON DEMAND' : 'Stopped'))}</div><div class="streams-xc-uptime-meta"><span>${escHtml(bitrateLine)}</span>${codecLine ? `<span>${escHtml(codecLine)}</span>` : ''}</div><div class="streams-xc-uptime-meta muted">${escHtml(resolutionLine || 'No runtime information')}</div></div></td>
            <td><div class="row-actions streams-xc-row-actions">${buildStreamActionButtonsMarkup(channel)}</div></td>
          </tr>
        </tbody>
      </table>`;
    card.style.display = '';
  }

  function switchChannelFormTab(tabId) {
    const validTabId = CHANNEL_FORM_TABS.includes(tabId) ? tabId : CHANNEL_FORM_TABS[0];
    $$('#page-add-channels .stream-editor-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === validTabId));
    $$('#page-add-channels .wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${validTabId}`));
    const idx = CHANNEL_FORM_TABS.indexOf(validTabId);
    const prevBtn = $('#streamEditorPrevBtn');
    const nextBtn = $('#streamEditorNextBtn');
    if (prevBtn) prevBtn.style.visibility = idx <= 0 ? 'hidden' : 'visible';
    if (nextBtn) nextBtn.textContent = idx >= CHANNEL_FORM_TABS.length - 1 ? 'Finish' : 'Next';
  }

  function nextChannelFormTab() {
    const active = $('#page-add-channels .stream-editor-tab.active')?.dataset.tab || CHANNEL_FORM_TABS[0];
    const idx = CHANNEL_FORM_TABS.indexOf(active);
    if (idx < 0 || idx >= CHANNEL_FORM_TABS.length - 1) return;
    switchChannelFormTab(CHANNEL_FORM_TABS[idx + 1]);
  }

  function prevChannelFormTab() {
    const active = $('#page-add-channels .stream-editor-tab.active')?.dataset.tab || CHANNEL_FORM_TABS[0];
    const idx = CHANNEL_FORM_TABS.indexOf(active);
    if (idx <= 0) return;
    switchChannelFormTab(CHANNEL_FORM_TABS[idx - 1]);
  }

  function playEditingStream() {
    const id = ($('#streamFormId')?.value || '').trim();
    if (!id) return;
    const channel = _editingStreamOriginal || _streamsCache.find((row) => String(row.id) === String(id));
    openStreamPlayer(id, channel && channel.name ? channel.name : 'Stream');
  }

  function openEditingStreamLogoPicker() {
    const id = ($('#streamFormId')?.value || '').trim();
    if (!id) return previewStreamLogo();
    openChannelLogoModal(id);
  }

  async function probeSingleChannelSource(index) {
    syncStreamSourcesFromInputs();
    const url = String(_streamSources[index] || '').trim();
    const target = index === 0 ? $('#streamPrimaryUrlStatus') : $('#streamSwapUrlStatus');
    if (!url) {
      if (target) target.textContent = '';
      return;
    }
    if (target) target.innerHTML = '<span style="color:#d29922">Scanning...</span>';
    try {
      const opts = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          user_agent: $('#streamUserAgent')?.value || '',
          http_proxy: $('#streamHttpProxy')?.value || '',
        }),
      };
      await addCsrfHeaders(opts);
      const resp = await fetch('/api/channels/probe-source', opts);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Probe failed');
      if (target) {
        target.innerHTML = `<span class="si-ok">${escHtml(data.video_codec || '?')} ${data.width || '?'}x${data.height || '?'} ${escHtml(formatStreamFps(data.fps || '?'))}</span>`;
      }
    } catch (e) {
      if (target) target.innerHTML = `<span style="color:#f85149">${escHtml(e.message || 'Probe failed')}</span>`;
    }
  }

  function insertChannelSourceAfter(index) {
    syncStreamSourcesFromInputs();
    _streamSources.splice(index + 1, 0, '');
    renderStreamSourceEditors();
  }

  function removeChannelSource(index) {
    syncStreamSourcesFromInputs();
    if (_streamSources.length <= 2) {
      _streamSources[index] = '';
    } else {
      _streamSources.splice(index, 1);
    }
    renderStreamSourceEditors();
  }

  function promoteChannelSource(index) {
    syncStreamSourcesFromInputs();
    if (index <= 0 || index >= _streamSources.length) return;
    const tmp = _streamSources[index - 1];
    _streamSources[index - 1] = _streamSources[index];
    _streamSources[index] = tmp;
    renderStreamSourceEditors();
  }

  function demoteChannelSource(index) {
    syncStreamSourcesFromInputs();
    if (index < 0 || index >= _streamSources.length - 1) return;
    const tmp = _streamSources[index + 1];
    _streamSources[index + 1] = _streamSources[index];
    _streamSources[index] = tmp;
    renderStreamSourceEditors();
  }

  async function scanAllSources() {
    syncStreamSourcesFromInputs();
    await Promise.all([probeSingleChannelSource(0), probeSingleChannelSource(1)]);
  }

  async function openStreamForm(chData, options = {}) {
    if (!options.skipNavigate) navigateTo('add-channels');
    await loadRefData();
    await ensureServersCacheForPlaylist();

    const liveCats = _categories.filter((c) => c.category_type === 'live');
    populateSelect('#streamCategory', liveCats, 'id', 'category_name', 'None');
    populateSelect('#streamSubCategory', liveCats, 'id', 'category_name', 'Select sub-category...');
    populateSelect('#streamBouquet', _bouquets, 'id', 'bouquet_name', 'Select bouquet...');

    _streamBqTags = [];
    _streamSubCategoryTags = [];
    _streamCustomMapEntries = [];
    _editingStreamOriginal = chData ? { ...chData } : null;
    if (chData && chData.id) {
      const cached = _streamsCache.find((row) => String(row.id) === String(chData.id));
      if (cached) Object.assign(cached, chData);
      else _streamsCache.unshift(chData);
    }

    const profileSel = $('#streamTranscodeProfile');
    if (profileSel) {
      try {
        const profiles = await api('/api/transcode-profiles');
        profileSel.innerHTML = '<option value="">Transcoding Disabled</option>' +
          profiles.map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
      } catch {
        profileSel.innerHTML = '<option value="">Transcoding Disabled</option>';
      }
    }

    await loadStreamEditorEpgSources(chData && chData.epg_source_id);
    await populateStreamServerSelect('#streamPlaylistServer', chData && chData.stream_server_id);
    await populateStreamTimeshiftServerSelect(chData && chData.timeshift_server_id);

    if (chData) {
      $('#channelFormTitle').textContent = chData.name || 'Edit Stream';
      $('#channelFormSubtitle').textContent = 'Update this stream using the same details, advanced, mapping, restart, EPG, and server tabs shown in the reference design.';
      $('#streamFormId').value = chData.id || '';
      $('#streamName').value = chData.name || '';
      $('#streamLogoUrl').value = chData.logoUrl || '';
      $('#streamCategory').value = chData.category_id || '';
      $('#streamNotes').value = chData.notes || '';
      $('#streamInputType').value = chData.inputType || 'auto';
      $('#streamGenPts').checked = chData.gen_timestamps !== false;
      $('#streamReadNative').checked = !!chData.read_native;
      $('#streamStreamAll').checked = !!chData.stream_all;
      $('#streamAllowRecord').checked = chData.allow_record !== false;
      $('#streamDirectSource').checked = !!chData.direct_source;
      $('#streamProtect').checked = !!chData.protect_stream;
      $('#streamCustomSid').value = chData.custom_sid || '';
      $('#streamDelayMin').value = chData.delay_minutes || 0;
      $('#streamProbesize').value = chData.probesize_ondemand || 1500000;
      $('#streamUserAgent').value = chData.userAgent || '';
      $('#streamHttpProxy').value = chData.httpProxy || '';
      $('#streamCustomArgs').value = chData.customFfmpegArgs || '';
      $('#streamRestartDays').value = chData.restart_days || '';
      $('#streamRestartTime').value = chData.restart_time || '06:00';
      $('#streamEpgId').value = chData.epgChannelId || '';
      $('#streamEpgLanguage').value = chData.epg_language || '';
      $('#streamOnDemandMode').value = chData.on_demand ? '1' : '0';
      $('#streamTimeshiftDays').value = chData.timeshift_days || 0;
      $('#streamRestartOnEdit').checked = !!chData.restart_on_edit;
      $('#streamCustomMapQuery').value = chData.custom_map_query || '';
      hydrateStreamHeaderFields(chData);

      if (profileSel) profileSel.value = chData.transcode_profile_id || '';

      _streamSources = Array.isArray(chData.sourceQueue) && chData.sourceQueue.length
        ? [...chData.sourceQueue]
        : [chData.mpdUrl || '', chData.swap_link || ''];
      _streamCustomMapEntries = Array.isArray(chData.custom_map_entries) ? [...chData.custom_map_entries] : [];

      if (Array.isArray(chData.bouquet_ids)) {
        _streamBqTags = chData.bouquet_ids.map((bid) => {
          const row = _bouquets.find((item) => String(item.id) === String(bid));
          return row ? { id: String(row.id), name: row.bouquet_name || row.name } : { id: String(bid), name: String(bid) };
        });
      }

      const subCategoryIds = Array.isArray(chData.join_sub_category_ids)
        ? chData.join_sub_category_ids
        : Array.isArray(chData.joinSubCategoryIds)
          ? chData.joinSubCategoryIds
          : [];
      _streamSubCategoryTags = subCategoryIds.map((cid) => {
        const row = liveCats.find((item) => String(item.id) === String(cid));
        return row ? { id: String(row.id), name: row.category_name } : { id: String(cid), name: String(cid) };
      });
    } else {
      $('#channelFormTitle').textContent = 'Add Stream';
      $('#channelFormSubtitle').textContent = 'Create a live stream with the same multi-tab editing flow used on the final reference layout.';
      $('#streamFormId').value = '';
      $('#streamName').value = '';
      $('#streamLogoUrl').value = '';
      $('#streamCategory').value = '';
      $('#streamNotes').value = '';
      $('#streamInputType').value = 'auto';
      $('#streamGenPts').checked = true;
      $('#streamReadNative').checked = false;
      $('#streamStreamAll').checked = false;
      $('#streamAllowRecord').checked = true;
      $('#streamDirectSource').checked = false;
      $('#streamProtect').checked = false;
      $('#streamCustomSid').value = '';
      $('#streamDelayMin').value = 0;
      $('#streamProbesize').value = 1500000;
      $('#streamUserAgent').value = 'XtreamMasters OTT Panel';
      $('#streamHttpProxy').value = '';
      $('#streamCustomArgs').value = '';
      $('#streamCookie').value = '';
      $('#streamHeaders').value = '';
      $('#streamRestartDays').value = '';
      $('#streamRestartTime').value = '06:00';
      $('#streamEpgId').value = '';
      $('#streamEpgLanguage').value = '';
      $('#streamOnDemandMode').value = '0';
      $('#streamTimeshiftDays').value = 0;
      $('#streamRestartOnEdit').checked = false;
      $('#streamCustomMapQuery').value = '';
      _streamSources = ['', ''];
    }

    renderStreamSourceEditors();
    renderStreamBqTags();
    renderStreamSubCategoryTags();
    renderStreamCustomMapTable();
    renderStreamEditorSummary(chData);
    updateStreamServerTree();
    previewStreamLogo();
    switchChannelFormTab(CHANNEL_FORM_TABS[0]);

    const playBtn = $('#streamHeaderPlayBtn');
    if (playBtn) playBtn.style.display = chData && chData.id ? 'inline-flex' : 'none';
    const saveBtn = $('#streamEditorSaveBtn');
    if (saveBtn) saveBtn.textContent = chData && chData.id ? 'Edit' : 'Create';

    if ($('#streamPlaylistServer')) {
      $('#streamPlaylistServer').onchange = updateStreamServerTree;
    }
    if ($('#streamPrimaryUrl')) {
      $('#streamPrimaryUrl').oninput = () => {
        syncStreamSourcesFromInputs();
        updateStreamExtraSourceNote();
      };
    }
    if ($('#streamSwapUrl')) {
      $('#streamSwapUrl').oninput = () => {
        syncStreamSourcesFromInputs();
        updateStreamExtraSourceNote();
      };
    }
    if ($('#streamName')) {
      $('#streamName').oninput = () => {
        const fallback = ($('#streamFormId')?.value || '').trim() ? 'Edit Stream' : 'Add Stream';
        $('#channelFormTitle').textContent = ($('#streamName').value || '').trim() || fallback;
      };
    }
  }

  async function editStream(id) {
    try {
      const list = await fetch('/api/channels', { credentials: 'same-origin' }).then((r) => r.json());
      const channel = (Array.isArray(list) ? list : []).find((row) => String(row.id) === String(id));
      if (!channel) return toast('Stream not found', 'error');
      await openStreamForm(channel);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveStream() {
    const id = ($('#streamFormId')?.value || '').trim();
    syncStreamSourcesFromInputs();
    const sourceQueue = _streamSources.map((item) => String(item || '').trim()).filter(Boolean);
    const primaryUrl = sourceQueue[0] || '';
    if (!($('#streamName')?.value || '').trim()) return toast('Stream name is required', 'error');
    if (!primaryUrl) return toast('At least one stream URL is required', 'error');

    const tpVal = $('#streamTranscodeProfile') ? $('#streamTranscodeProfile').value : '';
    const body = {
      name: ($('#streamName')?.value || '').trim(),
      mpdUrl: primaryUrl,
      inputType: $('#streamInputType')?.value || 'auto',
      sourceQueue,
      epgChannelId: ($('#streamEpgId')?.value || '').trim(),
      epg_source_id: parseInt($('#streamEpgSource')?.value, 10) || 0,
      epg_language: $('#streamEpgLanguage')?.value || '',
      logoUrl: ($('#streamLogoUrl')?.value || '').trim(),
      category_id: $('#streamCategory')?.value || null,
      join_sub_category_ids: _streamSubCategoryTags.map((t) => parseInt(t.id, 10)).filter((n) => Number.isFinite(n)),
      notes: $('#streamNotes')?.value || '',
      transcode_profile_id: tpVal ? parseInt(tpVal, 10) : null,
      userAgent: $('#streamUserAgent')?.value || '',
      httpProxy: ($('#streamHttpProxy')?.value || '').trim() || null,
      headers: buildStreamHeadersFromForm(),
      customFfmpegArgs: $('#streamCustomArgs')?.value || '',
      gen_timestamps: !!$('#streamGenPts')?.checked,
      read_native: !!$('#streamReadNative')?.checked,
      stream_all: !!$('#streamStreamAll')?.checked,
      allow_record: !!$('#streamAllowRecord')?.checked,
      custom_sid: ($('#streamCustomSid')?.value || '').trim(),
      probesize_ondemand: parseInt($('#streamProbesize')?.value, 10) || 1500000,
      delay_minutes: parseInt($('#streamDelayMin')?.value, 10) || 0,
      on_demand: ($('#streamOnDemandMode')?.value || '0') === '1',
      restart_on_edit: !!$('#streamRestartOnEdit')?.checked,
      bouquet_ids: _streamBqTags.map((t) => parseInt(t.id, 10)).filter((n) => Number.isFinite(n)),
      stream_server_id: (() => {
        const n = parseInt($('#streamPlaylistServer')?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
      direct_source: !!$('#streamDirectSource')?.checked,
      protect_stream: !!$('#streamProtect')?.checked,
      custom_map_query: ($('#streamCustomMapQuery')?.value || '').trim(),
      custom_map_entries: _streamCustomMapEntries.slice(),
      restart_days: ($('#streamRestartDays')?.value || '').trim(),
      restart_time: $('#streamRestartTime')?.value || '',
      timeshift_server_id: parseInt($('#streamTimeshiftServer')?.value, 10) || 0,
      timeshift_days: parseInt($('#streamTimeshiftDays')?.value, 10) || 0,
    };

    const wasRunning = _editingStreamOriginal && ['running', 'starting'].includes(String(_editingStreamOriginal.status || '').toLowerCase());
    try {
      let targetId = id;
      if (id) {
        if (wasRunning) {
          await channelFetch(`/${id}/stop`, { method: 'POST' });
        }
        await channelFetch(`/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        targetId = id;
        if (wasRunning) {
          await channelFetch(`/${id}/start`, { method: 'POST' });
          toast('Stream updated and restarted');
        } else {
          toast('Stream updated');
        }
      } else {
        const created = await channelFetch('', { method: 'POST', body: JSON.stringify(body) });
        targetId = created && created.id ? created.id : '';
        toast('Stream created');
      }
      _editingStreamOriginal = null;
      navigateTo('manage-channels');
      if (targetId) loadStreams({ silent: true }).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Stream Repair ─────────────────────────────────────────────────
  APP._streamHealthCache = {};

  async function fetchHealthData() {
    try {
      const data = await apiFetch('/streams/health-all');
      APP._streamHealthCache = data || {};
      renderStreamsTable();
    } catch {}
  }

  APP.repairStream = async function(id) {
    const btn = document.querySelector(`.row-action-btn.repair-btn[onclick*="${id}"]`);
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    try {
      const data = await apiFetch(`/streams/${id}/repair`, { method: 'POST' });
      APP._streamHealthCache = APP._streamHealthCache || {};
      APP._streamHealthCache[id] = { status: data.status, checkedAt: Date.now(), info: data.info, error: data.error };
      toast(`Stream ${data.status === 'ok' ? 'is healthy' : data.status === 'slow' ? 'is slow' : 'has issues'}: ${id}`, data.status === 'ok' ? 'success' : 'warning');
      renderStreamsTable();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

  APP.repairAllStreams = async function() {
    const btn = $('#repairAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    try {
      toast('Checking all streams...', 'info', 4000);
      const data = await apiFetch('/streams/repair-all', { method: 'POST' });
      // Update cache with results
      APP._streamHealthCache = APP._streamHealthCache || {};
      for (const d of (data.details || [])) {
        APP._streamHealthCache[d.id] = { status: d.status, checkedAt: Date.now(), info: d.info, error: d.error };
      }
      toast(`Done: ${data.ok || 0} OK, ${data.slow || 0} Slow, ${data.broken || 0} Broken`, data.broken > 0 ? 'warning' : 'success');
      renderStreamsTable();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Mass Review'; }
    }
  };

  async function viewStreamLogs(id) {
    try {
      const data = await fetch(`/api/channels/${id}/logs`, { credentials: 'same-origin' }).then(r => r.json());
      $('#streamLogsContent').textContent = data.logs || 'No logs available';
      $('#streamLogsModal').style.display = 'flex';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function openStreamPlayer(id, name) {
    const modal = $('#streamPlayerModal');
    if (!modal) return;
    const video = $('#streamPlayerVideo');
    const urlInput = $('#streamPlayerUrl');
    if (!video || !urlInput) {
      toast('Player UI not found', 'error');
      return;
    }
    const ch = _streamsCache.find(c => c.id === id);
    const st = ch && (ch.status || '');
    const needBoot = ch && ch.on_demand && st !== 'running' && st !== 'error';
    if (needBoot) {
      _pendingStreamStartId = id;
      _streamReadyByWS = false;
      if (st === 'stopped' || !st) {
        try {
          toast('Starting on-demand stream…');
          await channelFetch(`/${id}/start`, { method: 'POST' });
        } catch (e) {
          toast(e.message || 'Start failed', 'error');
          _pendingStreamStartId = null;
          return;
        }
      }
      const deadline = Date.now() + 90000;
      let started = false;
      while (Date.now() < deadline) {
        if (_streamReadyByWS) {
          _streamReadyByWS = false;
          started = true;
          break;
        }
        const r = await fetch('/api/channels', { credentials: 'same-origin' });
        const list = await r.json();
        const cur = Array.isArray(list) ? list.find(c => c.id === id) : null;
        if (cur && cur.status === 'running') {
          started = true;
          break;
        }
        if (cur && cur.status === 'error') {
          toast('Stream failed to start', 'error');
          _pendingStreamStartId = null;
          return;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      _pendingStreamStartId = null;
      if (!started) {
        toast('Stream did not become ready in time', 'error');
        return;
      }
      try {
        const r = await fetch('/api/channels', { credentials: 'same-origin' });
        const list = await r.json();
        if (Array.isArray(list)) _streamsCache = list;
      } catch {}
      renderStreamsTable();
    }
    modal.style.display = 'flex';
    $('#streamPlayerTitle').textContent = `Player: ${name}`;
    const outHint = $('#streamPlayerOutputHint');
    if (outHint) outHint.textContent = '';
    let url = '';
    let urlSigned = '';
    try {
      const data = await api(`/api/channels/${id}/playback-url`);
      url = (data && data.url) ? data.url : '';
      urlSigned = (data && data.urlSigned) ? data.urlSigned : '';
      if (outHint && data && data.outputFormat) {
        const isTs = data.outputFormat === 'mpegts';
        outHint.textContent = isTs
          ? 'Output: MPEG-TS (continuous TS — use TS URL in VLC, not a .m3u8 playlist)'
          : 'Output: HLS (playlist .m3u8 — segment delay applies; not the same as pipe TS)';
      }
    } catch (e) {
      toast(e.message || 'Could not get playback URL', 'error');
      return;
    }
    if (!url) {
      toast('No playback URL', 'error');
      return;
    }
    urlInput.value = url;
    const signedWrap = $('#streamPlayerUrlSignedWrap');
    const signedInput = $('#streamPlayerUrlSigned');
    if (signedWrap && signedInput && urlSigned && urlSigned !== url) {
      signedInput.value = urlSigned;
      signedWrap.style.display = 'block';
    } else if (signedWrap && signedInput) {
      signedInput.value = '';
      signedWrap.style.display = 'none';
    }
    if (video._hls) {
      try { video._hls.destroy(); } catch {}
      video._hls = null;
    }
    video.removeAttribute('src');
    const isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls) {
      if (window.Hls && Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 8,
          maxMaxBufferLength: 16,
          maxBufferSize: 30 * 1000 * 1000,
          maxBufferHole: 0.5,
          lowLatencyMode: true,
          startLevel: -1,
          backBufferLength: 30,
          autoStartLoad: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        video._hls = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        toast('HLS: copy URL below and open in VLC or Safari', 'info');
      }
    } else {
      const shortNoQuery = url && !/[?&]token=/.test(url);
      toast(
        shortNoQuery
          ? 'MPEG-TS: use the first URL in VLC on this machine (no token). Use the signed line only from another device.'
          : 'MPEG-TS: paste the URL below into VLC (browser TS playback is limited).',
        'info'
      );
    }
  }

  function closeStreamPlayer() {
    const modal = $('#streamPlayerModal');
    if (modal) modal.style.display = 'none';
    const outHint = $('#streamPlayerOutputHint');
    if (outHint) outHint.textContent = '';
    const signedInput = $('#streamPlayerUrlSigned');
    const signedWrap = $('#streamPlayerUrlSignedWrap');
    if (signedInput) signedInput.value = '';
    if (signedWrap) signedWrap.style.display = 'none';
    const video = $('#streamPlayerVideo');
    if (video) {
      if (video._hls) { video._hls.destroy(); video._hls = null; }
      video.pause();
      video.removeAttribute('src');
    }
  }

  async function confirmStreamImport() {
    let rawText = ($('#streamImportRaw')?.value || '').trim();
    if (!rawText) {
      try { rawText = await readFileAsText($('#streamImportFile')); } catch {}
    }
    if (!rawText) { toast('Select a file or paste content', 'error'); return; }
    const name = ($('#streamImportName')?.value || '').trim() || undefined;
    try {
      toast('Importing stream...');
      const res = await fetch('/api/channels/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ rawText, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      $('#streamImportResult').style.display = 'block';
      $('#streamImportResultBody').innerHTML = `
        <p class="text-success">Stream imported successfully!</p>
        <p><strong>ID:</strong> ${escHtml(data.id || '')}</p>
        <p><strong>Name:</strong> ${escHtml(data.name || '')}</p>
        <p><strong>Input:</strong> ${escHtml(data.mpdUrl || '')}</p>
      `;
      toast('Stream imported');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Categories ──────────────────────────────────────────────────

  function getCategoryFixedTypeFromPage() {
    if (_currentPage === 'categories') {
      return document.querySelector('[data-cat-type].active')?.dataset.catType || 'live';
    }
    return null;
  }

  function reloadCurrentCategoriesPage() {
    if (_currentPage === 'categories') {
      return loadCategoriesPage(document.querySelector('[data-cat-type].active')?.dataset.catType || 'live');
    }
  }

  // ─── Unified Categories Page ─────────────────────────────────────────
  async function loadCategoriesPage(type) {
    try {
      document.querySelectorAll('[data-cat-type]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.catType === type);
      });
      const data = await apiFetch(`/categories?type=${encodeURIComponent(type)}`);
      const cats = data.categories || [];
      _categoriesCache = cats;
      const tbody = $('#categoriesTable tbody');
      if (!tbody) return;

      // Client-side search filter
      const search = ($('#categoriesSearch')?.value || '').toLowerCase();
      const filtered = search
        ? cats.filter(c => (c.category_name || '').toLowerCase().includes(search))
        : cats;

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#8b949e;padding:32px 0">No categories found</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(c => {
        const color = c.color || '#6b9ef5';
        return `<tr>
          <td width="50"><span style="color:#8b949e;font-size:.75rem">${c.id}</span></td>
          <td>
            <span class="cat-dot" style="background:${escHtml(color)}"></span>
            <span style="font-weight:500;color:#e6edf3">${escHtml(c.category_name || '')}</span>
          </td>
          <td width="70"><span style="color:#8b949e;font-size:.82rem">${c.cat_order || 0}</span></td>
          <td>
            <div class="row-actions">
              <button class="row-action-btn edit-btn" onclick="APP.editCategory(${c.id}, '${escHtml(c.category_name || '')}', '${escHtml(type)}', ${c.cat_order || 0})" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="row-action-btn delete-btn" onclick="APP.deleteCategory(${c.id})" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </td>
        </tr>`;
      }).join('');

      makeSortable($('#categoriesTable'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openCategoryModal(id, name, type, order) {
    $('#categoryModal').style.display = 'flex';
    $('#catFormId').value = id || '';
    $('#catName').value = name || '';
    const fixed = getCategoryFixedTypeFromPage();
    const catTypeRow = $('#catTypeRow');
    if (fixed) {
      $('#catType').value = fixed;
      if (catTypeRow) catTypeRow.style.display = 'none';
    } else {
      $('#catType').value = type || 'live';
      if (catTypeRow) catTypeRow.style.display = '';
    }
    $('#catOrder').value = order || 0;
    $('#catModalTitle').textContent = id ? 'Edit Category' : 'Add Category';
  }

  function editCategory(id, name, type, order) {
    openCategoryModal(id, name, type, order);
  }

  function closeCategoryModal() {
    $('#categoryModal').style.display = 'none';
  }

  async function saveCategory() {
    const id = $('#catFormId').value;
    const category_type = getCategoryFixedTypeFromPage() || $('#catType').value;
    const body = { category_name: $('#catName').value, category_type, cat_order: parseInt($('#catOrder').value) || 0 };
    try {
      if (id) {
        await apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Category updated');
      } else {
        await apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
        toast('Category created');
      }
      closeCategoryModal();
      loadRefData();
      reloadCurrentCategoriesPage();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteCategory(id) {
    if (!confirm('Delete this category?')) return;
    try {
      await apiFetch(`/categories/${id}`, { method: 'DELETE' });
      toast('Category deleted');
      loadRefData();
      reloadCurrentCategoriesPage();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Bouquets ────────────────────────────────────────────────────

  async function loadBouquets() {
    try {
      const data = await apiFetch('/bouquets');
      const items = data.bouquets || [];
      $('#bouquetsTable tbody').innerHTML = items.map(b => `
        <tr>
          <td>${b.id}</td>
          <td>${escHtml(b.bouquet_name || b.name || '')}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editBouquet(${b.id}, '${escHtml(b.bouquet_name || b.name || '')}')">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteBouquet(${b.id})">Del</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openBouquetModal(id, name) {
    $('#bouquetModal').style.display = 'flex';
    $('#bqFormId').value = id || '';
    $('#bqName').value = name || '';
    $('#bqModalTitle').textContent = id ? 'Edit Bouquet' : 'Add Bouquet';
  }
  function editBouquet(id, name) { openBouquetModal(id, name); }
  function closeBouquetModal() { $('#bouquetModal').style.display = 'none'; }

  async function saveBouquet() {
    const id = $('#bqFormId').value;
    const body = { bouquet_name: $('#bqName').value };
    try {
      if (id) { await apiFetch(`/bouquets/${id}`, { method: 'PUT', body: JSON.stringify(body) }); toast('Bouquet updated'); }
      else { await apiFetch('/bouquets', { method: 'POST', body: JSON.stringify(body) }); toast('Bouquet created'); }
      closeBouquetModal();
      loadRefData();
      loadBouquets();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteBouquet(id) {
    if (!confirm('Delete?')) return;
    try { await apiFetch(`/bouquets/${id}`, { method: 'DELETE' }); toast('Deleted'); loadRefData(); loadBouquets(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ─── Packages ────────────────────────────────────────────────────

  function pkgMergedOptions(pkg) {
    const o = pkg && pkg.options && typeof pkg.options === 'object' ? pkg.options : {};
    return { lock_to_isp: 0, verify_compatibility: 1, forced_connection: 'disabled', ...o };
  }

  function renderPackageWizardTables() {
    const gtb = $('#pkgGroupsTable tbody');
    const btb = $('#pkgBouquetsTable tbody');
    if (gtb) {
      gtb.innerHTML = (_userGroups || []).map(g => `
        <tr>
          <td><input type="checkbox" class="pkg-group-cb" data-group-id="${g.group_id}"></td>
          <td>${g.group_id}</td>
          <td>${escHtml(g.group_name || '')}</td>
        </tr>`).join('');
    }
    if (btb) {
      btb.innerHTML = (_bouquets || []).map(b => {
        const ch = Array.isArray(b.bouquet_channels) ? b.bouquet_channels.length : 0;
        const mv = Array.isArray(b.bouquet_movies) ? b.bouquet_movies.length : 0;
        const se = Array.isArray(b.bouquet_series) ? b.bouquet_series.length : 0;
        const rd = Array.isArray(b.bouquet_radios) ? b.bouquet_radios.length : 0;
        return `
        <tr>
          <td><input type="checkbox" class="pkg-bq-cb" data-bouquet-id="${b.id}"></td>
          <td>${b.id}</td>
          <td>${escHtml(b.bouquet_name || '')}</td>
          <td>${ch}</td><td>${mv}</td><td>${se}</td><td>${rd}</td>
        </tr>`;
      }).join('');
    }
  }

  function applyPackageGroupBqSelection(pkg) {
    const gset = new Set((pkg && pkg.groups ? pkg.groups : []).map(String));
    const bset = new Set((pkg && pkg.bouquets ? pkg.bouquets : []).map(String));
    document.querySelectorAll('#packageModal .pkg-group-cb').forEach(cb => {
      cb.checked = gset.has(String(cb.dataset.groupId));
    });
    document.querySelectorAll('#packageModal .pkg-bq-cb').forEach(cb => {
      cb.checked = bset.has(String(cb.dataset.bouquetId));
    });
  }

  function fillPackageForm(pkg) {
    if (!pkg) {
      $('#pkgName').value = '';
      $('#pkgTrialEnabled').checked = false;
      $('#pkgTrialCredits').value = '0';
      $('#pkgTrialDuration').value = '0';
      $('#pkgTrialDurationIn').value = 'hour';
      $('#pkgOfficialEnabled').checked = true;
      $('#pkgOfficialCredits').value = '0';
      $('#pkgOfficialDuration').value = '0';
      $('#pkgOfficialDurationIn').value = 'month';
      $('#pkgIsMag').checked = false;
      $('#pkgIsE2').checked = false;
      $('#pkgIsLine').checked = true;
      $('#pkgIsRestreamer').checked = false;
      $('#pkgLockIsp').checked = false;
      $('#pkgVerifyCompat').checked = true;
      $('#pkgForcedConnection').value = 'disabled';
      $('#pkgForcedCountry').value = '';
      $('#pkgMaxConnections').value = '1';
      const om = $('#pkgOutM3u8'); const ot = $('#pkgOutTs'); const or = $('#pkgOutRtmp');
      if (om) om.checked = false;
      if (ot) ot.checked = false;
      if (or) or.checked = false;
      applyPackageGroupBqSelection(null);
      return;
    }
    const opt = pkgMergedOptions(pkg);
    $('#pkgName').value = pkg.package_name || '';
    $('#pkgTrialEnabled').checked = !!pkg.is_trial;
    $('#pkgTrialCredits').value = String(pkg.trial_credits != null ? pkg.trial_credits : 0);
    $('#pkgTrialDuration').value = String(pkg.trial_duration != null ? pkg.trial_duration : 0);
    const durUnits = ['hour', 'day', 'month'];
    $('#pkgTrialDurationIn').value = durUnits.includes(pkg.trial_duration_in) ? pkg.trial_duration_in : 'hour';
    $('#pkgOfficialEnabled').checked = pkg.is_official !== 0 && pkg.is_official !== false;
    $('#pkgOfficialCredits').value = String(pkg.official_credits != null ? pkg.official_credits : 0);
    $('#pkgOfficialDuration').value = String(pkg.official_duration != null ? pkg.official_duration : 0);
    $('#pkgOfficialDurationIn').value = durUnits.includes(pkg.official_duration_in) ? pkg.official_duration_in : 'month';
    $('#pkgIsMag').checked = !!pkg.is_mag;
    $('#pkgIsE2').checked = !!pkg.is_e2;
    $('#pkgIsLine').checked = pkg.is_line !== 0 && pkg.is_line !== false;
    $('#pkgIsRestreamer').checked = !!pkg.is_restreamer;
    $('#pkgLockIsp').checked = !!opt.lock_to_isp;
    $('#pkgVerifyCompat').checked = opt.verify_compatibility !== 0 && opt.verify_compatibility !== false;
    $('#pkgForcedConnection').value = opt.forced_connection || 'disabled';
    $('#pkgForcedCountry').value = pkg.forced_country || '';
    $('#pkgMaxConnections').value = String(pkg.max_connections != null ? pkg.max_connections : 1);
    const outs = Array.isArray(pkg.output_formats) ? pkg.output_formats : [];
    const om = $('#pkgOutM3u8'); const ot = $('#pkgOutTs'); const or = $('#pkgOutRtmp');
    if (om) om.checked = outs.includes('m3u8');
    if (ot) ot.checked = outs.includes('ts');
    if (or) or.checked = outs.includes('rtmp');
    applyPackageGroupBqSelection(pkg);
  }

  function collectPackageBody() {
    const output_formats = [];
    const om = $('#pkgOutM3u8'); const ot = $('#pkgOutTs'); const or = $('#pkgOutRtmp');
    if (om && om.checked) output_formats.push('m3u8');
    if (ot && ot.checked) output_formats.push('ts');
    if (or && or.checked) output_formats.push('rtmp');
    const groups = [...document.querySelectorAll('#packageModal .pkg-group-cb:checked')].map(cb => parseInt(cb.dataset.groupId, 10)).filter(n => Number.isFinite(n));
    const bouquets = [...document.querySelectorAll('#packageModal .pkg-bq-cb:checked')].map(cb => parseInt(cb.dataset.bouquetId, 10)).filter(n => Number.isFinite(n));
    return {
      package_name: ($('#pkgName').value || '').trim() || 'New Package',
      is_trial: $('#pkgTrialEnabled').checked ? 1 : 0,
      is_official: $('#pkgOfficialEnabled').checked ? 1 : 0,
      trial_credits: parseFloat($('#pkgTrialCredits').value) || 0,
      official_credits: parseFloat($('#pkgOfficialCredits').value) || 0,
      trial_duration: parseInt($('#pkgTrialDuration').value, 10) || 0,
      trial_duration_in: $('#pkgTrialDurationIn').value,
      official_duration: parseInt($('#pkgOfficialDuration').value, 10) || 0,
      official_duration_in: $('#pkgOfficialDurationIn').value,
      groups,
      bouquets,
      output_formats,
      max_connections: Math.max(1, parseInt($('#pkgMaxConnections').value, 10) || 1),
      forced_country: ($('#pkgForcedCountry').value || '').trim(),
      is_line: $('#pkgIsLine').checked ? 1 : 0,
      is_mag: $('#pkgIsMag').checked ? 1 : 0,
      is_e2: $('#pkgIsE2').checked ? 1 : 0,
      is_restreamer: $('#pkgIsRestreamer').checked ? 1 : 0,
      options: {
        lock_to_isp: $('#pkgLockIsp').checked ? 1 : 0,
        verify_compatibility: $('#pkgVerifyCompat').checked ? 1 : 0,
        forced_connection: $('#pkgForcedConnection').value,
      },
    };
  }

  function syncPkgWizardUi() {
    const modal = $('#packageModal');
    if (!modal) return;
    const step = PKG_WIZARD_TABS[_pkgWizardIdx];
    modal.querySelectorAll('.wizard-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === step);
    });
    modal.querySelectorAll('.wizard-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + step);
    });
    syncPkgWizardFooterOnly();
  }

  function pkgWizardNext() {
    if (_pkgWizardIdx >= PKG_WIZARD_TABS.length - 1) return;
    _pkgWizardIdx++;
    syncPkgWizardUi();
  }

  function pkgWizardPrev() {
    if (_pkgWizardIdx <= 0) return;
    _pkgWizardIdx--;
    syncPkgWizardUi();
  }

  function togglePackageGroups() {
    const cbs = [...document.querySelectorAll('#packageModal .pkg-group-cb')];
    if (!cbs.length) return;
    const allOn = cbs.every(c => c.checked);
    cbs.forEach(c => { c.checked = !allOn; });
  }

  function togglePackageBouquets() {
    const cbs = [...document.querySelectorAll('#packageModal .pkg-bq-cb')];
    if (!cbs.length) return;
    const allOn = cbs.every(c => c.checked);
    cbs.forEach(c => { c.checked = !allOn; });
  }

  async function loadPackages() {
    try {
      const data = await apiFetch('/packages');
      const items = data.packages || [];
      $('#packagesTable tbody').innerHTML = items.map(p => {
        const bq = p.bouquets;
        const bqN = Array.isArray(bq) ? bq.length : 0;
        const oc = p.official_credits != null ? p.official_credits : 0;
        const mc = p.max_connections != null ? p.max_connections : 1;
        return `
        <tr>
          <td>${p.id}</td>
          <td>${escHtml(p.package_name || '')}</td>
          <td>${oc}</td>
          <td>${mc}</td>
          <td>${bqN}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editPackage(${p.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deletePackage(${p.id})">Del</button>
          </td>
        </tr>`;
      }).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openPackageModal(id) {
    await loadRefData();
    _pkgWizardIdx = 0;
    $('#pkgModalTitle').textContent = id ? 'Edit Package' : 'Add Package';
    $('#pkgFormId').value = id || '';
    renderPackageWizardTables();
    const pkg = id ? _packages.find(p => String(p.id) === String(id)) : null;
    if (id && !pkg) {
      toast('Package not found', 'error');
      return;
    }
    fillPackageForm(pkg || null);
    syncPkgWizardUi();
    $('#packageModal').style.display = 'flex';
  }

  async function editPackage(id) {
    await openPackageModal(id);
  }

  function closePackageModal() {
    $('#packageModal').style.display = 'none';
    _pkgWizardIdx = 0;
  }

  async function savePackage() {
    const id = $('#pkgFormId').value;
    const body = collectPackageBody();
    try {
      if (id) {
        await apiFetch(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Package updated');
      } else {
        await apiFetch('/packages', { method: 'POST', body: JSON.stringify(body) });
        toast('Package created');
      }
      closePackageModal();
      await loadRefData();
      loadPackages();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deletePackage(id) {
    if (!confirm('Delete?')) return;
    try { await apiFetch(`/packages/${id}`, { method: 'DELETE' }); toast('Deleted'); loadRefData(); loadPackages(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ─── Resellers ───────────────────────────────────────────────────

  function getResellerMemberGroups() {
    return (_userGroups || []).filter((g) => Number(g.is_reseller) === 1);
  }

  function formatUserDate(raw) {
    if (!raw) return 'Never';
    return formatDate(raw);
  }

  function syncRegisteredUsersGroupControls() {
    const groups = getResellerMemberGroups();
    const filter = $('#registeredUsersGroupFilter');
    const form = $('#registeredUserGroup');
    const currentFilter = filter ? filter.value : '';
    const currentForm = form ? form.value : '';
    populateSelect('#registeredUsersGroupFilter', groups, 'group_id', 'group_name', 'All Member Groups');
    populateSelect('#registeredUserGroup', groups, 'group_id', 'group_name', 'Select reseller group...');
    if (filter) filter.value = currentFilter;
    if (form && currentForm) form.value = currentForm;
  }

  function renderRegisteredUsersPagination(total) {
    const bar = $('#registeredUsersPagination');
    if (!bar) return;
    const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, _registeredUsersPerPage)));
    const info = `<span class="pagination-info">Page ${_registeredUsersPage} of ${totalPages} · Total ${total || 0}</span>`;
    const buttons = [
      `<button class="btn btn-xs btn-secondary" ${_registeredUsersPage <= 1 ? 'disabled' : ''} onclick="APP.goRegisteredUsersPage(${_registeredUsersPage - 1})">Prev</button>`,
      `<button class="btn btn-xs btn-secondary" ${_registeredUsersPage >= totalPages ? 'disabled' : ''} onclick="APP.goRegisteredUsersPage(${_registeredUsersPage + 1})">Next</button>`,
    ].join('');
    bar.innerHTML = `${info}<div class="pagination-controls">${buttons}</div>`;
  }

  function goRegisteredUsersPage(page) {
    _registeredUsersPage = Math.max(1, parseInt(page, 10) || 1);
    loadRegisteredUsers();
  }

  function renderRegisteredUserPackageOverridesTable(overrides = []) {
    const tbody = $('#registeredUserPackageOverridesTable tbody');
    if (!tbody) return;
    const overrideMap = new Map((overrides || []).map((row) => [String(row.package_id), row]));
    tbody.innerHTML = (_packages || []).map((pkg, index) => {
      const override = overrideMap.get(String(pkg.id)) || {};
      return `
        <tr data-package-id="${pkg.id}">
          <td>${index + 1}</td>
          <td>${escHtml(pkg.package_name || '')}</td>
          <td>${Number(pkg.trial_credits || 0).toFixed(2)}</td>
          <td>${Number(pkg.official_credits || 0).toFixed(2)}</td>
          <td><input type="number" class="form-control rpo-trial" min="0" step="0.01" value="${override.trial_credits_override != null ? escHtml(String(override.trial_credits_override)) : ''}" placeholder="Default"></td>
          <td><input type="number" class="form-control rpo-official" min="0" step="0.01" value="${override.official_credits_override != null ? escHtml(String(override.official_credits_override)) : ''}" placeholder="Default"></td>
          <td><label class="toggle"><input type="checkbox" class="rpo-enabled" ${overrideMap.has(String(pkg.id)) ? (Number(override.enabled) === 1 ? 'checked' : '') : ''}><span class="toggle-slider"></span></label></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="7" style="color:#8b949e;text-align:center">No packages available</td></tr>';
  }

  function collectRegisteredUserPackageOverrides() {
    return [...document.querySelectorAll('#registeredUserPackageOverridesTable tbody tr[data-package-id]')].map((row) => {
      const packageId = parseInt(row.dataset.packageId, 10);
      const data = {
        package_id: packageId,
        enabled: row.querySelector('.rpo-enabled')?.checked ? 1 : 0,
        trial_credits_override: row.querySelector('.rpo-trial')?.value || '',
        official_credits_override: row.querySelector('.rpo-official')?.value || '',
      };
      return data;
    }).filter((row) => row.enabled || row.trial_credits_override !== '' || row.official_credits_override !== '');
  }

  function resetRegisteredUserPackageOverrides() {
    _registeredUserPackageOverrides = [];
    renderRegisteredUserPackageOverridesTable([]);
  }

  function editRegisteredUser(id) {
    openRegisteredUserForm(id);
  }

  function updateRegisteredUserCreditsPreview() {
    if (!_registeredUserCreditsTarget) return;
    const mode = $('#registeredUserCreditsMode')?.value || 'add';
    const amount = parseFloat($('#registeredUserCreditsAmount')?.value || '0') || 0;
    const current = Number(_registeredUserCreditsTarget.credits || 0);
    let next = current;
    if (mode === 'add') next = current + amount;
    else if (mode === 'subtract') next = Math.max(0, current - amount);
    else next = Math.max(0, amount);
    const preview = $('#registeredUserCreditsPreview');
    if (preview) preview.textContent = `New Balance: ${next.toFixed(2)}`;
  }

  function syncMemberGroupFormMode() {
    const isReseller = $('#memberGroupIsReseller')?.checked;
    ['memberGroupTrialsAllowed', 'memberGroupTrialsIn', 'memberGroupDeleteUsers', 'memberGroupManageExpiryMedia', 'memberGroupAnnouncement'].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.disabled = !isReseller;
    });
  }

  async function loadMemberGroupFormPage() {
    await loadRefData();
    const adminToggle = $('#memberGroupIsAdmin');
    const resellerToggle = $('#memberGroupIsReseller');
    if (adminToggle) adminToggle.onchange = () => { if (adminToggle.checked && resellerToggle) resellerToggle.checked = false; syncMemberGroupFormMode(); };
    if (resellerToggle) resellerToggle.onchange = () => { if (resellerToggle.checked && adminToggle) adminToggle.checked = false; syncMemberGroupFormMode(); };
    if (_memberGroupEditingId) {
      try {
        const group = await apiFetch(`/user-groups/${_memberGroupEditingId}`);
        $('#memberGroupFormTitle').textContent = 'Edit Group';
        $('#memberGroupFormSubtitle').textContent = 'Configure the real reseller permissions and announcement content for this member group.';
        $('#memberGroupFormId').value = group.group_id;
        $('#memberGroupName').value = group.group_name || '';
        $('#memberGroupIsAdmin').checked = Number(group.is_admin) === 1;
        $('#memberGroupIsReseller').checked = Number(group.is_reseller) === 1;
        $('#memberGroupTrialsAllowed').value = String(group.total_allowed_gen_trials || 0);
        $('#memberGroupTrialsIn').value = group.total_allowed_gen_in || 'day';
        $('#memberGroupDeleteUsers').checked = Number(group.delete_users) === 1;
        $('#memberGroupManageExpiryMedia').checked = Number(group.manage_expiry_media) === 1;
        $('#memberGroupAnnouncement').value = group.notice_html || '';
        syncMemberGroupFormMode();
      } catch (e) {
        toast(e.message, 'error');
        navigateTo('member-groups');
      }
      return;
    }
    $('#memberGroupFormTitle').textContent = 'Add Group';
    $('#memberGroupFormSubtitle').textContent = 'Create a focused member group for reseller or admin operator accounts.';
    $('#memberGroupFormId').value = '';
    $('#memberGroupName').value = '';
    $('#memberGroupIsAdmin').checked = false;
    $('#memberGroupIsReseller').checked = true;
    $('#memberGroupTrialsAllowed').value = '0';
    $('#memberGroupTrialsIn').value = 'day';
    $('#memberGroupDeleteUsers').checked = false;
    $('#memberGroupManageExpiryMedia').checked = false;
    $('#memberGroupAnnouncement').value = '';
    syncMemberGroupFormMode();
  }

  function openMemberGroupForm(id = null) {
    const nextId = parseInt(id, 10);
    _memberGroupEditingId = Number.isFinite(nextId) ? nextId : null;
    if (_currentPage !== 'member-group-form') return navigateTo('member-group-form');
    return loadMemberGroupFormPage();
  }

  async function saveMemberGroup() {
    const id = parseInt($('#memberGroupFormId')?.value || '', 10);
    const body = {
      group_name: $('#memberGroupName').value.trim(),
      is_admin: $('#memberGroupIsAdmin').checked ? 1 : 0,
      is_reseller: $('#memberGroupIsReseller').checked ? 1 : 0,
      total_allowed_gen_trials: parseInt($('#memberGroupTrialsAllowed').value || '0', 10) || 0,
      total_allowed_gen_in: $('#memberGroupTrialsIn').value || 'day',
      delete_users: $('#memberGroupDeleteUsers').checked ? 1 : 0,
      manage_expiry_media: $('#memberGroupManageExpiryMedia').checked ? 1 : 0,
      notice_html: $('#memberGroupAnnouncement').value || '',
    };
    if (!body.group_name) return toast('Group name required', 'error');
    try {
      if (Number.isFinite(id)) {
        await apiFetch(`/user-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Member group updated');
      } else {
        await apiFetch('/user-groups', { method: 'POST', body: JSON.stringify(body) });
        toast('Member group created');
      }
      _memberGroupEditingId = null;
      navigateTo('member-groups');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteMemberGroup(id) {
    if (!confirm('Delete this member group?')) return;
    try {
      await apiFetch(`/user-groups/${id}`, { method: 'DELETE' });
      toast('Member group deleted');
      loadMemberGroups();
    } catch (e) { toast(e.message, 'error'); }
  }

  function buildExpiryMediaRow(item = {}) {
    return `
      <div class="reseller-members-expiry-row">
        <input type="text" class="form-control rem-country" placeholder="Country code (blank = default)" value="${escHtml(item.country_code || '')}">
        <input type="text" class="form-control rem-url" placeholder="https://example.com/media.m3u8" value="${escHtml(item.media_url || '')}">
        <button type="button" class="btn btn-xs btn-danger" onclick="APP.removeExpiryMediaRow(this)">Remove</button>
      </div>
    `;
  }

  function renderExpiryMediaScenarioRows(scenario, items = []) {
    const wrap = scenario === 'expiring' ? $('#expiryMediaExpiringRows') : $('#expiryMediaExpiredRows');
    if (!wrap) return;
    const filtered = (items || []).filter((item) => item.scenario === scenario);
    wrap.innerHTML = (filtered.length ? filtered : [{}]).map((item) => buildExpiryMediaRow(item)).join('');
  }

  function collectExpiryMediaRows(containerSelector, scenario) {
    const wrap = $(containerSelector);
    if (!wrap) return [];
    return [...wrap.querySelectorAll('.reseller-members-expiry-row')]
      .map((row, index) => ({
        scenario,
        country_code: row.querySelector('.rem-country')?.value || '',
        media_url: row.querySelector('.rem-url')?.value || '',
        sort_order: index,
      }))
      .filter((item) => String(item.media_url || '').trim());
  }

  function openExpiryMediaAddModal() {
    const used = new Set((_expiryMediaCurrentRows || []).map((row) => String(row.user_id)));
    const eligible = (_resellersCache || []).filter((row) => !used.has(String(row.id)));
    const select = $('#expiryMediaAddReseller');
    if (select) {
      select.innerHTML = '<option value="">Select reseller...</option>' + eligible.map((row) => `<option value="${row.id}">${escHtml(row.username || '')}</option>`).join('');
    }
    $('#expiryMediaAddModal').style.display = 'flex';
  }

  function closeExpiryMediaAddModal() {
    $('#expiryMediaAddModal').style.display = 'none';
  }

  async function createExpiryMediaService() {
    const userId = parseInt($('#expiryMediaAddReseller')?.value || '', 10);
    if (!Number.isFinite(userId)) return toast('Select a reseller first', 'error');
    try {
      const service = await apiFetch('/expiry-media/services', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
      _expiryMediaEditingServiceId = service.id;
      closeExpiryMediaAddModal();
      navigateTo('expiry-media-edit');
    } catch (e) { toast(e.message, 'error'); }
  }

  function addExpiryMediaRow(scenario) {
    const wrap = scenario === 'expiring' ? $('#expiryMediaExpiringRows') : $('#expiryMediaExpiredRows');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend', buildExpiryMediaRow({}));
  }

  function removeExpiryMediaRow(btn) {
    const row = btn && btn.closest ? btn.closest('.reseller-members-expiry-row') : null;
    const wrap = row && row.parentElement;
    if (row) row.remove();
    if (wrap && !wrap.querySelector('.reseller-members-expiry-row')) {
      wrap.insertAdjacentHTML('beforeend', buildExpiryMediaRow({}));
    }
  }

  function editExpiryMediaService(id) {
    _expiryMediaEditingServiceId = parseInt(id, 10) || null;
    if (_currentPage !== 'expiry-media-edit') return navigateTo('expiry-media-edit');
    return loadExpiryMediaEditPage();
  }
  // Backward-compatible aliases from the older Resellers surface
  function openResellerModal() { openRegisteredUserForm(); }
  function closeResellerModal() {}
  async function saveReseller() { await saveRegisteredUser(); }
  async function editResellerCredits(id) { await openRegisteredUserCredits(id); }

  // ─── Panel Users ─────────────────────────────────────────────────

  async function loadUsers() {
    try {
      const data = await apiFetch('/users');
      const items = data.users || [];
      $('#usersTable tbody').innerHTML = items.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${escHtml(u.username || '')}</td>
          <td>${escHtml(u.email || '')}</td>
          <td>${u.member_group_id || '-'}</td>
          <td>${statusBadge(u.status === 1, false, false)}</td>
          <td>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteUser(${u.id})">Del</button>
          </td>
        </tr>
      `).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function openUserModal() {
    $('#userModal').style.display = 'flex';
    $('#usrFormId').value = '';
    $('#usrUsername').value = '';
    $('#usrPassword').value = '';
    $('#usrEmail').value = '';
    $('#usrModalTitle').textContent = 'Add User';
  }
  function closeUserModal() { $('#userModal').style.display = 'none'; }

  async function saveUser() {
    const body = { username: $('#usrUsername').value, password: $('#usrPassword').value, email: $('#usrEmail').value };
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(body) });
      toast('User created');
      closeUserModal();
      loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    try { await apiFetch(`/users/${id}`, { method: 'DELETE' }); toast('Deleted'); loadUsers(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ─── EPG ─────────────────────────────────────────────────────────

  async function loadEpg() {
    try {
      const data = await apiFetch('/epg/sources');
      const items = data.sources || [];
      $('#epgTable tbody').innerHTML = items.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${escHtml(s.name || '')}</td>
          <td class="text-truncate" style="max-width:300px">${escHtml(s.url || '')}</td>
          <td>${s.last_updated || 'Never'}</td>
          <td><button class="btn btn-xs btn-danger" onclick="APP.deleteEpg(${s.id})">Del</button></td>
        </tr>
      `).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function openEpgModal() { $('#epgModal').style.display = 'flex'; $('#epgName').value = ''; $('#epgUrl').value = ''; }
  function closeEpgModal() { $('#epgModal').style.display = 'none'; }

  async function saveEpg() {
    try {
      await apiFetch('/epg/sources', { method: 'POST', body: JSON.stringify({ name: $('#epgName').value, url: $('#epgUrl').value }) });
      toast('EPG source added');
      closeEpgModal();
      loadEpg();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteEpg(id) {
    if (!confirm('Delete?')) return;
    try { await apiFetch(`/epg/sources/${id}`, { method: 'DELETE' }); toast('Deleted'); loadEpg(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function refreshEpg() {
    try {
      toast('Refreshing EPG...');
      await apiFetch('/epg/refresh', { method: 'POST' });
      toast('EPG refreshed');
      loadEpg();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Mass EPG Assignment ─────────────────────────────────────────

  APP.autoMatchEpg = async function() {
    toast('EPG auto-match is not available in the current admin page.', 'info');
  };

  // ─── Plex Servers ────────────────────────────────────────────────

  async function loadPlexServers() {
    try {
      const data = await apiFetchOptional('/plex/servers', { servers: [] });
      const servers = data.servers || [];
      $('#plexServersTable tbody').innerHTML = servers.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${escHtml(s.name || '')}</td>
          <td><code style="font-size:0.78rem">${escHtml(s.url || '')}</code></td>
          <td>${s.last_seen ? new Date(s.last_seen).toLocaleString() : 'Never'}</td>
          <td>
            <button class="btn btn-xs btn-secondary" onclick="APP.refreshPlexWatch('${s.id}')">Watchers</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deletePlexServer(${s.id})">Del</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1.5rem">No Plex servers configured</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  }

  function openPlexModal() { $('#plexModal').style.display = 'flex'; }
  function closePlexModal() { $('#plexModal').style.display = 'none'; }

  APP.savePlex = async function() {
    try {
      await apiFetch('/plex/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#plexName')?.value,
          url: $('#plexUrl')?.value,
          plex_token: $('#plexToken')?.value,
        }),
      });
      toast('Plex server saved', 'success');
      closePlexModal();
      loadPlexServers();
    } catch (e) { toast(e.message, 'error'); }
  };

  APP.deletePlexServer = async function(id) {
    if (!confirm('Remove this Plex server?')) return;
    try {
      await apiFetch(`/plex/servers/${id}`, { method: 'DELETE' });
      toast('Removed', 'success');
      loadPlexServers();
    } catch (e) { toast(e.message, 'error'); }
  };

  APP.refreshPlexWatch = async function(id) {
    try {
      const data = await apiFetch(`/plex/servers/${id}/watch-status`);
      const watchers = data.watchers || [];
      const el = document.getElementById('plexWatchStatus');
      if (!el) return;
      if (watchers.length === 0) {
        el.innerHTML = '<span style="color:#8b949e">No active streams</span>';
      } else {
        el.innerHTML = watchers.map(w => `
          <div style="margin-bottom:0.5rem;padding:0.5rem;background:rgba(255,255,255,0.04);border-radius:6px">
            <div style="color:#e6edf3;font-weight:500">${escHtml(w.title)}</div>
            <div style="color:#8b949e;font-size:0.75rem">User: ${escHtml(w.user)} &middot; ${w.viewOffset ? Math.round(w.viewOffset/60000) + 'm watched' : 'started'}</div>
          </div>`).join('');
      }
    } catch (e) {
      const el = document.getElementById('plexWatchStatus');
      if (el) el.innerHTML = `<span style="color:#ef4444">Error: ${escHtml(e.message)}</span>`;
    }
  };

  // ─── Settings ────────────────────────────────────────────────────

  let _streamingPrewarmAllowed = true;
  let _spProvisioningPrev = false;

  function syncSpPrebufferMb() {
    const r = $('#spPrebufferMbRange');
    const n = $('#spPrebufferMb');
    if (!r || !n) return;
    n.value = r.value;
  }

  function syncSpPrebufferMbFromNum() {
    const r = $('#spPrebufferMbRange');
    const n = $('#spPrebufferMb');
    if (!r || !n) return;
    let v = parseInt(n.value, 10);
    if (!Number.isFinite(v)) v = 6;
    v = Math.min(16, Math.max(1, v));
    n.value = v;
    r.value = v;
  }

  async function loadStreamingPerformanceSettings() {
    try {
      const c = await apiFetch('/settings/streaming-performance');
      _streamingPrewarmAllowed = !!c.prewarm_enabled;
      if ($('#spPrebufferEnabled')) $('#spPrebufferEnabled').checked = !!c.prebuffer_enabled;
      const mb = Math.min(16, Math.max(1, Math.round(Number(c.prebuffer_size_mb) || 6)));
      if ($('#spPrebufferMbRange')) $('#spPrebufferMbRange').value = mb;
      if ($('#spPrebufferMb')) $('#spPrebufferMb').value = mb;
      if ($('#spOdMinBytes')) $('#spOdMinBytes').value = c.prebuffer_on_demand_min_bytes != null ? c.prebuffer_on_demand_min_bytes : 2097152;
      if ($('#spOdWaitMs')) $('#spOdWaitMs').value = c.prebuffer_on_demand_max_wait_ms != null ? c.prebuffer_on_demand_max_wait_ms : 3000;
      if ($('#spIngestStyle')) $('#spIngestStyle').value = ['webapp', 'xc', 'safe'].includes(c.ingest_style) ? c.ingest_style : 'webapp';
      if ($('#spLowLatency')) $('#spLowLatency').checked = !!c.low_latency_enabled;
      if ($('#spMinimalIngest')) $('#spMinimalIngest').checked = !!c.minimal_ingest_enabled;
      if ($('#spPrewarmEnabled')) $('#spPrewarmEnabled').checked = !!c.prewarm_enabled;
      // Block VOD download
      try {
        const vodBlock = await apiFetch('/settings/block_vod_download');
        if ($('#spBlockVodDownload')) $('#spBlockVodDownload').checked = !!vodBlock.enabled;
      } catch (_) {}
      if ($('#spProvisioningEnabled')) {
        _spProvisioningPrev = !!c.streaming_provisioning_enabled;
        $('#spProvisioningEnabled').checked = _spProvisioningPrev;
        const envOk = c.provisioning_env_master_enabled !== false;
        $('#spProvisioningEnabled').disabled = !envOk;
        const hint = $('#spProvisioningEnvHint');
        if (hint) {
          hint.textContent = envOk
            ? 'When off, the Install tab stays hidden and provision API returns 403.'
            : 'Set ENABLE_SERVER_PROVISIONING=1 in the panel environment, then restart, to allow enabling here.';
        }
      }
      const r = $('#spPrebufferMbRange');
      if (r && !r._spBound) {
        r._spBound = true;
        r.addEventListener('input', syncSpPrebufferMb);
      }
      const n = $('#spPrebufferMb');
      if (n && !n._spBound) {
        n._spBound = true;
        n.addEventListener('change', syncSpPrebufferMbFromNum);
      }
    } catch (e) {
      console.warn('streaming-performance:', e.message);
    }
  }

  async function saveStreamingPerformance() {
    const spProvEl = $('#spProvisioningEnabled');
    const canToggleProv = !!(spProvEl && !spProvEl.disabled);
    const wantProv = canToggleProv ? !!spProvEl.checked : false;
    if (canToggleProv && wantProv && !_spProvisioningPrev) {
      const ok = confirm(
        'Enable SSH-based server provisioning? Only trusted admins should turn this on. Continue?'
      );
      if (!ok) return;
    }
    const body = {
      prebuffer_enabled: $('#spPrebufferEnabled')?.checked,
      prebuffer_size_mb: parseFloat($('#spPrebufferMb')?.value, 10) || 6,
      prebuffer_on_demand_min_bytes: parseInt($('#spOdMinBytes')?.value, 10) || 0,
      prebuffer_on_demand_max_wait_ms: parseInt($('#spOdWaitMs')?.value, 10) || 3000,
      ingest_style: $('#spIngestStyle')?.value || 'webapp',
      low_latency_enabled: $('#spLowLatency')?.checked,
      minimal_ingest_enabled: $('#spMinimalIngest')?.checked,
      prewarm_enabled: $('#spPrewarmEnabled')?.checked,
    };
    if (canToggleProv) body.streaming_provisioning_enabled = wantProv;
    try {
      await apiFetch('/settings/streaming-performance', { method: 'PUT', body: JSON.stringify(body) });
      _adminFeatures = null;
      // Block VOD download
      const blockVod = $('#spBlockVodDownload')?.checked;
      await apiFetch('/settings/block_vod_download', { method: 'PUT', body: JSON.stringify({ enabled: !!blockVod }) });
      toast('Streaming performance saved');
      await loadStreamingPerformanceSettings();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function applyStreamingPreset(which) {
    const map = {
      ultra_fast: {
        prebuffer_enabled: true,
        prebuffer_size_mb: 6,
        prebuffer_on_demand_min_bytes: 2097152,
        prebuffer_on_demand_max_wait_ms: 3000,
        ingest_style: 'webapp',
        low_latency_enabled: true,
        minimal_ingest_enabled: true,
        prewarm_enabled: true,
      },
      balanced: {
        prebuffer_enabled: true,
        prebuffer_size_mb: 6,
        prebuffer_on_demand_min_bytes: 1048576,
        prebuffer_on_demand_max_wait_ms: 5000,
        ingest_style: 'xc',
        low_latency_enabled: true,
        minimal_ingest_enabled: true,
        prewarm_enabled: true,
      },
      stable: {
        prebuffer_enabled: true,
        prebuffer_size_mb: 8,
        prebuffer_on_demand_min_bytes: 2097152,
        prebuffer_on_demand_max_wait_ms: 8000,
        ingest_style: 'safe',
        low_latency_enabled: false,
        minimal_ingest_enabled: false,
        prewarm_enabled: true,
      },
    };
    const p = map[which];
    if (!p) return;
    if ($('#spPrebufferEnabled')) $('#spPrebufferEnabled').checked = p.prebuffer_enabled;
    if ($('#spPrebufferMbRange')) $('#spPrebufferMbRange').value = p.prebuffer_size_mb;
    if ($('#spPrebufferMb')) $('#spPrebufferMb').value = p.prebuffer_size_mb;
    if ($('#spOdMinBytes')) $('#spOdMinBytes').value = p.prebuffer_on_demand_min_bytes;
    if ($('#spOdWaitMs')) $('#spOdWaitMs').value = p.prebuffer_on_demand_max_wait_ms;
    if ($('#spIngestStyle')) $('#spIngestStyle').value = p.ingest_style;
    if ($('#spLowLatency')) $('#spLowLatency').checked = p.low_latency_enabled;
    if ($('#spMinimalIngest')) $('#spMinimalIngest').checked = p.minimal_ingest_enabled;
    if ($('#spPrewarmEnabled')) $('#spPrewarmEnabled').checked = p.prewarm_enabled;
  }

  /** Keys managed by Streaming tab UI (DB `streaming_*`); hidden from raw advanced. */
  const STREAMING_DB_SETTING_KEYS = new Set([
    'streaming_prebuffer_enabled', 'streaming_prebuffer_size_mb',
    'streaming_prebuffer_on_demand_min_bytes', 'streaming_prebuffer_on_demand_max_wait_ms',
    'streaming_ingest_style', 'streaming_low_latency_enabled',
    'streaming_minimal_ingest_enabled', 'streaming_prewarm_enabled',
    'streaming_provisioning_enabled',
  ]);

  const SETTINGS_PARITY_DEFAULTS = {
    server_name: 'NovaStreams Panel',
    service_logo_url: '',
    service_logo_sidebar_url: '',
    system_timezone: 'UTC',
    force_epg_timezone: 'UTC',
    enigma2_bouquet_name: 'Example',
    live_streaming_pass: '',
    load_balancing_key: '',
    geolite2_version: 'Auto',
    security_patch_level: '5 Levels',

    player_credentials_user: '',
    player_credentials_pass: '',
    tmdb_http: '0',
    new_playlist_without_ts: '1',
    release_parser: 'python',
    logout_on_ip_change: '0',
    cloudflare_connecting_ip: 'HTTP_CF_CONNECTING_IP',
    maximum_login_attempts: '5',
    minimum_password_length: '0',
    default_entries_to_show: '25',
    two_factor_authentication: '0',
    localhost_api: '1',
    dark_mode_login: '0',
    dashboard_stats_enabled: '0',
    stats_interval: '600',
    dashboard_world_map_live: '1',
    dashboard_world_map_activity: '1',
    download_images: '0',
    auto_refresh_default: '1',
    alternate_scandir_cloud: '0',
    show_alert_tickets: '1',
    statistics_enabled: '1',
    disable_get_playlist: '0',
    disable_xml_epg: '0',
    disable_player_api_epg: '0',

    reseller_copyright: '',
    reseller_disable_trials: '0',
    reseller_allow_restrictions: '0',
    reseller_trial_set_date_on_usage: '0',
    reseller_paid_set_date_on_usage: '0',
    reseller_change_usernames: '1',
    reseller_change_own_dns: '0',
    reseller_change_own_email: '0',
    reseller_change_own_password: '1',
    reseller_change_own_language: '1',
    reseller_send_mag_events: '0',
    reseller_use_isplock: '1',
    reseller_use_reset_isp: '1',
    reseller_see_manuals: '1',
    reseller_view_info_dashboard: '0',
    reseller_view_apps_dashboard: '1',
    reseller_convert_mag_to_m3u: '0',
    reseller_deny_same_user_pass: '0',
    reseller_deny_weak_username_password: '0',
    reseller_deny_similar_user_pass: '0',
    reseller_deny_similar_percentage: '80',
    reseller_generating_type: 'random_number',
    reseller_min_chars: '6',

    streaming_main_lb_https: '[]',
    use_https_m3u_lines: '0',
    secure_lb_connection: '0',
    streaming_auto_kick_users: '0',
    category_order_type: 'bouquet',
    streaming_client_prebuffer: '30',
    streaming_restreamer_prebuffer: '0',
    split_clients: 'equally',
    split_by: 'connections',
    analysis_duration: '500000',
    probe_size: '5000000',
    use_custom_name_series_episodes: '0',
    restart_on_audio_loss: '0',
    save_connection_logs: '0',
    save_client_logs: '1',
    case_sensitive_details: '1',
    override_country_with_first: '0',
    enable_xc_firewall: '0',
    enable_isps: '1',
    enable_isp_lock: '0',
    token_revalidate: '0',
    token_validity: '',
    vod_download_speed: '45000',
    vod_download_limit: '20',
    buffer_size_for_reading: '8192',
    block_vpn_proxies_servers: '0',
    always_use_first_working_stream_source: '0',
    stream_down_video_enabled: '0',
    stream_down_video_url: 'Default http video link .ts',
    banned_video_enabled: '0',
    banned_video_url: 'Default http video link .ts',
    expired_video_enabled: '1',
    expired_video_url: 'Default http video link .ts',
    countrylock_video_enabled: '0',
    countrylock_video_url: 'Default http video link .ts',
    max_conn_exceed_video_enabled: '0',
    max_conn_exceed_video_url: 'Default http video link .ts',
    enable_connections_exceed_video_log: '0',
    admin_streaming_ips: '',
    adult_stream_password: '',
    verify_client_ip_during_lb: '0',
    user_connections_red_after_hours: '3',
    restrict_player_api_devices: '0',
    disallow_proxy_types: '[]',

    enable_remote_secure_backups: '0',
    enable_local_backups: '1',
    local_backup_directory: 'data/backups',
    backup_interval_unit: 'hours',
    backups_to_keep: '20',
    cloud_backup_type: '',
    cloud_backup_key: '',
    gdrive_access_token: '',
    gdrive_folder_id: '',
    dropbox_access_token: '',
    s3_bucket: '',
    s3_region: 'us-east-1',
    s3_access_key: '',
    s3_secret_key: '',
  };

  const SETTINGS_RADIO_GENERATOR_TYPES = [
    { value: 'random_number', label: 'Random Number (Easy)' },
    { value: 'hex_string', label: 'Hex String (Normal)' },
    { value: 'random_string', label: 'Random String (Hard)' },
  ];

  const SETTINGS_PROXY_TYPE_OPTIONS = [
    { value: 'tor_exit_nodes', label: 'Tor Exit Nodes' },
    { value: 'datacenters', label: 'DataCenters' },
    { value: 'public_proxies', label: 'Public Proxies' },
    { value: 'web_proxies', label: 'Web Proxies' },
    { value: 'vpn_providers', label: 'VPN Providers' },
  ];

  function getTimezoneOptions() {
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('timeZone');
      }
    } catch (_) {}
    return ['UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Baghdad', 'Asia/Dubai', 'Asia/Istanbul', 'America/New_York'];
  }

  const SETTINGS_TMDB_LANGUAGE_OPTIONS = [
    { value: 'en', label: 'Default - EN' },
    { value: 'ar', label: 'Arabic' },
    { value: 'tr', label: 'Turkish' },
    { value: 'de', label: 'German' },
    { value: 'fr', label: 'French' },
    { value: 'es', label: 'Spanish' },
  ];

  const SETTINGS_DEFAULT_ENTRY_OPTIONS = [10, 25, 50, 100].map(v => ({ value: String(v), label: String(v) }));
  const SETTINGS_RELEASE_PARSER_OPTIONS = [
    { value: 'python', label: 'Python Based (slower, more accurate)' },
    { value: 'node', label: 'Node Based' },
    { value: 'simple', label: 'Simple Parser' },
  ];
  const SETTINGS_CATEGORY_ORDER_OPTIONS = [
    { value: 'bouquet', label: 'Bouquet' },
    { value: 'alphabetical', label: 'Alphabetical' },
    { value: 'id', label: 'ID' },
  ];
  const SETTINGS_SPLIT_CLIENT_OPTIONS = [
    { value: 'equally', label: 'Equally' },
    { value: 'sequential', label: 'Sequential' },
    { value: 'first_available', label: 'First Available' },
  ];
  const SETTINGS_SPLIT_BY_OPTIONS = [
    { value: 'connections', label: 'Connections' },
    { value: 'bandwidth', label: 'Bandwidth' },
    { value: 'country', label: 'Country' },
  ];
  const SETTINGS_INTERVAL_UNIT_OPTIONS = [
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
  ];

  let _settingsDataCache = {};
  let _settingsSummaryCache = null;

  const SETTINGS_GENERAL_SECTIONS = [
    {
      title: 'General',
      rows: [
        [
          { key: 'server_name', label: 'Server Name', type: 'text' },
          { key: 'service_logo_url', label: 'Service Logo URL', type: 'text' },
        ],
        [
          { key: 'service_logo_sidebar_url', label: 'Service Logo Sidebar URL (180x40)', type: 'text' },
          { key: 'system_timezone', label: 'System Timezone', type: 'select', options: getTimezoneOptions },
        ],
        [
          { key: 'force_epg_timezone', label: 'Force EPG Timezone', type: 'select', options: getTimezoneOptions },
          { key: 'enigma2_bouquet_name', label: 'Enigma2 Bouquet Name', type: 'text' },
        ],
        [
          { key: 'live_streaming_pass', label: 'Live Streaming Pass', type: 'password' },
          { key: 'load_balancing_key', label: 'Load Balancing Key', type: 'password' },
        ],
      ],
    },
  ];

  const SETTINGS_XTREAM_SECTIONS = [
    {
      title: 'XtreamMasters',
      rows: [
        [
          { key: 'player_credentials_user', label: 'Player Credentials User', type: 'text' },
          { key: 'player_credentials_pass', label: 'Player Credentials Pass', type: 'password' },
        ],
        [
          { key: 'tmdb_api_key', label: 'TMDB Key', type: 'text' },
          { key: 'tmdb_language', label: 'TMDB Language', type: 'select', options: SETTINGS_TMDB_LANGUAGE_OPTIONS },
        ],
        [
          { key: 'tmdb_http', label: 'TMDB HTTP', type: 'toggle' },
          { key: 'new_playlist_without_ts', label: 'New Playlist without .ts', type: 'toggle' },
        ],
        [
          { key: 'release_parser', label: 'Release Parser', type: 'select', options: SETTINGS_RELEASE_PARSER_OPTIONS },
          { key: 'logout_on_ip_change', label: 'Logout On IP Change', type: 'toggle' },
        ],
        [
          { key: 'cloudflare_connecting_ip', label: 'Cloudflare Connecting IP', type: 'text' },
          { key: 'maximum_login_attempts', label: 'Maximum Login Attempts', type: 'number' },
        ],
        [
          { key: 'minimum_password_length', label: 'Minimum Password Length', type: 'number' },
          { key: 'default_entries_to_show', label: 'Default Entries to Show', type: 'select', options: SETTINGS_DEFAULT_ENTRY_OPTIONS },
        ],
        [
          { key: 'two_factor_authentication', label: 'Two Factor Authentication', type: 'toggle' },
          { key: 'localhost_api', label: 'Localhost API', type: 'toggle' },
        ],
        [
          { key: 'dark_mode_login', label: 'Dark Mode Login', type: 'toggle' },
          { key: 'dashboard_stats_enabled', label: 'Dashboard Stats', type: 'toggle' },
        ],
        [
          { key: 'stats_interval', label: 'Stats Interval', type: 'number' },
          { key: 'dashboard_world_map_live', label: 'Dashboard World Map Live', type: 'toggle' },
        ],
        [
          { key: 'dashboard_world_map_activity', label: 'Dashboard World Map Activity', type: 'toggle' },
          { key: 'download_images', label: 'Download Images', type: 'toggle' },
        ],
        [
          { key: 'auto_refresh_default', label: 'Auto-Refresh by Default', type: 'toggle' },
          { key: 'alternate_scandir_cloud', label: 'Alternate Scandir Method (Cloud)', type: 'toggle' },
        ],
        [
          { key: 'show_alert_tickets', label: 'Show alert tickets', type: 'toggle' },
          { key: 'statistics_enabled', label: 'Statistics', type: 'toggle' },
        ],
      ],
    },
    {
      title: 'Disable services during peak hours to prevent excessive CPU resource usage.',
      rows: [
        [
          { key: 'disable_get_playlist', label: 'Disable Get Playlist', type: 'toggle' },
          { key: 'disable_player_api', label: 'Disable Player_API', type: 'toggle' },
        ],
        [
          { key: 'disable_xml_epg', label: 'Disable XML EPG', type: 'toggle' },
          { key: 'disable_player_api_epg', label: 'Disable Player_API EPG', type: 'toggle' },
        ],
      ],
      centerTitle: true,
    },
  ];

  const SETTINGS_RESELLER_SECTIONS = [
    {
      title: 'Reseller',
      rows: [
        [
          { key: 'reseller_copyright', label: 'Copyright', type: 'text' },
          null,
        ],
        [
          { key: 'reseller_disable_trials', label: 'Disable Trials', type: 'toggle' },
          { key: 'reseller_allow_restrictions', label: 'Allow Restrictions', type: 'toggle' },
        ],
        [
          { key: 'reseller_trial_set_date_on_usage', label: 'Trial M3U Lines - Set Date on Usage', type: 'toggle' },
          { key: 'reseller_paid_set_date_on_usage', label: 'Paid M3U Lines - Set Date on Usage', type: 'toggle' },
        ],
        [
          { key: 'reseller_change_usernames', label: 'Change Usernames', type: 'toggle' },
          { key: 'reseller_change_own_dns', label: 'Change Own DNS', type: 'toggle' },
        ],
        [
          { key: 'reseller_change_own_email', label: 'Change Own Email Address', type: 'toggle' },
          { key: 'reseller_change_own_password', label: 'Change Own Password', type: 'toggle' },
        ],
        [
          { key: 'reseller_change_own_language', label: 'Change Own Language', type: 'toggle' },
          { key: 'reseller_send_mag_events', label: 'Reseller Send Mag Events', type: 'toggle' },
        ],
        [
          { key: 'reseller_use_isplock', label: 'Reseller can use IspLock', type: 'toggle' },
          { key: 'reseller_use_reset_isp', label: 'Reseller can use Reset Isp', type: 'toggle' },
        ],
        [
          { key: 'reseller_see_manuals', label: 'Reseller can see Manuals', type: 'toggle' },
          { key: 'reseller_view_info_dashboard', label: 'Reseller can view Info Dashboard', type: 'toggle' },
        ],
        [
          { key: 'reseller_view_apps_dashboard', label: 'Reseller can view APPS Dashboard', type: 'toggle' },
          { key: 'reseller_convert_mag_to_m3u', label: 'Reseller can Convert MAG to M3U', type: 'toggle' },
        ],
      ],
    },
    {
      title: 'Weak Lines Username and Password Restrictions',
      rows: [
        [
          { key: 'reseller_deny_same_user_pass', label: 'Deny Same Username & Password For Lines', type: 'toggle' },
          { key: 'reseller_deny_weak_username_password', label: 'Deny Weak Username or Password', type: 'toggle' },
        ],
        [
          { key: 'reseller_deny_similar_user_pass', label: 'Deny Similar Username and password', type: 'toggle' },
          { key: 'reseller_deny_similar_percentage', label: 'Deny Similar Username and password Percentage', type: 'number' },
        ],
        [
          { key: 'reseller_generating_type', label: 'Select Username, Password Generating Type.', type: 'radio', options: SETTINGS_RADIO_GENERATOR_TYPES },
          { key: 'reseller_min_chars', label: 'Min Chart For user/pass', type: 'number' },
        ],
      ],
      centerTitle: true,
    },
  ];

  const SETTINGS_STREAMING_SECTIONS = [
    {
      title: 'Load balancing and delivery',
      rows: [
        [
          { key: 'streaming_main_lb_https', label: 'Main or Loadbalancer Https', type: 'taglist', clearLabel: 'Clear all' },
          null,
        ],
        [
          { key: 'use_https_m3u_lines', label: 'Use Https M3U Lines', type: 'toggle' },
          { key: 'secure_lb_connection', label: 'Secure LB Connection', type: 'toggle' },
        ],
        [
          { key: 'streaming_auto_kick_users', label: 'Auto-Kick Users', type: 'number' },
          { key: 'category_order_type', label: 'Category Order Type', type: 'select', options: SETTINGS_CATEGORY_ORDER_OPTIONS },
        ],
        [
          { key: 'streaming_client_prebuffer', label: 'Client Prebuffer', type: 'number' },
          { key: 'streaming_restreamer_prebuffer', label: 'Restreamer Prebuffer', type: 'number' },
        ],
        [
          { key: 'split_clients', label: 'Split Clients', type: 'select', options: SETTINGS_SPLIT_CLIENT_OPTIONS },
          { key: 'split_by', label: 'Split By', type: 'select', options: SETTINGS_SPLIT_BY_OPTIONS },
        ],
        [
          { key: 'analysis_duration', label: 'Analysis Duration', type: 'number' },
          { key: 'probe_size', label: 'Probe Size', type: 'number' },
        ],
      ],
    },
    {
      title: 'Stream behavior and logs',
      rows: [
        [
          { key: 'use_custom_name_series_episodes', label: 'Use Custom Name on Series Episodes', type: 'toggle' },
          { key: 'restart_on_audio_loss', label: 'Restart on Audio Loss', type: 'toggle' },
        ],
        [
          { key: 'save_connection_logs', label: 'Save Connection Logs', type: 'toggle' },
          { key: 'save_client_logs', label: 'Save Client Logs', type: 'toggle' },
        ],
        [
          { key: 'case_sensitive_details', label: 'Case Sensitive Details', type: 'toggle' },
          { key: 'override_country_with_first', label: 'Override Country with First', type: 'toggle' },
        ],
        [
          { key: 'disallow_2nd_ip_con', label: 'Disallow 2nd IP Connection', type: 'toggle' },
          { key: 'enable_xc_firewall', label: 'Enable XC Firewall', type: 'toggle' },
        ],
        [
          { key: 'enable_isps', label: 'Enable ISP\'s', type: 'toggle' },
          { key: 'enable_isp_lock', label: 'Enable Isp Lock', type: 'toggle' },
        ],
        [
          { key: 'token_revalidate', label: 'Token Re-Validate', type: 'toggle' },
          { key: 'token_validity', label: 'Token Validity', type: 'text' },
        ],
        [
          { key: 'vod_download_speed', label: 'VOD Download Speed', type: 'number' },
          { key: 'vod_download_limit', label: 'VOD Download Limit', type: 'number' },
        ],
        [
          { key: 'buffer_size_for_reading', label: 'Buffer Size For Reading', type: 'number' },
          { key: 'block_vpn_proxies_servers', label: 'Block VPN & PROXIES & SERVERS', type: 'toggle' },
        ],
        [
          { key: 'always_use_first_working_stream_source', label: 'Always use first working stream source', type: 'toggle' },
          { key: 'enable_connections_exceed_video_log', label: 'Enable Connections Exceed VideoLog', type: 'toggle' },
        ],
        [
          { key: 'admin_streaming_ips', label: 'Admin Streaming IP\'s', type: 'textarea' },
          { key: 'adult_stream_password', label: 'Adult Stream Password', type: 'password' },
        ],
        [
          { key: 'verify_client_ip_during_lb', label: 'Verify Client-IP During Load Balancing', type: 'toggle' },
          { key: 'user_connections_red_after_hours', label: 'Show In Red The User Connections, Based On Total Time Online', type: 'number' },
        ],
        [
          { key: 'restrict_player_api_devices', label: 'Restrict Player API on devices', type: 'toggle' },
          { key: 'disallow_proxy_types', label: 'Disallow Following Proxy Types Connections', type: 'checklist', options: SETTINGS_PROXY_TYPE_OPTIONS },
        ],
        [
          { key: 'allow_countries', label: 'Allow connections from these countries', type: 'taglist', clearLabel: 'Allow all countries' },
          null,
        ],
      ],
    },
    {
      title: 'Status video fallbacks',
      rows: [
        [
          { key: 'stream_down_video_enabled', label: 'Stream Down Video', type: 'toggle' },
          { key: 'stream_down_video_url', label: 'Default Stream Down Video URL', type: 'text' },
        ],
        [
          { key: 'banned_video_enabled', label: 'Banned Video', type: 'toggle' },
          { key: 'banned_video_url', label: 'Default Banned Video URL', type: 'text' },
        ],
        [
          { key: 'expired_video_enabled', label: 'Expired Video', type: 'toggle' },
          { key: 'expired_video_url', label: 'Default Expired Video URL', type: 'text' },
        ],
        [
          { key: 'countrylock_video_enabled', label: 'CountryLock Video', type: 'toggle' },
          { key: 'countrylock_video_url', label: 'Default CountryLock Video URL', type: 'text' },
        ],
        [
          { key: 'max_conn_exceed_video_enabled', label: 'Max Conx Exceed Video', type: 'toggle' },
          { key: 'max_conn_exceed_video_url', label: 'Default Max Conx Exceed Video URL', type: 'text' },
        ],
      ],
    },
  ];

  const SETTINGS_DATABASE_KEYS = new Set([
    'enable_remote_secure_backups', 'dropbox_access_token', 'enable_local_backups', 'local_backup_directory',
    'automatic_backups', 'backup_interval_hours', 'backup_interval_unit', 'backups_to_keep',
    'cloud_backup_type', 'cloud_backup_key', 'gdrive_access_token', 'gdrive_folder_id',
    's3_bucket', 's3_region', 's3_access_key', 's3_secret_key'
  ]);

  function isTruthySetting(val) {
    const v = String(val ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  function getSettingValue(data, key) {
    if (data && data[key] !== undefined && data[key] !== null && String(data[key]) !== '') return String(data[key]);
    return String(SETTINGS_PARITY_DEFAULTS[key] ?? '');
  }

  function getSettingBool(data, key) {
    if (data && data[key] !== undefined && data[key] !== null && String(data[key]) !== '') return isTruthySetting(data[key]);
    return isTruthySetting(SETTINGS_PARITY_DEFAULTS[key] ?? '0');
  }

  function parseStoredArray(raw, fallback = []) {
    if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean);
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return [...fallback];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(x => String(x).trim()).filter(Boolean);
    } catch (_) {}
    return s.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
  }

  function renderSettingsField(field, data) {
    if (!field) return '<div class="settings-parity-field is-empty"></div>';
    const key = field.key;
    const label = escHtml(field.label || key);
    const hint = field.hint ? `<div class="settings-parity-hint">${escHtml(field.hint)}</div>` : '';
    const type = field.type || 'text';

    if (type === 'toggle') {
      return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><label class="toggle"><input type="checkbox" class="settings-toggle" data-key="${escHtml(key)}" ${getSettingBool(data, key) ? 'checked' : ''}><span class="toggle-slider"></span></label></div>${hint}</div>`;
    }

    if (type === 'select') {
      const opts = typeof field.options === 'function' ? field.options() : (field.options || []);
      const current = getSettingValue(data, key);
      const optionsHtml = opts.map((opt) => {
        const value = typeof opt === 'string' ? opt : opt.value;
        const text = typeof opt === 'string' ? opt : opt.label;
        return `<option value="${escHtml(String(value))}" ${String(current) === String(value) ? 'selected' : ''}>${escHtml(String(text))}</option>`;
      }).join('');
      return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><select class="form-control settings-input" data-key="${escHtml(key)}">${optionsHtml}</select></div>${hint}</div>`;
    }

    if (type === 'textarea') {
      return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><textarea class="form-control settings-input" data-key="${escHtml(key)}" rows="4">${escHtml(getSettingValue(data, key))}</textarea></div>${hint}</div>`;
    }

    if (type === 'radio') {
      const current = getSettingValue(data, key);
      const opts = field.options || [];
      const radios = opts.map((opt) => `
        <label class="settings-radio-option">
          <input type="radio" name="${escHtml(key)}" class="settings-radio" data-key="${escHtml(key)}" value="${escHtml(opt.value)}" ${String(current) === String(opt.value) ? 'checked' : ''}>
          <span>${escHtml(opt.label)}</span>
        </label>`).join('');
      return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control settings-radio-group">${radios}</div>${hint}</div>`;
    }

    if (type === 'checklist') {
      const values = new Set(parseStoredArray(getSettingValue(data, key)));
      const checks = (field.options || []).map((opt) => `
        <label class="settings-check-option">
          <input type="checkbox" class="settings-checklist-item" data-key="${escHtml(key)}" value="${escHtml(opt.value)}" ${values.has(String(opt.value)) ? 'checked' : ''}>
          <span>${escHtml(opt.label)}</span>
        </label>`).join('');
      return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control settings-checklist">${checks}</div>${hint}</div>`;
    }

    if (type === 'taglist') {
      const items = parseStoredArray(getSettingValue(data, key));
      const chips = items.map((item) => `<span class="settings-chip" data-value="${escHtml(item)}">${escHtml(item)} <button type="button" class="settings-chip-remove">&times;</button></span>`).join('');
      return `<div class="settings-parity-field settings-parity-field-wide"><label>${label}</label><div class="settings-parity-control"><div class="settings-chip-editor" data-key="${escHtml(key)}"><div class="settings-chip-list">${chips}</div><div class="settings-chip-input-row"><input type="text" class="form-control settings-chip-input" placeholder="Type and press Enter"></div><input type="hidden" class="settings-tag-hidden" data-key="${escHtml(key)}" value="${escHtml(JSON.stringify(items))}"></div>${field.clearLabel ? `<button type="button" class="btn btn-xs btn-secondary settings-chip-clear" data-key="${escHtml(key)}">${escHtml(field.clearLabel)}</button>` : ''}</div>${hint}</div>`;
    }

    const inputType = type === 'password' ? 'password' : (type === 'number' ? 'number' : 'text');
    const step = type === 'number' ? (field.step || '1') : '';
    const placeholder = field.placeholder ? ` placeholder="${escHtml(field.placeholder)}"` : '';
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><input type="${inputType}" class="form-control settings-input" data-key="${escHtml(key)}" value="${escHtml(getSettingValue(data, key))}"${placeholder}${step ? ` step="${escHtml(String(step))}"` : ''}></div>${hint}</div>`;
  }

  function renderSettingsSection(section, data) {
    const rowsHtml = (section.rows || []).map((row) => {
      const cols = Array.isArray(row) ? row : [row];
      return `<div class="settings-parity-grid-row">${cols.map((field) => renderSettingsField(field, data)).join('')}</div>`;
    }).join('');
    return `<section class="settings-parity-section"><h4 class="settings-group-title${section.centerTitle ? ' is-centered' : ''}">${escHtml(section.title || '')}</h4>${section.note ? `<p class="settings-hint">${escHtml(section.note)}</p>` : ''}${rowsHtml}</section>`;
  }

  function renderSettingsSections(sections, data) {
    return sections.map((section) => renderSettingsSection(section, data)).join('');
  }

  function renderStreamingPerformanceBlock(streamingPerf) {
    const provEnabled = !!streamingPerf.streaming_provisioning_enabled;
    const envOk = streamingPerf.provisioning_env_master_enabled !== false;
    return `
      <section class="settings-parity-section settings-perf-section">
        <div class="settings-faq-strip">FAQs: Recommended Streaming Settings Configuration</div>
        <div class="settings-perf-preset-row">
          <button type="button" class="btn btn-xs btn-secondary" onclick="APP.applyStreamingPreset('ultra_fast')">Ultra Fast</button>
          <button type="button" class="btn btn-xs btn-secondary" onclick="APP.applyStreamingPreset('balanced')">Balanced</button>
          <button type="button" class="btn btn-xs btn-secondary" onclick="APP.applyStreamingPreset('stable')">Stable</button>
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'streaming_prebuffer_enabled', label: 'Prebuffer', type: 'toggle' }, {
            streaming_prebuffer_enabled: streamingPerf.prebuffer_enabled ? '1' : '0',
          })}
          ${renderSettingsField({ key: 'streaming_prebuffer_size_mb', label: 'Client Prebuffer', type: 'number' }, {
            streaming_prebuffer_size_mb: streamingPerf.prebuffer_size_mb,
          })}
        </div>
        <div class="settings-parity-grid-row">
          <div class="settings-parity-field"><label>Prebuffer Size (MB)</label><div class="settings-parity-control settings-range-pair"><input type="range" id="spPrebufferMbRange" min="1" max="16" step="1"><input type="number" id="spPrebufferMb" class="form-control" min="1" max="16" step="1"></div></div>
          <div class="settings-parity-field"><label>On-demand Start Buffer (bytes)</label><div class="settings-parity-control"><input type="number" id="spOdMinBytes" class="form-control" min="0" step="1024"></div></div>
        </div>
        <div class="settings-parity-grid-row">
          <div class="settings-parity-field"><label>On-demand Max Wait (ms)</label><div class="settings-parity-control"><input type="number" id="spOdWaitMs" class="form-control" min="100" max="60000" step="100"></div></div>
          <div class="settings-parity-field"><label>Ingest Style</label><div class="settings-parity-control"><select id="spIngestStyle" class="form-control"><option value="webapp">Webapp (fast)</option><option value="xc">XC (balanced)</option><option value="safe">Safe (stable)</option></select></div></div>
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'streaming_low_latency_enabled', label: 'Low Latency Demux', type: 'toggle' }, { streaming_low_latency_enabled: streamingPerf.low_latency_enabled ? '1' : '0' })}
          ${renderSettingsField({ key: 'streaming_minimal_ingest_enabled', label: 'Minimal Ingest', type: 'toggle' }, { streaming_minimal_ingest_enabled: streamingPerf.minimal_ingest_enabled ? '1' : '0' })}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'streaming_prewarm_enabled', label: 'Pre-warm Feature', type: 'toggle' }, { streaming_prewarm_enabled: streamingPerf.prewarm_enabled ? '1' : '0' })}
          <div class="settings-parity-field"><label>Block VOD Download</label><div class="settings-parity-control"><label class="toggle"><input type="checkbox" id="spBlockVodDownload" class="settings-toggle" data-key="block_vod_download" ${streamingPerf.block_vod_download ? 'checked' : ''}><span class="toggle-slider"></span></label></div></div>
        </div>
        <div class="settings-parity-grid-row">
          <div class="settings-parity-field"><label>Enable Server Provisioning</label><div class="settings-parity-control"><label class="toggle"><input type="checkbox" id="spProvisioningEnabled" ${provEnabled ? 'checked' : ''} ${envOk ? '' : 'disabled'}><span class="toggle-slider"></span></label><span class="toggle-label text-muted" id="spProvisioningEnvHint">${envOk ? 'When off, the Install tab stays hidden and provision API returns 403.' : 'Set ENABLE_SERVER_PROVISIONING=1 in the panel environment, then restart, to allow enabling here.'}</span></div></div>
          <div class="settings-parity-field is-empty"></div>
        </div>
      </section>`;
  }

  function renderDatabaseSettings(data) {
    const intervalUnit = getSettingValue(data, 'backup_interval_unit') || 'hours';
    const rawHours = parseInt(getSettingValue(data, 'backup_interval_hours'), 10) || 0;
    const intervalDisplay = intervalUnit === 'days' ? Math.max(1, Math.round(rawHours / 24) || 1) : Math.max(1, rawHours || 1);
    return `
      <section class="settings-parity-section">
        <h4 class="settings-group-title">Database / Backups</h4>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'enable_remote_secure_backups', label: 'Enable Remote Secure Backups', type: 'toggle' }, data)}
          ${renderSettingsField({ key: 'dropbox_access_token', label: 'DropBox API Key', type: 'password' }, data)}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'enable_local_backups', label: 'Enable Local Backups', type: 'toggle' }, data)}
          ${renderSettingsField({ key: 'local_backup_directory', label: 'Local Backup Directory', type: 'text' }, data)}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'automatic_backups', label: 'Enable Auto Backups', type: 'toggle' }, data)}
          <div class="settings-parity-field"><label>Every</label><div class="settings-parity-control settings-inline-pair"><input type="number" class="form-control settings-input" data-key="backup_interval_hours" value="${escHtml(String(intervalDisplay))}"><select class="form-control settings-input" data-key="backup_interval_unit">${SETTINGS_INTERVAL_UNIT_OPTIONS.map((opt) => `<option value="${escHtml(opt.value)}" ${intervalUnit === opt.value ? 'selected' : ''}>${escHtml(opt.label)}</option>`).join('')}</select></div></div>
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'backups_to_keep', label: 'Backups to Keep', type: 'number' }, data)}
          ${renderSettingsField({ key: 'cloud_backup_key', label: 'Cloud Backup Encryption Key', type: 'password' }, data)}
        </div>
      </section>
      <section class="settings-parity-section">
        <p class="settings-hint">Cloud backup uploads remain intentionally de-scoped in TARGET. These fields are stored for parity only and do not enable real remote provider-backed uploads.</p>
        <div class="settings-setup-buttons">
          <button type="button" class="btn btn-secondary" onclick="APP.openSettingsBackupProvider('xdrive')" disabled title="Blocked: no xDrive provider implementation in TARGET">xDrive Auto Backup De-scoped</button>
          <button type="button" class="btn btn-secondary" onclick="APP.openSettingsBackupProvider('gdrive')" title="Provider config only; uploads remain de-scoped">Google Drive Config Only</button>
        </div>
        <div class="settings-parity-grid-row">
          <div class="settings-parity-field"><label>Stored Cloud Provider Config</label><div class="settings-parity-control"><select id="settingsDbCloudType" class="form-control settings-input" data-key="cloud_backup_type"><option value="">Disabled</option><option value="gdrive">Google Drive</option><option value="dropbox">Dropbox</option><option value="s3">Amazon S3</option></select></div><small class="settings-hint">Selecting a provider stores parity config only. It does not activate uploads.</small></div>
          ${renderSettingsField({ key: 'gdrive_access_token', label: 'Google Drive Access Token', type: 'password' }, data)}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 'gdrive_folder_id', label: 'Google Drive Folder ID', type: 'text' }, data)}
          ${renderSettingsField({ key: 'dropbox_access_token', label: 'DropBox Backup Access Token', type: 'password' }, data)}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 's3_bucket', label: 'S3 Bucket', type: 'text' }, data)}
          ${renderSettingsField({ key: 's3_region', label: 'S3 Region', type: 'text' }, data)}
        </div>
        <div class="settings-parity-grid-row">
          ${renderSettingsField({ key: 's3_access_key', label: 'S3 Access Key', type: 'text' }, data)}
          ${renderSettingsField({ key: 's3_secret_key', label: 'S3 Secret Key', type: 'password' }, data)}
        </div>
      </section>`;
  }

  function buildSettingsSummary(summary) {
    const version = summary.version || {};
    const dbStatus = summary.dbStatus || {};
    const geolite = getSettingValue(summary.settings || {}, 'geolite2_version');
    const patch = getSettingValue(summary.settings || {}, 'security_patch_level');
    return `
      <div class="settings-summary-card purple">
        <div class="settings-summary-label">Installed Version</div>
        <div class="settings-summary-value">${escHtml(version.current || '—')}</div>
        <div class="settings-summary-status ${version.currentIsOutdated ? 'warn' : 'ok'}">${version.currentIsOutdated ? 'Update Available' : 'Up to Date'}</div>
      </div>
      <div class="settings-summary-card blue">
        <div class="settings-summary-label">GeoLite2 Version</div>
        <div class="settings-summary-value">${escHtml(geolite || 'Auto')}</div>
        <div class="settings-summary-status ok">Up to Date</div>
      </div>
      <div class="settings-summary-card green">
        <div class="settings-summary-label">Security Patch</div>
        <div class="settings-summary-value">${escHtml(patch || '5 Levels')}</div>
        <div class="settings-summary-status ok">Up to Date</div>
      </div>
      <div class="settings-summary-card orange">
        <div class="settings-summary-label">Database Tables</div>
        <div class="settings-summary-value">${escHtml(String(dbStatus.total_tables || 0))}</div>
        <div class="settings-summary-actions">
          <button type="button" class="btn btn-xs btn-secondary" onclick="APP.refreshSettingsSummary()">Update Now</button>
          <button type="button" class="btn btn-xs btn-primary" onclick="APP.runDbOptimize()">Optimize Database</button>
        </div>
      </div>`;
  }

  function applyPanelBranding(data) {
    const panelName = getSettingValue(data, 'server_name') || 'NovaStreams Panel';
    document.title = panelName;
    const loginText = document.querySelector('.login-logo-text');
    const brandName = document.querySelector('.brand-name');
    if (loginText) loginText.textContent = panelName;
    if (brandName) brandName.textContent = panelName;

    const setBrandImage = (selector, url) => {
      const el = document.querySelector(selector);
      if (!el) return;
      if (!el.dataset.defaultMarkup) el.dataset.defaultMarkup = el.innerHTML;
      if (url) {
        el.innerHTML = `<img src="${escHtml(url)}" alt="${escHtml(panelName)}" class="settings-brand-image" onerror="this.style.display='none'">`;
      } else {
        el.innerHTML = el.dataset.defaultMarkup;
      }
    };
    setBrandImage('.login-logo-icon', getSettingValue(data, 'service_logo_url'));
    setBrandImage('.brand-icon', getSettingValue(data, 'service_logo_sidebar_url'));
  }

  function switchSettingsTab(tab) {
    $$('#settingsTabBar .settings-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.settingsTab === tab);
    });
    $$('[data-settings-panel]').forEach(panel => {
      const on = panel.dataset.settingsPanel === tab;
      panel.style.display = on ? 'block' : 'none';
      panel.classList.toggle('active', on);
    });
    try { localStorage.setItem('settingsActiveTab', tab); } catch (_) {}
  }

  async function loadTelegramSettings() {
    try {
      const data = await apiFetch('/settings/telegram');
      const tokenEl = document.getElementById('tgBotToken');
      const chatEl = document.getElementById('tgAdminChatId');
      const alertsEl = document.getElementById('tgAlertsEnabled');
      if (tokenEl) tokenEl.value = data.bot_token_set ? '••••••••' : '';
      if (chatEl) chatEl.value = data.admin_chat_id || '';
      if (alertsEl) alertsEl.checked = data.alerts_enabled;
      return data;
    } catch (e) {
      console.warn('telegram-settings:', e.message);
      return { bot_token_set: false, admin_chat_id: '', alerts_enabled: false };
    }
  }

  async function saveTelegramSettings(silent = false) {
    await apiFetch('/settings/telegram', {
      method: 'PUT',
      body: JSON.stringify({
        bot_token: document.getElementById('tgBotToken')?.value || '',
        admin_chat_id: document.getElementById('tgAdminChatId')?.value || '',
        alerts_enabled: document.getElementById('tgAlertsEnabled')?.checked,
      }),
    });
    if (!silent) toast('Telegram settings saved. Bot will restart.', 'success');
  }
  APP.saveTelegramSettings = saveTelegramSettings;

  function settingsStructuredKeys() {
    const keys = new Set([
      ...Object.keys(SETTINGS_PARITY_DEFAULTS),
      'disable_player_api', 'disable_ministra', 'restrict_playlists', 'restrict_same_ip',
      'auth_flood_limit', 'auth_flood_window_sec', 'bruteforce_max_attempts', 'bruteforce_window_sec',
      'default_stream_server_id', 'stream_user_agent', 'max_connections_per_line',
    ]);
    for (const key of STREAMING_DB_SETTING_KEYS) keys.add(key);
    return keys;
  }

  function renderAdvancedRawSettings(data) {
    const structured = settingsStructuredKeys();
    const keys = Object.keys(data || {}).sort().filter((k) => !structured.has(k));
    $('#settingsForm').innerHTML = keys.map(k => `
      <div class="form-row settings-pref-row">
        <label>${escHtml(k)}</label>
        <div class="form-input"><input type="text" class="form-control setting-input" data-key="${escHtml(k)}" value="${escHtml(String(data[k] || ''))}"></div>
      </div>`).join('') + `
      <div class="form-row settings-pref-row">
        <label>Add new key</label>
        <div class="form-input">
          <input type="text" id="newSettingKey" class="form-control" placeholder="key">
          <input type="text" id="newSettingVal" class="form-control mt-1" placeholder="value">
        </div>
      </div>`;
  }

  function renderSettingsBackupsTable(backups) {
    const tb = $('#settingsBackupsTable tbody');
    if (!tb) return;
    const rows = Array.isArray(backups) ? backups : [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#8b949e;padding:2rem">No backups found</td></tr>';
      return;
    }
    tb.innerHTML = rows.map((b) => `
      <tr>
        <td>${new Date(b.created_at).toLocaleString()}</td>
        <td>${b.size_mb} MB</td>
        <td>
          <div class="backup-actions compact">
            <button class="btn btn-restore" onclick="APP.restoreBackup(${b.id})">Restore</button>
            <button class="btn btn-download" onclick="APP.downloadBackup(${b.id})">Download</button>
            <button class="btn btn-delete-backup" onclick="APP.deleteBackup(${b.id})">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  }

  function syncSettingsSummary(summary) {
    _settingsSummaryCache = summary;
    const banner = $('#settingsUpdateNotice');
    const version = summary.version || {};
    if (banner) {
      if (version.currentIsOutdated) {
        banner.style.display = 'block';
        banner.innerHTML = `Main server update available version: <strong>[${escHtml(version.latest || '')}]</strong> <a href="#" onclick="APP.openSettingsReleaseUrl();return false;">click here to update main server</a>.`;
      } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }
    }
    const grid = $('#settingsSummaryGrid');
    if (grid) grid.innerHTML = buildSettingsSummary(summary);
  }

  APP.openSettingsReleaseUrl = function() {
    if (_settingsSummaryCache && _settingsSummaryCache.version && _settingsSummaryCache.version.releaseUrl) {
      window.open(_settingsSummaryCache.version.releaseUrl, '_blank', 'noopener');
    }
  };

  APP.refreshSettingsSummary = async function() {
    try {
      const [settings, version, dbStatus] = await Promise.all([
        apiFetch('/settings'),
        apiFetch('/version'),
        apiFetch('/system/db-status').catch(() => ({ total_tables: 0 })),
      ]);
      syncSettingsSummary({ settings, version, dbStatus });
      toast('Settings summary refreshed', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  APP.openSettingsBackupProvider = function(provider) {
    if (provider === 'xdrive') {
      toast('xDrive auto cloud backup is not currently supported in TARGET.', 'warning');
      return;
    }
    toast('Cloud provider setup here stores parity config only. Remote uploads remain de-scoped in TARGET.', 'warning');
    const el = $('#settingsDbCloudType');
    if (el) el.value = provider;
  };

  function initSettingsChipEditors() {
    $$('.settings-chip-editor').forEach((editor) => {
      const hidden = editor.querySelector('.settings-tag-hidden');
      const list = editor.querySelector('.settings-chip-list');
      const input = editor.querySelector('.settings-chip-input');
      if (!hidden || !list || !input || editor._bound) return;
      editor._bound = true;

      const syncHidden = () => {
        const values = [...list.querySelectorAll('.settings-chip')].map((chip) => chip.dataset.value).filter(Boolean);
        hidden.value = JSON.stringify(values);
      };

      const addChip = (value) => {
        const v = String(value || '').trim();
        if (!v) return;
        if ([...list.querySelectorAll('.settings-chip')].some((chip) => chip.dataset.value === v)) return;
        const chip = document.createElement('span');
        chip.className = 'settings-chip';
        chip.dataset.value = v;
        chip.innerHTML = `${escHtml(v)} <button type="button" class="settings-chip-remove">&times;</button>`;
        list.appendChild(chip);
        syncHidden();
      };

      list.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('settings-chip-remove')) {
          const chip = e.target.closest('.settings-chip');
          if (chip) chip.remove();
          syncHidden();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          addChip(input.value);
          input.value = '';
        }
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) {
          addChip(input.value);
          input.value = '';
        }
      });
    });

    $$('.settings-chip-clear').forEach((btn) => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const editor = document.querySelector(`.settings-chip-editor[data-key="${key}"]`);
        if (!editor) return;
        const list = editor.querySelector('.settings-chip-list');
        const hidden = editor.querySelector('.settings-tag-hidden');
        if (list) list.innerHTML = '';
        if (hidden) hidden.value = '[]';
      });
    });
  }

  async function getAdminFeatures() {
    if (_adminFeatures) return _adminFeatures;
    try {
      _adminFeatures = await apiFetch('/features');
    } catch {
      _adminFeatures = { serverProvisioning: false };
    }
    return _adminFeatures;
  }

  function serverStatusBadge(s) {
    if (!s.enabled) return '<span class="badge badge-secondary">Off</span>';
    if (s.last_heartbeat_at) return '<span class="badge badge-success">Live</span>';
    return '<span class="badge badge-warning">No agent</span>';
  }

  // ─── Phase D: Server Order ─────────────────────────────────────────
  let _serverOrder = [];

  function renderServerOrderTable() {
    const tbody = $('#serverOrderBody');
    if (!tbody) return;
    tbody.innerHTML = _serverOrder.map((s, i) => `
      <tr>
        <td><span class="sort-order-num">${i + 1}</span></td>
        <td>${escHtml(s.name || '')}</td>
        <td>${escHtml(s.role || '')}</td>
        <td>${escHtml(s.public_host || '')}</td>
        <td>${serverStatusBadge(s)}</td>
        <td>
          <button class="btn btn-xs btn-secondary" onclick="APP.moveServerOrder(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲ Up</button>
          <button class="btn btn-xs btn-secondary" onclick="APP.moveServerOrder(${i}, 1)" ${i === _serverOrder.length - 1 ? 'disabled' : ''}>▼ Down</button>
        </td>
      </tr>`).join('');
  }

  // ─── Phase D: Server Monitor ────────────────────────────────────────
  function stopServerMonitorAutoRefresh() {
    if (_serverMonitorRefreshTimer) {
      clearInterval(_serverMonitorRefreshTimer);
      _serverMonitorRefreshTimer = null;
    }
  }

  function startServerMonitorAutoRefresh() {
    stopServerMonitorAutoRefresh();
    if (!_serverMonitorAutoRefreshEnabled || !_serverMonitorSelectedId || _currentPage !== 'server-monitor') return;
    _serverMonitorRefreshTimer = setInterval(() => {
      if (_currentPage !== 'server-monitor' || !_serverMonitorSelectedId) {
        stopServerMonitorAutoRefresh();
        return;
      }
      loadServerMonitorPage({ silent: true });
    }, 15000);
  }

  function syncServerMonitorAutoRefreshCheckbox() {
    const checkbox = $('#serverMonitorAutoRefresh');
    if (checkbox) checkbox.checked = !!_serverMonitorAutoRefreshEnabled;
  }

  function formatMonitorNumber(value, digits = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(digits) : '—';
  }

  function formatMonitorRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 1 : 2)} Gbps`;
    return `${num.toFixed(num >= 100 ? 1 : num >= 10 ? 2 : 3)} Mbps`;
  }

  function formatMonitorAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'just now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function parseMonitorLimit(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    const match = raw.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const num = Number(match[0]);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (/tb/i.test(raw)) return num * 1024 * 1024;
    if (/gb/i.test(raw) || /gbit/i.test(raw)) return num * 1000;
    return num;
  }

  function getServerMonitorState(server) {
    if (!server || !server.enabled) {
      return {
        label: server ? 'Disabled' : 'Unavailable',
        tone: 'off',
        detail: server ? 'Server row is currently disabled.' : 'Selected server could not be loaded.',
      };
    }
    if (!server.last_heartbeat_at) {
      return { label: 'No agent', tone: 'warning', detail: 'No heartbeat has been received from this node yet.' };
    }
    if (server.heartbeat_fresh === false) {
      return {
        label: 'Stale heartbeat',
        tone: 'stale',
        detail: `Last heartbeat ${formatMonitorAge(server.heartbeat_stale_ms)}.`,
      };
    }
    return { label: 'Online', tone: 'live', detail: `Heartbeat ${formatMonitorAge(server.heartbeat_stale_ms || 0)}.` };
  }

  function getServerMonitorSelectLabel(server) {
    const host = server.public_host || server.public_ip || server.private_ip || `#${server.id}`;
    return `${server.name || 'Server'} (${host})`;
  }

  function getServerMonitorStatusPill(label, on) {
    return `<span class="server-monitor-status-pill ${on ? 'is-on' : 'is-off'}">${escHtml(label)} ${on ? 'On' : 'Off'}</span>`;
  }

  function renderServerMonitorEmptyState(servers) {
    const surface = $('#serverMonitorSurface');
    if (!surface) return;
    const count = Array.isArray(servers) ? servers.length : 0;
    if (!count) {
      surface.innerHTML = `
        <div class="server-monitor-empty-card">
          <div class="server-monitor-empty-icon">!</div>
          <div class="server-monitor-empty-title">No servers available</div>
          <div class="server-monitor-empty-copy">Create or enable a server first, then return here to inspect heartbeat metrics and delivery health.</div>
        </div>`;
      return;
    }
    surface.innerHTML = `
      <div class="server-monitor-empty-card">
        <div class="server-monitor-empty-icon">S</div>
        <div class="server-monitor-empty-title">Please choose a server first</div>
        <div class="server-monitor-empty-copy">Select one of your ${count} server${count === 1 ? '' : 's'} from the dropdown above to open a focused monitoring dashboard.</div>
      </div>`;
  }

  function hydrateServerMonitorSelector(servers) {
    const select = $('#serverMonitorSelect');
    if (!select) return;
    const current = _serverMonitorSelectedId != null ? String(_serverMonitorSelectedId) : '';
    select.innerHTML = '<option value="">Please choose server</option>' + servers.map((server) => {
      return `<option value="${escHtml(String(server.id))}">${escHtml(getServerMonitorSelectLabel(server))}</option>`;
    }).join('');
    if (current && servers.some((server) => String(server.id) === current)) {
      select.value = current;
    }
  }

  function renderServerMonitorSurface(server, detail) {
    const surface = $('#serverMonitorSurface');
    if (!surface) return;
    if (!server) {
      renderServerMonitorEmptyState([]);
      return;
    }

    const state = getServerMonitorState(server);
    const cpu = Number.isFinite(Number(server.health_cpu_pct)) ? Number(server.health_cpu_pct) : null;
    const mem = Number.isFinite(Number(server.health_mem_pct)) ? Number(server.health_mem_pct) : null;
    const net = Number.isFinite(Number(server.health_net_mbps)) ? Number(server.health_net_mbps) : null;
    const ping = Number.isFinite(Number(server.health_ping_ms)) ? Number(server.health_ping_ms) : null;
    const sessions = Number(server.active_sessions || 0);
    const runningPlacements = Number(server.running_placements || 0);
    const totalPlacements = Number(server.total_placements || 0);
    const maxClients = Number(server.max_clients || 0);
    const networkLimit = parseMonitorLimit(server.network_mbps_cap) || parseMonitorLimit(server.network_speed) || 0;
    const networkPct = net != null && networkLimit > 0 ? Math.min(100, (net / networkLimit) * 100) : (net != null ? Math.min(100, net) : 0);
    const placementPct = totalPlacements > 0 ? Math.min(100, (runningPlacements / totalPlacements) * 100) : 0;
    const sessionPct = maxClients > 0 ? Math.min(100, (sessions / maxClients) * 100) : 0;
    const domains = Array.isArray(detail && detail.domains) ? detail.domains : [];
    const domainList = domains.length ? domains.map((d) => `<span class="server-monitor-domain-chip">${escHtml(d.domain || d.host || '')}</span>`).join('') : '<span class="text-muted">No extra domains configured</span>';
    const capabilities = [
      getServerMonitorStatusPill('Runtime', !!server.runtime_enabled),
      getServerMonitorStatusPill('Proxy', !!server.proxy_enabled),
      getServerMonitorStatusPill('Controller', !!server.controller_enabled),
      getServerMonitorStatusPill('Proxied', !!server.proxied),
      getServerMonitorStatusPill('Timeshift', !!server.timeshift_only),
    ].join('');

    surface.innerHTML = `
      <div class="server-monitor-shell">
        <section class="server-monitor-hero-card tone-${escHtml(state.tone)}">
          <div class="server-monitor-hero-copy">
            <span class="server-monitor-kicker">Focused Node Overview</span>
            <h3>${escHtml(server.name || 'Server')}</h3>
            <p>${escHtml(server.role || 'edge')} node • ${escHtml(server.public_host || server.public_ip || server.private_ip || 'No public host')} • Agent ${escHtml(server.agent_version || '—')}</p>
          </div>
          <div class="server-monitor-hero-status">
            <span class="server-monitor-health-badge is-${escHtml(state.tone)}">${escHtml(state.label)}</span>
            <span class="server-monitor-health-meta">${escHtml(state.detail)}</span>
          </div>
        </section>

        <section class="server-monitor-kpi-grid">
          <article class="server-monitor-kpi-card is-blue">
            <div class="server-monitor-kpi-head"><span>CPU Usage</span><strong>${cpu != null ? cpu.toFixed(1) + '%' : '—'}</strong></div>
            <div class="server-monitor-progress"><div class="server-monitor-progress-fill is-blue" style="width:${cpu != null ? Math.min(100, cpu) : 0}%"></div></div>
            <div class="server-monitor-kpi-meta">Heartbeat CPU utilization from the agent.</div>
          </article>
          <article class="server-monitor-kpi-card is-green">
            <div class="server-monitor-kpi-head"><span>RAM Usage</span><strong>${mem != null ? mem.toFixed(1) + '%' : '—'}</strong></div>
            <div class="server-monitor-progress"><div class="server-monitor-progress-fill is-green" style="width:${mem != null ? Math.min(100, mem) : 0}%"></div></div>
            <div class="server-monitor-kpi-meta">Memory pressure reported by the node agent.</div>
          </article>
          <article class="server-monitor-kpi-card is-cyan">
            <div class="server-monitor-kpi-head"><span>Network Throughput</span><strong>${formatMonitorRate(net)}</strong></div>
            <div class="server-monitor-progress"><div class="server-monitor-progress-fill is-cyan" style="width:${networkPct}%"></div></div>
            <div class="server-monitor-kpi-meta">${networkLimit > 0 ? `Compared against ${escHtml(String(networkLimit))} Mbps capacity.` : 'Live network sample without a stored cap.'}</div>
          </article>
          <article class="server-monitor-kpi-card is-amber">
            <div class="server-monitor-kpi-head"><span>Delivery Load</span><strong>${sessions}</strong></div>
            <div class="server-monitor-progress"><div class="server-monitor-progress-fill is-amber" style="width:${Math.max(sessionPct, placementPct)}%"></div></div>
            <div class="server-monitor-kpi-meta">${runningPlacements} running placement${runningPlacements === 1 ? '' : 's'} of ${totalPlacements}. ${maxClients > 0 ? `Max clients: ${maxClients}.` : 'No max-client cap configured.'}</div>
          </article>
        </section>

        <section class="server-monitor-detail-grid">
          <article class="server-monitor-panel-card">
            <div class="server-monitor-panel-head">
              <div>
                <div class="server-monitor-panel-kicker">Server Details</div>
                <h4>System Information</h4>
              </div>
              <span class="server-monitor-pill">${escHtml(String(server.role || 'edge').toUpperCase())}</span>
            </div>
            <div class="server-monitor-fact-list">
              <div class="server-monitor-fact-row"><span>Public host</span><strong>${escHtml(server.public_host || '—')}</strong></div>
              <div class="server-monitor-fact-row"><span>Public IP</span><strong>${escHtml(server.public_ip || '—')}</strong></div>
              <div class="server-monitor-fact-row"><span>Private IP</span><strong>${escHtml(server.private_ip || '—')}</strong></div>
              <div class="server-monitor-fact-row"><span>Operating system</span><strong>${escHtml(server.os_info || '—')}</strong></div>
              <div class="server-monitor-fact-row"><span>Network interface</span><strong>${escHtml(server.network_interface || 'all')}</strong></div>
              <div class="server-monitor-fact-row"><span>Ports</span><strong>SSH ${escHtml(String(server.ssh_port || '22'))} • HTTP ${escHtml(String(server.http_port || '8080'))} • HTTPS ${escHtml(String(server.https_port || '8083'))}</strong></div>
            </div>
          </article>

          <article class="server-monitor-panel-card">
            <div class="server-monitor-panel-head">
              <div>
                <div class="server-monitor-panel-kicker">Health & Agent</div>
                <h4>Live Heartbeat</h4>
              </div>
              <span class="server-monitor-pill is-${escHtml(state.tone)}">${escHtml(state.label)}</span>
            </div>
            <div class="server-monitor-fact-list">
              <div class="server-monitor-fact-row"><span>Last heartbeat</span><strong>${server.last_heartbeat_at ? escHtml(formatDate(server.last_heartbeat_at)) : '—'}</strong></div>
              <div class="server-monitor-fact-row"><span>Agent version</span><strong>${escHtml(server.agent_version || '—')}</strong></div>
              <div class="server-monitor-fact-row"><span>Latency</span><strong>${ping != null ? ping.toFixed(0) + ' ms' : '—'}</strong></div>
              <div class="server-monitor-fact-row"><span>CPU / RAM</span><strong>${cpu != null ? cpu.toFixed(1) + '%' : '—'} / ${mem != null ? mem.toFixed(1) + '%' : '—'}</strong></div>
              <div class="server-monitor-fact-row"><span>Network sample</span><strong>${formatMonitorRate(net)}</strong></div>
              <div class="server-monitor-fact-row"><span>Heartbeat freshness</span><strong>${escHtml(state.detail)}</strong></div>
            </div>
          </article>

          <article class="server-monitor-panel-card">
            <div class="server-monitor-panel-head">
              <div>
                <div class="server-monitor-panel-kicker">Delivery & Capabilities</div>
                <h4>Runtime Posture</h4>
              </div>
              <span class="server-monitor-pill">${sessions} sessions</span>
            </div>
            <div class="server-monitor-fact-list compact">
              <div class="server-monitor-fact-row"><span>Running placements</span><strong>${runningPlacements} / ${totalPlacements}</strong></div>
              <div class="server-monitor-fact-row"><span>Max clients</span><strong>${maxClients > 0 ? maxClients : 'Unlimited'}</strong></div>
              <div class="server-monitor-fact-row"><span>Configured domains</span><strong>${domains.length || server.domains_count || 0}</strong></div>
            </div>
            <div class="server-monitor-status-group">${capabilities}</div>
            <div class="server-monitor-domain-list">${domainList}</div>
          </article>
        </section>

        <section class="server-monitor-action-card">
          <div class="server-monitor-panel-head">
            <div>
              <div class="server-monitor-panel-kicker">Quick Control</div>
              <h4>Safe Remote Actions</h4>
            </div>
            <span class="server-monitor-pill is-${escHtml(state.tone)}">${escHtml(server.name || 'Selected server')}</span>
          </div>
          <p class="server-monitor-action-copy">Use these actions carefully. They queue through the current control-plane endpoints and operate on the selected node only.</p>
          <div class="server-monitor-action-row">
            <button type="button" class="btn btn-primary" onclick="APP.serverMonitorAction('restart-services')">Restart Services</button>
            <button type="button" class="btn btn-secondary" onclick="APP.serverMonitorAction('kill-connections')">Kill Connections</button>
            <button type="button" class="btn btn-danger" onclick="APP.serverMonitorAction('reboot-server')">Reboot Server</button>
          </div>
        </section>
      </div>`;
  }

  async function loadServerMonitorPage(options = {}) {
    const opts = options || {};
    const focusedServerId = Number.isFinite(Number(_serverMonitorFocusId)) ? Number(_serverMonitorFocusId) : null;
    const routeServerId = getServerMonitorQueryId();
    try {
      if (!opts.silent) clearToasts();
      const data = await apiFetch('/servers/monitor-summary');
      const rows = data.servers || [];
      if (routeServerId && rows.some((server) => Number(server.id) === routeServerId)) {
        _serverMonitorSelectedId = routeServerId;
      } else if (focusedServerId && rows.some((server) => Number(server.id) === focusedServerId)) {
        _serverMonitorSelectedId = focusedServerId;
      } else if (!routeServerId && !focusedServerId) {
        _serverMonitorSelectedId = null;
      }
      if (_serverMonitorSelectedId != null && !rows.some((server) => Number(server.id) === Number(_serverMonitorSelectedId))) {
        _serverMonitorSelectedId = null;
      }
      hydrateServerMonitorSelector(rows);
      syncServerMonitorAutoRefreshCheckbox();
      if (!_serverMonitorSelectedId) {
        renderServerMonitorEmptyState(rows);
        stopServerMonitorAutoRefresh();
        return;
      }
      const selectedSummary = rows.find((server) => Number(server.id) === Number(_serverMonitorSelectedId)) || null;
      if (!selectedSummary) {
        renderServerMonitorEmptyState(rows);
        stopServerMonitorAutoRefresh();
        return;
      }
      const detail = await apiFetch(`/servers/${selectedSummary.id}`).catch(() => null);
      renderServerMonitorSurface(selectedSummary, detail || selectedSummary);
      if (_serverMonitorAutoRefreshEnabled) startServerMonitorAutoRefresh();
      else stopServerMonitorAutoRefresh();
    } catch (e) {
      toast(e.message, 'error');
      renderServerMonitorEmptyState([]);
      stopServerMonitorAutoRefresh();
    } finally {
      _serverMonitorFocusId = null;
    }
  }

  function selectServerMonitor(value) {
    const parsed = parseInt(value, 10);
    const selectedId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    navigateTo('server-monitor', { serverId: selectedId, replaceHistory: false });
  }

  function toggleServerMonitorAutoRefresh(enabled) {
    _serverMonitorAutoRefreshEnabled = !!enabled;
    if (_serverMonitorAutoRefreshEnabled) startServerMonitorAutoRefresh();
    else stopServerMonitorAutoRefresh();
  }

  function refreshServerMonitor() {
    return loadServerMonitorPage();
  }

  function serverMonitorAction(actionPath) {
    if (!_serverMonitorSelectedId) {
      toast('Choose a server first', 'warning');
      return;
    }
    const messages = {
      'restart-services': ['Restart services on this server?', 'Restart services command queued'],
      'kill-connections': ['Kill all active connections for this server?', 'Connections cleared'],
      'reboot-server': ['Reboot this server? This is destructive and may interrupt service.', 'Reboot command queued'],
    };
    const [confirmMsg, successMsg] = messages[actionPath] || [null, 'Action queued'];
    return postServerAction(_serverMonitorSelectedId, actionPath, confirmMsg, successMsg);
  }

  // ─── Phase D: Bandwidth Monitor ────────────────────────────────────
  APP._bwPeriod2 = 6;
  APP._bwHistoryChart2 = null;

  function getBandwidthBucketSeconds(hours) {
    return hours <= 6 ? 60 : hours <= 24 ? 300 : 3600;
  }

  function formatBandwidthWindowLabel(hours) {
    if (hours >= 24) {
      const days = Math.round(hours / 24);
      return `Last ${days} day${days === 1 ? '' : 's'}`;
    }
    return `Last ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  function formatBandwidthResolution(seconds) {
    if (seconds >= 3600) return `${Math.round(seconds / 3600)}-hour buckets`;
    if (seconds >= 60) return `${Math.round(seconds / 60)}-minute buckets`;
    return `${seconds}-second buckets`;
  }

  function formatBandwidthRate(mbps) {
    const value = Number(mbps) || 0;
    if (value >= 1000) {
      const gbps = value / 1000;
      return `${gbps.toFixed(gbps >= 10 ? 1 : 2)} Gbps`;
    }
    const precision = value >= 100 ? 1 : value >= 10 ? 2 : 3;
    return `${value.toFixed(precision)} Mbps`;
  }

  function formatBandwidthVolume(mb) {
    const value = Number(mb) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} TB`;
    if (value >= 1024) return `${(value / 1024).toFixed(value >= 10240 ? 1 : 2)} GB`;
    if (value >= 1) return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} MB`;
    if (value > 0) return `${(value * 1024).toFixed(value * 1024 >= 100 ? 0 : 1)} KB`;
    return '0 MB';
  }

  function getBandwidthBucketLabel(date, hours) {
    return hours <= 24
      ? `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`
      : `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:00`;
  }

  function getBandwidthBucketDirection(avgRx, avgTx) {
    const delta = Math.abs(avgRx - avgTx);
    if (delta <= 0.12) return { label: 'Balanced', tone: 'balanced' };
    return avgRx > avgTx ? { label: 'Ingress', tone: 'in' } : { label: 'Egress', tone: 'out' };
  }

  function getBandwidthTrafficPosture(totalRxMB, totalTxMB) {
    const total = totalRxMB + totalTxMB;
    if (total < 0.05) {
      return { label: 'Idle window', meta: 'No measurable traffic in the selected range.' };
    }
    const ratio = Math.abs(totalRxMB - totalTxMB) / total;
    if (ratio <= 0.12) {
      return { label: 'Balanced flow', meta: 'Ingress and egress stay closely matched.' };
    }
    if (totalRxMB > totalTxMB) {
      return { label: 'Ingress heavy', meta: 'Inbound traffic dominates this time window.' };
    }
    return { label: 'Egress heavy', meta: 'Outbound delivery dominates this time window.' };
  }

  function buildBandwidthRows(points, hours) {
    const bucketSec = getBandwidthBucketSeconds(hours);
    const buckets = new Map();
    for (const p of points) {
      const t = new Date(p.time);
      const rounded = new Date(Math.floor(t.getTime() / (bucketSec * 1000)) * (bucketSec * 1000));
      const key = rounded.toISOString();
      if (!buckets.has(key)) buckets.set(key, { rx: [], tx: [], totalRx: 0, totalTx: 0, count: 0 });
      const bucket = buckets.get(key);
      bucket.rx.push(p.rxMbps || 0);
      bucket.tx.push(p.txMbps || 0);
      bucket.totalRx += (p.rxMB || 0);
      bucket.totalTx += (p.txMB || 0);
      bucket.count++;
    }

    const rowsAsc = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, vals]) => {
      const date = new Date(key);
      const avgRx = +((vals.rx.reduce((sum, value) => sum + value, 0) / (vals.rx.length || 1)) || 0).toFixed(3);
      const avgTx = +((vals.tx.reduce((sum, value) => sum + value, 0) / (vals.tx.length || 1)) || 0).toFixed(3);
      const totalMB = +(vals.totalRx + vals.totalTx).toFixed(1);
      return {
        key,
        date,
        label: getBandwidthBucketLabel(date, hours),
        avgRx,
        avgTx,
        totalMB,
        combinedMbps: +(avgRx + avgTx).toFixed(3),
        sampleCount: vals.count,
        direction: getBandwidthBucketDirection(avgRx, avgTx),
      };
    });

    return {
      bucketSec,
      rowsAsc,
      rowsDesc: rowsAsc.slice().reverse().slice(0, 50),
    };
  }

  function setBandwidthShareFill(id, percent) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  async function loadBandwidthMonitorPage() {
    clearToasts();
    await loadBwMonitorData(APP._bwPeriod2);
  }

  async function loadBwMonitorData(hours) {
    APP._bwPeriod2 = hours;
    try {
      const bwData = await apiFetch(`/bandwidth?hours=${hours}`).catch(() => null);
      if (!bwData) {
        document.getElementById('bwHistoryBody2').innerHTML = '<tr><td colspan="6">No bandwidth data</td></tr>';
        renderBwHistoryChart2([], hours);
        return;
      }
      const totalRxMB = Number(bwData.totalRxMB) || 0;
      const totalTxMB = Number(bwData.totalTxMB) || 0;
      const peakInMbps = Number(bwData.peakInMbps) || 0;
      const peakOutMbps = Number(bwData.peakOutMbps) || 0;
      const { bucketSec, rowsAsc, rowsDesc } = buildBandwidthRows(bwData.points || [], hours);
      const latestRow = rowsAsc[rowsAsc.length - 1] || null;
      const peakRow = rowsAsc.reduce((best, row) => (!best || row.combinedMbps > best.combinedMbps ? row : best), null);
      const avgRxOverall = rowsAsc.length ? rowsAsc.reduce((sum, row) => sum + row.avgRx, 0) / rowsAsc.length : 0;
      const avgTxOverall = rowsAsc.length ? rowsAsc.reduce((sum, row) => sum + row.avgTx, 0) / rowsAsc.length : 0;
      const combinedAvg = avgRxOverall + avgTxOverall;
      const totalTrafficMB = totalRxMB + totalTxMB;
      const inShare = totalTrafficMB > 0 ? (totalRxMB / totalTrafficMB) * 100 : 0;
      const outShare = totalTrafficMB > 0 ? (totalTxMB / totalTrafficMB) * 100 : 0;
      const posture = getBandwidthTrafficPosture(totalRxMB, totalTxMB);

      document.getElementById('bwTotalIn2').textContent = formatBandwidthVolume(totalRxMB);
      document.getElementById('bwTotalOut2').textContent = formatBandwidthVolume(totalTxMB);
      document.getElementById('bwAvgIn2').textContent = formatBandwidthRate(avgRxOverall);
      document.getElementById('bwAvgOut2').textContent = formatBandwidthRate(avgTxOverall);
      document.getElementById('bwPeakCombined2').textContent = formatBandwidthRate((peakRow && peakRow.combinedMbps) || 0);
      document.getElementById('bwLatestCombined2').textContent = formatBandwidthRate((latestRow && latestRow.combinedMbps) || 0);
      document.getElementById('bwPeakCombinedInline2').textContent = formatBandwidthRate((peakRow && peakRow.combinedMbps) || 0);
      document.getElementById('bwLatestCombinedInline2').textContent = formatBandwidthRate((latestRow && latestRow.combinedMbps) || 0);
      document.getElementById('bwWindowLabel2').textContent = formatBandwidthWindowLabel(hours);
      document.getElementById('bwResolution2').textContent = formatBandwidthResolution(bucketSec);
      document.getElementById('bwBucketCount2').textContent = `${rowsAsc.length} bucket${rowsAsc.length === 1 ? '' : 's'}`;
      document.getElementById('bwTotalSamples2').textContent = `${(bwData.points || []).length} raw sample${(bwData.points || []).length === 1 ? '' : 's'}`;
      document.getElementById('bwTrafficDirection2').textContent = posture.label;
      document.getElementById('bwTrafficDirectionMeta2').textContent = posture.meta;
      document.getElementById('bwCombinedAvg2').textContent = formatBandwidthRate(combinedAvg);
      document.getElementById('bwWindowTotal2').textContent = `${formatBandwidthVolume(totalTrafficMB)} moved in ${formatBandwidthWindowLabel(hours).toLowerCase()}`;
      document.getElementById('bwPeakPair2').textContent = `${formatBandwidthRate(peakInMbps)} / ${formatBandwidthRate(peakOutMbps)}`;
      document.getElementById('bwLatestSampleAt2').textContent = latestRow ? formatDate(latestRow.date) : 'No recent sample';
      document.getElementById('bwPeakWindowTime2').textContent = peakRow ? formatDate(peakRow.date) : 'No burst recorded yet';
      document.getElementById('bwLatestBucketTime2').textContent = latestRow ? formatDate(latestRow.date) : 'Awaiting sample';
      document.getElementById('bwInSharePct2').textContent = `${inShare.toFixed(1)}%`;
      document.getElementById('bwOutSharePct2').textContent = `${outShare.toFixed(1)}%`;
      document.getElementById('bwInShareValue2').textContent = `${formatBandwidthVolume(totalRxMB)} total in`;
      document.getElementById('bwOutShareValue2').textContent = `${formatBandwidthVolume(totalTxMB)} total out`;
      document.getElementById('bwTableMeta2').textContent = rowsAsc.length
        ? `${rowsDesc.length} newest bucket${rowsDesc.length === 1 ? '' : 's'} shown`
        : 'No buckets available';
      setBandwidthShareFill('bwInShareFill2', inShare);
      setBandwidthShareFill('bwOutShareFill2', outShare);

      document.getElementById('bwHistoryBody2').innerHTML = rowsDesc.map((row) => {
        return `<tr>
          <td>${row.label}</td>
          <td class="bandwidth-rate"><strong>${row.avgRx.toFixed(3)}</strong></td>
          <td class="bandwidth-rate"><strong>${row.avgTx.toFixed(3)}</strong></td>
          <td class="bandwidth-rate"><strong>${row.combinedMbps.toFixed(3)}</strong></td>
          <td><span class="bandwidth-direction-pill is-${row.direction.tone}">${row.direction.label}</span></td>
          <td class="bandwidth-total"><strong>${row.totalMB.toFixed(1)}</strong></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6">No data</td></tr>';

      renderBwHistoryChart2(rowsAsc, hours);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function setBwPeriod2(hours) {
    ['bwBtn1h2','bwBtn6h2','bwBtn24h2','bwBtn168h2'].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.classList.toggle('active', id === `bwBtn${hours}h2`);
    });
    loadBwMonitorData(hours);
  }

  function renderBwHistoryChart2(rowsAsc, hours) {
    const canvas = document.getElementById('bwHistoryChart2');
    if (!canvas) return;
    if (APP._bwHistoryChart2) {
      APP._bwHistoryChart2.destroy();
      APP._bwHistoryChart2 = null;
    }
    if (!rowsAsc.length || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    const inGradient = ctx.createLinearGradient(0, 0, 0, 360);
    inGradient.addColorStop(0, 'rgba(96,165,250,0.26)');
    inGradient.addColorStop(1, 'rgba(96,165,250,0.02)');
    const outGradient = ctx.createLinearGradient(0, 0, 0, 360);
    outGradient.addColorStop(0, 'rgba(52,211,153,0.24)');
    outGradient.addColorStop(1, 'rgba(52,211,153,0.02)');

    APP._bwHistoryChart2 = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rowsAsc.map((row) => row.label),
        datasets: [
          {
            label: 'Ingress',
            data: rowsAsc.map((row) => row.avgRx),
            borderColor: '#60a5fa',
            backgroundColor: inGradient,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35,
          },
          {
            label: 'Egress',
            data: rowsAsc.map((row) => row.avgTx),
            borderColor: '#34d399',
            backgroundColor: outGradient,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 280 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              maxTicksLimit: hours >= 24 ? 10 : 12,
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              callback: (value) => `${value} Mbps`,
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: '#c8d3e4',
              font: { size: 11, weight: '600' },
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(11,21,34,0.96)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#e8edf5',
            bodyColor: '#c8d3e4',
            displayColors: true,
            callbacks: {
              title: (items) => {
                const row = rowsAsc[items[0].dataIndex];
                return row ? formatDate(row.date) : items[0].label;
              },
              label: (ctx2) => ` ${ctx2.dataset.label}: ${Number(ctx2.parsed.y || 0).toFixed(3)} Mbps`,
              afterBody: (items) => {
                const row = rowsAsc[items[0].dataIndex];
                if (!row) return [];
                return [
                  `Combined: ${row.combinedMbps.toFixed(3)} Mbps`,
                  `Moved: ${row.totalMB.toFixed(1)} MB`,
                  `Samples: ${row.sampleCount}`,
                ];
              },
            },
          },
        },
      },
    });
  }

  // ─── Phase E: Live Connections ─────────────────────────────────────
  async function loadLiveConnections() {
    const type = ($('#lcFilterType') || {}).value || '';
    const serverId = ($('#lcFilterServer') || {}).value || '';
    try {
      clearToasts();
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (serverId) params.set('server_id', serverId);
      const query = params.toString();
      const [summary, sessions] = await Promise.all([
        apiFetch('/live-connections/summary'),
        apiFetch(`/live-connections${query ? `?${query}` : ''}`),
      ]);
      // Populate server filter if empty
      const srvSel = $('#lcFilterServer');
      if (srvSel && srvSel.options.length <= 1) {
        const servers = summary.servers || [];
        srvSel.innerHTML = '<option value="">All servers</option>' +
          servers.map((s) => `<option value="${s.server_id}">${escHtml(s.name || '')}</option>`).join('');
        if (serverId) srvSel.value = serverId;
      }
      // Summary cards
      document.getElementById('lcTotal').textContent = summary.total || 0;
      document.getElementById('lcLive').textContent = summary.by_type ? (summary.by_type.live || 0) : 0;
      document.getElementById('lcMovie').textContent = summary.by_type ? (summary.by_type.movie || 0) : 0;
      document.getElementById('lcEpisode').textContent = summary.by_type ? (summary.by_type.episode || 0) : 0;
      document.getElementById('lcCountries').textContent = summary.countries ? summary.countries.length : 0;
      // Sessions table
      const sessList = sessions.sessions || [];
      document.getElementById('lcSessionsBody').innerHTML = sessList.length ? sessList.map((s) => {
        const typeBadge = s.stream_type === 'live' ? '<span class="badge badge-success">Live</span>'
          : s.stream_type === 'movie' ? '<span class="badge badge-info">Movie</span>'
          : '<span class="badge badge-warning">Ep.</span>';
        const countryFlag = s.geoip_country_code ? ` ${escHtml(s.geoip_country_code)}` : '';
        const lastSeen = s.last_seen_at ? escHtml(s.last_seen_at.slice(0, 16).replace('T', ' ')) : '—';
        return `<tr>
          <td>${escHtml(s.username || '—')}</td>
          <td>${typeBadge}</td>
          <td>${escHtml(String(s.stream_id || ''))}</td>
          <td>${escHtml(s.origin_name || s.origin_host || (s.origin_server_id ? '#' + s.origin_server_id : '—'))}</td>
          <td>${escHtml(s.proxy_name || s.proxy_host || (s.proxy_server_id ? '#' + s.proxy_server_id : '—'))}</td>
          <td>${countryFlag}</td>
          <td>${escHtml(s.user_ip || '—')}</td>
          <td>${lastSeen}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="8" class="text-muted">No active sessions.</td></tr>';
      // Top streams
      const topStreams = summary.top_streams || [];
      document.getElementById('lcTopStreamsBody').innerHTML = topStreams.length ? topStreams.map((t) => {
        const typeBadge = t.stream_type === 'live' ? '<span class="badge badge-success">Live</span>'
          : t.stream_type === 'movie' ? '<span class="badge badge-info">Movie</span>'
          : '<span class="badge badge-warning">Ep.</span>';
        return `<tr><td>${escHtml(String(t.stream_id || ''))}</td><td>${typeBadge}</td><td>${t.cnt}</td></tr>`;
      }).join('') : '<tr><td colspan="3" class="text-muted">No data.</td></tr>';
      // Server distribution
      const srvDist = summary.servers || [];
      document.getElementById('lcServerDistBody').innerHTML = srvDist.length ? srvDist.map((s) => {
        return `<tr><td>${escHtml(s.name || '')}</td><td>${s.cnt}</td></tr>`;
      }).join('') : '<tr><td colspan="2" class="text-muted">No data.</td></tr>';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Phase E: Live Connections Map ─────────────────────────────────
  async function loadLiveConnectionsMap() {
    try {
      clearToasts();
      const data = await apiFetch('/live-connections/geo');
      const total = data.total || 0;
      const countries = data.countries || [];
      document.getElementById('mapTotal').textContent = total;
      document.getElementById('mapCountries').textContent = countries.length;
      document.getElementById('mapTopCountry').textContent = countries.length ? countries[0].code : '—';
      // Country table
      document.getElementById('lcCountryBody').innerHTML = countries.length ? countries.map((c) => {
        const share = total ? ((c.cnt / total) * 100).toFixed(1) : '0.0';
        return `<tr><td>${escHtml(c.code || '—')}</td><td>${escHtml(c.code || '—')}</td><td>${c.cnt}</td><td>${share}%</td></tr>`;
      }).join('') : '<tr><td colspan="4" class="text-muted">No geographic data.</td></tr>';
      // Horizontal bar chart via Chart.js
      renderLcGeoChart(countries, total);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderLcGeoChart(countries, total) {
    const canvas = document.getElementById('lcGeoChart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.getContext('2d');
      canvas.height = 60 + countries.length * 28;
      return;
    }
    const top10 = countries.slice(0, 15);
    const labels = top10.map((c) => c.code || '—');
    const values = top10.map((c) => c.cnt);
    const colors = [
      '#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
      '#06b6d4','#ec4899','#10b981','#f97316','#6366f1',
      '#14b8a6','#eab308','#84cc16','#a855f7','#64748b',
    ];
    if (window._lcGeoChartInstance) window._lcGeoChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    canvas.height = 60 + top10.length * 32;
    window._lcGeoChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Sessions', data: values, backgroundColor: colors.slice(0, top10.length) }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: {
            label: (ctx) => {
              const share = total ? ((ctx.raw / total) * 100).toFixed(1) : '0';
              return ` ${ctx.raw} sessions (${share}%)`;
            },
          },
        } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e' } },
          y: { grid: { display: false }, ticks: { color: '#e6edf3' } },
        },
      },
    });
  }

  function serverHeartbeatFresh(s) {
    if (!s || !s.last_heartbeat_at) return false;
    const ts = new Date(s.last_heartbeat_at).getTime();
    return Number.isFinite(ts) && (Date.now() - ts) <= 5 * 60 * 1000;
  }

  function serverRoleBadge(role) {
    const r = String(role || '').toLowerCase();
    if (r === 'main') return '<span class="server-mini-badge blue">MAIN</span>';
    if (r === 'lb') return '<span class="server-mini-badge teal">LB</span>';
    if (r === 'edge') return '<span class="server-mini-badge amber">EDGE</span>';
    return `<span class="server-mini-badge slate">${escHtml(String(role || 'server').toUpperCase())}</span>`;
  }

  function serverHealthLabel(s) {
    if (!s.enabled) return { cls: 'offline', label: 'Disabled' };
    if (!s.last_heartbeat_at) return { cls: 'warning', label: 'No agent' };
    if (!serverHeartbeatFresh(s)) return { cls: 'warning', label: 'Stale' };
    return { cls: 'ok', label: 'OK' };
  }

  function serverStatusCell(s) {
    const fresh = serverHeartbeatFresh(s);
    const dotCls = !s.enabled ? 'offline' : (fresh ? 'online' : 'warning');
    const text = !s.enabled ? 'Disabled' : (fresh ? 'Online' : (s.last_heartbeat_at ? 'Stale' : 'No Agent'));
    return `<div class="server-status-cell"><span class="server-status-dot ${dotCls}"></span><span>${escHtml(text)}</span></div>`;
  }

  function serverPortsCell(s) {
    const meta = s.meta_json && typeof s.meta_json === 'object' ? s.meta_json : {};
    const httpPort = meta.http_port || meta.port || 80;
    const httpsPort = meta.https_port || (meta.https ? 443 : null);
    const parts = [
      `<span class="server-port-chip">${escHtml(String(httpPort))}</span>`,
      httpsPort ? `<span class="server-port-chip is-secure">${escHtml(String(httpsPort))}</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="server-port-list">${parts || '<span class="text-muted">—</span>'}</div>`;
  }

  function serverDnsCell(s) {
    const domains = Array.isArray(s.domains) ? s.domains.map((d) => d.domain).filter(Boolean) : [];
    const host = s.public_host || '';
    return `
      <div class="server-dns-cell">
        <div class="server-dns-primary">${escHtml(host || '—')}</div>
        <div class="server-dns-secondary">${domains.length > 1 ? `${domains.length} DNS entries` : (domains.length === 1 ? '1 DNS entry' : 'No DNS entries')}</div>
      </div>`;
  }

  function serverClientsCell(s) {
    const active = Number(s.active_sessions || 0);
    const max = Number(s.max_clients || 0);
    return `<div class="server-clients-cell"><span class="server-clients-count">${active}</span>${max > 0 ? `<span class="server-clients-max">/ ${max}</span>` : ''}</div>`;
  }

  function serverResourcesCell(s) {
    const cpu = s.health_cpu_pct != null ? Number(s.health_cpu_pct) : null;
    const mem = s.health_mem_pct != null ? Number(s.health_mem_pct) : null;
    const cpuW = cpu != null && Number.isFinite(cpu) ? Math.max(0, Math.min(100, cpu)) : 0;
    const memW = mem != null && Number.isFinite(mem) ? Math.max(0, Math.min(100, mem)) : 0;
    return `
      <div class="server-resources-cell">
        <div class="server-resource-line"><span>CPU</span><div class="server-mini-bar"><div class="server-mini-fill cpu" style="width:${cpuW}%"></div></div><strong>${cpu != null && Number.isFinite(cpu) ? cpu.toFixed(0) + '%' : '—'}</strong></div>
        <div class="server-resource-line"><span>RAM</span><div class="server-mini-bar"><div class="server-mini-fill mem" style="width:${memW}%"></div></div><strong>${mem != null && Number.isFinite(mem) ? mem.toFixed(0) + '%' : '—'}</strong></div>
      </div>`;
  }

  function serverBandwidthCell(s) {
    const net = s.health_net_mbps != null ? Number(s.health_net_mbps) : null;
    const cap = s.network_mbps_cap != null ? Number(s.network_mbps_cap) : 0;
    const pct = net != null && Number.isFinite(net)
      ? (cap > 0 ? Math.max(0, Math.min(100, (net / cap) * 100)) : Math.min(100, net * 5))
      : 0;
    return `
      <div class="server-bandwidth-cell">
        <div class="server-resource-line"><span>IN</span><div class="server-mini-bar"><div class="server-mini-fill net" style="width:${pct}%"></div></div><strong>${net != null && Number.isFinite(net) ? net.toFixed(1) + ' Mb/s' : '—'}</strong></div>
        <div class="server-resource-line"><span>OUT</span><div class="server-mini-bar"><div class="server-mini-fill muted" style="width:${pct * 0.35}%"></div></div><strong>${cap > 0 ? cap + ' cap' : '—'}</strong></div>
      </div>`;
  }

  function serverNameCell(s) {
    const host = s.public_ip || s.private_ip || '—';
    return `
      <div class="server-name-cell-rich">
        <div class="server-name-top">${serverRoleBadge(s.role)} <span class="server-name-value">${escHtml(s.name || '')}</span></div>
        <div class="server-name-sub">${escHtml(host)}</div>
      </div>`;
  }

  function serverActionsCell(s) {
    return `
      <div class="server-actions-split" data-server-action-wrap="${s.id}">
        <button type="button" class="server-actions-main" onclick="APP.openServerAdvancedModal(${s.id})">Actions</button>
        <button type="button" class="server-actions-toggle" onclick="APP.toggleServerActionMenu(event, ${s.id})">&#9662;</button>
        <div class="server-actions-menu" id="serverActionMenu-${s.id}">
          <button type="button" class="server-actions-menu-item" onclick="APP.serverActionIpChange(${s.id})">IP Change</button>
          <button type="button" class="server-actions-menu-item" onclick="APP.serverActionStartAllStreams(${s.id})">Start All Streams</button>
          <button type="button" class="server-actions-menu-item" onclick="APP.serverActionStopAllStreams(${s.id})">Stop All Streams</button>
          <button type="button" class="server-actions-menu-item danger" onclick="APP.serverActionKillConnections(${s.id})">Kill All Connections</button>
          <div class="server-actions-divider"></div>
          <button type="button" class="server-actions-menu-item" onclick="APP.serverActionEdit(${s.id})">Edit Server</button>
          <button type="button" class="server-actions-menu-item" onclick="APP.serverActionMonitor(${s.id})">Monitor</button>
        </div>
      </div>`;
  }

  function renderServersPage() {
    const tb = $('#serversTable tbody');
    if (!tb) return;

    const search = ($('#serversSearch')?.value || '').trim().toLowerCase();
    let rows = [..._serversCache];
    if (search) {
      rows = rows.filter((s) => {
        const hay = [s.id, s.name, s.public_host, s.public_ip, s.role, s.agent_version]
          .map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(search);
      });
    }

    if (_serversSortMode === 'latency') {
      rows.sort((a, b) => {
        const ap = Number.isFinite(Number(a.health_ping_ms)) ? Number(a.health_ping_ms) : Number.POSITIVE_INFINITY;
        const bp = Number.isFinite(Number(b.health_ping_ms)) ? Number(b.health_ping_ms) : Number.POSITIVE_INFINITY;
        return ap - bp;
      });
    } else {
      rows.sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || (Number(a.id) - Number(b.id)));
    }

    const total = rows.length;
    const online = rows.filter((s) => s.enabled && serverHeartbeatFresh(s)).length;
    if ($('#serversTotalPill')) $('#serversTotalPill').textContent = `${total} Total`;
    if ($('#serversOnlinePill')) $('#serversOnlinePill').textContent = `${online} Online`;

    const perPage = Math.max(10, parseInt($('#serversPerPage')?.value || _serversPerPage, 10) || 50);
    _serversPerPage = perPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (_serversPage > totalPages) _serversPage = totalPages;
    if (_serversPage < 1) _serversPage = 1;
    const start = (_serversPage - 1) * perPage;
    const pageRows = rows.slice(start, start + perPage);

    if (!pageRows.length) {
      tb.innerHTML = '<tr><td colspan="12" class="text-muted" style="text-align:center;padding:2rem">No servers found.</td></tr>';
    } else {
      tb.innerHTML = pageRows.map((s) => {
        const health = serverHealthLabel(s);
        return `
          <tr class="server-row" data-server-row="${s.id}">
            <td><input type="checkbox" disabled></td>
            <td>${s.id}</td>
            <td>${serverNameCell(s)}</td>
            <td>${serverStatusCell(s)}</td>
            <td><span class="server-health-pill ${health.cls}">${escHtml(health.label)}</span></td>
            <td><span class="server-version-pill">${escHtml(s.agent_version || '—')}</span></td>
            <td>${serverPortsCell(s)}</td>
            <td>${serverDnsCell(s)}</td>
            <td>${serverClientsCell(s)}</td>
            <td>${serverResourcesCell(s)}</td>
            <td>${serverBandwidthCell(s)}</td>
            <td>${serverActionsCell(s)}</td>
          </tr>`;
      }).join('');
    }

    const startRow = total ? start + 1 : 0;
    const endRow = total ? Math.min(total, start + pageRows.length) : 0;
    if ($('#serversPageSummary')) $('#serversPageSummary').textContent = `Showing ${startRow} to ${endRow} of ${total} entries`;
    if ($('#serversPageInfo')) $('#serversPageInfo').textContent = String(_serversPage);
    if ($('#serversTotalPages')) $('#serversTotalPages').textContent = String(totalPages);
    if ($('#serversPrevBtn')) $('#serversPrevBtn').disabled = _serversPage <= 1;
    if ($('#serversNextBtn')) $('#serversNextBtn').disabled = _serversPage >= totalPages;

    renderServersLatencyBanner(rows);
  }

  function renderServersLatencyBanner(rows) {
    const pings = rows
      .map((s) => Number(s.health_ping_ms))
      .filter((n) => Number.isFinite(n) && n > 0);
    let text = 'Current CDN Latency: —';
    if (pings.length) {
      const avg = pings.reduce((a, b) => a + b, 0) / pings.length;
      const tone = avg <= 25 ? 'Good' : avg <= 60 ? 'Average' : 'High';
      text = `Current CDN Latency: ${avg.toFixed(2)} - ${tone}`;
    }
    if ($('#serversLatencyText')) $('#serversLatencyText').textContent = text;
  }

  function closeServerActionMenus() {
    $$('[data-server-action-wrap].open').forEach((wrap) => wrap.classList.remove('open'));
    $$('.server-actions-menu').forEach((menu) => {
      menu.style.left = '';
      menu.style.top = '';
      menu.style.maxHeight = '';
    });
  }

  function positionServerActionMenu(serverId) {
    const wrap = document.querySelector(`[data-server-action-wrap="${serverId}"]`);
    const menu = $(`#serverActionMenu-${serverId}`);
    if (!wrap || !menu) return;
    const rect = wrap.getBoundingClientRect();
    const menuWidth = 220;
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    let left = rect.right - menuWidth;
    if (left < 12) left = 12;
    if (left + menuWidth > viewportW - 12) left = Math.max(12, viewportW - menuWidth - 12);
    let top = rect.bottom + 6;
    const estimatedMenuHeight = Math.min(320, menu.scrollHeight || 280);
    if (top + estimatedMenuHeight > viewportH - 12) {
      top = Math.max(12, rect.top - estimatedMenuHeight - 6);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.maxHeight = `${Math.max(160, viewportH - top - 12)}px`;
  }

  const _srvTabOrder = ['details', 'advanced', 'server-guard', 'ssl', 'isp-manager', 'install'];
  const _srvTabLabels = { details: 'Details', advanced: 'Advanced', 'server-guard': 'Server Guard', ssl: 'SSL Certificate', 'isp-manager': 'ISP Manager', install: 'Install' };
  let _serverEditReturnPage = 'servers';

  function _resetTagInput(inputId) {
    const wrap = $(`#${inputId}Wrap`);
    if (!wrap) return;
    wrap.querySelectorAll('.tag-pill').forEach((pill) => pill.remove());
    const input = wrap.querySelector('.tag-input-field');
    if (input) input.value = '';
  }

  function _setTagInput(inputId, value) {
    _resetTagInput(inputId);
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
    items.forEach((item) => addTag(inputId, item));
  }

  function _getTagValues(inputId) {
    const wrap = $(`#${inputId}Wrap`);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.tag-pill'))
      .map((pill) => pill.textContent.replace(/\xD7$/, '').trim())
      .filter(Boolean);
  }

  function _getServerEditMeta(server) {
    return server && typeof server.meta_json === 'object' && server.meta_json ? server.meta_json : {};
  }

  function switchServerModalTab(tab) {
    $$('.server-modal-tabs .xc-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.srvTab === tab);
    });
    const modal = $('#serverModal');
    const panels = modal ? modal.querySelectorAll('[data-srv-panel]') : [];
    panels.forEach((panel) => {
      const on = panel.dataset.srvPanel === tab;
      panel.style.display = on ? 'block' : 'none';
    });
    _updateServerTabNav(tab);
  }

  function _updateServerTabNav(tab) {
    const idx = _srvTabOrder.indexOf(tab);
    const modal = $('#serverModal');
    if (!modal) return;
    modal.querySelectorAll('.srv-tab-prev').forEach((btn) => {
      btn.disabled = idx <= 0;
    });
    modal.querySelectorAll('.srv-tab-next').forEach((btn) => {
      btn.disabled = idx >= _srvTabOrder.length - 2;
    });
  }

  function navigateServerModalTab(dir) {
    const activeTab = $$('.server-modal-tabs .xc-tab.active')[0];
    if (!activeTab) return;
    const current = activeTab.dataset.srvTab;
    const idx = _srvTabOrder.indexOf(current);
    const nextIdx = dir === 'next' ? Math.min(idx + 1, _srvTabOrder.length - 1) : Math.max(idx - 1, 0);
    if (nextIdx !== idx) switchServerModalTab(_srvTabOrder[nextIdx]);
  }

  async function openServerModal(id) {
    await getAdminFeatures();
    const prov = _adminFeatures && _adminFeatures.serverProvisioning;
    const tabInst = $('#serverTabInstall');
    const formInst = $('#serverInstallForm');
    if (tabInst) tabInst.style.display = prov ? 'inline-block' : 'none';
    if (formInst) formInst.style.display = prov ? 'block' : 'none';

    clearToasts();
    _wireServerModalHandlers();
    _serverEditReturnPage = _currentPage && _currentPage !== 'server-edit' ? _currentPage : 'servers';
    navigateTo('server-edit');
    switchServerModalTab('details');
    $('#serverModalTitle').textContent = id ? 'Edit Server' : 'Edit Server';
    $('#srvFormId').value = id || '';
    $('#serverModal').dataset.serverRole = 'edge';
    document.querySelector('.page-content')?.scrollTo?.(0, 0);

    if (!id) {
      $('#srvName').value = '';
      $('#srvServerIpPrimary').value = '';
      $('#srvPrivateUsersCdn').value = '';
      $('#srvProxyIpDefaultDns').value = '';
      $('#srvRootPassword').value = '';
      $('#srvMaxClients').value = '0';
      $('#srvEnabled').checked = true;
      $('#srvFullDuplex').checked = false;
      $('#srvBoostFpm').checked = false;
      $('#srvTimeshiftOnly').checked = false;
      _setTagInput('srvDomains', '');
      _setTagInput('srvHttpPort', '80');
      $('#srvHttpsM3uLines').checked = false;
      $('#srvForceSslPort').checked = false;
      $('#srvHttpsPort').value = '443';
      $('#srvTimeDifference').value = '0';
      $('#srvSshPortAdv').value = '22';
      $('#srvNetworkInterface').value = 'eth0';
      $('#srvNetworkSpeed').value = '1000';
      $('#srvOsInfo').value = '';
      $('#srvGeoipLb').checked = false;
      $('#srvGeoipPriority').value = 'low';
      $('#srvGeoipCountries').value = '';
      $('#srvExtraNginx').value = '';
      $('#srvServerGuardEnabled').checked = false;
      $('#srvIpWhitelisting').checked = false;
      $('#srvBotnetFighter').checked = false;
      $('#srvUnderAttack').checked = false;
      _setTagInput('srvConnLimitPorts', '');
      $('#srvMaxConnPerIp').value = '0';
      $('#srvMaxHitsNormal').value = '50';
      $('#srvMaxHitsRestreamer').value = '1200';
      $('#srvWhitelistUsername').value = '';
      $('#srvBlockUserMins').value = '10';
      $('#srvAutoRestartMysql').value = '2200';
      $('#srvIspEnabled').checked = false;
      $('#srvIspPriority').value = 'low';
      $('#srvIspNameEntry').value = '';
      $('#srvIspNames').value = '';
      const guardSettings = $('#srvGuardSettings');
      if (guardSettings) guardSettings.style.display = 'none';
      const guardBanner = $('#srvGuardBanner');
      if (guardBanner) guardBanner.style.display = 'none';
      const primaryIpWarning = $('#srvPrimaryIpWarning');
      if (primaryIpWarning) primaryIpWarning.style.display = 'none';
      const srvLbName = $('#srvLbName');
      if (srvLbName) srvLbName.value = '';
      const srvProvHost = $('#srvProvisionPublicHost');
      if (srvProvHost) srvProvHost.value = '';
      const srvPanelUrlEl = $('#srvPanelUrl');
      if (srvPanelUrlEl && typeof window !== 'undefined' && window.location) {
        srvPanelUrlEl.value = window.location.origin;
      }
      renderSSLDomainsTable(null);
      return;
    }

    try {
      const s = await apiFetch(`/servers/${id}`);
      const meta = _getServerEditMeta(s);
      $('#serverModal').dataset.serverRole = s.role || 'edge';
      $('#srvName').value = s.name || '';
      $('#srvServerIpPrimary').value = s.public_ip || s.server_ip || '';
      $('#srvPrimaryIpWarning').style.display = (s.role === 'main') ? 'block' : 'none';
      $('#srvPrivateUsersCdn').value = meta.private_users_cdn_lb || '';
      $('#srvProxyIpDefaultDns').value = s.public_host || '';
      $('#srvRootPassword').value = s.admin_password || '';
      $('#srvMaxClients').value = String(s.max_clients != null ? s.max_clients : 0);
      $('#srvEnabled').checked = !!s.enabled;
      $('#srvFullDuplex').checked = !!s.full_duplex;
      $('#srvBoostFpm').checked = !!s.boost_fpm;
      $('#srvTimeshiftOnly').checked = !!s.timeshift_only;
      _setTagInput('srvDomains', (s.domains || []).map((d) => d.domain).filter(Boolean));

      _setTagInput('srvHttpPort', meta.http_port_list || (s.http_port ? [s.http_port] : []));
      $('#srvHttpsM3uLines').checked = !!s.https_m3u_lines;
      $('#srvForceSslPort').checked = !!s.force_ssl_port;
      $('#srvHttpsPort').value = s.https_port || 443;
      $('#srvTimeDifference').value = s.time_difference || '0';
      $('#srvSshPortAdv').value = s.ssh_port || 22;
      $('#srvNetworkInterface').value = s.network_interface || 'eth0';
      $('#srvNetworkSpeed').value = s.network_speed || '';
      $('#srvOsInfo').value = s.os_info || '';
      $('#srvGeoipLb').checked = !!s.geoip_load_balancing;
      $('#srvGeoipPriority').value = meta.geoip_priority || 'low';
      $('#srvGeoipCountries').value = s.geoip_countries || '';
      $('#srvExtraNginx').value = s.extra_nginx_config || '';

      $('#srvServerGuardEnabled').checked = !!s.server_guard_enabled;
      $('#srvIpWhitelisting').checked = !!s.ip_whitelisting;
      $('#srvBotnetFighter').checked = !!s.botnet_fighter;
      $('#srvUnderAttack').checked = !!s.under_attack;
      _setTagInput('srvConnLimitPorts', s.connection_limit_ports || '');
      $('#srvMaxConnPerIp').value = s.max_conn_per_ip || 0;
      $('#srvMaxHitsNormal').value = s.max_hits_normal_user || 50;
      $('#srvMaxHitsRestreamer').value = s.max_hits_restreamer || 1200;
      $('#srvWhitelistUsername').value = meta.server_guard_whitelist_username || '';
      $('#srvBlockUserMins').value = s.block_user_minutes || 10;
      $('#srvAutoRestartMysql').value = meta.server_guard_auto_restart_mysql_value || (s.auto_restart_mysql ? '1' : '2200');
      const guardSettings = $('#srvGuardSettings');
      if (guardSettings) guardSettings.style.display = s.server_guard_enabled ? 'block' : 'none';
      const guardBanner = $('#srvGuardBanner');
      if (guardBanner) guardBanner.style.display = s.server_guard_enabled ? 'block' : 'none';

      $('#srvIspEnabled').checked = !!s.isp_enabled;
      $('#srvIspPriority').value = meta.isp_priority_label || 'low';
      $('#srvIspNameEntry').value = '';
      $('#srvIspNames').value = String(s.isp_allowed_names || '').split(',').map((item) => item.trim()).filter(Boolean).join('\n');

      const srvLbNameEd = $('#srvLbName');
      if (srvLbNameEd) srvLbNameEd.value = s.name || '';
      const srvProvHostEd = $('#srvProvisionPublicHost');
      if (srvProvHostEd) srvProvHostEd.value = s.public_host || '';
      const srvPanelUrlEd = $('#srvPanelUrl');
      if (srvPanelUrlEd && typeof window !== 'undefined' && window.location) {
        srvPanelUrlEd.value = window.location.origin;
      }

      renderSSLDomainsTable(id, s.domains || []);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function closeServerModal() {
    navigateTo(_serverEditReturnPage || 'servers');
  }

  async function openInstallModal(profile) {
    await getAdminFeatures();
    const prov = _adminFeatures && _adminFeatures.serverProvisioning;
    const tabInst = $('#serverTabInstall');
    const formInst = $('#serverInstallForm');
    if (tabInst) tabInst.style.display = prov ? 'inline-block' : 'none';
    if (formInst) formInst.style.display = prov ? 'block' : 'none';

    // Reset all fields for a fresh install
    await openServerModal(null);
    $('#serverModal').dataset.serverRole = 'lb';
    const guardSettings = $('#srvGuardSettings');
    if (guardSettings) guardSettings.style.display = 'none';
    const srvLbName = $('#srvLbName');
    if (srvLbName) srvLbName.value = '';
    const srvProvHost = $('#srvProvisionPublicHost');
    if (srvProvHost) srvProvHost.value = '';
    const srvPanelUrlEl = $('#srvPanelUrl');
    if (srvPanelUrlEl && typeof window !== 'undefined' && window.location) {
      srvPanelUrlEl.value = window.location.origin;
    }
    // Pre-select the requested profile
    const profileEl = $('#srvNodeProfile');
    if (profileEl) profileEl.value = profile || 'origin-runtime';
    // Reset provision log
    const logEl = $('#srvProvisionLog');
    if (logEl) logEl.textContent = '';
    switchServerModalTab('install');
    $('#serverModalTitle').textContent = 'Install server';
  }

  async function submitProvisionJob(body, logSelector, onStarted) {
    const logEl = $(logSelector);
    if (!(_adminFeatures && _adminFeatures.serverProvisioning)) {
      const msg = 'Provisioning is disabled. Enable it in Settings → Streaming before running this install.';
      if (logEl) logEl.textContent = msg;
      toast(msg, 'error');
      return null;
    }
    const job = await apiFetch('/servers/provision', { method: 'POST', body: JSON.stringify(body) });
    if (logEl) logEl.textContent = `Job #${job.id || '?'} started…\n`;
    if (typeof onStarted === 'function') await onStarted(job, logEl);
    const poll = async () => {
      try {
        const st = await apiFetch(`/servers/provision/${job.id}`);
        if (logEl) logEl.textContent = (st.log || '') + (st.error ? `\n${st.error}` : '');
        if (st.status === 'done' || st.status === 'error') return;
        setTimeout(poll, 1500);
      } catch (e) {
        if (logEl) logEl.textContent += `\n${e.message}`;
      }
    };
    poll();
    return job;
  }

  async function createServerRowForInstall({ name, host, role, meta }) {
    return await apiFetch('/servers', {
      method: 'POST',
      body: JSON.stringify({
        name,
        role,
        public_host: host,
        public_ip: host,
        private_ip: '',
        enabled: false,
        proxied: role === 'lb',
        timeshift_only: false,
        domains: host ? [host] : [],
        meta_json: meta || {},
      }),
    });
  }

  async function submitInstallLbPage() {
    const name = ($('#installLbName')?.value || '').trim();
    const host = ($('#installLbHost')?.value || '').trim();
    const password = $('#installLbPassword')?.value || '';
    const sshPort = parseInt($('#installLbSshPort')?.value, 10) || 22;
    const httpPort = parseInt($('#installLbHttpPort')?.value, 10) || 8080;
    const httpsPort = parseInt($('#installLbHttpsPort')?.value, 10) || 8443;
    if (!name || !host || !password) {
      toast('Server name, server IP, and SSH password are required.', 'error');
      return;
    }
    await getAdminFeatures();
    if (!(_adminFeatures && _adminFeatures.serverProvisioning)) {
      const msg = 'Provisioning is disabled. Enable it in Settings → Streaming before running this install.';
      if ($('#installLbLog')) $('#installLbLog').textContent = msg;
      toast(msg, 'error');
      return;
    }
    try {
      const server = await createServerRowForInstall({
        name,
        host,
        role: 'lb',
        meta: {
          http_port: httpPort,
          https_port: httpsPort,
          port: httpPort,
          https: false,
        },
      });
      await submitProvisionJob({
        server_id: server.id,
        host,
        port: sshPort,
        user: 'root',
        password,
        panel_url: window.location.origin,
        profile: 'origin-runtime',
      }, '#installLbLog', async () => {
        toast('Load balancer install started', 'success');
        await loadServers();
      });
    } catch (e) {
      const logEl = $('#installLbLog');
      if (logEl) logEl.textContent = e.message;
      toast(e.message, 'error');
    }
  }

  async function submitInstallProxyPage() {
    const protectServerId = parseInt($('#installProxyProtectServer')?.value, 10) || 0;
    const ports = ($('#installProxyPorts')?.value || '').trim();
    const name = ($('#installProxyName')?.value || '').trim();
    const host = ($('#installProxyHost')?.value || '').trim();
    const password = $('#installProxyPassword')?.value || '';
    const sshPort = parseInt($('#installProxySshPort')?.value, 10) || 22;
    const apiHttp = parseInt($('#installProxyApiHttpPort')?.value, 10) || 2086;
    const apiHttps = parseInt($('#installProxyApiHttpsPort')?.value, 10) || 2083;
    if (!protectServerId || !name || !host || !password) {
      toast('Protected server, proxy server name, proxy server IP, and SSH password are required.', 'error');
      return;
    }
    await getAdminFeatures();
    if (!(_adminFeatures && _adminFeatures.serverProvisioning)) {
      const msg = 'Provisioning is disabled. Enable it in Settings → Streaming before running this install.';
      if ($('#installProxyLog')) $('#installProxyLog').textContent = msg;
      toast(msg, 'error');
      return;
    }
    try {
      const server = await createServerRowForInstall({
        name,
        host,
        role: 'lb',
        meta: {
          streaming_proxy_ports: ports,
          proxy_api_http_port: apiHttp,
          proxy_api_https_port: apiHttps,
          port: apiHttp,
          https: false,
          protected_server_id: protectServerId,
        },
      });
      const job = await submitProvisionJob({
        server_id: server.id,
        host,
        port: sshPort,
        user: 'root',
        password,
        panel_url: window.location.origin,
        profile: 'proxy-delivery',
      }, '#installProxyLog', async () => {
        toast('Proxy server install started', 'success');
        await loadServers();
      });
      if (job && protectServerId) {
        try {
          await apiFetch('/server-relationships', {
            method: 'POST',
            body: JSON.stringify({
              parent_server_id: protectServerId,
              child_server_id: server.id,
              relationship_type: 'origin-proxy',
              priority: 0,
              enabled: 1,
            }),
          });
          const logEl = $('#installProxyLog');
          if (logEl) logEl.textContent += '\nRelationship created. Automatic upstream sync and live proxy forwarding remain de-scoped in current TARGET.';
        } catch (relErr) {
          const logEl = $('#installProxyLog');
          if (logEl) logEl.textContent += `\nRelationship warning: ${relErr.message}`;
        }
      }
    } catch (e) {
      const logEl = $('#installProxyLog');
      if (logEl) logEl.textContent = e.message;
      toast(e.message, 'error');
    }
  }

  function toggleServerActionMenu(event, serverId) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const wrap = document.querySelector(`[data-server-action-wrap="${serverId}"]`);
    if (!wrap) return;
    const willOpen = !wrap.classList.contains('open');
    closeServerActionMenus();
    if (willOpen) {
      wrap.classList.add('open');
      requestAnimationFrame(() => positionServerActionMenu(serverId));
    }
  }

  function openServerAdvancedModal(serverId) {
    closeServerActionMenus();
    const server = _serversCache.find((s) => Number(s.id) === Number(serverId));
    _serverAdvancedTargetId = serverId;
    $('#serverAdvancedTitle').textContent = `ADVANCED FUNCTIONS FOR THE ${String(server && server.role === 'main' ? 'MAIN' : (server && server.name ? server.name : 'SERVER')).toUpperCase()}`;
    $('#serverAdvancedCommand').textContent = 'systemctl restart nginx && systemctl restart iptv-panel-agent';
    $('#serverAdvancedNote').textContent = 'Optimize PHP Config and Update FFmpeg are blocked for the current TARGET node profiles because this stack provisions Node/nginx profiles rather than a PHP panel runtime, and no safe FFmpeg in-place upgrade workflow is exposed yet.';
    $('#serverAdvancedModal').style.display = 'flex';
  }

  function closeServerAdvancedModal() {
    $('#serverAdvancedModal').style.display = 'none';
    _serverAdvancedTargetId = null;
  }

  async function postServerAction(serverId, actionPath, confirmMsg, successMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      const data = await apiFetch(`/servers/${serverId}/actions/${actionPath}`, { method: 'POST', body: JSON.stringify({}) });
      toast(data.message || successMsg || 'Action queued', 'success');
      closeServerAdvancedModal();
      loadServers();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function showServerFaq(which) {
    const faqs = {
      'balancer-down': 'If a balancer shows down, verify heartbeat freshness and rerun provisioning if the node never completed capability handshake.',
      'main-change': 'Changing the main server should be done by editing the target row and confirming role/host values together.',
      'main-ip-change': 'Use IP Change from the row actions to update the server IP fields without rebuilding the entire row.',
      'lb-zero': '0 connection on LB often means DNS is not pointing to the delivery node or provisioning is incomplete.',
      'panel-port': 'Changing the panel port requires panel URL and external reverse proxy/DNS alignment.',
      'protect-scan': 'Protect origin nodes behind proxy-delivery nodes and keep management ports firewalled.',
      'bandwidth': 'Bandwidth metrics depend on fresh agent heartbeat and server-side interface reporting.',
    };
    toast(faqs[which] || 'No FAQ text available yet.', 'info');
  }

  function toggleServerFaqs() {
    _serverFaqsVisible = !_serverFaqsVisible;
    const row = $('#serversFaqRow');
    if (row) row.style.display = _serverFaqsVisible ? 'flex' : 'none';
  }

  function changeServersPerPage(value) {
    _serversPerPage = Math.max(10, parseInt(value, 10) || 50);
    _serversPage = 1;
    renderServersPage();
  }

  function changeServersPage(delta) {
    _serversPage += delta;
    renderServersPage();
  }

  function findLowestLatencyServer() {
    _serversSortMode = 'latency';
    _serversPage = 1;
    renderServersPage();
    toast('Sorted by lowest server latency', 'success');
  }

  function filterServersTable() {
    _serversPage = 1;
    renderServersPage();
  }

  function serverActionIpChange(serverId) {
    closeServerActionMenus();
    openServerModal(serverId);
    switchServerModalTab('details');
    setTimeout(() => {
      $('#srvServerIpPrimary')?.focus();
      $('#srvServerIpPrimary')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
  }

  async function getAssignedLiveChannelsForServer(serverId) {
    const rows = await fetch('/api/channels', { credentials: 'same-origin' }).then((r) => r.json());
    return (Array.isArray(rows) ? rows : []).filter((ch) => Number(ch.stream_server_id || 0) === Number(serverId));
  }

  async function serverActionStartAllStreams(serverId) {
    closeServerActionMenus();
    if (!confirm('Start all live streams assigned to this server?')) return;
    try {
      const channels = await getAssignedLiveChannelsForServer(serverId);
      let started = 0;
      for (const ch of channels) {
        if (ch.status === 'running') continue;
        await channelFetch(`/${ch.id}/start`, { method: 'POST' });
        started++;
      }
      toast(`Started ${started} stream(s) assigned to this server.`, 'success');
      loadServers();
    } catch (e) {
      toast(e.message || 'Failed to start streams', 'error');
    }
  }

  async function serverActionStopAllStreams(serverId) {
    closeServerActionMenus();
    if (!confirm('Stop all live streams assigned to this server?')) return;
    try {
      const channels = await getAssignedLiveChannelsForServer(serverId);
      let stopped = 0;
      for (const ch of channels) {
        if (ch.status !== 'running') continue;
        await channelFetch(`/${ch.id}/stop`, { method: 'POST' });
        stopped++;
      }
      toast(`Stopped ${stopped} stream(s) assigned to this server.`, 'success');
      loadServers();
    } catch (e) {
      toast(e.message || 'Failed to stop streams', 'error');
    }
  }

  async function serverActionKillConnections(serverId) {
    closeServerActionMenus();
    await postServerAction(serverId, 'kill-connections', 'Kill all active connections for this server?', 'Connections cleared');
  }

  function serverActionEdit(serverId) {
    closeServerActionMenus();
    openServerModal(serverId);
  }

  function serverActionMonitor(serverId) {
    closeServerActionMenus();
    _serverMonitorFocusId = serverId;
    navigateTo('server-monitor', { serverId, replaceHistory: false });
  }

  async function serverRestartServices() {
    if (!_serverAdvancedTargetId) return;
    await postServerAction(_serverAdvancedTargetId, 'restart-services', 'Restart services on this server?', 'Restart services command queued');
  }

  async function serverReboot() {
    if (!_serverAdvancedTargetId) return;
    await postServerAction(_serverAdvancedTargetId, 'reboot-server', 'Reboot this server? This is destructive and may interrupt service.', 'Reboot command queued');
  }

  function serverOptimizePhp() {
    toast('Blocked: current TARGET nodes do not provision/manage PHP runtime config in this server-area flow.', 'warning');
  }

  function serverUpdateFfmpeg() {
    toast('Blocked: no safe FFmpeg in-place upgrade workflow is currently exposed for TARGET node profiles.', 'warning');
  }

  // ─── Tag Input Helpers ────────────────────────────────────────────
  function focusTagInput(inputId) {
    const el = $(`#${inputId}`);
    if (el) el.focus();
  }

  function addTag(inputId, value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    const wrap = $(`#${inputId}Wrap`);
    const container = wrap ? wrap.querySelector('.tag-input-container') : null;
    if (!container) return;
    // Check duplicate
    const pills = container.querySelectorAll('.tag-pill');
    for (const p of pills) {
      const txt = p.textContent.replace(/\×$/, '').trim();
      if (txt === trimmed) return;
    }
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(trimmed)}<button type="button" class="tag-pill-remove" onclick="APP.removeTag('${inputId}','${escHtml(trimmed)}')">&times;</button>`;
    container.insertBefore(pill, wrap.querySelector('.tag-input-field'));
    const input = container.querySelector('.tag-input-field');
    if (input) input.value = '';
  }

  function removeTag(inputId, value) {
    const trimmed = String(value || '').trim();
    const wrap = $(`#${inputId}Wrap`);
    const container = wrap ? wrap.querySelector('.tag-input-container') : null;
    if (!container) return;
    const pills = container.querySelectorAll('.tag-pill');
    pills.forEach(p => {
      const txt = p.textContent.replace(/\×$/, '').trim();
      if (txt === trimmed) p.remove();
    });
  }

  function handleTagInputKeydown(e, inputId) {
    if (!e) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = e.target ? e.target.value.replace(',', '').trim() : '';
      if (val) addTag(inputId, val);
    } else if (e.key === 'Backspace' && !e.target.value) {
      const wrap = $(`#${inputId}Wrap`);
      const container = wrap ? wrap.querySelector('.tag-input-container') : null;
      if (!container) return;
      const pills = Array.from(container.querySelectorAll('.tag-pill'));
      if (pills.length > 0) {
        const last = pills[pills.length - 1];
        const txt = last.textContent.replace(/\×$/, '').trim();
        last.remove();
      }
    }
  }

  // Wire tag input Enter key handling — attached once when modal opens
  let _srvModalWired = false;
  function _wireServerModalHandlers() {
    if (_srvModalWired) return;
    _srvModalWired = true;
    ['srvDomains', 'srvHttpPort', 'srvConnLimitPorts'].forEach(inputId => {
      const el = $(`#${inputId}`);
      if (el) {
        el.addEventListener('keydown', (e) => handleTagInputKeydown(e, inputId));
        el.addEventListener('blur', (e) => {
          const val = e.target ? e.target.value.trim() : '';
          if (val) addTag(inputId, val);
        });
      }
    });
    const sgToggle = $('#srvServerGuardEnabled');
    if (sgToggle) {
      sgToggle.addEventListener('change', () => {
        const settings = $('#srvGuardSettings');
        const banner = $('#srvGuardBanner');
        if (settings) settings.style.display = sgToggle.checked ? 'block' : 'none';
        if (banner) banner.style.display = sgToggle.checked ? 'block' : 'none';
      });
    }
    const ispEntry = $('#srvIspNameEntry');
    if (ispEntry) {
      ispEntry.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addIspName();
        }
      });
    }
  }

  // ─── SSL Certificate Tab ─────────────────────────────────────────
  let _srvSSLDomains = [];

  function renderSSLDomainsTable(serverId, domains) {
    _srvSSLDomains = Array.isArray(domains) ? domains : [];
    const body = $('#srvSSLDomainsBody');
    if (!body) return;
    if (!_srvSSLDomains.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:16px">No SSL domains available for this server yet.</td></tr>';
      return;
    }
    body.innerHTML = _srvSSLDomains.map(d => `
      <tr>
        <td>${escHtml(d.domain || '')}</td>
        <td>${d.ssl_port || 443}</td>
        <td><span class="status-badge ${d.ssl_status === 'active' ? 'success' : d.ssl_status === 'expired' ? 'error' : 'muted'}">${d.ssl_status === 'active' ? 'Installed' : d.ssl_status === 'expired' ? 'Expired' : 'Not Installed'}</span></td>
        <td>${d.ssl_expiry ? d.ssl_expiry : '—'}</td>
        <td>
          ${d.ssl_status !== 'active'
            ? `<button type="button" class="btn btn-xs btn-primary" onclick="APP.installSSL(${d.id})">Install SSL</button>`
            : '<span class="text-muted">Active</span>'}
        </td>
      </tr>
    `).join('');
  }

  async function installSSL(domainId) {
    const domain = _srvSSLDomains.find((item) => Number(item.id) === Number(domainId));
    toast(`Automatic SSL issuance is not implemented for ${domain && domain.domain ? domain.domain : 'this domain'} yet. Current blocker: the panel has no certificate issuance/provisioning backend or remote cert-path sync contract for Edit Server.`, 'warning');
  }

  // ─── ISP Manager ────────────────────────────────────────────────
  function addIspName() {
    const entry = $('#srvIspNameEntry');
    const area = $('#srvIspNames');
    if (!entry || !area) return;
    const value = String(entry.value || '').trim();
    if (!value) return;
    const lines = String(area.value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (!lines.includes(value)) lines.push(value);
    area.value = lines.join('\n');
    entry.value = '';
    entry.focus();
  }

  function clearIspNameEntry() {
    const entry = $('#srvIspNameEntry');
    if (entry) entry.value = '';
  }

  function openIspEditor() {
    saveServer();
  }

  // ─── Save Server ────────────────────────────────────────────────
  async function saveServer() {
    const id = $('#srvFormId').value.trim();
    const domains = _getTagValues('srvDomains');
    const httpPorts = _getTagValues('srvHttpPort');
    const connectionLimitPorts = _getTagValues('srvConnLimitPorts');
    const serverRole = $('#serverModal').dataset.serverRole || 'edge';
    const ispNames = String($('#srvIspNames').value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);

    const body = {
      name: $('#srvName').value.trim(),
      role: serverRole,
      public_host: $('#srvProxyIpDefaultDns').value.trim(),
      public_ip: $('#srvServerIpPrimary').value.trim(),
      server_ip: $('#srvServerIpPrimary').value.trim(),
      admin_password: $('#srvRootPassword').value,
      max_clients: parseInt($('#srvMaxClients').value, 10) || 0,
      enabled: $('#srvEnabled').checked,
      timeshift_only: $('#srvTimeshiftOnly').checked,
      full_duplex: $('#srvFullDuplex').checked,
      boost_fpm: $('#srvBoostFpm').checked,
      domains,
      private_users_cdn_lb: $('#srvPrivateUsersCdn').value.trim(),
      http_port: parseInt(httpPorts[0], 10) || 80,
      http_port_list: httpPorts,
      https_m3u_lines: $('#srvHttpsM3uLines').checked,
      force_ssl_port: $('#srvForceSslPort').checked,
      https_port: parseInt($('#srvHttpsPort').value, 10) || 443,
      time_difference: $('#srvTimeDifference').value,
      ssh_port: parseInt($('#srvSshPortAdv').value, 10) || 22,
      network_interface: $('#srvNetworkInterface').value,
      network_speed: $('#srvNetworkSpeed').value,
      os_info: $('#srvOsInfo').value,
      geoip_load_balancing: $('#srvGeoipLb').checked,
      geoip_priority: $('#srvGeoipPriority').value,
      geoip_countries: $('#srvGeoipCountries').value.trim(),
      extra_nginx_config: $('#srvExtraNginx').value,
      server_guard_enabled: $('#srvServerGuardEnabled').checked,
      ip_whitelisting: $('#srvIpWhitelisting').checked,
      botnet_fighter: $('#srvBotnetFighter').checked,
      under_attack: $('#srvUnderAttack').checked,
      connection_limit_ports: connectionLimitPorts.join(','),
      max_conn_per_ip: parseInt($('#srvMaxConnPerIp').value, 10) || 0,
      max_hits_normal_user: parseInt($('#srvMaxHitsNormal').value, 10) || 50,
      max_hits_restreamer: parseInt($('#srvMaxHitsRestreamer').value, 10) || 1200,
      server_guard_whitelist_username: $('#srvWhitelistUsername').value.trim(),
      block_user_minutes: parseInt($('#srvBlockUserMins').value, 10) || 10,
      server_guard_auto_restart_mysql_value: $('#srvAutoRestartMysql').value.trim(),
      isp_enabled: $('#srvIspEnabled').checked,
      isp_priority_label: $('#srvIspPriority').value,
      isp_allowed_names: ispNames.join(','),
    };

    try {
      if (id) await apiFetch(`/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiFetch('/servers', { method: 'POST', body: JSON.stringify(body) });
      toast('Server updated');
      closeServerModal();
      await loadServers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteServer(id) {
    if (!confirm('Delete this server?')) return;
    try {
      await apiFetch(`/servers/${id}`, { method: 'DELETE' });
      toast('Deleted');
      loadServers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function exportNginxUpstream() {
    try {
      const data = await apiFetch('/servers/nginx-export');
      const text = data.snippet || '';
      await navigator.clipboard.writeText(text);
      toast('Nginx upstream copied to clipboard');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function startServerProvision() {
    const existingId = ($('#srvFormId').value || '').trim();
    const name = ($('#srvLbName').value || '').trim();
    const publicHost = ($('#srvProvisionPublicHost').value || '').trim();
    const panelUrlInput = ($('#srvPanelUrl').value || '').trim();
    const panelUrl =
      panelUrlInput ||
      (typeof window !== 'undefined' && window.location ? window.location.origin : '');

    const body = {
      host: ($('#srvSshHost').value || '').trim(),
      port: parseInt($('#srvSshPort').value, 10) || 22,
      user: ($('#srvSshUser').value || '').trim() || 'root',
      password: $('#srvSshPassword').value || '',
      panel_url: panelUrl,
      profile: ($('#srvNodeProfile').value || 'origin-runtime'),
    };

    if (existingId) {
      body.server_id = parseInt(existingId, 10);
    } else {
      if (!name) {
        toast('LB name required', 'error');
        return;
      }
      if (!publicHost) {
        toast('Public host required', 'error');
        return;
      }
      body.name = name;
      body.public_host = publicHost;
    }

    if (!body.host) {
      toast('SSH host required', 'error');
      return;
    }
    try {
      const job = await apiFetch('/servers/provision', { method: 'POST', body: JSON.stringify(body) });
      const logEl = $('#srvProvisionLog');
      if (logEl) logEl.textContent = `Job #${job.id || '?'} started…\n`;
      if (job.server_id && !existingId) {
        $('#srvFormId').value = String(job.server_id);
        $('#serverModalTitle').textContent = 'Edit Server';
        $('#srvName').value = name;
        $('#srvProxyIpDefaultDns').value = publicHost;
        $('#serverModal').dataset.serverRole = 'lb';
      }
      const poll = async () => {
        try {
          const st = await apiFetch(`/servers/provision/${job.id}`);
          if (logEl) logEl.textContent = (st.log || '') + (st.error ? `\n${st.error}` : '');
          if (st.status === 'done' || st.status === 'error') return;
          setTimeout(poll, 1500);
        } catch (e) {
          if (logEl) logEl.textContent += `\n${e.message}`;
        }
      };
      poll();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Security ────────────────────────────────────────────────────

  // ─── Logs ────────────────────────────────────────────────────────

  function providerHostLabel(url) {
    try { return new URL(url).host; } catch { return '—'; }
  }

  async function loadProviders() {
    try {
      await loadRefData();
      const data = await apiFetch('/providers');
      _importProviders = data.providers || [];
      const tb = $('#providersTableBody');
      if (!tb) return;
      const bqName = (id) => {
        const b = _bouquets.find(x => String(x.id) === String(id));
        return b ? b.bouquet_name : '—';
      };
      const freqLabel = (h) => (!h ? 'Off' : `${h}h`);
      tb.innerHTML = _importProviders.map(p => {
        const last = p.last_updated ? formatDate(p.last_updated) : '—';
        return `<tr>
          <td>${p.id}</td>
          <td>${escHtml(p.name || '')}</td>
          <td>${escHtml(providerHostLabel(p.url))}</td>
          <td>${escHtml(bqName(p.bouquet_id))}</td>
          <td>${freqLabel(p.update_frequency)}</td>
          <td>${last}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.openProviderModal(${p.id})">Edit</button>
            <button class="btn btn-xs btn-secondary" onclick="APP.validateSavedProvider(${p.id})">Test</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteProvider(${p.id})">Del</button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7">No providers yet</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  }

  function openProviderModal(id) {
    $('#providerModal').style.display = 'flex';
    $('#providerModalTitle').textContent = id ? 'Edit provider' : 'Add provider';
    $('#providerEditId').value = id || '';
    populateSelect('#providerBouquet', _bouquets, 'id', 'bouquet_name', '— None —');
    if (id) {
      const p = _importProviders.find(x => x.id === id);
      if (p) {
        $('#providerName').value = p.name || '';
        $('#providerUrl').value = p.url || '';
        $('#providerBouquet').value = String(p.bouquet_id || '');
        $('#providerFreq').value = String(p.update_frequency || 0);
      }
    } else {
      $('#providerName').value = '';
      $('#providerUrl').value = '';
      $('#providerBouquet').value = '';
      $('#providerFreq').value = '0';
    }
  }

  function closeProviderModal() {
    $('#providerModal').style.display = 'none';
  }

  async function saveProvider() {
    const id = $('#providerEditId').value;
    const body = {
      name: $('#providerName').value.trim(),
      url: $('#providerUrl').value.trim(),
      bouquet_id: parseInt($('#providerBouquet').value, 10) || 0,
      update_frequency: parseInt($('#providerFreq').value, 10) || 0,
    };
    if (!body.url) return toast('URL required', 'error');
    try {
      if (id) {
        await apiFetch(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/providers', { method: 'POST', body: JSON.stringify(body) });
      }
      closeProviderModal();
      toast('Saved');
      loadProviders();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteProvider(id) {
    if (!confirm('Delete this provider?')) return;
    try {
      await apiFetch(`/providers/${id}`, { method: 'DELETE' });
      toast('Deleted');
      loadProviders();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function validateProviderForm() {
    const url = $('#providerUrl').value.trim();
    if (!url) return toast('URL required', 'error');
    try {
      await apiFetch('/providers/validate-preview', { method: 'POST', body: JSON.stringify({ url }) });
      toast('Connection OK');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function validateSavedProvider(id) {
    try {
      await apiFetch(`/providers/${id}/validate`, { method: 'POST', body: JSON.stringify({}) });
      toast('Connection OK');
    } catch (e) { toast(e.message, 'error'); }
  }

  function syncImportContentTypeUI() {
    const el = $('#importContentType');
    const t = el ? el.value : 'movies';
    const xb = $('#importXtreamBlock');
    const mb = $('#importM3uBlock');
    if (!xb || !mb) return;
    if (t === 'm3u') { xb.style.display = 'none'; mb.style.display = 'block'; }
    else { xb.style.display = 'block'; mb.style.display = 'none'; }
  }

  async function loadImportContentPage() {
    await loadRefData();
    try {
      const data = await apiFetch('/providers');
      _importProviders = data.providers || [];
      const sel = $('#importProviderSel');
      if (sel) {
        sel.innerHTML = _importProviders.map(p =>
          `<option value="${p.id}">${escHtml(p.name || '')} (${escHtml(providerHostLabel(p.url))})</option>`
        ).join('');
        if (!_importProviders.length) sel.innerHTML = '<option value="">— Add a provider first —</option>';
      }
      populateSelect('#importBouquetSel', _bouquets, 'id', 'bouquet_name', '— None —');
      const wrap = $('#importCatCheckboxWrap');
      if (wrap) wrap.innerHTML = '';
      syncImportContentTypeUI();
      await resumeImportJobFromStorage();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function fetchImportCategories() {
    const pid = parseInt($('#importProviderSel').value, 10);
    if (!pid) return toast('Select a provider', 'error');
    const t = $('#importContentType').value;
    if (t === 'm3u') return;
    try {
      const data = await apiFetch(`/providers/${pid}/categories`, { method: 'POST', body: JSON.stringify({ type: t }) });
      const cats = data.categories || [];
      const wrap = $('#importCatCheckboxWrap');
      wrap.innerHTML = cats.map(c => {
        const id = String(c.category_id);
        const name = escHtml(c.category_name || id);
        return `<label style="display:block;margin:4px 0"><input type="checkbox" class="import-cat-cb" value="${escHtml(id)}"> ${name} <span style="color:#6e7681">(${escHtml(id)})</span></label>`;
      }).join('') || '<span style="color:#8b949e">No categories</span>';
      toast(`Loaded ${cats.length} categories`);
    } catch (e) { toast(e.message, 'error'); }
  }

  function toggleImportCatsAll(on) {
    $$('.import-cat-cb').forEach(cb => { cb.checked = !!on; });
  }

  function stopImportJobPoll() {
    if (_importJobPoll) { clearInterval(_importJobPoll); _importJobPoll = null; }
  }

  function pollImportJob(jobId) {
    stopImportJobPoll();
    _importJobId = jobId;
    persistImportJobId(jobId);
    const panel = $('#importJobPanel');
    if (panel) panel.style.display = 'block';

    const tick = async () => {
      try {
        const j = await apiFetch(`/import/jobs/${jobId}`);
        applyImportJobToUI(j);
        if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
          stopImportJobPoll();
          persistImportJobId(null);
          _importJobId = null;
          toast(j.status === 'done' ? 'Import finished' : (j.message || j.status), j.status === 'done' ? 'success' : 'error');
        }
      } catch {
        stopImportJobPoll();
        persistImportJobId(null);
        _importJobId = null;
      }
    };

    tick();
    _importJobPoll = setInterval(tick, 1200);
  }

  /** Restore progress UI after refresh while a job still runs server-side (in-memory job map). */
  async function resumeImportJobFromStorage() {
    const stored = readImportJobId();
    if (!stored) return;
    try {
      const j = await apiFetch(`/import/jobs/${encodeURIComponent(stored)}`);
      if (j.status === 'running') {
        pollImportJob(stored);
        return;
      }
      const panel = $('#importJobPanel');
      if (panel) panel.style.display = 'block';
      applyImportJobToUI(j);
      persistImportJobId(null);
      _importJobId = null;
    } catch {
      persistImportJobId(null);
    }
  }

  async function startContentImport() {
    const t = $('#importContentType').value;
    const bq = parseInt($('#importBouquetSel').value, 10) || 0;
    if (t === 'm3u') {
      const text = $('#importM3uText').value;
      if (!text.trim()) return toast('Paste M3U content', 'error');
      try {
        const r = await apiFetch('/import/m3u', { method: 'POST', body: JSON.stringify({ m3u_text: text, bouquet_id: bq }) });
        pollImportJob(r.job_id);
        toast('M3U import started', 'success');
      } catch (e) { toast(e.message, 'error'); }
      return;
    }
    const pid = parseInt($('#importProviderSel').value, 10);
    if (!pid) return toast('Select a provider', 'error');
    const ids = [...$$('.import-cat-cb')].filter(cb => cb.checked).map(cb => cb.value);
    if (!ids.length) return toast('Select at least one category (load categories first)', 'error');

    const patch = {};
    if (t === 'movies') patch.movie_categories = ids;
    if (t === 'series') patch.series_categories = ids;
    if (t === 'live') patch.live_categories = ids;
    if (bq) patch.bouquet_id = bq;
    try {
      await apiFetch(`/providers/${pid}`, { method: 'PUT', body: JSON.stringify(patch) });
      let r;
      if (t === 'movies') r = await apiFetch('/import/movies', { method: 'POST', body: JSON.stringify({ provider_id: pid, category_ids: ids }) });
      else if (t === 'series') r = await apiFetch('/import/series', { method: 'POST', body: JSON.stringify({ provider_id: pid, category_ids: ids }) });
      else r = await apiFetch('/import/live', { method: 'POST', body: JSON.stringify({ provider_id: pid, category_ids: ids }) });
      pollImportJob(r.job_id);
      toast('Import started', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function cancelContentImport() {
    if (!_importJobId) return toast('No active job', 'error');
    try {
      await apiFetch(`/import/jobs/${_importJobId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      toast('Cancel requested');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadLogs() {
    try {
      const [logData, actData] = await Promise.all([
        apiFetchOptional('/logs', { logs: [] }),
        apiFetchOptional('/activity', { activity: [] }),
      ]);
      $('#panelLogsTable tbody').innerHTML = (logData.logs || []).map(l => `
        <tr><td>${l.id}</td><td>${escHtml(l.action || '')}</td><td>${escHtml(l.target_type || '')} ${l.target_id || ''}</td><td>${escHtml(l.details || '')}</td><td>${l.created_at || ''}</td></tr>
      `).join('') || '<tr><td colspan="5">No logs</td></tr>';
      $('#activityLogsTable tbody').innerHTML = (actData.activity || []).slice(0, 200).map(a => `
        <tr><td>${a.activity_id || a.id}</td><td>${a.user_id || ''}</td><td>${a.stream_id || ''}</td><td>${escHtml(a.user_ip || '')}</td><td class="text-truncate" style="max-width:200px">${escHtml(a.user_agent || '')}</td><td>${formatDate(a.date || a.created_at)}</td></tr>
      `).join('') || '<tr><td colspan="6">No activity</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Monitor (Bandwidth + Health) ──────────────────────────────────

  APP._bwPeriod = 6;
  APP._bwHistoryChart = null;
  APP._bwHistoryLabels = [];
  APP._bwHistoryRx = [];
  APP._bwHistoryTx = [];

  function renderBwHistoryChart(points, periodHours) {
    const canvas = document.getElementById('bwHistoryChart');
    if (!canvas) return;

    // Aggregate by time bucket depending on period
    const bucketSec = periodHours <= 6 ? 60 : periodHours <= 24 ? 300 : 3600;
    const buckets = new Map();
    for (const p of points) {
      const t = new Date(p.time);
      const rounded = new Date(Math.floor(t.getTime() / (bucketSec * 1000)) * (bucketSec * 1000));
      const key = rounded.toISOString();
      if (!buckets.has(key)) buckets.set(key, { rx: [], tx: [] });
      buckets.get(key).rx.push(p.rxMbps || 0);
      buckets.get(key).tx.push(p.txMbps || 0);
    }

    const labels = [];
    const rxData = [];
    const txData = [];
    [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([key, vals]) => {
      const d = new Date(key);
      const label = periodHours <= 24
        ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
        : `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`;
      labels.push(label);
      rxData.push(+((vals.rx.reduce((a, b) => a + b, 0) / vals.rx.length) || 0).toFixed(3));
      txData.push(+((vals.tx.reduce((a, b) => a + b, 0) / vals.tx.length) || 0).toFixed(3));
    });

    if (APP._bwHistoryChart) {
      APP._bwHistoryChart.destroy();
      APP._bwHistoryChart = null;
    }

    APP._bwHistoryChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'In (Mbps)',
            data: rxData,
            borderColor: '#6b9ef5',
            backgroundColor: 'rgba(107,158,245,0.1)',
            borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
          },
          {
            label: 'Out (Mbps)',
            data: txData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.1)',
            borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        scales: {
          x: { ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#8b949e', font: { size: 10 }, callback: v => v + ' Mbps' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
        },
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} Mbps` } },
        },
      },
    });
  }

  async function loadMonitorPage() {
    if (!monitorModule) return;
    return monitorModule.loadMonitorPage({
      apiFetch,
      toast,
      dashboardRelativeAge,
      getBwPeriod: () => APP._bwPeriod,
      getBwHistoryChart: () => APP._bwHistoryChart,
      setBwHistoryChart: (chart) => { APP._bwHistoryChart = chart; },
    });
  }

  APP.setBwPeriod = function(hours) {
    APP._bwPeriod = hours;
    document.querySelectorAll('.monitor-period-btns .btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('bwBtn' + hours + 'h');
    if (btn) btn.classList.add('active');
    loadMonitorPage();
  };

  // ─── Sharing Detection ────────────────────────────────────────────

  APP._sharingCache = [];

  async function loadSharingPage() {
    try {
      const data = await apiFetchOptional('/sharing', { users: [] });
      const users = data.users || [];
      APP._sharingCache = users;

      document.getElementById('sharingFlaggedCount').textContent = users.filter(u => u.flagged).length;

      renderSharingTable(users);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderSharingTable(users) {
    const tb = document.querySelector('#sharingTable tbody');
    if (!tb) return;

    const search = (document.getElementById('sharingSearch')?.value || '').toLowerCase();
    const filtered = users.filter(u =>
      u.username.toLowerCase().includes(search) ||
      u.ips.some(ip => ip.toLowerCase().includes(search))
    );

    if (filtered.length === 0) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:2rem">No users found</td></tr>';
      return;
    }

    tb.innerHTML = filtered.map((u, i) => {
      const countClass = u.flagged ? 'danger' : u.uniqueIps > 0 ? 'warn' : 'safe';
      const ipsList = u.ips.slice(0, 8).map(ip => `<span class="sharing-ip-chip">${ip}</span>`).join('');
      const overflow = u.ips.length > 8 ? `<span class="sharing-ip-chip" style="color:#8b949e">+${u.ips.length - 8}</span>` : '';
      const isActive = u.status === 'Active';
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${escHtml(u.username)}</strong></td>
        <td><div class="sharing-ip-list">${ipsList}${overflow}</div></td>
        <td><span class="sharing-unique-count ${countClass}">${u.uniqueIps}</span></td>
        <td><span class="status-badge ${isActive ? 'active' : 'passive'}">${u.status || 'Unknown'}</span></td>
        <td>
          <button class="btn-clear-history" onclick="APP.clearSharingHistory(${u.userId})" title="Clear IP history">
            Clear
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  APP.clearSharingHistory = async function(userId) {
    if (!confirm('Clear IP history for this user?')) return;
    try {
      await apiFetch(`/sharing/${userId}/clear`, { method: 'POST' });
      toast('History cleared', 'success');
      loadSharingPage();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  APP.scanSharing = async function() {
    try {
      toast('Scanning...', 'info');
      const data = await apiFetch('/sharing/scan', { method: 'POST' });
      toast(`Scanned ${data.scanned || 0} users`, 'success');
      loadSharingPage();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // Search listener
  document.getElementById('sharingSearch')?.addEventListener('input', () => {
    renderSharingTable(APP._sharingCache);
  });

  // ─── Backup Management ────────────────────────────────────────────

  APP._backupsCache = [];
  APP._backupRetentionLimit = null;
  APP._cloudBackupCapability = null;

  async function loadBackupsPage() {
    if (!backupsModule) return;
    return backupsModule.loadBackupsPage({
      apiFetch, apiFetchOptional, escHtml, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
      getBackupsCache: () => APP._backupsCache,
      setBackupsCache: (rows) => { APP._backupsCache = rows; },
      getBackupRetentionLimit: () => APP._backupRetentionLimit,
      setBackupRetentionLimit: (value) => { APP._backupRetentionLimit = value; },
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
    });
  }

  async function loadCloudBackups() {
    if (!backupsModule) return;
    return backupsModule.loadCloudBackups({
      apiFetch, escHtml,
      getBackupsCache: () => APP._backupsCache,
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
    });
  }

  function renderLocalBackups(backups) {
    if (!backupsModule) return;
    return backupsModule.renderLocalBackups({
      escHtml,
      getCloudBackupCapability: () => APP._cloudBackupCapability,
    }, backups);
  }

  APP.createBackup = async function() {
    if (!backupsModule) return;
    return backupsModule.createBackup({
      apiFetch, apiFetchOptional, escHtml, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
      getBackupsCache: () => APP._backupsCache,
      setBackupsCache: (rows) => { APP._backupsCache = rows; },
      getBackupRetentionLimit: () => APP._backupRetentionLimit,
      setBackupRetentionLimit: (value) => { APP._backupRetentionLimit = value; },
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
    });
  };

  APP.downloadBackup = async function(id) {
    if (!backupsModule) return;
    return backupsModule.downloadBackup(id);
  };

  APP.restoreBackup = async function(id) {
    if (!backupsModule) return;
    return backupsModule.restoreBackup({
      apiFetch, apiFetchOptional, escHtml, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
      getBackupsCache: () => APP._backupsCache,
      setBackupsCache: (rows) => { APP._backupsCache = rows; },
      getBackupRetentionLimit: () => APP._backupRetentionLimit,
      setBackupRetentionLimit: (value) => { APP._backupRetentionLimit = value; },
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
    }, id);
  };

  APP.deleteBackup = async function(id) {
    if (!backupsModule) return;
    return backupsModule.deleteBackup({
      apiFetch, apiFetchOptional, escHtml, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
      getBackupsCache: () => APP._backupsCache,
      setBackupsCache: (rows) => { APP._backupsCache = rows; },
      getBackupRetentionLimit: () => APP._backupRetentionLimit,
      setBackupRetentionLimit: (value) => { APP._backupRetentionLimit = value; },
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
    }, id);
  };

  APP.uploadBackupCloud = async function(id) {
    if (!backupsModule) return;
    return backupsModule.uploadBackupCloud({
      apiFetch, escHtml, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
      getCloudBackupCapability: () => APP._cloudBackupCapability,
      setCloudBackupCapability: (value) => { APP._cloudBackupCapability = value; },
      getBackupsCache: () => APP._backupsCache,
    }, id);
  };

  APP.toggleCloudConfig = function() {
    if (!backupsModule) return;
    return backupsModule.toggleCloudConfig();
  };

  APP.saveCloudConfig = async function() {
    if (!backupsModule) return;
    return backupsModule.saveCloudConfig({
      apiFetch, toast,
      getCurrentPage: () => _currentPage,
      loadSettings,
    });
  };

  document.getElementById('backupsSearch')?.addEventListener('input', () => {
    renderLocalBackups(APP._backupsCache);
  });

  // ─── Access Codes ─────────────────────────────────────────────────

  async function loadAccessCodes() {
    try {
      const data = await apiFetch('/access-codes');
      _accessCodes = data.codes || [];
      const tb = $('#accessCodesTable tbody');
      if (!tb) return;
      tb.innerHTML = _accessCodes.map(c => {
        const url = `${location.origin}/${c.code}`;
        return `<tr>
          <td>${c.id}</td>
          <td><code>${escHtml(c.code || '')}</code></td>
          <td>${escHtml(c.role || '')}</td>
          <td>${c.enabled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-secondary">No</span>'}</td>
          <td>${escHtml(c.description || '')}</td>
          <td>${c.last_used_at ? formatDate(c.last_used_at) : '—'}</td>
          <td>
            <button class="btn btn-xs btn-secondary" onclick="navigator.clipboard.writeText('${escHtml(url)}').then(()=>APP.toast('URL copied')).catch(()=>APP.toast('Copy failed','error'))">Copy URL</button>
            <button class="btn btn-xs btn-primary" onclick="APP.openAccessCodeModal(${c.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteAccessCode(${c.id})">Del</button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7">No access codes</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  }

  function openAccessCodeModal(id) {
    $('#accessCodeModal').style.display = 'flex';
    $('#accessCodeId').value = id || '';
    $('#accessCodeModalTitle').textContent = id ? 'Edit Access Code' : 'Add Access Code';
    if (!id) {
      $('#accessCodeValue').value = '';
      $('#accessCodeRole').value = 'admin';
      $('#accessCodeEnabled').value = '1';
      $('#accessCodeDescription').value = '';
      return;
    }
    const c = _accessCodes.find(x => x.id === id);
    if (!c) return;
    $('#accessCodeValue').value = c.code || '';
    $('#accessCodeRole').value = c.role || 'admin';
    $('#accessCodeEnabled').value = c.enabled ? '1' : '0';
    $('#accessCodeDescription').value = c.description || '';
  }

  function closeAccessCodeModal() {
    $('#accessCodeModal').style.display = 'none';
  }

  async function saveAccessCode() {
    const id = $('#accessCodeId').value;
    const body = {
      code: $('#accessCodeValue').value.trim(),
      role: $('#accessCodeRole').value,
      enabled: $('#accessCodeEnabled').value === '1' ? 1 : 0,
      description: $('#accessCodeDescription').value.trim(),
    };
    if (!body.code) return toast('Code is required', 'error');
    try {
      if (id) await apiFetch(`/access-codes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiFetch('/access-codes', { method: 'POST', body: JSON.stringify(body) });
      closeAccessCodeModal();
      toast('Saved');
      loadAccessCodes();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteAccessCode(id) {
    if (!confirm('Delete this access code?')) return;
    try {
      await apiFetch(`/access-codes/${id}`, { method: 'DELETE' });
      toast('Deleted');
      loadAccessCodes();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Database Manager ──────────────────────────────────────────────

  async function loadDbManager() {
    try {
      const [status, perf, live] = await Promise.all([
        apiFetch('/system/db-status'),
        apiFetch('/system/db-performance'),
        apiFetch('/system/db-live'),
      ]);
      $('#dbSizeMb').textContent = `${status.total_size_mb || 0} MB`;
      $('#dbTotalTables').textContent = status.total_tables || 0;
      $('#dbConnections').textContent = live.current_connections || perf.Threads_connected || 0;
      $('#dbSlowQueries').textContent = perf.Slow_queries || 0;
      const tb = $('#dbTableSizes tbody');
      if (tb) {
        tb.innerHTML = (status.tables || []).map(t => `<tr><td>${escHtml(t.table_name)}</td><td>${t.size_mb}</td></tr>`).join('')
          || '<tr><td colspan="2">No table stats</td></tr>';
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runDbOptimize() {
    if (!confirm('Run OPTIMIZE TABLE on core tables now?')) return;
    try {
      const r = await apiFetch('/system/db-optimize', { method: 'POST', body: JSON.stringify({}) });
      toast(r.message || 'Optimize completed');
      loadDbManager();
      if (_currentPage === 'settings') loadSettings();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runDbRepair() {
    if (!confirm('Run REPAIR TABLE on core tables now?')) return;
    try {
      const r = await apiFetch('/system/db-repair', { method: 'POST', body: JSON.stringify({}) });
      toast(r.message || 'Repair completed');
      loadDbManager();
      if (_currentPage === 'settings') loadSettings();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Init ────────────────────────────────────────────────────────

  function init() {
    initWizardTabs();
    initTmdbSearch();

    $('#loginForm').addEventListener('submit', doLogin);
    $('#logoutBtn').addEventListener('click', (e) => { e.preventDefault(); doLogout(); });
    applySidebarLayoutState();
    $('#sidebarToggle').addEventListener('click', () => {
      toggleSidebarLayout();
    });
    syncAdminRouteLinks();
    normalizeLegacyAdminHashOnBoot();

    $$('.nav-link[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
      });
    });

    window.addEventListener('popstate', () => {
      const route = getRequestedAdminRoute({ ignoreHash: true, ignoreSaved: true });
      const routePage = route.page || 'dashboard';
      const routeServerId = route.serverId || null;
      const currentServerId = _currentPage === 'server-monitor' ? (_serverMonitorSelectedId || null) : null;
      if (routePage !== _currentPage || routeServerId !== currentServerId) {
        navigateTo(routePage, { skipHistory: true, serverId: routeServerId });
      }
    });
    window.addEventListener('hashchange', () => {
      const route = parseAdminHashRoute(location.hash);
      if (!route.page || !isKnownAdminPageKey(route.page)) return;
      navigateTo(route.page, {
        replaceHistory: true,
        serverId: parsePositiveInt(route.params.get('server') || route.params.get('id')),
      });
    });
    window.addEventListener('resize', () => {
      closeServerActionMenus();
      closeLineActionMenus();
      applySidebarLayoutState();
    });
    window.addEventListener('scroll', () => {
      closeServerActionMenus();
      closeLineActionMenus();
    }, true);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-server-action-wrap]')) closeServerActionMenus();
      if (!e.target.closest('[data-line-action-wrap]')) closeLineActionMenus();
    });

    // Filter event listeners
    ['linesSearch', 'linesStatusFilter', 'linesResellerFilter', 'linesTypeFilter', 'linesPackageFilter', 'linesPerPage'].forEach(id => {
      const el = $(`#${id}`);
      if (el) {
        const handler = () => { _linesPage = 1; loadLines(); };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      }
    });
    ['registeredUsersSearch', 'registeredUsersGroupFilter', 'registeredUsersStatusFilter', 'registeredUsersPerPage'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      const handler = () => { _registeredUsersPage = 1; loadRegisteredUsers(); };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    const groupSearch = $('#memberGroupsSearch');
    if (groupSearch) {
      groupSearch.addEventListener('input', () => loadMemberGroups());
      groupSearch.addEventListener('change', () => loadMemberGroups());
    }
    const expirySearch = $('#expiryMediaSearch');
    if (expirySearch) {
      expirySearch.addEventListener('input', () => loadExpiryMedia());
      expirySearch.addEventListener('change', () => loadExpiryMedia());
    }
    const creditsMode = $('#registeredUserCreditsMode');
    const creditsAmount = $('#registeredUserCreditsAmount');
    if (creditsMode) creditsMode.addEventListener('change', updateRegisteredUserCreditsPreview);
    if (creditsAmount) creditsAmount.addEventListener('input', updateRegisteredUserCreditsPreview);
    const importBqSearch = $('#importUsersBouquetSearch');
    if (importBqSearch) importBqSearch.addEventListener('input', renderImportUsersBouquetList);
    function debounceLoadMovies(el) {
      clearTimeout(el._t);
      _moviesPage = 1;
      el._t = setTimeout(loadMovies, 300);
    }
    function debounceLoadSeries(el) {
      clearTimeout(el._t);
      _seriesPage = 1;
      el._t = setTimeout(loadSeriesList, 300);
    }
    ['streamsSearch'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      const run = () => { clearTimeout(el._t); _streamsPage = 1; el._t = setTimeout(renderStreamsTable, 300); };
      el.addEventListener('input', run);
      el.addEventListener('change', run);
    });
    ['episodesSearch'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener('input', () => { clearTimeout(el._t); _allEpisodesPage = 0; el._t = setTimeout(loadAllEpisodes, 300); });
    });
    const epSeriesF = $('#episodesSeriesFilter');
    if (epSeriesF) epSeriesF.addEventListener('change', () => { _allEpisodesPage = 0; loadAllEpisodes(); });
    const epPerPage = $('#episodesPerPage');
    if (epPerPage) epPerPage.addEventListener('change', () => { _allEpisodesPage = 0; loadAllEpisodes(); });
    const streamStatusF = $('#streamsStatusFilter');
    if (streamStatusF) streamStatusF.addEventListener('change', () => { _streamsPage = 1; renderStreamsTable(); });
    const streamCatF = $('#streamsCategoryFilter');
    if (streamCatF) streamCatF.addEventListener('change', () => { _streamsPage = 1; renderStreamsTable(); });
    const streamServerF = $('#streamsServerFilter');
    if (streamServerF) streamServerF.addEventListener('change', () => { _streamsPage = 1; renderStreamsTable(); });
    const streamPerPage = $('#streamsPerPage');
    if (streamPerPage) streamPerPage.addEventListener('change', () => { _streamsPage = 1; renderStreamsTable(); });
    const channelLogoSearch = $('#channelLogoSearchQuery');
    if (channelLogoSearch) channelLogoSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchChannelLogos(); } });

    // Categories tab switching (Channel | Movie | Series)
    document.querySelectorAll('[data-cat-type]').forEach(tab => {
      if (tab.dataset.catType === undefined) return;
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-cat-type]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadCategoriesPage(tab.dataset.catType);
      });
    });

    // Movies search & filter listeners
    ['moviesSearch', 'moviesCatFilter', 'moviesStatusFilter'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => debounceLoadMovies(el));
      el.addEventListener('change', () => debounceLoadMovies(el));
    });

    // Series search & filter listeners (no sort order anymore)
    ['seriesSearch', 'seriesCatFilter', 'seriesStatusFilter'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => debounceLoadSeries(el));
      el.addEventListener('change', () => debounceLoadSeries(el));
    });

    // Categories search listener
    const catSearchEl = $('#categoriesSearch');
    if (catSearchEl) {
      catSearchEl.addEventListener('input', () => {
        clearTimeout(catSearchEl._t);
        catSearchEl._t = setTimeout(() => {
          loadCategoriesPage(document.querySelector('[data-cat-type].active')?.dataset.catType || 'live');
        }, 300);
      });
    }

    const fpsRestartCb = $('#streamFpsRestart');
    if (fpsRestartCb) fpsRestartCb.addEventListener('change', updateFpsThresholdVisibility);
    const ict = $('#importContentType');
    if (ict) ict.addEventListener('change', syncImportContentTypeUI);

    // Image previews on blur
    ['moviePoster', 'movieBackdrop'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener('blur', () => updateImgPreview(id + 'Preview', el.value));
    });
    ['seriesCover', 'seriesBackdrop'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener('blur', () => updateImgPreview(id + 'Preview', el.value));
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tmdb-search-wrap')) {
        $$('.tmdb-dropdown').forEach(d => d.style.display = 'none');
      }
    });

    // Populate import category dropdowns
    const movieImportCat = $('#movieImportCat');
    if (movieImportCat) {
      const obs = new MutationObserver(() => {
        populateSelect('#movieImportCat', _movieCats, 'id', 'category_name', 'None');
        populateSelect('#seriesImportCat', _seriesCats, 'id', 'category_name', 'None');
      });
    }

    checkSession();
  }

  // ─── Transcode Profiles ──────────────────────────────────────────────

  async function loadTranscodeProfiles() {
    try {
      const rows = await api('/api/transcode-profiles');
      const tbody = document.querySelector('#transcodeProfilesTable tbody');
      if (!tbody) return;
      tbody.innerHTML = rows.map(p => {
        const rend = (() => { try { return JSON.parse(p.renditions || '[]').join(', '); } catch { return ''; } })();
        return `<tr>
          <td>${p.id}</td>
          <td>${escHtml(p.name)}</td>
          <td>${p.output_mode}</td>
          <td>${p.video_encoder || ''}</td>
          <td>${p.x264_preset || ''}</td>
          <td>${p.audio_bitrate_k || 128}</td>
          <td>${p.hls_segment_seconds || 4}s</td>
          <td>
            <button class="btn btn-sm" onclick="APP.openTranscodeProfileModal(${p.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="APP.deleteTranscodeProfile(${p.id})">Delete</button>
          </td>
        </tr>`;
      }).join('');
    } catch (err) { console.error('loadTranscodeProfiles', err); }
  }

  async function openTranscodeProfileModal(id) {
    const modal = $('#transcodeProfileModal');
    const title = $('#transcodeProfileModalTitle');
    if (!modal) return;
    $('#tpId').value = '';
    $('#tpName').value = '';
    $('#tpOutputMode').value = 'copy';
    $('#tpVideoEncoder').value = 'cpu_x264';
    $('#tpPreset').value = 'veryfast';
    $('#tpRenditionMode').value = 'single';
    $$('#tpRenditionsWrap input[type=checkbox]').forEach(cb => { cb.checked = cb.value === '1080p'; });
    $('#tpAudioBitrate').value = 128;
    $('#tpHlsSegment').value = 4;
    $('#tpHlsPlaylist').value = 10;
    if (id) {
      title.textContent = 'Edit Transcode Profile';
      try {
        const rows = await api('/api/transcode-profiles');
        const p = rows.find(r => r.id === id);
        if (p) {
          $('#tpId').value = p.id;
          $('#tpName').value = p.name || '';
          $('#tpOutputMode').value = p.output_mode || 'copy';
          $('#tpVideoEncoder').value = p.video_encoder || 'cpu_x264';
          $('#tpPreset').value = p.x264_preset || 'veryfast';
          $('#tpRenditionMode').value = p.rendition_mode || 'single';
          const rends = (() => { try { return JSON.parse(p.renditions || '[]'); } catch { return ['1080p']; } })();
          $$('#tpRenditionsWrap input[type=checkbox]').forEach(cb => { cb.checked = rends.includes(cb.value); });
          $('#tpAudioBitrate').value = p.audio_bitrate_k || 128;
          $('#tpHlsSegment').value = p.hls_segment_seconds || 4;
          $('#tpHlsPlaylist').value = p.hls_playlist_size || 10;
        }
      } catch (err) { console.error(err); }
    } else {
      title.textContent = 'Add Transcode Profile';
    }
    modal.style.display = 'flex';
  }

  function closeTranscodeProfileModal() {
    const modal = $('#transcodeProfileModal');
    if (modal) modal.style.display = 'none';
  }

  async function saveTranscodeProfile() {
    const id = $('#tpId').value;
    const renditions = [];
    $$('#tpRenditionsWrap input[type=checkbox]').forEach(cb => { if (cb.checked) renditions.push(cb.value); });
    if (renditions.length === 0) renditions.push('1080p');
    const data = {
      name: $('#tpName').value.trim(),
      output_mode: $('#tpOutputMode').value,
      video_encoder: $('#tpVideoEncoder').value,
      x264_preset: $('#tpPreset').value,
      rendition_mode: $('#tpRenditionMode').value,
      renditions,
      audio_bitrate_k: parseInt($('#tpAudioBitrate').value, 10) || 128,
      hls_segment_seconds: parseInt($('#tpHlsSegment').value, 10) || 4,
      hls_playlist_size: parseInt($('#tpHlsPlaylist').value, 10) || 10,
    };
    if (!data.name) return alert('Name is required');
    try {
      if (id) {
        await api(`/api/transcode-profiles/${id}`, 'PUT', data);
      } else {
        await api('/api/transcode-profiles', 'POST', data);
      }
      closeTranscodeProfileModal();
      loadTranscodeProfiles();
    } catch (err) { alert(err.message); }
  }

  async function deleteTranscodeProfile(id) {
    if (!confirm('Delete this transcode profile?')) return;
    try {
      await api(`/api/transcode-profiles/${id}`, 'DELETE');
      loadTranscodeProfiles();
    } catch (err) { alert(err.message); }
  }

  // ─── Playlist Download Modal ─────────────────────────────────────

  function openPlaylistModal(lineId, username, password) {
    const base = `${location.protocol}//${location.host}`;
    $('#plServerUrl').value = base;
    $('#plUsername').value = username || '';
    $('#plPassword').value = password || '';
    $('#plM3uUrl').value = `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`;
    $('#plEpgUrl').value = `${base}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    $('#plXtreamUrl').value = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    $('#playlistModal').style.display = 'flex';
  }

  function closePlaylistModal() {
    $('#playlistModal').style.display = 'none';
  }

  function copyPlaylistField(fieldId) {
    const el = $(`#${fieldId}`);
    if (!el) return;
    navigator.clipboard.writeText(el.value).then(() => toast('Copied!')).catch(() => toast('Copy failed', 'error'));
  }

  // ─── DRM Streams ───────────────────────────────────────────────────

  async function loadDrmTranscodeProfiles(selectedId) {
    const profileSel = $('#drmTranscodeProfile');
    if (!profileSel) return;
    try {
      const profiles = await api('/api/transcode-profiles');
      profileSel.innerHTML = '<option value="">None (copy mode)</option>' +
        (profiles || []).map(p => `<option value="${p.id}">${escHtml(p.name)} (${p.output_mode})</option>`).join('');
    } catch {
      profileSel.innerHTML = '<option value="">None (copy mode)</option>';
    }
    profileSel.value = selectedId ? String(selectedId) : '';
  }

  async function loadDrmStreams() {
    try {
      const rows = await api('/api/drm-restreams');
      const tbody = document.querySelector('#drmStreamsTable tbody');
      if (!tbody) return;
      const baseUrl = `${location.protocol}//${location.host}`;
      tbody.innerHTML = rows.map(d => {
        const statusClass = d.status === 'running' ? 'badge-success' : d.status === 'starting' ? 'badge-warning' : 'badge-secondary';
        const outUrl = d.output_url || `/drm/${d.id}/stream.ts`;
        const fullUrl = baseUrl + outUrl;
        return `<tr>
          <td><code>${escHtml(d.id)}</code></td>
          <td>${escHtml(d.name)}</td>
          <td><span class="badge ${statusClass}">${d.status || 'stopped'}</span></td>
          <td><code style="font-size:0.85em">${escHtml(fullUrl)}</code> <button class="btn btn-sm" onclick="APP.copyDrmOutputUrl('${escHtml(fullUrl)}')">Copy</button></td>
          <td>
            ${d.status === 'running' || d.status === 'starting'
              ? `<button class="btn btn-sm btn-warning" onclick="APP.stopDrmStream('${escHtml(d.id)}')">Stop</button>`
              : `<button class="btn btn-sm btn-success" onclick="APP.startDrmStream('${escHtml(d.id)}')">Start</button>`}
            <button class="btn btn-sm" onclick="APP.openDrmStreamModal('${escHtml(d.id)}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="APP.deleteDrmStream('${escHtml(d.id)}')">Delete</button>
          </td>
        </tr>`;
      }).join('');
    } catch (err) { console.error('loadDrmStreams', err); }
  }

  async function openDrmStreamModal(id) {
    const modal = $('#drmStreamModal');
    const title = $('#drmStreamModalTitle');
    if (!modal) return;
    await loadDrmTranscodeProfiles('');
    $('#drmId').value = '';
    $('#drmName').value = '';
    $('#drmMpdUrl').value = '';
    $('#drmKid').value = '';
    $('#drmKey').value = '';
    $('#drmUserAgent').value = '';
    $('#drmHeaders').value = '';
    if (id) {
      title.textContent = 'Edit DRM Stream';
      try {
        const rows = await api('/api/drm-restreams');
        const d = rows.find(r => r.id === id);
        if (d) {
          $('#drmId').value = d.id;
          $('#drmName').value = d.name || '';
          $('#drmMpdUrl').value = d.mpdUrl || '';
          $('#drmKid').value = d.kid || '';
          $('#drmKey').value = d.key || '';
          $('#drmUserAgent').value = d.userAgent || '';
          const headersVal = d.headers || '';
          $('#drmHeaders').value = typeof headersVal === 'string'
            ? headersVal
            : (headersVal && Object.keys(headersVal).length ? JSON.stringify(headersVal, null, 2) : '');
          if (d.transcode_profile_id) {
            $('#drmTranscodeProfile').value = String(d.transcode_profile_id);
          } else {
            $('#drmTranscodeProfile').value = '';
          }
        }
      } catch (err) { console.error(err); }
    } else {
      title.textContent = 'Add DRM Stream';
    }
    modal.style.display = 'flex';
  }

  function closeDrmStreamModal() {
    const modal = $('#drmStreamModal');
    if (modal) modal.style.display = 'none';
  }

  async function saveDrmStream() {
    const id = $('#drmId').value;
    const tpVal = $('#drmTranscodeProfile') ? $('#drmTranscodeProfile').value : '';
    const data = {
      name: $('#drmName').value.trim(),
      mpdUrl: $('#drmMpdUrl').value.trim(),
      kid: $('#drmKid').value.trim(),
      key: $('#drmKey').value.trim(),
      userAgent: $('#drmUserAgent').value.trim(),
      headers: $('#drmHeaders').value.trim(),
      transcode_profile_id: tpVal ? parseInt(tpVal, 10) : null,
    };
    if (!data.name) return alert('Name is required');
    if (!data.mpdUrl) return alert('MPD URL is required');
    if (!data.kid || !data.key) return alert('KID and Key are required');
    try {
      if (id) {
        await api(`/api/drm-restreams/${id}`, 'PUT', data);
      } else {
        await api('/api/drm-restreams', 'POST', data);
      }
      closeDrmStreamModal();
      loadDrmStreams();
    } catch (err) { alert(err.message); }
  }

  async function startDrmStream(id) {
    try {
      const res = await api(`/api/drm-restreams/${id}/start`, 'POST');
      if (res.output_url) {
        const full = `${location.protocol}//${location.host}${res.output_url}`;
        await navigator.clipboard.writeText(full).catch(() => {});
        alert('Stream started! Output URL copied:\n' + full);
      }
      loadDrmStreams();
    } catch (err) { alert(err.message); }
  }

  async function stopDrmStream(id) {
    try {
      await api(`/api/drm-restreams/${id}/stop`, 'POST');
      loadDrmStreams();
    } catch (err) { alert(err.message); }
  }

  async function deleteDrmStream(id) {
    if (!confirm('Delete this DRM stream?')) return;
    try {
      await api(`/api/drm-restreams/${id}`, 'DELETE');
      loadDrmStreams();
    } catch (err) { alert(err.message); }
  }

  async function parseDrmImport() {
    const rawText = $('#drmImportRawText')?.value || '';
    if (!rawText.trim()) return alert('Paste a DRM dump first.');
    try {
      const preview = await api('/api/drm-restreams/parse-preview', 'POST', { rawText });
      await openDrmStreamModal();
      $('#drmName').value = preview.name || '';
      $('#drmMpdUrl').value = preview.mpdUrl || '';
      $('#drmKid').value = preview.kid || '';
      $('#drmKey').value = preview.key || '';
      $('#drmUserAgent').value = preview.userAgent || '';
      const headersObj = preview.headers && typeof preview.headers === 'object' ? preview.headers : {};
      $('#drmHeaders').value = headersObj && Object.keys(headersObj).length ? JSON.stringify(headersObj, null, 2) : '';
      toast('Parsed DRM dump', 'success');
    } catch (err) { alert(err.message); }
  }

  function copyDrmOutputUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
      const toast = document.createElement('div');
      toast.textContent = 'URL copied!';
      toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4caf50;color:#fff;padding:10px 20px;border-radius:6px;z-index:99999;font-size:14px';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }).catch(() => alert('Failed to copy'));
  }

  // ─── Phase 06 Domain Wrappers ───────────────────────────────────

  function buildLinesModuleContext() {
    return {
      $, $$, escHtml, apiFetch, populateSelect, toast, formatDate,
      ensureResellersCache,
      getResellersCache: () => _resellersCache,
      getPackages: () => _packages,
      getLinesPage: () => _linesPage,
      setLinesPage: (v) => { _linesPage = v; },
      getLinesPerPage: () => _linesPerPage,
      setLinesPerPage: (v) => { _linesPerPage = v; },
      getLinesAutoRefreshTimer: () => _linesAutoRefreshTimer,
      setLinesAutoRefreshTimer: (v) => { _linesAutoRefreshTimer = v; },
      getResellerLabel,
      openLineForm,
      lineStatusLabel,
      parseTextareaList,
      parseDateInputValue,
      getLineStatsTargetId: () => _lineStatsTargetId,
      getLineExtendTarget: () => _lineExtendTarget,
      setLineExtendTarget: (v) => { _lineExtendTarget = v; },
    };
  }

  function buildStreamsModuleContext() {
    return {
      $, escHtml, toast, api, makeSortable,
      getCurrentPage: () => _currentPage,
      getCategories: () => _categories,
      getServersCache: () => _serversCache,
      getStreamsCache: () => _streamsCache,
      setStreamsCache: (v) => { _streamsCache = v; },
      getStreamsPage: () => _streamsPage,
      setStreamsPage: (v) => { _streamsPage = v; },
      getStreamsPerPage: () => _streamsPerPage,
      setStreamsPerPage: (v) => { _streamsPerPage = v; },
      setStreamsTotal: (v) => { _streamsTotal = v; },
      getStreamsAutoRefreshEnabled: () => _streamsAutoRefreshEnabled,
      setStreamsAutoRefreshEnabled: (v) => { _streamsAutoRefreshEnabled = !!v; },
      getStreamsAutoRefreshTimer: () => _streamsAutoRefreshTimer,
      setStreamsAutoRefreshTimer: (v) => { _streamsAutoRefreshTimer = v; },
      ensureServersCacheForPlaylist,
      loadRefData,
      fetchHealthData,
      getStreamServerName,
      getStreamSourceUrl,
      formatStreamFps,
      formatSourceHost,
      getChannelLogoTarget: () => _channelLogoTarget,
      setChannelLogoTarget: (v) => { _channelLogoTarget = v; },
      getChannelLogoSearchResults: () => _channelLogoSearchResults,
      setChannelLogoSearchResults: (v) => { _channelLogoSearchResults = v; },
      updateChannelLogoPreview,
    };
  }

  function buildResellerMembersContext() {
    return {
      $, escHtml, apiFetch, toast, navigateTo, loadRefData, statusBadge,
      formatUserDate, syncRegisteredUsersGroupControls, renderRegisteredUsersPagination,
      renderRegisteredUserPackageOverridesTable, getResellerMemberGroups,
      collectRegisteredUserPackageOverrides, updateRegisteredUserCreditsPreview,
      renderExpiryMediaScenarioRows, collectExpiryMediaRows,
      getCurrentPage: () => _currentPage,
      getRegisteredUsersPage: () => _registeredUsersPage,
      setRegisteredUsersPage: (v) => { _registeredUsersPage = v; },
      getRegisteredUsersPerPage: () => _registeredUsersPerPage,
      setRegisteredUsersPerPage: (v) => { _registeredUsersPerPage = v; },
      getRegisteredUsersEditingId: () => _registeredUsersEditingId,
      setRegisteredUsersEditingId: (v) => { _registeredUsersEditingId = v; },
      getRegisteredUsersCurrentRows: () => _registeredUsersCurrentRows,
      setRegisteredUsersCurrentRows: (v) => { _registeredUsersCurrentRows = v; },
      getRegisteredUserPackageOverrides: () => _registeredUserPackageOverrides,
      setRegisteredUserPackageOverrides: (v) => { _registeredUserPackageOverrides = v; },
      setRegisteredUserNotesTarget: (v) => { _registeredUserNotesTarget = v; },
      getRegisteredUserCreditsTarget: () => _registeredUserCreditsTarget,
      setRegisteredUserCreditsTarget: (v) => { _registeredUserCreditsTarget = v; },
      setMemberGroupsCurrentRows: (v) => { _memberGroupsCurrentRows = v; },
      getExpiryMediaEditingServiceId: () => _expiryMediaEditingServiceId,
      setExpiryMediaEditingServiceId: (v) => { _expiryMediaEditingServiceId = v; },
      setExpiryMediaCurrentRows: (v) => { _expiryMediaCurrentRows = v; },
    };
  }

  function buildServerAreaContext() {
    return {
      $, escHtml, apiFetch, toast, populateSelect,
      renderServersPage, renderServerOrderTable, getAdminFeatures,
      getAdminFeaturesCache: () => _adminFeatures,
      getServersCache: () => _serversCache,
      setServersCache: (v) => { _serversCache = v; },
      setServersSummaryCache: (v) => { _serversSummaryCache = v; },
      getServerOrder: () => _serverOrder,
      setServerOrder: (v) => { _serverOrder = v; },
    };
  }

  function buildSettingsModuleContext() {
    return {
      $, $$, apiFetch, apiFetchOptional, toast, checkForUpdates,
      SETTINGS_PARITY_DEFAULTS, SETTINGS_GENERAL_SECTIONS, SETTINGS_XTREAM_SECTIONS,
      SETTINGS_RESELLER_SECTIONS, SETTINGS_STREAMING_SECTIONS,
      renderSettingsSections, renderStreamingPerformanceBlock, renderDatabaseSettings,
      renderSettingsBackupsTable, renderAdvancedRawSettings, syncSettingsSummary,
      initSettingsChipEditors, loadStreamingPerformanceSettings, switchSettingsTab,
      loadTelegramSettings, saveTelegramSettings, getSettingValue, applyPanelBranding,
      setSettingsDataCache: (v) => { _settingsDataCache = v; },
    };
  }

  function buildSecurityModuleContext() {
    return { $, escHtml, apiFetch, apiFetchOptional, toast };
  }

  async function loadLines() {
    if (!linesModule) return;
    return linesModule.loadLines(buildLinesModuleContext());
  }

  function goLinesPage(p) {
    if (!linesModule) return;
    return linesModule.goLinesPage(buildLinesModuleContext(), p);
  }

  function resetLineFilters() {
    if (!linesModule) return;
    return linesModule.resetLineFilters(buildLinesModuleContext());
  }

  async function toggleBanLine(id, currentEnabled) {
    if (!linesModule) return;
    return linesModule.toggleBanLine(buildLinesModuleContext(), id, currentEnabled);
  }

  async function deleteLine(id) {
    if (!linesModule) return;
    return linesModule.deleteLine(buildLinesModuleContext(), id);
  }

  async function deleteExpiredLines() {
    if (!linesModule) return;
    return linesModule.deleteExpiredLines(buildLinesModuleContext());
  }

  function stopLinesAutoRefresh() {
    if (!linesModule) return;
    return linesModule.stopLinesAutoRefresh(buildLinesModuleContext());
  }

  function toggleLinesAutoRefresh() {
    if (!linesModule) return;
    return linesModule.toggleLinesAutoRefresh(buildLinesModuleContext());
  }

  function createTrialUser() {
    if (!linesModule) return;
    return linesModule.createTrialUser(buildLinesModuleContext());
  }

  function createPaidUser() {
    if (!linesModule) return;
    return linesModule.createPaidUser(buildLinesModuleContext());
  }

  async function toggleDisableLine(id, enabled) {
    if (!linesModule) return;
    return linesModule.toggleDisableLine(buildLinesModuleContext(), id, enabled);
  }

  async function killLineConnections(id) {
    if (!linesModule) return;
    return linesModule.killLineConnections(buildLinesModuleContext(), id);
  }

  function closeLineActionMenus() {
    if (!linesModule) return;
    return linesModule.closeLineActionMenus(buildLinesModuleContext());
  }

  function toggleLineInfoMenu(event, lineId) {
    if (!linesModule) return;
    return linesModule.toggleLineInfoMenu(buildLinesModuleContext(), event, lineId);
  }

  function toggleLineSettingsMenu(event, lineId) {
    if (!linesModule) return;
    return linesModule.toggleLineSettingsMenu(buildLinesModuleContext(), event, lineId);
  }

  async function loadLineStats(id = _lineStatsTargetId) {
    if (!linesModule) return;
    return linesModule.loadLineStats(buildLinesModuleContext(), id);
  }

  async function openLineRestrictions(id) {
    if (!linesModule) return;
    return linesModule.openLineRestrictions(buildLinesModuleContext(), id);
  }

  function closeLineRestrictionsModal() {
    if (!linesModule) return;
    return linesModule.closeLineRestrictionsModal(buildLinesModuleContext());
  }

  async function saveLineRestrictions() {
    if (!linesModule) return;
    return linesModule.saveLineRestrictions(buildLinesModuleContext());
  }

  async function openLineExtendModal(id) {
    if (!linesModule) return;
    return linesModule.openLineExtendModal(buildLinesModuleContext(), id);
  }

  function closeLineExtendModal() {
    if (!linesModule) return;
    return linesModule.closeLineExtendModal(buildLinesModuleContext());
  }

  async function saveLineExtension() {
    if (!linesModule) return;
    return linesModule.saveLineExtension(buildLinesModuleContext());
  }

  function toggleStreamsAutoRefresh() {
    if (!streamsModule) return;
    return streamsModule.toggleStreamsAutoRefresh(buildStreamsModuleContext());
  }

  async function loadStreams(options = {}) {
    if (!streamsModule) return;
    return streamsModule.loadStreams(buildStreamsModuleContext(), options);
  }

  function renderStreamsTable() {
    if (!streamsModule) return;
    return streamsModule.renderStreamsTable(buildStreamsModuleContext());
  }

  async function openChannelLogoModal(id) {
    if (!streamsModule) return;
    return streamsModule.openChannelLogoModal(buildStreamsModuleContext(), id);
  }

  function closeChannelLogoModal() {
    if (!streamsModule) return;
    return streamsModule.closeChannelLogoModal(buildStreamsModuleContext());
  }

  async function searchChannelLogos() {
    if (!streamsModule) return;
    return streamsModule.searchChannelLogos(buildStreamsModuleContext());
  }

  async function applyChannelLogoResult(url) {
    if (!streamsModule) return;
    return streamsModule.applyChannelLogoResult(buildStreamsModuleContext(), url);
  }

  async function saveChannelLogoFromCustomUrl() {
    if (!streamsModule) return;
    return streamsModule.saveChannelLogoFromCustomUrl(buildStreamsModuleContext());
  }

  async function loadRegisteredUsers() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadRegisteredUsers(buildResellerMembersContext());
  }

  async function loadRegisteredUserFormPage() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadRegisteredUserFormPage(buildResellerMembersContext());
  }

  async function loadResellers() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadResellers(buildResellerMembersContext());
  }

  function openRegisteredUserForm(id = null) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.openRegisteredUserForm(buildResellerMembersContext(), id);
  }

  async function saveRegisteredUser() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.saveRegisteredUser(buildResellerMembersContext());
  }

  async function openRegisteredUserNotes(id) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.openRegisteredUserNotes(buildResellerMembersContext(), id);
  }

  function closeRegisteredUserNotesModal() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.closeRegisteredUserNotesModal(buildResellerMembersContext());
  }

  async function saveRegisteredUserNotes() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.saveRegisteredUserNotes(buildResellerMembersContext());
  }

  async function openRegisteredUserCredits(id) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.openRegisteredUserCredits(buildResellerMembersContext(), id);
  }

  function closeRegisteredUserCreditsModal() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.closeRegisteredUserCreditsModal(buildResellerMembersContext());
  }

  async function saveRegisteredUserCredits() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.saveRegisteredUserCredits(buildResellerMembersContext());
  }

  async function toggleRegisteredUserStatus(id) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.toggleRegisteredUserStatus(buildResellerMembersContext(), id);
  }

  async function deleteRegisteredUser(id) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.deleteRegisteredUser(buildResellerMembersContext(), id);
  }

  async function loadMemberGroups() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadMemberGroups(buildResellerMembersContext());
  }

  async function loadExpiryMedia() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadExpiryMedia(buildResellerMembersContext());
  }

  async function loadExpiryMediaEditPage() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.loadExpiryMediaEditPage(buildResellerMembersContext());
  }

  async function saveExpiryMediaService() {
    if (!resellerMembersModule) return;
    return resellerMembersModule.saveExpiryMediaService(buildResellerMembersContext());
  }

  async function deleteExpiryMediaService(id, fromList = false) {
    if (!resellerMembersModule) return;
    return resellerMembersModule.deleteExpiryMediaService(buildResellerMembersContext(), id, fromList);
  }

  async function loadSettings() {
    if (!settingsModule) return;
    return settingsModule.loadSettings(buildSettingsModuleContext());
  }

  async function saveSettings() {
    if (!settingsModule) return;
    return settingsModule.saveSettings(buildSettingsModuleContext());
  }

  async function loadServers() {
    if (!serverAreaModule) return;
    return serverAreaModule.loadServers(buildServerAreaContext());
  }

  async function loadInstallLbPage() {
    if (!serverAreaModule) return;
    return serverAreaModule.loadInstallLbPage(buildServerAreaContext());
  }

  async function loadInstallProxyPage() {
    if (!serverAreaModule) return;
    return serverAreaModule.loadInstallProxyPage(buildServerAreaContext());
  }

  async function loadManageProxyPage() {
    if (!serverAreaModule) return;
    return serverAreaModule.loadManageProxyPage(buildServerAreaContext());
  }

  async function addProxyRelationship() {
    if (!serverAreaModule) return;
    return serverAreaModule.addProxyRelationship(buildServerAreaContext());
  }

  async function deleteProxyRelationship(parentId, childId) {
    if (!serverAreaModule) return;
    return serverAreaModule.deleteProxyRelationship(buildServerAreaContext(), parentId, childId);
  }

  async function loadServerOrderPage() {
    if (!serverAreaModule) return;
    return serverAreaModule.loadServerOrderPage(buildServerAreaContext());
  }

  function moveServerOrder(idx, dir) {
    if (!serverAreaModule) return;
    return serverAreaModule.moveServerOrder(buildServerAreaContext(), idx, dir);
  }

  async function saveServerOrder() {
    if (!serverAreaModule) return;
    return serverAreaModule.saveServerOrder(buildServerAreaContext());
  }

  async function loadSecurity() {
    if (!securityModule) return;
    return securityModule.loadSecurity(buildSecurityModuleContext());
  }

  function renderRbacTables(rbac) {
    if (!securityModule) return;
    return securityModule.renderRbacTables(buildSecurityModuleContext(), rbac);
  }

  async function addBlockedIp() { if (securityModule) return securityModule.addBlockedIp(buildSecurityModuleContext()); }
  async function addBlockedUa() { if (securityModule) return securityModule.addBlockedUa(buildSecurityModuleContext()); }
  async function removeBlockedIp(id) { if (securityModule) return securityModule.removeBlockedIp(buildSecurityModuleContext(), id); }
  async function removeBlockedUa(id) { if (securityModule) return securityModule.removeBlockedUa(buildSecurityModuleContext(), id); }

  APP.saveVpnSettings = async function () { if (securityModule) return securityModule.saveVpnSettings(buildSecurityModuleContext()); };
  APP.blockAsn = async function () { if (securityModule) return securityModule.blockAsn(buildSecurityModuleContext()); };
  APP.unblockAsn = async function (asn) { if (securityModule) return securityModule.unblockAsn(buildSecurityModuleContext(), asn); };
  APP.saveMultiloginSettings = async function () { if (securityModule) return securityModule.saveMultiloginSettings(buildSecurityModuleContext()); };
  APP.disconnectLine = async function (lineId) { if (securityModule) return securityModule.disconnectLine(buildSecurityModuleContext(), lineId); };
  APP.addRole = async function () { if (securityModule) return securityModule.addRole(buildSecurityModuleContext()); };
  APP.deleteRole = async function (id) { if (securityModule) return securityModule.deleteRole(buildSecurityModuleContext(), id); };
  APP.editRolePerms = async function (roleId) { if (securityModule) return securityModule.editRolePerms(buildSecurityModuleContext(), roleId); };
  APP.saveCurrentRolePerms = async function () {
    const saveButton = document.getElementById('saveRolePermsBtn');
    const roleId = parseInt(saveButton?.dataset.roleId || '0', 10);
    if (!roleId) return toast('Choose a role first', 'error');
    return APP.saveRolePerms(roleId);
  };
  APP.saveRolePerms = async function (roleId) { if (securityModule) return securityModule.saveRolePerms(buildSecurityModuleContext(), roleId); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose page state getters for use in inline onclick handlers
  Object.defineProperty(APP, '_streamsPage', { get: () => _streamsPage, set: (v) => { _streamsPage = v; }, configurable: true });
  Object.defineProperty(APP, '_moviesPage', { get: () => _moviesPage, set: (v) => { _moviesPage = v; }, configurable: true });
  Object.defineProperty(APP, '_seriesPage', { get: () => _seriesPage, set: (v) => { _seriesPage = v; }, configurable: true });
  Object.defineProperty(APP, '_streamsPerPage', { get: () => _streamsPerPage, set: (v) => { _streamsPerPage = v; }, configurable: true });
  Object.defineProperty(APP, '_moviesPerPage', { get: () => _moviesPerPage, set: (v) => { _moviesPerPage = v; }, configurable: true });
  Object.defineProperty(APP, '_seriesPerPage', { get: () => _seriesPerPage, set: (v) => { _seriesPerPage = v; }, configurable: true });

  Object.assign(APP, {
    navigateTo,
    loadMovies,
    loadSeriesList,
    loadStreams,
    loadMonitorTopChannelsPage,
    loadCategoriesPage,
    toggleStreamsAutoRefresh,
    openLineForm,
    editLine,
    saveLine,
    toggleBanLine,
    deleteLine,
    goLinesPage,
    resetLineFilters,
    deleteExpiredLines,
    toggleLinesAutoRefresh,
    createTrialUser,
    createPaidUser,
    toggleDisableLine,
    killLineConnections,
    toggleLineInfoMenu,
    toggleLineSettingsMenu,
    openLineStats,
    openLineRestrictions,
    closeLineRestrictionsModal,
    saveLineRestrictions,
    openLineExtendModal,
    closeLineExtendModal,
    saveLineExtension,
    addLineBouquets,
    removeLineBouquets,
    moveLineBouquet,
    applyLinePackageDefaults,
    resetLineBouquetsToPackage,
    downloadLinePlaylist,
    loadImportUsers,
    validateImportUsers,
    executeImportUsers,
    openMovieForm,
    closeMovieModal,
    movieTabNext,
    editMovie,
    saveMovie,
    deleteMovie,
    addMovieSourceRow,
    addSubtitleRow,
    addMovieCatTag,
    removeMovieCatTag,
    addMovieBqTag,
    removeMovieBqTag,
    addSeriesBqTag,
    removeSeriesBqTag,
    addStreamBqTag,
    removeStreamBqTag,
    addStreamSubCategoryTag,
    removeStreamSubCategoryTag,
    copyMovieUrl,
    parseMovieImport,
    confirmMovieImport,
    openSeriesForm,
    editSeries,
    saveSeries,
    deleteSeries,
    openEpisodeForm,
    closeEpisodeModal,
    editEpisode,
    saveEpisode,
    deleteEpisode,
    openStandaloneEpisodeForm,
    closeStandaloneEpisodeModal,
    saveStandaloneEpisode,
    editStandaloneEpisode,
    deleteStandaloneEpisode,
    goEpisodesPage,
    confirmSeriesImport,
    openStreamForm,
    closeStreamModal,
    editStream,
    saveStream,
    startStream,
    stopStream,
    restartStream,
    deleteStream,
    viewStreamLogs,
    addSourceRow,
    removeSourceRow,
    scanAllSources,
    probeSingleChannelSource,
    promoteChannelSource,
    demoteChannelSource,
    insertChannelSourceAfter,
    removeChannelSource,
    addChannelCustomMapEntry,
    switchChannelFormTab,
    nextChannelFormTab,
    prevChannelFormTab,
    playEditingStream,
    openEditingStreamLogoPicker,
    previewStreamLogo,
    openChannelLogoModal,
    closeChannelLogoModal,
    searchChannelLogos,
    applyChannelLogoResult,
    saveChannelLogoFromCustomUrl,
    openStreamPlayer,
    closeStreamPlayer,
    confirmStreamImport,
    openCategoryModal,
    editCategory,
    closeCategoryModal,
    saveCategory,
    deleteCategory,
    openBouquetModal,
    editBouquet,
    closeBouquetModal,
    saveBouquet,
    deleteBouquet,
    openPackageModal,
    editPackage,
    closePackageModal,
    savePackage,
    deletePackage,
    pkgWizardPrev,
    pkgWizardNext,
    togglePackageGroups,
    togglePackageBouquets,
    loadRegisteredUsers,
    goRegisteredUsersPage,
    openRegisteredUserForm,
    editRegisteredUser,
    saveRegisteredUser,
    openRegisteredUserNotes,
    closeRegisteredUserNotesModal,
    saveRegisteredUserNotes,
    openRegisteredUserCredits,
    closeRegisteredUserCreditsModal,
    saveRegisteredUserCredits,
    toggleRegisteredUserStatus,
    deleteRegisteredUser,
    resetRegisteredUserPackageOverrides,
    loadMemberGroups,
    openMemberGroupForm,
    saveMemberGroup,
    deleteMemberGroup,
    loadExpiryMedia,
    openExpiryMediaAddModal,
    closeExpiryMediaAddModal,
    createExpiryMediaService,
    editExpiryMediaService,
    addExpiryMediaRow,
    removeExpiryMediaRow,
    saveExpiryMediaService,
    deleteExpiryMediaService,
    openResellerModal,
    closeResellerModal,
    saveReseller,
    editResellerCredits,
    openUserModal,
    closeUserModal,
    saveUser,
    deleteUser,
    openEpgModal,
    closeEpgModal,
    saveEpg,
    deleteEpg,
    refreshEpg,
    saveSettings,
    switchSettingsTab,
    navigateTo,
    loadServers,
    openServerModal,
    closeServerModal,
    switchServerModalTab,
    navigateServerModalTab,
    openInstallModal,
    loadInstallLbPage,
    loadInstallProxyPage,
    submitInstallLbPage,
    submitInstallProxyPage,
    saveServer,
    deleteServer,
    exportNginxUpstream,
    startServerProvision,
    changeServersPerPage,
    changeServersPage,
    filterServersTable,
    findLowestLatencyServer,
    toggleServerFaqs,
    showServerFaq,
    toggleServerActionMenu,
    openServerAdvancedModal,
    closeServerAdvancedModal,
    serverActionIpChange,
    serverActionStartAllStreams,
    serverActionStopAllStreams,
    serverActionKillConnections,
    serverActionEdit,
    serverActionMonitor,
    serverRestartServices,
    serverReboot,
    serverOptimizePhp,
    serverUpdateFfmpeg,
    focusTagInput,
    addTag,
    removeTag,
    renderSSLDomainsTable,
    installSSL,
    addIspName,
    clearIspNameEntry,
    openIspEditor,
    loadManageProxyPage,
    addProxyRelationship,
    deleteProxyRelationship,
    loadServerOrderPage,
    moveServerOrder,
    saveServerOrder,
    loadServerMonitorPage,
    refreshServerMonitor,
    selectServerMonitor,
    toggleServerMonitorAutoRefresh,
    serverMonitorAction,
    loadBandwidthMonitorPage,
    setBwPeriod2,
    loadLiveConnections,
    loadLiveConnectionsMap,
    loadStreamingPerformanceSettings,
    saveStreamingPerformance,
    applyStreamingPreset,
    addBlockedIp,
    addBlockedUa,
    removeBlockedIp,
    removeBlockedUa,
    openTranscodeProfileModal,
    closeTranscodeProfileModal,
    saveTranscodeProfile,
    deleteTranscodeProfile,
    openPlexModal,
    closePlexModal,
    openPlaylistModal,
    closePlaylistModal,
    copyPlaylistField,
    openDrmStreamModal,
    parseDrmImport,
    closeDrmStreamModal,
    saveDrmStream,
    startDrmStream,
    stopDrmStream,
    deleteDrmStream,
    copyDrmOutputUrl,
    loadProviders,
    openProviderModal,
    closeProviderModal,
    saveProvider,
    deleteProvider,
    validateProviderForm,
    validateSavedProvider,
    loadImportContentPage,
    fetchImportCategories,
    toggleImportCatsAll,
    startContentImport,
    cancelContentImport,
    loadAccessCodes,
    openAccessCodeModal,
    closeAccessCodeModal,
    saveAccessCode,
    deleteAccessCode,
    loadDbManager,
    runDbOptimize,
    runDbRepair,
    toast,
  });

  // APP already exposed via window.APP at top
})();
