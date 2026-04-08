// NovaStreams Panel - Vite Admin SPA Entry Point

import { initRouter, navigateTo, registerPage } from './core/router.js';
import { authEvents, apiFetch, apiFetchOptional } from './core/api.js';
import {
  store,
  API_BASE,
  SIDEBAR_DESKTOP_STATE_KEY,
  pages,
  getCurrentPage,
} from './core/state.js';
import { $, $$, escHtml, formatDate } from './core/utils.js';
import { connectDashboardWS } from './core/websocket.js';
import { timerManager } from './core/timer-manager.js';
import {
  toast,
  showConfirm,
  toggleSidebar,
  makeSortable,
  populateSelect,
  statusBadge,
  applySidebarLayoutState,
} from './core/ui-common.js';

export { navigateTo, registerPage } from './core/router.js';
export { authEvents, apiFetch, apiFetchOptional } from './core/api.js';
export { store, API_BASE, SIDEBAR_DESKTOP_STATE_KEY } from './core/state.js';
export { $, $$, escHtml, formatDate } from './core/utils.js';
export {
  toast,
  showConfirm,
  toggleSidebar,
  makeSortable,
  populateSelect,
  statusBadge,
} from './core/ui-common.js';
export { timerManager } from './core/timer-manager.js';

const appHandlers = {};
window.APP = new Proxy(appHandlers, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== 'string') return undefined;
    return (..._args) =>
      toast(`Action ${prop} is not implemented yet`, 'warning');
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
});

registerPage('dashboard', () => import('./pages/dashboard.js'));
registerPage('lines', () => import('./pages/lines.js'));
registerPage('add-user', () => import('./pages/line-form.js'));
registerPage('line-form', () => import('./pages/line-form.js'));
registerPage('import-users', () => import('./pages/import-users.js'));
registerPage('movies', () => import('./pages/movies.js'));
registerPage('movie-import', () => import('./pages/movies.js'));
registerPage('series', () => import('./pages/series.js'));
registerPage('series-form', () => import('./pages/series.js'));
registerPage('series-import', () => import('./pages/series.js'));
registerPage('episodes', () => import('./pages/episodes.js'));
registerPage('streams', () => import('./pages/streams.js'));
registerPage('manage-channels', () => import('./pages/streams.js'));
registerPage('registered-users', () => import('./pages/registered-users.js'));
registerPage('member-groups', () => import('./pages/member-groups.js'));
registerPage('member-group-form', () => import('./pages/member-groups.js'));
registerPage('expiry-media', () => import('./pages/expiry-media.js'));
registerPage('categories', () => import('./pages/categories.js'));
registerPage('bouquets', () => import('./pages/bouquets.js'));
registerPage('packages', () => import('./pages/packages.js'));
registerPage('settings', () => import('./pages/settings.js'));
registerPage('servers', () => import('./pages/servers.js'));
registerPage('security', () => import('./pages/security.js'));
registerPage('monitor', () => import('./pages/monitor.js'));
registerPage('drm-streams', () => import('./pages/drm-streams.js'));
registerPage(
  'transcode-profiles',
  () => import('./pages/transcode-profiles.js')
);
registerPage('epg', () => import('./pages/epg.js'));
registerPage('users', () => import('./pages/users.js'));
registerPage('access-codes', () => import('./pages/access-codes.js'));
registerPage('db-manager', () => import('./pages/db-manager.js'));
registerPage('logs', () => import('./pages/logs.js'));
registerPage('sharing', () => import('./pages/sharing.js'));
registerPage('backups', () => import('./pages/backups.js'));
registerPage('plex', () => import('./pages/plex.js'));
registerPage('providers', () => import('./pages/providers.js'));
registerPage('import-content', () => import('./pages/import-content.js'));
registerPage('add-channels', () => import('./pages/add-channels.js'));
registerPage('stream-import', () => import('./pages/stream-import.js'));
registerPage('stream-import-tools', () => import('./pages/stream-import.js'));

function normalizeCollection(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

async function loadReferenceData(force = false) {
  if (!force && store.referenceDataLoaded) return;
  const [categories, bouquets, packagesData, userGroups, servers] =
    await Promise.all([
      apiFetch('/categories'),
      apiFetch('/bouquets'),
      apiFetch('/packages'),
      apiFetch('/user-groups'),
      apiFetch('/servers').catch(() => ({ servers: [] })),
    ]);
  store.categories = normalizeCollection(categories, 'categories');
  store.bouquets = normalizeCollection(bouquets, 'bouquets');
  store.packages = normalizeCollection(packagesData, 'packages');
  store.userGroups = normalizeCollection(userGroups, 'groups');
  store.serversCache = normalizeCollection(servers, 'servers');
  store.referenceDataLoaded = true;
}

async function ensureResellersCache(force = false) {
  if (
    !force &&
    Array.isArray(store.resellersCache) &&
    store.resellersCache.length
  )
    return store.resellersCache;
  const data = await apiFetch('/resellers');
  store.resellersCache = data.resellers || [];
  return store.resellersCache;
}

async function ensureServersCacheForPlaylist(force = false) {
  if (!force && Array.isArray(store.serversCache) && store.serversCache.length)
    return store.serversCache;
  const data = await apiFetch('/servers');
  store.serversCache = data.servers || [];
  return store.serversCache;
}

async function getAdminFeatures() {
  if (store.adminFeatures) return store.adminFeatures;
  store.adminFeatures = await apiFetch('/features').catch(() => ({}));
  return store.adminFeatures;
}

function getPageState(key, fallback = {}) {
  if (!pages[key]) pages[key] = { ...fallback };
  return pages[key];
}

function getStreamSourceUrl(channel) {
  return (
    (Array.isArray(channel?.sourceQueue) &&
      channel.sourceQueue[Number(channel.sourceIndex) || 0]) ||
    channel?.mpdUrl ||
    channel?.url ||
    channel?.source_url ||
    ''
  );
}

function getStreamServerName(channel) {
  const serverId = String(channel?.stream_server_id || channel?.server_id || 0);
  if (serverId === '0') return 'Default';
  return (
    (store.serversCache || []).find((server) => String(server.id) === serverId)
      ?.name || `Server ${serverId}`
  );
}

function populateSettingsPage(data) {
  const page = document.getElementById('page-settings');
  if (!page || !data || typeof data !== 'object') return;
  Object.entries(data).forEach(([key, value]) => {
    const el = page.querySelector(`[name="${key}"], #${key}`);
    if (!el) return;
    if (el.type === 'checkbox')
      el.checked = Number(value) === 1 || value === true || value === '1';
    else el.value = value == null ? '' : String(value);
  });
}

function collectSettingsPayload() {
  const page = document.getElementById('page-settings');
  const payload = {};
  if (!page) return payload;
  page
    .querySelectorAll('input[name], select[name], textarea[name]')
    .forEach((el) => {
      payload[el.name] =
        el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
    });
  return payload;
}

function renderServersPage() {
  const tbody = document.querySelector('#serversTable tbody');
  if (!tbody) return;
  const servers = store.serversCache || [];
  tbody.innerHTML =
    servers
      .map(
        (server) => `
    <tr>
      <td>${escHtml(String(server.id || ''))}</td>
      <td>${escHtml(server.name || '')}</td>
      <td>${escHtml(server.public_host || server.server_ip || '')}</td>
      <td>${escHtml(server.status || 'unknown')}</td>
      <td>${Number(server.running_streams || 0)}</td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No servers found</td></tr>';
}

const ctx = {
  $,
  $$,
  escHtml,
  formatDate,
  toast,
  showConfirm,
  toggleSidebar,
  makeSortable,
  populateSelect,
  statusBadge,
  apiFetch,
  navigateTo,
  loadRefData: loadReferenceData,
  ensureResellersCache,
  ensureServersCacheForPlaylist,
  getCurrentPage,
  getCategories: () => store.categories || [],
  getBouquets: () => store.bouquets || [],
  getPackages: () => store.packages || [],
  getUserGroups: () => store.userGroups || [],
  getServersCache: () => store.serversCache || [],
  setServersCache: (value) => {
    store.serversCache = value || [];
  },
  setServersSummaryCache: (value) => {
    store.serversSummaryCache = value || [];
  },
  getServersSummaryCache: () => store.serversSummaryCache || [],
  getResellersCache: () => store.resellersCache || [],
  setResellersCache: (value) => {
    store.resellersCache = value || [];
  },
  getResellerLabel: (memberId) =>
    Number(memberId || 0) === 0
      ? 'Admin'
      : (store.resellersCache || []).find(
          (row) => Number(row.id) === Number(memberId)
        )?.username || `Reseller ${memberId}`,
  getLinesPage: () => getPageState('lines', { page: 1, perPage: 50 }).page,
  setLinesPage: (value) => {
    getPageState('lines', { page: 1, perPage: 50 }).page = Math.max(
      1,
      Number(value) || 1
    );
  },
  getLinesPerPage: () =>
    getPageState('lines', { page: 1, perPage: 50 }).perPage,
  setLinesPerPage: (value) => {
    getPageState('lines', { page: 1, perPage: 50 }).perPage = Math.max(
      1,
      Number(value) || 50
    );
  },
  getLinesAutoRefreshEnabled: () =>
    !!getPageState('lines', { autoRefreshEnabled: false }).autoRefreshEnabled,
  setLinesAutoRefreshEnabled: (value) => {
    getPageState('lines', {}).autoRefreshEnabled = !!value;
  },
  getLinesAutoRefreshTimer: () => getPageState('lines', {}).autoRefreshTimer,
  setLinesAutoRefreshTimer: (value) => {
    getPageState('lines', {}).autoRefreshTimer = value;
  },
  getStreamsPage: () => getPageState('streams', { page: 1, perPage: 25 }).page,
  setStreamsPage: (value) => {
    getPageState('streams', { page: 1, perPage: 25 }).page = Math.max(
      1,
      Number(value) || 1
    );
  },
  getStreamsPerPage: () =>
    getPageState('streams', { page: 1, perPage: 25 }).perPage,
  setStreamsPerPage: (value) => {
    getPageState('streams', { page: 1, perPage: 25 }).perPage = Math.max(
      1,
      Number(value) || 25
    );
  },
  getStreamsCache: () => store.streamsCache || [],
  setStreamsCache: (value) => {
    store.streamsCache = value || [];
  },
  setStreamsTotal: (value) => {
    getPageState('streams', {}).total = Number(value) || 0;
  },
  getStreamsAutoRefreshEnabled: () =>
    !!getPageState('streams', { autoRefreshEnabled: false }).autoRefreshEnabled,
  setStreamsAutoRefreshEnabled: (value) => {
    getPageState('streams', {}).autoRefreshEnabled = !!value;
  },
  getStreamsAutoRefreshTimer: () =>
    getPageState('streams', {}).autoRefreshTimer,
  setStreamsAutoRefreshTimer: (value) => {
    getPageState('streams', {}).autoRefreshTimer = value;
  },
  getStreamSourceUrl,
  getStreamServerName,
  fetchHealthData: async () => apiFetch('/health').catch(() => null),
  getMoviesCache: () => store.moviesCache || [],
  setMoviesCache: (value) => {
    store.moviesCache = value || [];
  },
  getMoviesPage: () => getPageState('movies', { page: 1, perPage: 50 }).page,
  setMoviesPage: (value) => {
    getPageState('movies', { page: 1, perPage: 50 }).page = Math.max(
      1,
      Number(value) || 1
    );
  },
  getMoviesPerPage: () => getPageState('movies', { perPage: 50 }).perPage,
  setMoviesPerPage: (value) => {
    getPageState('movies', {}).perPage = Math.max(1, Number(value) || 50);
  },
  setMoviesTotal: (value) => {
    getPageState('movies', {}).total = Number(value) || 0;
  },
  renderMoviesTable: async (context) =>
    (await import('./pages/movies.js')).renderMoviesTable(context),
  renderMoviesPagination: async (context, total) =>
    (await import('./pages/movies.js')).renderMoviesPagination(context, total),
  getRegisteredUsersPage: () =>
    getPageState('registeredUsers', { page: 1, perPage: 25 }).page,
  setRegisteredUsersPage: (value) => {
    getPageState('registeredUsers', { page: 1, perPage: 25 }).page = Math.max(
      1,
      Number(value) || 1
    );
  },
  getRegisteredUsersPerPage: () =>
    getPageState('registeredUsers', { perPage: 25 }).perPage,
  setRegisteredUsersPerPage: (value) => {
    getPageState('registeredUsers', {}).perPage = Math.max(
      1,
      Number(value) || 25
    );
  },
  getRegisteredUsersEditingId: () =>
    getPageState('registeredUsers', {}).editingId,
  setRegisteredUsersEditingId: (value) => {
    getPageState('registeredUsers', {}).editingId = value;
  },
  getRegisteredUsersCurrentRows: () => store.registeredUsersCurrentRows || [],
  setRegisteredUsersCurrentRows: (value) => {
    store.registeredUsersCurrentRows = value || [];
  },
  setRegisteredUserPackageOverrides: (value) => {
    store.registeredUserPackageOverrides = value || [];
  },
  getRegisteredUserPackageOverrides: () =>
    store.registeredUserPackageOverrides || [],
  setRegisteredUserNotesTarget: (value) => {
    store.registeredUserNotesTarget = value || null;
  },
  getRegisteredUserNotesTarget: () => store.registeredUserNotesTarget || null,
  setRegisteredUserCreditsTarget: (value) => {
    store.registeredUserCreditsTarget = value || null;
  },
  getRegisteredUserCreditsTarget: () =>
    store.registeredUserCreditsTarget || null,
  getUsersCache: () => store.usersCache || [],
  setUsersCache: (value) => {
    store.usersCache = value || [];
  },
  getPendingStreamBouquets: () => store.pendingStreamBouquets || [],
  setPendingStreamBouquets: (value) => {
    store.pendingStreamBouquets = value || [];
  },
  getMemberGroupsCurrentRows: () => store.memberGroupsCurrentRows || [],
  setMemberGroupsCurrentRows: (value) => {
    store.memberGroupsCurrentRows = value || [];
  },
  getMemberGroupsEditingId: () => store.memberGroupsEditingId || null,
  setMemberGroupsEditingId: (value) => {
    store.memberGroupsEditingId = value || null;
  },
  getImportUsersSelectedBouquets: () => store.importUsersSelectedBouquets || [],
  setImportUsersSelectedBouquets: (value) => {
    store.importUsersSelectedBouquets = value || [];
  },
  createDashboardState: () => ({
    stats: {},
    health: null,
    servers: [],
    serverCards: [],
    liveSummary: {
      total: 0,
      by_type: { live: 0, movie: 0, episode: 0 },
      countries: [],
      top_streams: [],
      servers: [],
    },
  }),
  getDashboardState: () => store.dashboardState || null,
  setDashboardState: (value) => {
    store.dashboardState = value;
  },
  getDashActivityChart: () => store.dashActivityChart || null,
  setDashActivityChart: (value) => {
    store.dashActivityChart = value || null;
  },
  getPendingStreamStartId: () => store.pendingStreamStartId || null,
  setPendingStreamStartId: (value) => {
    store.pendingStreamStartId = value;
  },
  markPendingStreamReady: () => {
    store.pendingStreamStartId = null;
  },
  updateDashboardFromWS: (payload) =>
    import('./pages/dashboard.js').then((mod) =>
      mod.updateDashboardFromWS(ctx, payload)
    ),
  handleWSEvent: (payload) =>
    import('./pages/dashboard.js').then((mod) =>
      mod.handleWSEvent(ctx, payload)
    ),
  setSettingsDataCache: (value) => {
    store.settingsDataCache = value || {};
  },
  getSettingsDataCache: () => store.settingsDataCache || {},
  populateSettingsPage,
  renderServersPage,
  getAdminFeatures,
  getAdminFeaturesCache: () => store.adminFeatures || null,
  setProvidersCache: (value) => {
    store.providersCache = value || [];
  },
  getProvidersCache: () => store.providersCache || [],
  getSeriesCache: () => store.seriesCache || [],
  setSeriesCache: (value) => {
    store.seriesCache = value || [];
  },
  getSeriesPage: () => getPageState('series', { page: 1, perPage: 50 }).page,
  setSeriesPage: (value) => {
    getPageState('series', { page: 1, perPage: 50 }).page = Math.max(
      1,
      Number(value) || 1
    );
  },
  getSeriesPerPage: () => getPageState('series', { perPage: 50 }).perPage,
  setSeriesPerPage: (value) => {
    getPageState('series', {}).perPage = Math.max(1, Number(value) || 50);
  },
  setSeriesTotal: (value) => {
    getPageState('series', {}).total = Number(value) || 0;
  },
  renderSeriesTable: async (context) =>
    (await import('./pages/series.js')).renderSeriesTable(context),
  renderSeriesPagination: async (context, total) =>
    (await import('./pages/series.js')).renderSeriesPagination(context, total),
  getAllEpisodes: () => store.allEpisodes || [],
  setAllEpisodes: (value) => {
    store.allEpisodes = value || [];
  },
  getAllEpisodesPage: () => getPageState('episodes', { page: 0 }).page,
  setAllEpisodesPage: (value) => {
    getPageState('episodes', { page: 0 }).page = Math.max(
      0,
      Number(value) || 0
    );
  },
  renderEpisodesTable: async (context) =>
    (await import('./pages/episodes.js')).renderEpisodesTable(context),
  renderProvidersTable: async (context) =>
    (await import('./pages/providers.js')).renderProvidersTable(context),
  setServerOrder: (value) => {
    store.serverOrder = value || [];
  },
  getServerOrder: () => store.serverOrder || [],
  renderServerOrderTable: () => {},
  apiFetchOptional,
  // generic caches
  getAccessCodesCache: () => store.accessCodesCache || [],
  setAccessCodesCache: (value) => {
    store.accessCodesCache = value || [];
  },
  renderAccessCodesTable: async (context) =>
    (await import('./pages/access-codes.js')).renderAccessCodesTable(context),
  getBackupsCache: () => store.backupsCache || [],
  setBackupsCache: (value) => {
    store.backupsCache = value || [];
  },
  renderBackupsTable: async (context) =>
    (await import('./pages/backups.js')).renderBackupsTable(context),
  getBwHistoryChart: () => store.bwHistoryChart || null,
  setBwHistoryChart: (value) => {
    store.bwHistoryChart = value || null;
  },
  getBwPeriod: () => store.bwPeriod || '24h',
  getDrmStreamsCache: () => store.drmStreamsCache || [],
  setDrmStreamsCache: (value) => {
    store.drmStreamsCache = value || [];
  },
  renderDrmStreamsTable: async (context) =>
    (await import('./pages/drm-streams.js')).renderDrmStreamsTable(context),
  getEpgCache: () => store.epgCache || [],
  setEpgCache: (value) => {
    store.epgCache = value || [];
  },
  renderEpgTable: async (context) =>
    (await import('./pages/epg.js')).renderEpgTable(context),
  getExpiryMediaEditingServiceId: () =>
    store.expiryMediaEditingServiceId || null,
  setExpiryMediaEditingServiceId: (value) => {
    store.expiryMediaEditingServiceId = value || null;
  },
  setExpiryMediaCurrentRows: (value) => {
    store.expiryMediaCurrentRows = value || [];
  },
  getLogsCache: () => store.logsCache || [],
  setLogsCache: (value) => {
    store.logsCache = value || [];
  },
  renderLogsTable: async (context) =>
    (await import('./pages/logs.js')).renderLogsTable(context),
  getPlexServersCache: () => store.plexServersCache || [],
  setPlexServersCache: (value) => {
    store.plexServersCache = value || [];
  },
  renderPlexServersTable: async (context) =>
    (await import('./pages/plex.js')).renderPlexServersTable(context),
  getSharingDetections: () => store.sharingDetections || [],
  setSharingDetections: (value) => {
    store.sharingDetections = value || [];
  },
  renderSharingTable: async (context) =>
    (await import('./pages/sharing.js')).renderSharingTable(context),
  getTopChannelsMonitorTimer: () => store.topChannelsMonitorTimer || null,
  setTopChannelsMonitorTimer: (value) => {
    store.topChannelsMonitorTimer = value || null;
  },
  getTranscodeProfilesCache: () => store.transcodeProfilesCache || [],
  setTranscodeProfilesCache: (value) => {
    store.transcodeProfilesCache = value || [];
  },
  renderTranscodeProfilesTable: async (context) =>
    (
      await import('./pages/transcode-profiles.js')
    ).renderTranscodeProfilesTable(context),
  populateDbManagerInfo: (data) => {
    const el = document.getElementById('dbManagerInfo');
    if (el) el.textContent = JSON.stringify(data || {}, null, 2);
  },
};

window.APP_CTX = ctx;

function bindApp(name, handler) {
  window.APP[name] = handler;
}

function parseDelegatedArgs(raw, event, element) {
  if (!raw) return [];
  try {
    return Function(
      'event',
      'element',
      `return [${String(raw)
        .replace(/\bthis\.value\b/g, 'element.value')
        .replace(/\bthis\b/g, 'element')
        .replace(/\bevent\b/g, 'event')}];`
    )(event, element);
  } catch (error) {
    console.warn('[APP] Failed to parse delegated args', { raw, error });
    return [];
  }
}

function invokeDelegatedAppAction(actionName, event, element) {
  const handler = actionName && window.APP[actionName];
  if (typeof handler !== 'function') return false;
  const args = parseDelegatedArgs(
    element?.dataset?.appArgs || '',
    event,
    element
  );
  handler(...args);
  return true;
}

function bindCoreAppActions() {
  bindApp('clickSelector', (selector) => {
    document.querySelector(selector)?.click();
  });
  bindApp('hideElement', (selector) => {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'none';
  });
  bindApp('removeClosest', (selector, element) => {
    element?.closest(selector)?.remove();
  });
  bindApp('removeParent', (element) => {
    element?.parentElement?.remove();
  });
  bindApp('goLinesPage', async (page) => {
    ctx.setLinesPage(page);
    const mod = await import('./pages/lines.js');
    return mod.loadLines(ctx, { silent: true });
  });
  bindApp('_streamsGoPage', async (page) => {
    ctx.setStreamsPage(page);
    const mod = await import('./pages/streams.js');
    return mod.renderStreamsTable(ctx);
  });
  bindApp('resetLineFilters', async () => {
    const mod = await import('./pages/lines.js');
    return mod.resetLineFilters();
  });
  bindApp('toggleLinesAutoRefresh', async () => {
    const mod = await import('./pages/lines.js');
    return mod.toggleLinesAutoRefresh(ctx);
  });
  bindApp('createTrialUser', () =>
    navigateTo('add-user', { ctx, trial: true })
  );
  bindApp('createPaidUser', () => navigateTo('add-user', { ctx }));
  bindApp('openLineForm', (id) => {
    if (id) toast('Line editing form is not fully migrated yet', 'warning');
    return navigateTo('add-user', { ctx, id });
  });
  bindApp('toggleBanLine', async (id) => {
    const line = await apiFetch(`/lines/${id}`);
    const action = Number(line.admin_enabled) === 0 ? 'unban' : 'ban';
    await apiFetch(`/lines/${id}/${action}`, { method: 'POST' });
    toast(action === 'ban' ? 'Line banned' : 'Line unbanned');
    return (await import('./pages/lines.js')).loadLines(ctx, { silent: true });
  });
  bindApp('deleteLine', async (id) => {
    if (!(await showConfirm('Delete this line?'))) return;
    await apiFetch(`/lines/${id}`, { method: 'DELETE' });
    toast('Line deleted');
    return (await import('./pages/lines.js')).loadLines(ctx, { silent: true });
  });
  bindApp('deleteExpiredLines', async () => {
    await apiFetch('/lines/expired/delete', { method: 'POST' });
    toast('Expired users deleted');
    return (await import('./pages/lines.js')).loadLines(ctx, { silent: true });
  });
  bindApp('openLineStats', async (id) => {
    const data = await apiFetch(`/lines/${id}/connections`).catch(() => ({
      connections: [],
    }));
    toast(`Active connections: ${data.connections?.length || 0}`, 'info');
  });
  bindApp('startStream', async (id) => {
    ctx.setPendingStreamStartId(id);
    await apiFetch(`/channels/${id}/start`, { method: 'POST' });
    toast('Stream start requested');
    return (await import('./pages/streams.js')).loadStreams(ctx, {
      silent: true,
    });
  });
  bindApp('stopStream', async (id) => {
    await apiFetch(`/channels/${id}/stop`, { method: 'POST' });
    toast('Stream stopped');
    return (await import('./pages/streams.js')).loadStreams(ctx, {
      silent: true,
    });
  });
  bindApp('restartStream', async (id) => {
    await apiFetch(`/channels/${id}/restart`, { method: 'POST' });
    toast('Stream restarted');
    return (await import('./pages/streams.js')).loadStreams(ctx, {
      silent: true,
    });
  });
  bindApp('deleteStream', async (id) => {
    if (!(await showConfirm('Delete this stream?'))) return;
    await apiFetch(`/channels/${id}`, { method: 'DELETE' });
    toast('Stream deleted');
    return (await import('./pages/streams.js')).loadStreams(ctx, {
      silent: true,
    });
  });
  bindApp('editStream', (id) => {
    toast('Stream editor is not fully migrated yet', 'warning');
    return navigateTo('add-channels', { ctx, id });
  });
  bindApp('openStreamPlayer', async (id, name) => {
    const data = await apiFetch(`/channels/${id}/playback-url`).catch(
      () => null
    );
    if (data?.url) window.open(data.url, '_blank', 'noopener');
    else toast(`Playback URL unavailable for ${name || id}`, 'warning');
  });
  const refreshBackupRelatedViews = async () => {
    const page = ctx.getCurrentPage();
    if (page === 'settings')
      return (await import('./pages/settings.js')).loadSettings(ctx);
    if (page === 'backups')
      return (await import('./pages/backups.js')).loadBackupsPage(ctx);
  };

  const resolveBackupFilename = async (id, filename) => {
    if (filename) return String(filename);
    const data = await apiFetch('/backups').catch(() => ({ backups: [] }));
    const row = (data.backups || []).find(
      (backup) => Number(backup.id) === Number(id)
    );
    return row?.filename || row?.name || '';
  };

  bindApp('saveSettings', async () =>
    (await import('./pages/settings.js')).saveSettings(ctx)
  );
  bindApp('switchSettingsTab', async (tabId) =>
    (await import('./pages/settings.js')).switchSettingsTab(tabId)
  );
  bindApp('refreshSettingsSummary', async () =>
    (await import('./pages/settings.js')).refreshSettingsSummary(ctx)
  );
  bindApp('openSettingsReleaseUrl', async () =>
    (await import('./pages/settings.js')).openSettingsReleaseUrl()
  );
  bindApp('createBackup', async () => {
    const result = await apiFetch('/backups', { method: 'POST' });
    toast(
      result?.backup?.filename
        ? `Backup created: ${result.backup.filename}`
        : 'Backup created'
    );
    return refreshBackupRelatedViews();
  });
  bindApp('downloadBackup', async (id) => {
    window.open(`/api/admin/backups/${id}/download`, '_blank', 'noopener');
  });
  bindApp('deleteBackup', async (id) => {
    if (!(await showConfirm('Delete this backup?'))) return;
    await apiFetch(`/backups/${id}`, { method: 'DELETE' });
    toast('Backup deleted');
    return refreshBackupRelatedViews();
  });
  bindApp('restoreBackup', async (id, filename) => {
    const confirmFilename = await resolveBackupFilename(id, filename);
    if (!confirmFilename) {
      toast('Backup filename not found', 'error');
      return;
    }
    if (
      !(await showConfirm(
        `Restore backup ${confirmFilename}? A safety backup will be created first.`
      ))
    )
      return;
    const result = await apiFetch(`/backups/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ confirmFilename }),
    });
    toast(
      result?.safetyBackup
        ? `Backup restored. Safety backup: ${result.safetyBackup}`
        : 'Backup restored'
    );
    return refreshBackupRelatedViews();
  });
  bindApp('loadDbManager', async () =>
    (await import('./pages/db-manager.js')).loadDbManager(ctx)
  );
  bindApp('runDbRepair', async () => {
    const result = await apiFetch('/system/db-repair', { method: 'POST' });
    toast(result?.message || 'Database repair completed');
    return (await import('./pages/db-manager.js')).loadDbManager(ctx);
  });
  bindApp('runDbOptimize', async () => {
    const result = await apiFetch('/system/db-optimize', { method: 'POST' });
    toast(result?.message || 'Database optimization completed');
    return (await import('./pages/db-manager.js')).loadDbManager(ctx);
  });
  bindApp('copyDrmOutput', async (url) => {
    if (!url) {
      toast('No DRM output URL available', 'warning');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('DRM output URL copied');
  });
  bindApp('openMovieForm', async (id) =>
    (await import('./pages/movies.js')).openMovieForm(ctx, id)
  );
  bindApp('editMovie', async (id) =>
    (await import('./pages/movies.js')).editMovie(ctx, id)
  );
  bindApp('deleteMovie', async (id) =>
    (await import('./pages/movies.js')).deleteMovie(ctx, id)
  );
  bindApp('saveMovie', async () =>
    (await import('./pages/movies.js')).saveMovie(ctx)
  );
  bindApp('closeMovieModal', async () =>
    (await import('./pages/movies.js')).closeMovieModal(ctx)
  );
  bindApp('copyMovieUrl', async () =>
    (await import('./pages/movies.js')).copyMovieUrl(ctx)
  );
  bindApp('addMovieSourceRow', async () =>
    (await import('./pages/movies.js')).addMovieSourceRow()
  );
  bindApp('addSubtitleRow', async () =>
    (await import('./pages/movies.js')).addSubtitleRow()
  );
  bindApp('movieTabNext', async (tabId) =>
    (await import('./pages/movies.js')).movieTabNext(tabId)
  );
  bindApp('addMovieCatTag', async (select) =>
    (await import('./pages/movies.js')).addMovieCatTag(ctx, select)
  );
  bindApp('addMovieBqTag', async (select) =>
    (await import('./pages/movies.js')).addMovieBqTag(ctx, select)
  );
  bindApp('removeMovieCatTag', async (id) =>
    (await import('./pages/movies.js')).removeMovieCatTag(ctx, id)
  );
  bindApp('removeMovieBqTag', async (id) =>
    (await import('./pages/movies.js')).removeMovieBqTag(ctx, id)
  );
  bindApp('confirmMovieImport', async () =>
    (await import('./pages/movies.js')).confirmMovieImport(ctx)
  );
  bindApp('openSeriesForm', async (id) =>
    (await import('./pages/series.js')).openSeriesForm(ctx, id)
  );
  bindApp('editSeries', async (id) =>
    (await import('./pages/series.js')).editSeries(ctx, id)
  );
  bindApp('deleteSeries', async (id) =>
    (await import('./pages/series.js')).deleteSeries(ctx, id)
  );
  bindApp('saveSeries', async () =>
    (await import('./pages/series.js')).saveSeries(ctx)
  );
  bindApp('addSeriesBqTag', async (select) =>
    (await import('./pages/series.js')).addSeriesBqTag(ctx, select)
  );
  bindApp('removeSeriesBqTag', async (id) =>
    (await import('./pages/series.js')).removeSeriesBqTag(ctx, id)
  );
  bindApp('confirmSeriesImport', async () =>
    (await import('./pages/series.js')).confirmSeriesImport(ctx)
  );
  bindApp('openEpisodeForm', async (id) =>
    (await import('./pages/episodes.js')).openEpisodeForm(ctx, id)
  );
  bindApp('closeEpisodeModal', async () =>
    (await import('./pages/episodes.js')).closeEpisodeModal(ctx)
  );
  bindApp('saveEpisode', async () =>
    (await import('./pages/episodes.js')).saveEpisode(ctx)
  );
  bindApp('openStandaloneEpisodeForm', async (id) =>
    (await import('./pages/episodes.js')).openStandaloneEpisodeForm(ctx, id)
  );
  bindApp('closeStandaloneEpisodeModal', async () =>
    (await import('./pages/episodes.js')).closeStandaloneEpisodeModal(ctx)
  );
  bindApp('saveStandaloneEpisode', async () =>
    (await import('./pages/episodes.js')).saveStandaloneEpisode(ctx)
  );
  bindApp('editEpisode', async (id) =>
    (await import('./pages/episodes.js')).editEpisode(ctx, id)
  );
  bindApp('deleteEpisode', async (id) =>
    (await import('./pages/episodes.js')).deleteEpisode(ctx, id)
  );
  bindApp('openDrmStreamModal', async (id) =>
    (await import('./pages/drm-streams.js')).openDrmStreamModal(ctx, id)
  );
  bindApp('closeDrmStreamModal', async () =>
    (await import('./pages/drm-streams.js')).closeDrmStreamModal(ctx)
  );
  bindApp('parseDrmImport', async () =>
    (await import('./pages/drm-streams.js')).parseDrmImport(ctx)
  );
  bindApp('saveDrmStream', async () =>
    (await import('./pages/drm-streams.js')).saveDrmStream(ctx)
  );
  bindApp('deleteDrmStream', async (id) =>
    (await import('./pages/drm-streams.js')).deleteDrmStream(ctx, id)
  );
  bindApp('addProxyRelationship', async () =>
    (await import('./pages/servers.js')).addProxyRelationship(ctx)
  );
  bindApp('deleteProxyRelationship', async (parentId, childId) =>
    (await import('./pages/servers.js')).deleteProxyRelationship(
      ctx,
      parentId,
      childId
    )
  );
  bindApp('editRegisteredUser', async (id) =>
    (await import('./pages/registered-users.js')).openRegisteredUserForm(
      ctx,
      id
    )
  );
  bindApp('openRegisteredUserNotes', async (id) =>
    (await import('./pages/registered-users.js')).openRegisteredUserNotes(
      ctx,
      id
    )
  );
  bindApp('openRegisteredUserCredits', async (id) =>
    (await import('./pages/registered-users.js')).openRegisteredUserCredits(
      ctx,
      id
    )
  );
  bindApp('toggleRegisteredUserStatus', async (id) =>
    (await import('./pages/registered-users.js')).toggleRegisteredUserStatus(
      ctx,
      id
    )
  );
  bindApp('deleteRegisteredUser', async (id) =>
    (await import('./pages/registered-users.js')).deleteRegisteredUser(ctx, id)
  );
  bindApp('saveRegisteredUser', async () =>
    (await import('./pages/registered-users.js')).saveRegisteredUser(ctx)
  );
  bindApp('closeRegisteredUserNotesModal', async () =>
    (await import('./pages/registered-users.js')).closeRegisteredUserNotesModal(
      ctx
    )
  );
  bindApp('saveRegisteredUserNotes', async () =>
    (await import('./pages/registered-users.js')).saveRegisteredUserNotes(ctx)
  );
  bindApp('closeRegisteredUserCreditsModal', async () =>
    (
      await import('./pages/registered-users.js')
    ).closeRegisteredUserCreditsModal(ctx)
  );
  bindApp('saveRegisteredUserCredits', async () =>
    (await import('./pages/registered-users.js')).saveRegisteredUserCredits(ctx)
  );
  bindApp('resetRegisteredUserPackageOverrides', async () => {
    const mod = await import('./pages/registered-users.js');
    ctx.setRegisteredUserPackageOverrides([]);
    return mod.loadRegisteredUserFormPage(ctx);
  });
  bindApp('goRegisteredUsersPage', async (page) => {
    ctx.setRegisteredUsersPage(page);
    return (await import('./pages/registered-users.js')).loadRegisteredUsers(
      ctx
    );
  });
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.user) showPanel(data.user);
    else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  const panel = document.getElementById('app-panel');
  if (panel) panel.style.display = 'none';
  const login = document.getElementById('app-login');
  if (login) login.style.display = 'flex';
}

async function showPanel(user = null) {
  const panel = document.getElementById('app-panel');
  if (panel) panel.style.display = 'block';
  const login = document.getElementById('app-login');
  if (login) login.style.display = 'none';
  if (user?.username) {
    const topbarUser = document.getElementById('topbarUser');
    if (topbarUser) topbarUser.textContent = user.username;
  }
  try {
    await loadReferenceData();
  } catch (error) {
    console.error('Failed to load reference data:', error);
    toast(error.message || 'Failed to load reference data', 'error');
  }
  connectDashboardWS({
    getCurrentPage: () => getCurrentPage(),
    onDashboardData: (data) => ctx.updateDashboardFromWS(data),
    onEventData: (data) => ctx.handleWSEvent(data),
  });
}

async function fetchCsrfToken() {
  const res = await fetch('/api/auth/csrf-token', {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('Failed to fetch CSRF token');
  const data = await res.json();
  return data.csrfToken;
}

async function doLogin(username, password) {
  const csrfToken = await fetchCsrfToken();
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ username, password }),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

function doLogout() {
  fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  }).finally(() => showLogin());
}

authEvents.addEventListener('unauthorized', () => {
  showLogin();
});

window.onerror = (msg, src, lineno, colno, err) => {
  console.error('[Global Error]', { msg, src, lineno, colno, err });
  return false;
};

window.addEventListener('beforeunload', () => {
  timerManager.clearAll();
});

function bindNav() {
  document.addEventListener('click', (event) => {
    const navLink = event.target.closest('.nav-link[data-page]');
    if (navLink) {
      event.preventDefault();
      navigateTo(navLink.dataset.page, { ctx });
      return;
    }
    const navAction = event.target.closest('[data-app-nav]');
    if (navAction) {
      event.preventDefault();
      navigateTo(navAction.dataset.appNav, { ctx });
      return;
    }
    const appAction = event.target.closest('[data-app-action]');
    if (appAction) {
      event.preventDefault();
      invokeDelegatedAppAction(appAction.dataset.appAction, event, appAction);
      return;
    }
    if (event.target.closest('#logoutBtn')) {
      event.preventDefault();
      doLogout();
      return;
    }
    if (event.target.closest('#sidebarToggle')) {
      event.preventDefault();
      toggleSidebar();
    }
  });

  document.addEventListener('change', (event) => {
    const appAction = event.target.closest('[data-app-change]');
    if (!appAction) return;
    invokeDelegatedAppAction(appAction.dataset.appChange, event, appAction);
  });

  document.addEventListener('input', (event) => {
    const appAction = event.target.closest('[data-app-input]');
    if (!appAction) return;
    invokeDelegatedAppAction(appAction.dataset.appInput, event, appAction);
  });
}

function bindLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('loginUser')?.value || '';
    const pass = document.getElementById('loginPass')?.value || '';
    const errEl = document.getElementById('loginError');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    try {
      const data = await doLogin(user, pass);
      await showPanel(data.user || { username: user });
      initRouter({ ctx });
    } catch (err) {
      if (errEl) {
        errEl.textContent = err?.message || 'Login failed';
        errEl.style.display = 'block';
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindCoreAppActions();
  bindNav();
  bindLoginForm();
  applySidebarLayoutState();
  await checkSession();
  if (document.getElementById('app-panel')?.style.display !== 'none') {
    initRouter({ ctx });
  }
});

export { doLogin, doLogout, showPanel, showLogin };
