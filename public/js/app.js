(function () {
  'use strict';

  const API = '/api/admin';
  let _token = null;
  let _currentPage = 'dashboard';
  let _categories = [];
  let _bouquets = [];
  let _packages = [];
  let _movieCats = [];
  let _seriesCats = [];
  let _editingSeriesId = null;
  let _editingSeriesSeasons = [];
  let _activeSeason = 1;
  let _tmdbTimer = null;
  let _importProviders = [];
  let _importJobPoll = null;
  let _importJobId = null;
  const IMPORT_JOB_STORAGE_KEY = 'iptv_panel_import_job_id';

  function persistImportJobId(jobId) {
    try {
      if (jobId) localStorage.setItem(IMPORT_JOB_STORAGE_KEY, jobId);
      else localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
    } catch (_) {}
  }

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
  const PKG_WIZARD_TABS = ['pkg-details', 'pkg-options', 'pkg-groups', 'pkg-bouquets'];
  let _pkgWizardIdx = 0;
  let _adminFeatures = null;
  let _serversCache = [];

  // ─── Helpers ──────────────────────────────────────────────────────

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    const raw = await res.text();
    let data = null;
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (raw && isJson) {
      try { data = JSON.parse(raw); } catch {}
    }
    if (res.status === 401 || res.status === 403) {
      showLogin();
      throw new Error((data && data.error) || 'unauthorized');
    }
    if (!isJson) {
      const sample = (raw || '').slice(0, 140).replace(/\s+/g, ' ').trim();
      throw new Error(`Unexpected non-JSON response (${res.status}): ${sample || 'empty'}`);
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  async function api(path, method, body) {
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const raw = await res.text();
    let data = null;
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (raw && isJson) {
      try { data = JSON.parse(raw); } catch {}
    }
    if (res.status === 401 || res.status === 403) { showLogin(); throw new Error((data && data.error) || 'unauthorized'); }
    if (!isJson) throw new Error(`Unexpected non-JSON response (${res.status})`);
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ─── WebSocket Real-time Dashboard ───────────────────────────────────────────
  let _ws = null;
  let _wsReconnectTimer = null;
  const _WS_PATH = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function disconnectWS() {
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
    if (_ws) { _ws.close(); _ws = null; }
  }

  function connectDashboardWS() {
    disconnectWS();
    try {
      _ws = new WebSocket(_WS_PATH);
    } catch (_) { return; }

    _ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.channel === 'dashboard') {
        updateDashboardFromWS(msg.data);
      } else if (msg.channel === 'events') {
        handleWSEvent(msg.data);
      }
    };

    _ws.onclose = () => {
      if (_currentPage === 'dashboard') {
        _wsReconnectTimer = setTimeout(connectDashboardWS, 5000);
      }
    };

    _ws.onerror = () => { _ws.close(); };
  }

  // Update dashboard UI with data from WebSocket
  function updateDashboardFromWS(d) {
    if (!_dashStatsEl) _dashStatsEl = $('#dashStats');
    if (!_dashMetersEl) _dashMetersEl = $('#dashMeters');
    if (!_dashActiveStreamsEl) _dashActiveStreamsEl = $('#dashActiveStreams');
    if (!_dashActiveUsersEl) _dashActiveUsersEl = $('#dashActiveUsers');
    if (!_dashStreamsCountEl) _dashStreamsCountEl = $('#dashStreamsCount');
    if (!_dashStatsEl) return;

    const cards = d.cards || {};
    const system = d.system || {};
    const runningStreams = cards.runningStreams || 0;
    const totalChannels = cards.channels || 0;
    const downStreams = Math.max(0, totalChannels - runningStreams);
    const netInMbps = ((system.netInKBps || 0) / 1024).toFixed(1);
    const netOutMbps = ((system.netOutKBps || 0) / 1024).toFixed(1);

    // 6 stat cards — XC solid color style
    _dashStatsEl.innerHTML = `
      <div class="dash-stat-card purple">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${d.cards?.connections || 0}</div>
          <div class="dash-stat-label">Connections</div>
        </div>
      </div>
      <div class="dash-stat-card green">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${totalChannels}</div>
          <div class="dash-stat-label">Channels</div>
        </div>
      </div>
      <div class="dash-stat-card blue">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${runningStreams}</div>
          <div class="dash-stat-label">Live Streams</div>
        </div>
      </div>
      <div class="dash-stat-card red">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${downStreams}</div>
          <div class="dash-stat-label">Down Streams</div>
        </div>
      </div>
      <div class="dash-stat-card cyan">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${netInMbps} <small>Mbps</small></div>
          <div class="dash-stat-label">Network In</div>
        </div>
      </div>
      <div class="dash-stat-card yellow">
        <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        <div class="dash-stat-info">
          <div class="dash-stat-value">${netOutMbps} <small>Mbps</small></div>
          <div class="dash-stat-label">Network Out</div>
        </div>
      </div>
    `;

    // System meters
    if (_dashMetersEl) {
      _dashMetersEl.innerHTML = `
        <div class="dash-meter-row">
          <span class="dash-meter-label">CPU</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill cpu" style="width:${system.cpuPct || 0}%"></div></div>
          <span class="dash-meter-val">${system.cpuPct || 0}%</span>
        </div>
        <div class="dash-meter-row">
          <span class="dash-meter-label">RAM</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill ram" style="width:${system.ramPct || 0}%"></div></div>
          <span class="dash-meter-val">${system.ramPct || 0}%</span>
        </div>
        <div class="dash-meter-row">
          <span class="dash-meter-label">Disk</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill disk" style="width:${system.diskPct || 0}%"></div></div>
          <span class="dash-meter-val">${system.diskPct || 0}%</span>
        </div>
      `;
    }

    // Active streams list
    if (_dashActiveStreamsEl) {
      const streams = Array.isArray(d.channels) ? d.channels.filter(ch => ch.status === 'running') : [];
      if (_dashStreamsCountEl) _dashStreamsCountEl.textContent = `${streams.length}`;
      if (streams.length === 0) {
        _dashActiveStreamsEl.innerHTML = `<div class="dash-streams-empty">No active streams</div>`;
      } else {
        _dashActiveStreamsEl.innerHTML = streams.slice(0, 50).map(ch => {
          const info = ch.info || {};
          return `<div class="dash-stream-row">
            <div class="dash-stream-name" title="${escHtml(ch.name || '')}">${escHtml(ch.name || 'Unknown')}${info.readable ? `<span>${info.readable}</span>` : ''}</div>
            <div class="dash-stream-viewers">${info.viewers || 0}</div>
            <div class="dash-stream-uptime">${ch.uptime || '00:00:00'}</div>
            <div class="dash-stream-actions">
              <button class="btn-icon btn-icon-stop" onclick="APP.stopStream('${ch.id}')" title="Stop"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg></button>
              <button class="btn-icon btn-icon-restart" onclick="APP.restartStream('${ch.id}')" title="Restart"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
            </div>
          </div>`;
        }).join('');
      }
    }

    // Active users
    if (_dashActiveUsersEl) {
      _dashActiveUsersEl.innerHTML = `
        <div class="dash-users-count">${d.activeUsers || 0}</div>
        <div class="dash-users-label">Users online (5m)</div>
      `;
    }
  }

  function handleWSEvent(data) {
    // Stream events: starting, stopped, exited (crash), etc.
    const eventLabels = {
      'stream:starting': 'Stream started',
      'stream:running': 'Stream ready',
      'stream:exited': 'Stream crashed',
      'stream:stopped': 'Stream stopped',
      'stream:error': 'Stream error',
      'stream:fatal': 'Stream fatal error',
      'stream:recovery_failed': 'Stream recovery failed',
      'stream:zombie': 'Zombie stream detected',
      'sharing:detected': 'Sharing detected',
    };
    // Fast-path: resolve pending on-demand stream start immediately
    if (data.event === 'stream:running' && data.channelId === _pendingStreamStartId) {
      _streamReadyByWS = true;
      _pendingStreamStartId = null;
    }
    const label = eventLabels[data.event] || data.event;
    if (label) toast(`${label}: ${data.channelId || data.userId || ''}`, data.event.includes('crash') || data.event.includes('fatal') || data.event.includes('sharing') ? 'error' : 'info');
  }

  // Cache DOM refs
  let _dashStatsEl = null;
  let _dashSystemEl = null;
  let _dashMetersEl = null;
  let _dashActiveStreamsEl = null;
  let _dashActiveUsersEl = null;
  let _dashStreamsCountEl = null;

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  function formatDate(ts) {
    if (!ts) return '-';
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function thumbImg(url, w = 40, h = 56) {
    if (!url) return '<div class="thumb-placeholder"></div>';
    return `<img src="${escHtml(url)}" class="thumb-img" width="${w}" height="${h}" loading="lazy" onerror="this.style.display='none'">`;
  }

  function statusBadge(active, banned, expired) {
    if (banned) return '<span class="badge badge-danger">Banned</span>';
    if (expired) return '<span class="badge badge-warning">Expired</span>';
    if (active) return '<span class="badge badge-success">Active</span>';
    return '<span class="badge badge-secondary">Disabled</span>';
  }

  // ─── Auth ────────────────────────────────────────────────────────

  function showLogin() {
    $('#app-login').style.display = 'flex';
    $('#app-panel').style.display = 'none';
  }

  function showPanel() {
    $('#app-login').style.display = 'none';
    $('#app-panel').style.display = 'flex';
    loadRefData();
    const hash = location.hash.replace('#', '');
    const saved = hash || (function() { try { return localStorage.getItem('lastPage'); } catch { return ''; } })();
    navigateTo(saved || 'dashboard');
  }

  async function doLogin(e) {
    e.preventDefault();
    const user = $('#loginUser').value.trim();
    const pass = $('#loginPass').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: user, password: pass }),
      });
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
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    showLogin();
  }

  // ─── Navigation ──────────────────────────────────────────────────

  function navigateTo(page) {
    if (page === 'categories') page = 'categories-channels';
    // Disconnect WS on any navigation (will reconnect if dashboard)
    if (page !== 'dashboard') disconnectWS();
    _currentPage = page;
    location.hash = page;
    try { localStorage.setItem('lastPage', page); } catch {}
    $$('.page').forEach(p => p.style.display = 'none');
    const el = $(`#page-${page}`);
    if (el) el.style.display = 'block';

    $$('.nav-link').forEach(l => l.classList.remove('active'));
    const link = $(`.nav-link[data-page="${page}"]`);
    if (link) link.classList.add('active');

    const loaders = {
      dashboard: () => { connectDashboardWS(); },
      lines: loadLines,
      movies: loadMovies,
      series: loadSeriesList,
      episodes: loadAllEpisodes,
      streams: loadStreams,
      'categories-channels': () => loadCategoriesForPage('live', 'categoriesTableChannels'),
      'categories-movies': () => loadCategoriesForPage('movie', 'categoriesTableMovies'),
      'categories-series': () => loadCategoriesForPage('series', 'categoriesTableSeries'),
      bouquets: loadBouquets,
      packages: loadPackages,
      resellers: loadResellers,
      users: loadUsers,
      epg: loadEpg,
      settings: loadSettings,
      servers: loadServers,
      security: loadSecurity,
      logs: loadLogs,
      'access-codes': loadAccessCodes,
      'db-manager': loadDbManager,
      'transcode-profiles': loadTranscodeProfiles,
      'drm-streams': loadDrmStreams,
      providers: loadProviders,
      'import-content': loadImportContentPage,
    };
    if (loaders[page]) loaders[page]();

    if (page === 'movie-import') {
      populateSelect('#movieImportCat', _movieCats, 'id', 'category_name', 'None');
      populateSelect('#movieImportBq', _bouquets, 'id', 'bouquet_name', 'None');
    } else if (page === 'series-import') {
      populateSelect('#seriesImportCat', _seriesCats, 'id', 'category_name', 'None');
      populateSelect('#seriesImportBq', _bouquets, 'id', 'bouquet_name', 'None');
    } else if (page === 'stream-import') {
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
        await loadStreamingPerformanceSettings();
      } catch { /* ignore */ }
    } catch (e) {
      console.warn('[APP] loadRefData failed, using defaults:', e?.message);
      _categories = _categories || [];
      _bouquets = _bouquets || [];
      _packages = _packages || [];
      _movieCats = _categories.filter(c => c.category_type === 'movie');
      _seriesCats = _categories.filter(c => c.category_type === 'series');
    }
  }

  function populateSelect(sel, items, valKey, lblKey, emptyLabel) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    el.innerHTML = '';
    if (emptyLabel) el.innerHTML = `<option value="">${escHtml(emptyLabel)}</option>`;
    for (const item of items) {
      el.innerHTML += `<option value="${escHtml(String(item[valKey]))}">${escHtml(item[lblKey])}</option>`;
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
    try {
      const stats = await apiFetch('/stats');
      const liveStreams = stats.liveStreams || 0;
      const totalChannels = (stats.channelsCount || 0);
      const downStreams = Math.max(0, totalChannels - liveStreams);
      const netInMbps = stats.netIn != null ? stats.netIn : '--';
      const netOutMbps = stats.netOut != null ? stats.netOut : '--';

      // Build 6 stat cards — XC solid color style
      $('#dashStats').innerHTML = `
        <div class="dash-stat-card purple">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${stats.connections || 0}</div>
            <div class="dash-stat-label">Connections</div>
          </div>
        </div>
        <div class="dash-stat-card green">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${stats.activeLines || 0}</div>
            <div class="dash-stat-label">Active Lines</div>
          </div>
        </div>
        <div class="dash-stat-card blue">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${liveStreams}</div>
            <div class="dash-stat-label">Live Streams</div>
          </div>
        </div>
        <div class="dash-stat-card red">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${downStreams}</div>
            <div class="dash-stat-label">Down Streams</div>
          </div>
        </div>
        <div class="dash-stat-card cyan">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${netInMbps} <small>Mbps</small></div>
            <div class="dash-stat-label">Network In</div>
          </div>
        </div>
        <div class="dash-stat-card yellow">
          <div class="dash-stat-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${netOutMbps} <small>Mbps</small></div>
            <div class="dash-stat-label">Network Out</div>
          </div>
        </div>
      `;

      // System meters
      const cpu = stats.cpu || 0;
      const ram = stats.memPercent || 0;
      const disk = stats.diskPercent || 0;
      $('#dashMeters').innerHTML = `
        <div class="dash-meter-row">
          <span class="dash-meter-label">CPU</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill cpu" style="width:${cpu}%"></div></div>
          <span class="dash-meter-val">${cpu}%</span>
        </div>
        <div class="dash-meter-row">
          <span class="dash-meter-label">RAM</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill ram" style="width:${ram}%"></div></div>
          <span class="dash-meter-val">${ram}%</span>
        </div>
        <div class="dash-meter-row">
          <span class="dash-meter-label">Disk</span>
          <div class="dash-meter-bar"><div class="dash-meter-fill disk" style="width:${disk}%"></div></div>
          <span class="dash-meter-val">${disk}%</span>
        </div>
      `;

      $('#dashActiveStreams').innerHTML = `<div class="dash-streams-empty">Stream data available via WebSocket</div>`;
      $('#dashActiveUsers').innerHTML = `<div class="dash-users-count">--</div><div class="dash-users-label">Users online</div>`;
    } catch (e) {
      $('#dashStats').innerHTML = `<p class="text-danger" style="padding:1rem">${escHtml(e.message)}</p>`;
    }
  }

  // ─── Lines ───────────────────────────────────────────────────────

  function lineStatusBadge(l) {
    const now = Math.floor(Date.now() / 1000);
    if (l.admin_enabled === 0) return '<span class="badge badge-danger">Banned</span>';
    if (l.exp_date && l.exp_date < now) return '<span class="badge badge-warning">Expired</span>';
    if (l.is_trial) return '<span class="badge badge-info">Trial</span>';
    return '<span class="badge badge-success">Active</span>';
  }

  function daysLeft(expDate) {
    if (!expDate) return '<span style="color:#8b949e">Unlimited</span>';
    const now = Math.floor(Date.now() / 1000);
    const diff = expDate - now;
    if (diff <= 0) return '<span style="color:#f85149">Expired</span>';
    const days = Math.ceil(diff / 86400);
    const color = days <= 7 ? '#d29922' : '#3fb950';
    return `<span style="color:${color}">${days}d</span>`;
  }

  async function loadLines() {
    try {
      const data = await apiFetch('/lines');
      const lines = data.lines || [];
      const search = ($('#linesSearch')?.value || '').toLowerCase();
      const statusF = $('#linesStatusFilter')?.value || '';
      const now = Math.floor(Date.now() / 1000);
      const filtered = lines.filter(l => {
        if (search && !l.username?.toLowerCase().includes(search)) return false;
        if (statusF === 'active' && (l.admin_enabled !== 1 || (l.exp_date && l.exp_date < now))) return false;
        if (statusF === 'banned' && l.admin_enabled !== 0) return false;
        if (statusF === 'expired' && !(l.exp_date && l.exp_date < now)) return false;
        if (statusF === 'disabled' && l.admin_enabled !== 0) return false;
        return true;
      });
      const tbody = $('#linesTable tbody');
      tbody.innerHTML = filtered.map(l => {
        const badge = lineStatusBadge(l);
        const activeCons = l.active_cons || 0;
        const maxCons = l.max_connections || 1;
        const connColor = activeCons >= maxCons ? '#f85149' : '#3fb950';
        return `<tr>
          <td>${l.id}</td>
          <td>${escHtml(l.username || '')}</td>
          <td>${escHtml(l.password || '')}</td>
          <td>${l.member_id ? l.member_id : '<span style="color:#8b949e">Admin</span>'}</td>
          <td>${badge}</td>
          <td>${l.exp_date ? formatDate(l.exp_date) : '<span style="color:#8b949e">Never</span>'}</td>
          <td>${daysLeft(l.exp_date)}</td>
          <td><span style="color:${connColor}">${activeCons}</span> / ${maxCons}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editLine(${l.id})">Edit</button>
            <button class="btn btn-xs btn-${l.admin_enabled ? 'warning' : 'success'}" onclick="APP.toggleBanLine(${l.id}, ${l.admin_enabled})">${l.admin_enabled ? 'Ban' : 'Unban'}</button>
            <button class="btn btn-xs btn-secondary" onclick="APP.openPlaylistModal(${l.id}, '${escHtml(l.username || '')}', '${escHtml(l.password || '')}')">Playlist</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteLine(${l.id})">Del</button>
          </td>
        </tr>`;
      }).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function showPackageSummary(pkgId) {
    const sum = $('#linePackageSummary');
    if (!sum) return;
    const pkg = _packages.find(p => String(p.id) === String(pkgId));
    if (!pkg) { sum.style.display = 'none'; return; }
    const dur = pkg.is_trial
      ? `${pkg.trial_duration || 0} ${pkg.trial_duration_in || 'day'}(s)`
      : `${pkg.official_duration || 0} ${pkg.official_duration_in || 'month'}(s)`;
    const bqs = (() => {
      const raw = pkg.bouquets_json || pkg.bouquets || [];
      const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
      if (!arr.length) return 'All';
      return arr.map(bid => {
        const b = _bouquets.find(x => String(x.id) === String(bid));
        return b ? b.bouquet_name || b.name : bid;
      }).join(', ');
    })();
    const outs = (() => {
      const raw = pkg.output_formats_json || pkg.output_formats || [];
      const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
      return arr.length ? arr.join(', ') : 'All';
    })();
    $('#pkgSumConn').textContent = pkg.max_connections || 1;
    $('#pkgSumDuration').textContent = dur;
    $('#pkgSumBouquets').textContent = bqs;
    $('#pkgSumOutputs').textContent = outs;
    sum.style.display = 'block';
  }

  function openLineForm(lineData) {
    navigateTo('line-form');
    populateSelect('#lineOwner', [], 'id', 'username', 'Admin');
    populateSelect('#linePackage', _packages, 'id', 'package_name', '-- Select Package --');
    const pkgSel = $('#linePackage');
    if (pkgSel) pkgSel.onchange = () => showPackageSummary(pkgSel.value);

    if (lineData) {
      $('#lineFormTitle').textContent = 'Edit Line';
      $('#lineFormId').value = lineData.id;
      $('#lineUsername').value = lineData.username || '';
      $('#linePassword').value = lineData.password || '';
      $('#lineEnabled').value = lineData.admin_enabled ? '1' : '0';
      if (lineData.package_id) {
        $('#linePackage').value = String(lineData.package_id);
        showPackageSummary(lineData.package_id);
      }
    } else {
      $('#lineFormTitle').textContent = 'Add Line';
      $('#lineFormId').value = '';
      $('#lineUsername').value = '';
      $('#linePassword').value = '';
      $('#lineEnabled').value = '1';
      $('#linePackageSummary').style.display = 'none';
    }
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
    const body = {
      username: $('#lineUsername').value,
      password: $('#linePassword').value,
      admin_enabled: parseInt($('#lineEnabled').value),
      package_id: parseInt(pkgId, 10),
      member_id: parseInt($('#lineOwner').value) || 0,
    };
    try {
      if (id) {
        await apiFetch(`/lines/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Line updated');
      } else {
        await apiFetch('/lines', { method: 'POST', body: JSON.stringify(body) });
        toast('Line created');
      }
      navigateTo('lines');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleBanLine(id, currentEnabled) {
    try {
      await apiFetch(`/lines/${id}/${currentEnabled ? 'ban' : 'unban'}`, { method: 'POST' });
      toast(currentEnabled ? 'Line banned' : 'Line unbanned');
      loadLines();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteLine(id) {
    if (!confirm('Delete this line?')) return;
    try {
      await apiFetch(`/lines/${id}`, { method: 'DELETE' });
      toast('Line deleted');
      loadLines();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ─── Movies ──────────────────────────────────────────────────────

  async function loadMovies() {
    populateSelect('#moviesCatFilter', _movieCats, 'id', 'category_name', 'All Categories');
    try {
      const search = ($('#moviesSearch')?.value || '').trim();
      const catId = $('#moviesCatFilter')?.value || '';
      const sortRaw = ($('#moviesSortOrder')?.value || 'id_desc');
      const sort = sortRaw === 'id_asc' ? 'id_asc' : 'id_desc';
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catId) params.set('category_id', catId);
      params.set('sort', sort);
      const qs = `?${params.toString()}`;
      const data = await apiFetch(`/movies${qs}`);
      const movies = data.movies || [];
      $('#moviesTable tbody').innerHTML = movies.map(m => {
        const tmdbBadge = m.tmdb_id ? '<span class="badge badge-info">TMDb</span>' : '<span class="badge badge-secondary">No</span>';
        const catName = _movieCats.find(c => String(c.id) === String(m.category_id))?.category_name || m.category_id || '-';
        return `<tr>
          <td><span class="id-link" role="button" tabindex="0" title="Edit" onclick="APP.editMovie(${m.id})">${m.id}</span></td>
          <td>${thumbImg(m.stream_icon || m.poster)}</td>
          <td>${escHtml(m.name || m.title || '')}</td>
          <td>${escHtml(catName)}</td>
          <td>${m.year || '-'}</td>
          <td>${m.rating || '-'}</td>
          <td>${tmdbBadge}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editMovie(${m.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteMovie(${m.id})">Del</button>
          </td>
        </tr>`;
      }).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  let _movieCatTags = [];
  let _movieBqTags = [];
  let _seriesBqTags = [];
  let _streamBqTags = [];

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
    try {
      const catId = $('#seriesCatFilter')?.value || '';
      const search = ($('#seriesSearch')?.value || '').trim();
      const sortRaw = ($('#seriesSortOrder')?.value || 'id_desc');
      const sort = sortRaw === 'id_asc' ? 'id_asc' : 'id_desc';
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catId) params.set('category_id', catId);
      params.set('sort', sort);
      const qs = `?${params.toString()}`;
      const data = await apiFetch(`/series${qs}`);
      const list = data.series || [];
      $('#seriesTable tbody').innerHTML = list.map(s => {
        const tmdbBadge = s.tmdb_id ? '<span class="badge badge-info">TMDb</span>' : '<span class="badge badge-secondary">No</span>';
        const catName = _seriesCats.find(c => String(c.id) === String(s.category_id))?.category_name || s.category_id || '-';
        let seasonCount = '-';
        try { const ss = JSON.parse(s.seasons || '[]'); seasonCount = ss.length || '-'; } catch { }
        return `<tr>
          <td><span class="id-link" role="button" tabindex="0" title="Edit" onclick="APP.editSeries(${s.id})">${s.id}</span></td>
          <td>${thumbImg(s.cover || s.poster)}</td>
          <td>${escHtml(s.title || s.name || '')}</td>
          <td>${escHtml(catName)}</td>
          <td>${seasonCount}</td>
          <td>${s.rating || '-'}</td>
          <td>${tmdbBadge}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editSeries(${s.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteSeries(${s.id})">Del</button>
          </td>
        </tr>`;
      }).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
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
    const res = await fetch('/api/channels' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  let _streamsCache = [];
  let _streamsPage = 1;
  let _pendingStreamStartId = null;   // channel ID being waited on via WS
  let _streamReadyByWS = false;       // set true by WS event to skip polling

  async function loadStreams() {
    try {
      const data = await fetch('/api/channels', { credentials: 'same-origin' });
      const list = await data.json();
      _streamsCache = Array.isArray(list) ? list : [];

      const liveCats = _categories.filter(c => c.category_type === 'live');
      const catFilter = $('#streamsCategoryFilter');
      if (catFilter && catFilter.options.length <= 1) {
        liveCats.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.category_name; catFilter.appendChild(o); });
      }

      renderStreamsTable();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderStreamsTable() {
    const search = ($('#streamsSearch')?.value || '').toLowerCase();
    const statusF = $('#streamsStatusFilter')?.value || '';
    const catF = $('#streamsCategoryFilter')?.value || '';
    const perPage = parseInt($('#streamsPerPage')?.value) || 50;
    const filtered = _streamsCache.filter(ch => {
      if (search && !(ch.name || '').toLowerCase().includes(search) && !(ch.id || '').toLowerCase().includes(search)) return false;
      if (statusF === 'on_demand') {
        if (!ch.on_demand) return false;
      } else if (statusF && ch.status !== statusF) return false;
      if (catF && String(ch.category_id || '') !== catF) return false;
      return true;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    if (_streamsPage > totalPages) _streamsPage = totalPages;
    const start = (_streamsPage - 1) * perPage;
    const pageItems = filtered.slice(start, start + perPage);

    $('#streamsTable tbody').innerHTML = pageItems.map(ch => {
      const isRunning = ch.status === 'running';
      const statusCls = isRunning ? 'success' : ch.status === 'error' ? 'danger' : 'secondary';
      const uptime = isRunning && ch.startedAt ? formatUptime(ch.startedAt) : '-';
      const clients = ch.clients || 0;
      const si = ch.streamInfo || {};
      const logo = ch.logoUrl ? `<img class="stream-icon" src="${escHtml(ch.logoUrl)}" onerror="this.outerHTML='<div class=\\'stream-icon-placeholder\\'>TV</div>'">`
                               : '<div class="stream-icon-placeholder">TV</div>';
      const infoHtml = isRunning && (si.video_codec || si.bitrate) ? `<div class="stream-info-cell">
        <span class="si-label">Video</span><span class="si-value">${escHtml(si.video_codec || '-')}</span>
        <span class="si-label">Audio</span><span class="si-value">${escHtml(si.audio_codec || '-')}</span>
        <span class="si-label">Res</span><span class="si-value">${si.width && si.height ? si.width + 'x' + si.height : '-'}</span>
        <span class="si-label">Bitrate</span><span class="si-value">${si.bitrate ? si.bitrate + ' kbps' : '-'}</span>
        <span class="si-label">FPS</span><span class="si-value">${si.current_fps || si.fps || '-'}</span>
        <span class="si-label">Speed</span><span class="si-value">${si.speed ? si.speed + 'x' : '-'}</span>
      </div>` : '<span style="color:#484f58;font-size:.7rem">Offline</span>';
      const st = ch.status || '';
      const playDisabled = st !== 'running' && !(ch.on_demand && st !== 'error');

      return `<tr>
        <td><code style="font-size:.7rem">${escHtml(ch.id || '')}</code></td>
        <td>${logo}</td>
        <td>
          <div style="font-weight:500;color:#f0f6fc">${escHtml(ch.name || '')}${ch.on_demand ? ' <span class="badge badge-info" style="font-size:.65rem;vertical-align:middle" title="On-demand">OD</span>' : ''}${ch.preWarm ? ' <span class="badge" style="font-size:.65rem;vertical-align:middle;background:#238636;color:#fff" title="Pre-warm">PW</span>' : ''}</div>
          <div style="font-size:.65rem;color:#484f58">${escHtml(ch.outputMode || 'copy')} · <span title="Server output">${(ch.outputFormat || 'hls') === 'mpegts' ? 'MPEG-TS' : 'HLS'}</span></div>
        </td>
        <td><span class="clients-badge ${clients > 0 ? 'active' : 'zero'}">${clients}</span></td>
        <td style="font-size:.75rem">${uptime}</td>
        <td>
          <div class="stream-actions">
            ${isRunning
              ? `<button class="btn-icon btn-icon-stop" onclick="APP.stopStream('${ch.id}')" title="Stop"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg></button>
                 <button class="btn-icon btn-icon-restart" onclick="APP.restartStream('${ch.id}')" title="Restart"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>`
              : `<button class="btn-icon btn-icon-start" onclick="APP.startStream('${ch.id}')" title="Start"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`}
            <button class="btn-icon btn-icon-edit" onclick="APP.editStream('${ch.id}')" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="btn-icon btn-icon-logs" onclick="APP.viewStreamLogs('${ch.id}')" title="Logs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            <button class="btn-icon btn-icon-del" onclick="APP.deleteStream('${ch.id}')" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </td>
        <td><button class="btn-icon-play ${playDisabled ? 'disabled' : ''}" onclick="${playDisabled ? '' : `APP.openStreamPlayer('${ch.id}','${escHtml(ch.name || '')}')`}" title="Play"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button></td>
        <td>${infoHtml}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:#484f58;padding:20px">No live streams</td></tr>';

    const pagEl = $('#streamsPagination');
    if (pagEl) {
      if (totalPages <= 1) { pagEl.innerHTML = ''; }
      else {
        let ph = '';
        for (let i = 1; i <= totalPages; i++) {
          ph += `<button class="btn btn-xs ${i === _streamsPage ? 'btn-primary' : 'btn-secondary'}" onclick="APP._streamsGoPage(${i})">${i}</button>`;
        }
        pagEl.innerHTML = ph;
      }
    }
  }

  function _streamsGoPage(p) { _streamsPage = p; renderStreamsTable(); }

  function formatUptime(startedAt) {
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

  async function openStreamForm(chData) {
    await loadRefData();
    const modal = $('#streamModal');
    modal.style.display = 'flex';

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

    $$('#streamModalTabs .xc-tab').forEach((t, i) => {
      t.classList.toggle('active', i === 0);
    });
    $$('#streamModal .xc-tab-panel').forEach((p, i) => {
      p.classList.toggle('active', i === 0);
    });

    if (chData) {
      $('#streamModalTitle').textContent = 'Edit Stream';
      $('#streamFormId').value = chData.id;
      $('#streamName').value = chData.name || '';
      $('#streamLogoUrl').value = chData.logoUrl || '';
      $('#streamCategory').value = chData.category_id || '';
      $('#streamNotes').value = chData.notes || '';

      const sq = Array.isArray(chData.sourceQueue) ? chData.sourceQueue : [];
      const primary = chData.mpdUrl || '';
      _streamSources = primary ? [primary, ...sq] : [...sq];
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

      if (chData.bouquet_ids && Array.isArray(chData.bouquet_ids)) {
        _streamBqTags = chData.bouquet_ids.map(bid => {
          const b = _bouquets.find(x => String(x.id) === String(bid));
          return b ? { id: String(b.id), name: b.bouquet_name || b.name } : { id: String(bid), name: String(bid) };
        });
      }
    } else {
      $('#streamModalTitle').textContent = 'Add Stream';
      $('#streamFormId').value = '';
      ['streamName', 'streamLogoUrl', 'streamNotes', 'streamCustomSid',
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
    }
    await populateStreamServerSelect('#streamPlaylistServer', chData && chData.stream_server_id);
    renderStreamBqTags();
  }

  function closeStreamModal() {
    $('#streamModal').style.display = 'none';
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
        const resp = await fetch('/api/channels/probe-source', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, user_agent: ua, http_proxy: proxy }),
        });
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
    const allSources = _streamSources.filter(Boolean);
    const mpdUrl = allSources[0] || '';
    const sourceQueue = allSources.slice(1);

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
      if (id) {
        await channelFetch(`/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Stream updated');
      } else {
        await channelFetch('', { method: 'POST', body: JSON.stringify(body) });
        toast('Stream created');
      }
      closeStreamModal();
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function startStream(id) {
    try {
      toast('Starting stream...');
      await channelFetch(`/${id}/start`, { method: 'POST' });
      toast('Stream started');
      loadStreams();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function stopStream(id) {
    try {
      await channelFetch(`/${id}/stop`, { method: 'POST' });
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
    if (_currentPage === 'categories-channels') return 'live';
    if (_currentPage === 'categories-movies') return 'movie';
    if (_currentPage === 'categories-series') return 'series';
    return null;
  }

  function reloadCurrentCategoriesPage() {
    const ft = getCategoryFixedTypeFromPage();
    if (ft === 'live') return loadCategoriesForPage('live', 'categoriesTableChannels');
    if (ft === 'movie') return loadCategoriesForPage('movie', 'categoriesTableMovies');
    if (ft === 'series') return loadCategoriesForPage('series', 'categoriesTableSeries');
  }

  async function loadCategoriesForPage(type, tableId) {
    try {
      const data = await apiFetch(`/categories?type=${encodeURIComponent(type)}`);
      const cats = data.categories || [];
      const tbody = $(`#${tableId} tbody`);
      if (!tbody) return;
      tbody.innerHTML = cats.map(c => `
        <tr>
          <td>${c.id}</td>
          <td>${escHtml(c.category_name || '')}</td>
          <td>${c.cat_order || 0}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editCategory(${c.id}, '${escHtml(c.category_name)}', '${escHtml(c.category_type)}', ${c.cat_order || 0})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteCategory(${c.id})">Del</button>
          </td>
        </tr>
      `).join('');
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

  async function loadResellers() {
    try {
      const data = await apiFetch('/resellers');
      const items = data.resellers || [];
      $('#resellersTable tbody').innerHTML = items.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${escHtml(r.username || '')}</td>
          <td>${escHtml(r.email || '')}</td>
          <td>${r.credits || 0}</td>
          <td>${statusBadge(r.status === 1, false, false)}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="APP.editResellerCredits(${r.id})">Credits</button>
          </td>
        </tr>
      `).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function openResellerModal() {
    $('#resellerModal').style.display = 'flex';
    $('#rslFormId').value = '';
    $('#rslUsername').value = '';
    $('#rslPassword').value = '';
    $('#rslEmail').value = '';
    $('#rslCredits').value = 0;
    $('#rslModalTitle').textContent = 'Add Reseller';
  }
  function closeResellerModal() { $('#resellerModal').style.display = 'none'; }

  async function saveReseller() {
    const body = {
      username: $('#rslUsername').value,
      password: $('#rslPassword').value,
      email: $('#rslEmail').value,
      credits: parseFloat($('#rslCredits').value) || 0,
    };
    try {
      await apiFetch('/resellers', { method: 'POST', body: JSON.stringify(body) });
      toast('Reseller created');
      closeResellerModal();
      loadResellers();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function editResellerCredits(id) {
    const credits = prompt('Enter new credit amount:');
    if (credits === null) return;
    try {
      await apiFetch(`/resellers/${id}/credits`, { method: 'PUT', body: JSON.stringify({ credits: parseFloat(credits) }) });
      toast('Credits updated');
      loadResellers();
    } catch (e) { toast(e.message, 'error'); }
  }

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

  /** Keys managed by Streaming tab UI (DB `streaming_*`); hidden from Advanced to avoid duplicates. */
  const STREAMING_DB_SETTING_KEYS = new Set([
    'streaming_prebuffer_enabled', 'streaming_prebuffer_size_mb',
    'streaming_prebuffer_on_demand_min_bytes', 'streaming_prebuffer_on_demand_max_wait_ms',
    'streaming_ingest_style', 'streaming_low_latency_enabled',
    'streaming_minimal_ingest_enabled', 'streaming_prewarm_enabled',
    'streaming_provisioning_enabled',
  ]);

  /** Whitelist: General tab grouped sections (order preserved). */
  const SETTINGS_GENERAL_GROUPS = [
    {
      title: 'Panel identity',
      rows: [
        { key: 'server_name', label: 'Server name', type: 'text' },
        { key: 'domain_name', label: 'Domain name', type: 'text' },
        { key: 'server_protocol', label: 'Protocol (http/https)', type: 'text' },
        { key: 'server_port', label: 'Port', type: 'text' },
      ],
    },
    {
      title: 'TMDb',
      rows: [
        { key: 'tmdb_api_key', label: 'TMDb API key', type: 'text' },
        { key: 'tmdb_language', label: 'TMDb language', type: 'text' },
      ],
    },
    {
      title: 'Security & limits',
      rows: [
        { key: 'allow_countries', label: 'Allowed countries (comma codes, empty = all)', type: 'text' },
        { key: 'auth_flood_limit', label: 'Auth flood limit (per IP)', type: 'text' },
        { key: 'auth_flood_window_sec', label: 'Auth flood window (seconds)', type: 'text' },
        { key: 'bruteforce_max_attempts', label: 'Bruteforce max attempts', type: 'text' },
        { key: 'bruteforce_window_sec', label: 'Bruteforce window (seconds)', type: 'text' },
        { key: 'user_auto_kick_hours', label: 'User auto-kick (hours, 0=off)', type: 'text' },
        { key: 'live_streaming_pass', label: 'Stream signing secret (optional)', type: 'text' },
      ],
    },
    {
      title: 'Features',
      rows: [
        { key: 'disable_player_api', label: 'Disable player API', type: 'toggle' },
        { key: 'disable_ministra', label: 'Disable Ministra', type: 'toggle' },
        { key: 'restrict_playlists', label: 'Restrict playlists', type: 'toggle' },
        { key: 'restrict_same_ip', label: 'Restrict same IP', type: 'toggle' },
        { key: 'disallow_2nd_ip_con', label: 'Disallow 2nd IP connection', type: 'toggle' },
        { key: 'automatic_backups', label: 'Automatic backups', type: 'toggle' },
        { key: 'backup_interval_hours', label: 'Backup interval (hours)', type: 'text' },
        { key: 'cache_playlists', label: 'Cache playlists', type: 'toggle' },
        { key: 'encrypt_playlist', label: 'Encrypt playlist', type: 'toggle' },
        { key: 'detect_restream', label: 'Detect restream', type: 'toggle' },
        { key: 'api_redirect', label: 'API redirect', type: 'toggle' },
        { key: 'legacy_panel_api', label: 'Legacy panel API', type: 'toggle' },
      ],
    },
    {
      title: 'Streaming defaults',
      rows: [
        { key: 'default_stream_server_id', label: 'Default stream server ID (0 = auto: LB → main)', type: 'text' },
        { key: 'stream_user_agent', label: 'Default stream user agent', type: 'text' },
      ],
    },
  ];

  function settingsGeneralKeySet() {
    const s = new Set();
    for (const g of SETTINGS_GENERAL_GROUPS) {
      for (const r of g.rows) s.add(r.key);
    }
    return s;
  }

  function isTruthySetting(val) {
    const v = String(val ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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
  }

  function renderSettingsGeneral(data) {
    const parts = [];
    for (const g of SETTINGS_GENERAL_GROUPS) {
      parts.push(`<h4 class="settings-group-title">${escHtml(g.title)}</h4>`);
      for (const row of g.rows) {
        const val = data[row.key] != null ? String(data[row.key]) : '';
        if (row.type === 'toggle') {
          const id = `sg_${row.key.replace(/[^a-z0-9]/gi, '_')}`;
          parts.push(`
            <div class="form-row settings-pref-row">
              <label for="${id}">${escHtml(row.label)}</label>
              <div class="form-input">
                <label class="toggle"><input type="checkbox" class="setting-toggle" id="${id}" data-key="${escHtml(row.key)}" ${isTruthySetting(val) ? 'checked' : ''}><span class="toggle-slider"></span></label>
              </div>
            </div>`);
        } else {
          parts.push(`
            <div class="form-row settings-pref-row">
              <label>${escHtml(row.label)}</label>
              <div class="form-input"><input type="text" class="form-control setting-input" data-key="${escHtml(row.key)}" value="${escHtml(val)}"></div>
            </div>`);
        }
      }
    }
    return parts.join('');
  }

  async function loadSettings() {
    try {
      await loadStreamingPerformanceSettings();
      const data = await apiFetch('/settings');
      const generalKeys = settingsGeneralKeySet();
      const keys = Object.keys(data).sort();
      const advKeys = keys.filter(k => !generalKeys.has(k) && !STREAMING_DB_SETTING_KEYS.has(k));

      const genEl = $('#settingsFormGeneral');
      if (genEl) genEl.innerHTML = renderSettingsGeneral(data);

      $('#settingsForm').innerHTML = advKeys.map(k => `
        <div class="form-row settings-pref-row">
          <label>${escHtml(k)}</label>
          <div class="form-input"><input type="text" class="form-control setting-input" data-key="${escHtml(k)}" value="${escHtml(String(data[k] || ''))}"></div>
        </div>
      `).join('') + `
        <div class="form-row settings-pref-row">
          <label>Add new key</label>
          <div class="form-input">
            <input type="text" id="newSettingKey" class="form-control" placeholder="key">
            <input type="text" id="newSettingVal" class="form-control mt-1" placeholder="value">
          </div>
        </div>
      `;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function saveSettings() {
    const body = {};
    $$('.setting-input').forEach(el => { body[el.dataset.key] = el.value; });
    $$('.setting-toggle').forEach(el => { body[el.dataset.key] = el.checked ? '1' : '0'; });
    const nk = $('#newSettingKey')?.value?.trim();
    const nv = $('#newSettingVal')?.value;
    if (nk) body[nk] = nv || '';
    try {
      await apiFetch('/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Settings saved');
      loadSettings();
    } catch (e) { toast(e.message, 'error'); }
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

  async function loadServers() {
    try {
      const data = await apiFetch('/servers');
      _serversCache = data.servers || [];
      const rows = _serversCache.map((s) => {
        const cpu = s.health_cpu_pct != null ? Number(s.health_cpu_pct) : null;
        const mem = s.health_mem_pct != null ? Number(s.health_mem_pct) : null;
        const net = s.health_net_mbps != null ? Number(s.health_net_mbps) : null;
        const ping = s.health_ping_ms != null ? Number(s.health_ping_ms) : null;
        const cpuW = cpu != null && Number.isFinite(cpu) ? cpu : 0;
        const memW = mem != null && Number.isFinite(mem) ? mem : 0;
        const netW = net != null && Number.isFinite(net) ? Math.min(100, net * 4) : 0;
        const pingW = ping != null && Number.isFinite(ping) ? Math.min(100, ping / 2) : 0;
        return `
        <tr>
          <td>${serverStatusBadge(s)}</td>
          <td>${escHtml(s.name || '')}</td>
          <td>${escHtml(s.role || '')}</td>
          <td>${escHtml(s.public_host || '')}</td>
          <td>${escHtml(s.public_ip || '')}</td>
          <td>—</td>
          <td><div class="server-gauge-inline" title="Net Mbps"><div class="server-gauge-fill" style="width:${netW}%"></div></div> <small>${net != null && Number.isFinite(net) ? net.toFixed(1) + ' Mb/s' : '—'}</small></td>
          <td><div class="server-gauge-inline"><div class="server-gauge-fill" style="width:${cpuW}%"></div></div> <small>${cpu != null && Number.isFinite(cpu) ? cpu.toFixed(0) + '%' : '—'}</small></td>
          <td><div class="server-gauge-inline"><div class="server-gauge-fill" style="width:${memW}%"></div></div> <small>${mem != null && Number.isFinite(mem) ? mem.toFixed(0) + '%' : '—'}</small></td>
          <td>
            <button class="btn btn-xs btn-secondary" onclick="APP.openServerModal(${s.id})">Edit</button>
            <button class="btn btn-xs btn-danger" onclick="APP.deleteServer(${s.id})">Del</button>
          </td>
        </tr>`;
      });
      const tb = $('#serversTable tbody');
      if (tb) tb.innerHTML = rows.join('') || '<tr><td colspan="10" class="text-muted">No servers yet.</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
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
  }

  async function openServerModal(id) {
    await getAdminFeatures();
    const prov = _adminFeatures && _adminFeatures.serverProvisioning;
    const tabInst = $('#serverTabInstall');
    const formInst = $('#serverInstallForm');
    if (tabInst) tabInst.style.display = prov ? 'inline-block' : 'none';
    if (formInst) formInst.style.display = prov ? 'block' : 'none';

    switchServerModalTab('details');
    $('#serverModal').style.display = 'flex';
    $('#serverModalTitle').textContent = id ? 'Edit server' : 'Add server';
    $('#srvFormId').value = id || '';
    if (!id) {
      $('#srvName').value = '';
      $('#srvRole').value = 'edge';
      $('#srvPublicHost').value = '';
      $('#srvPublicIp').value = '';
      $('#srvPrivateIp').value = '';
      $('#srvMaxClients').value = '0';
      $('#srvSortOrder').value = '0';
      $('#srvNetworkCap').value = '0';
      $('#srvEnabled').checked = true;
      $('#srvProxied').checked = false;
      $('#srvTimeshift').checked = false;
      $('#srvDomains').value = '';
      $('#srvMetaJson').value = '{}';
      const srvLbName = $('#srvLbName');
      if (srvLbName) srvLbName.value = '';
      const srvProvHost = $('#srvProvisionPublicHost');
      if (srvProvHost) srvProvHost.value = '';
      const srvPanelUrlEl = $('#srvPanelUrl');
      if (srvPanelUrlEl && typeof window !== 'undefined' && window.location) {
        srvPanelUrlEl.value = window.location.origin;
      }
      $('#srvPerfHeartbeat').textContent = '—';
      $('#srvPerfAgentVer').textContent = '—';
      ['srvGaugeCpu', 'srvGaugeMem', 'srvGaugeNet', 'srvGaugePing'].forEach((gid) => {
        const el = $(`#${gid}`);
        if (el) el.style.width = '0%';
      });
      ['srvGaugeCpuLbl', 'srvGaugeMemLbl', 'srvGaugeNetLbl', 'srvGaugePingLbl'].forEach((id) => {
        const el = $(`#${id}`);
        if (el) el.textContent = '—';
      });
      return;
    }
    try {
      const s = await apiFetch(`/servers/${id}`);
      $('#srvName').value = s.name || '';
      $('#srvRole').value = s.role || 'edge';
      $('#srvPublicHost').value = s.public_host || '';
      $('#srvPublicIp').value = s.public_ip || '';
      $('#srvPrivateIp').value = s.private_ip || '';
      $('#srvMaxClients').value = String(s.max_clients != null ? s.max_clients : 0);
      $('#srvSortOrder').value = String(s.sort_order != null ? s.sort_order : 0);
      $('#srvNetworkCap').value = String(s.network_mbps_cap != null ? s.network_mbps_cap : 0);
      $('#srvEnabled').checked = !!s.enabled;
      $('#srvProxied').checked = !!s.proxied;
      $('#srvTimeshift').checked = !!s.timeshift_only;
      const domLines = (s.domains || []).map((d) => d.domain).filter(Boolean);
      $('#srvDomains').value = domLines.join('\n');
      $('#srvMetaJson').value = s.meta_json && typeof s.meta_json === 'object' ? JSON.stringify(s.meta_json, null, 2) : (s.meta_json ? String(s.meta_json) : '{}');
      const srvLbNameEd = $('#srvLbName');
      if (srvLbNameEd) srvLbNameEd.value = s.name || '';
      const srvProvHostEd = $('#srvProvisionPublicHost');
      if (srvProvHostEd) srvProvHostEd.value = s.public_host || '';
      const srvPanelUrlEd = $('#srvPanelUrl');
      if (srvPanelUrlEd && typeof window !== 'undefined' && window.location) {
        srvPanelUrlEd.value = window.location.origin;
      }
      $('#srvPerfHeartbeat').textContent = s.last_heartbeat_at || '—';
      $('#srvPerfAgentVer').textContent = s.agent_version || '—';
      const setGauge = (barId, lblId, pct, label) => {
        const b = $(barId);
        const l = $(lblId);
        const w = Math.min(100, Math.max(0, Number(pct) || 0));
        if (b) b.style.width = `${w}%`;
        if (l) l.textContent = label;
      };
      const cpu = s.health_cpu_pct != null ? Number(s.health_cpu_pct) : null;
      const mem = s.health_mem_pct != null ? Number(s.health_mem_pct) : null;
      const net = s.health_net_mbps != null ? Number(s.health_net_mbps) : null;
      const ping = s.health_ping_ms != null ? Number(s.health_ping_ms) : null;
      setGauge('#srvGaugeCpu', '#srvGaugeCpuLbl', cpu != null && Number.isFinite(cpu) ? cpu : 0, cpu != null && Number.isFinite(cpu) ? `${cpu.toFixed(0)}%` : '—');
      setGauge('#srvGaugeMem', '#srvGaugeMemLbl', mem != null && Number.isFinite(mem) ? mem : 0, mem != null && Number.isFinite(mem) ? `${mem.toFixed(0)}%` : '—');
      setGauge('#srvGaugeNet', '#srvGaugeNetLbl', net != null && Number.isFinite(net) ? Math.min(100, net * 4) : 0, net != null && Number.isFinite(net) ? `${net.toFixed(2)} Mb/s` : '—');
      setGauge('#srvGaugePing', '#srvGaugePingLbl', ping != null && Number.isFinite(ping) ? Math.min(100, ping / 2) : 0, ping != null && Number.isFinite(ping) ? `${ping.toFixed(0)} ms` : '—');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function closeServerModal() {
    $('#serverModal').style.display = 'none';
  }

  async function saveServer() {
    const id = $('#srvFormId').value.trim();
    const domains = ($('#srvDomains').value || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    let metaJson = {};
    const mj = ($('#srvMetaJson').value || '').trim();
    if (mj) {
      try { metaJson = JSON.parse(mj); } catch {
        toast('meta_json must be valid JSON', 'error');
        return;
      }
    }
    const body = {
      name: $('#srvName').value,
      role: $('#srvRole').value,
      public_host: $('#srvPublicHost').value,
      public_ip: $('#srvPublicIp').value,
      private_ip: $('#srvPrivateIp').value,
      max_clients: parseInt($('#srvMaxClients').value, 10) || 0,
      sort_order: parseInt($('#srvSortOrder').value, 10) || 0,
      network_mbps_cap: parseInt($('#srvNetworkCap').value, 10) || 0,
      enabled: $('#srvEnabled').checked,
      proxied: $('#srvProxied').checked,
      timeshift_only: $('#srvTimeshift').checked,
      domains,
      meta_json: metaJson,
    };
    try {
      if (id) await apiFetch(`/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await apiFetch('/servers', { method: 'POST', body: JSON.stringify(body) });
      toast('Server saved');
      closeServerModal();
      loadServers();
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
        $('#serverModalTitle').textContent = 'Edit server';
        $('#srvName').value = name;
        $('#srvPublicHost').value = publicHost;
        $('#srvRole').value = 'lb';
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

  async function loadSecurity() {
    try {
      const [ips, uas] = await Promise.all([apiFetch('/security/blocked-ips'), apiFetch('/security/blocked-uas')]);
      $('#blockedIpsTable tbody').innerHTML = (ips.items || []).map(i => `
        <tr><td>${i.id}</td><td>${escHtml(i.ip)}</td><td>${escHtml(i.notes || '')}</td><td>${i.created_at || ''}</td>
        <td><button class="btn btn-xs btn-danger" onclick="APP.removeBlockedIp(${i.id})">Del</button></td></tr>
      `).join('');
      $('#blockedUasTable tbody').innerHTML = (uas.items || []).map(u => `
        <tr><td>${u.id}</td><td>${escHtml(u.user_agent)}</td><td>${escHtml(u.notes || '')}</td><td>${u.created_at || ''}</td>
        <td><button class="btn btn-xs btn-danger" onclick="APP.removeBlockedUa(${u.id})">Del</button></td></tr>
      `).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addBlockedIp() {
    const ip = prompt('Enter IP to block:');
    if (!ip) return;
    try { await apiFetch('/security/blocked-ips', { method: 'POST', body: JSON.stringify({ ip }) }); toast('IP blocked'); loadSecurity(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function addBlockedUa() {
    const ua = prompt('Enter User Agent to block:');
    if (!ua) return;
    try { await apiFetch('/security/blocked-uas', { method: 'POST', body: JSON.stringify({ user_agent: ua }) }); toast('UA blocked'); loadSecurity(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function removeBlockedIp(id) {
    if (!confirm('Unblock?')) return;
    try { await apiFetch(`/security/blocked-ips/${id}`, { method: 'DELETE' }); toast('Removed'); loadSecurity(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function removeBlockedUa(id) {
    if (!confirm('Unblock?')) return;
    try { await apiFetch(`/security/blocked-uas/${id}`, { method: 'DELETE' }); toast('Removed'); loadSecurity(); }
    catch (e) { toast(e.message, 'error'); }
  }

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
    let stored = null;
    try {
      stored = localStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    } catch (_) {}
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
      const [logData, actData] = await Promise.all([apiFetch('/logs'), apiFetch('/activity')]);
      $('#panelLogsTable tbody').innerHTML = (logData.logs || []).map(l => `
        <tr><td>${l.id}</td><td>${escHtml(l.action || '')}</td><td>${escHtml(l.target_type || '')} ${l.target_id || ''}</td><td>${escHtml(l.details || '')}</td><td>${l.created_at || ''}</td></tr>
      `).join('') || '<tr><td colspan="5">No logs</td></tr>';
      $('#activityLogsTable tbody').innerHTML = (actData.activity || []).slice(0, 200).map(a => `
        <tr><td>${a.activity_id || a.id}</td><td>${a.user_id || ''}</td><td>${a.stream_id || ''}</td><td>${escHtml(a.user_ip || '')}</td><td class="text-truncate" style="max-width:200px">${escHtml(a.user_agent || '')}</td><td>${formatDate(a.date || a.created_at)}</td></tr>
      `).join('') || '<tr><td colspan="6">No activity</td></tr>';
    } catch (e) { toast(e.message, 'error'); }
  }

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
    } catch (e) { toast(e.message, 'error'); }
  }

  async function runDbRepair() {
    if (!confirm('Run REPAIR TABLE on core tables now?')) return;
    try {
      const r = await apiFetch('/system/db-repair', { method: 'POST', body: JSON.stringify({}) });
      toast(r.message || 'Repair completed');
      loadDbManager();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Init ────────────────────────────────────────────────────────

  function init() {
    initWizardTabs();
    initTmdbSearch();

    $('#loginForm').addEventListener('submit', doLogin);
    $('#logoutBtn').addEventListener('click', (e) => { e.preventDefault(); doLogout(); });
    $('#sidebarToggle').addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('collapsed');
    });

    $$('.nav-link[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
      });
    });

    window.addEventListener('hashchange', () => {
      const page = location.hash.replace('#', '');
      if (page && page !== _currentPage) navigateTo(page);
    });

    // Filter event listeners
    ['linesSearch', 'linesStatusFilter'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener('input', () => loadLines());
    });
    function debounceLoadMovies(el) {
      clearTimeout(el._t);
      el._t = setTimeout(loadMovies, 300);
    }
    function debounceLoadSeries(el) {
      clearTimeout(el._t);
      el._t = setTimeout(loadSeriesList, 300);
    }
    ['moviesSearch', 'moviesCatFilter', 'moviesSortOrder'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => debounceLoadMovies(el));
      el.addEventListener('change', () => debounceLoadMovies(el));
    });
    ['seriesSearch', 'seriesCatFilter', 'seriesSortOrder'].forEach(id => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => debounceLoadSeries(el));
      el.addEventListener('change', () => debounceLoadSeries(el));
    });
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
    const streamsPerPage = $('#streamsPerPage');
    if (streamsPerPage) streamsPerPage.addEventListener('change', () => { _streamsPage = 1; renderStreamsTable(); });

    $$('#streamModalTabs .xc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const panel = tab.dataset.panel;
        $$('#streamModalTabs .xc-tab').forEach(t => t.classList.toggle('active', t === tab));
        $$('#streamModal .xc-tab-panel').forEach(p => p.classList.toggle('active', p.id === panel));
      });
    });
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

  document.addEventListener('DOMContentLoaded', init);

  window.APP = {
    navigateTo,
    openLineForm,
    editLine,
    saveLine,
    toggleBanLine,
    deleteLine,
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
    previewStreamLogo,
    openStreamPlayer,
    closeStreamPlayer,
    _streamsGoPage,
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
    loadServers,
    openServerModal,
    closeServerModal,
    switchServerModalTab,
    saveServer,
    deleteServer,
    exportNginxUpstream,
    startServerProvision,
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
  };
})();
