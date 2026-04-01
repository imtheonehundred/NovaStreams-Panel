(function () {
  'use strict';

  const API = '/api/reseller';
  let _currentPage = 'dashboard';
  let _packages = [];
  let _bouquets = [];
  let _profile = null;
  let _expiryMediaService = null;

  // CSRF token management
  let _csrfToken = null;
  let _csrfTokenPromise = null;

  async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    if (_csrfTokenPromise) return _csrfTokenPromise;
    _csrfTokenPromise = (async () => {
      try {
        const res = await fetch('/api/auth/csrf-token', {
          method: 'GET',
          credentials: 'same-origin',
        });
        if (res.ok) {
          const data = await res.json();
          _csrfToken = data.csrfToken;
          return _csrfToken;
        }
      } catch (e) {
        console.warn('[CSRF] Failed to fetch token:', e.message);
      } finally {
        _csrfTokenPromise = null;
      }
      return null;
    })();
    return _csrfTokenPromise;
  }

  async function addCsrfHeaders(opts) {
    const method = (opts.method || 'GET').toUpperCase();
    // Only add CSRF for state-changing methods
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return;
    const token = await getCsrfToken();
    if (token) {
      opts.headers = opts.headers || {};
      opts.headers['X-CSRF-Token'] = token;
    }
  }

  /**
   * Check if a 403 error should trigger logout.
   * CSRF validation errors should NOT trigger logout.
   */
  function shouldLogoutOn403(errorMsg) {
    if (!errorMsg) return false;
    const msg = String(errorMsg).toLowerCase();
    // Explicitly DO NOT logout on CSRF errors - user just needs to refresh page
    if (msg.includes('csrf')) return false;
    // Explicitly DO NOT logout on validation/business rule errors
    const nonAuthPatterns = ['validation failed', 'already exists', 'not found', 'invalid input'];
    if (nonAuthPatterns.some(pattern => msg.includes(pattern))) return false;
    if (msg === 'forbidden') return true;
    // Logout only on true auth failures
    const authPatterns = ['unauthorized', 'authentication failed', 'invalid username or password', 'access code invalid', 'account disabled'];
    return authPatterns.some(pattern => msg.includes(pattern));
  }

  async function apiFetch(path, opts = {}) {
    await addCsrfHeaders(opts);
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

    // Handle 401 as explicit auth failure
    if (res.status === 401) {
      showLogin();
      throw new Error((data && data.error) || 'unauthorized');
    }

    // Handle 403 - only logout on true auth failures, not CSRF/validation errors
    if (res.status === 403) {
      const errorMsg = (data && data.error) || '';
      if (shouldLogoutOn403(errorMsg)) {
        showLogin();
      }
      throw new Error(errorMsg || 'forbidden');
    }

    if (!isJson) throw new Error(`Unexpected non-JSON response (${res.status})`);
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

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

  function applyResellerProfileState(profile) {
    _profile = profile || null;
    const expiryNav = $('#expiryMediaNav');
    if (expiryNav) expiryNav.style.display = profile && Number(profile.manage_expiry_media) === 1 ? '' : 'none';
    const announcementWrap = $('#dashAnnouncement');
    const announcementBody = $('#dashAnnouncementBody');
    const html = profile && profile.notice_html ? String(profile.notice_html).trim() : '';
    if (announcementWrap && announcementBody) {
      if (html) {
        announcementBody.innerHTML = html;
        announcementWrap.style.display = '';
      } else {
        announcementBody.innerHTML = '';
        announcementWrap.style.display = 'none';
      }
    }
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
    const saved = hash || (function () { try { return localStorage.getItem('rslLastPage'); } catch { return ''; } })();
    navigateTo(saved || 'dashboard');
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
      if (data.role && data.role !== 'reseller') throw new Error('This account must use admin access code URL');
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
        if (user && user.role === 'reseller' && data.portalRole === 'reseller') {
          $('#topbarUser').textContent = user.username || '';
          showPanel();
        } else {
          showLogin();
        }
      } else {
        showLogin();
      }
    } catch { showLogin(); }
  }

  async function doLogout() {
    const opts = { method: 'POST', credentials: 'same-origin' };
    await addCsrfHeaders(opts);
    await fetch('/api/auth/logout', opts);
    showLogin();
  }

  // ─── Navigation ──────────────────────────────────────────────────

  function navigateTo(page) {
    _currentPage = page;
    location.hash = page;
    try { localStorage.setItem('rslLastPage', page); } catch {}
    $$('.page').forEach(p => p.style.display = 'none');
    const el = $(`#page-${page}`);
    if (el) el.style.display = 'block';
    $$('.nav-link').forEach(l => l.classList.remove('active'));
    const link = $(`.nav-link[data-page="${page}"]`);
    if (link) link.classList.add('active');

    const loaders = { dashboard: loadDashboard, lines: loadLines, profile: loadProfile, 'expiry-media': loadExpiryMedia };
    if (loaders[page]) loaders[page]();
  }

  async function loadRefData() {
    try {
      const [pkgData, bqData, credData, profile] = await Promise.all([
        apiFetch('/packages'),
        apiFetch('/bouquets'),
        apiFetch('/credits'),
        apiFetch('/profile'),
      ]);
      _packages = pkgData.packages || [];
      _bouquets = bqData.bouquets || [];
      if (credData.credits !== undefined) {
        $('#topbarCredits').textContent = `Credits: ${credData.credits}`;
      }
      applyResellerProfileState(profile || null);
    } catch {}
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

  // ─── Dashboard ──────────────────────────────────────────────────

  async function loadDashboard() {
    try {
      const [credData, linesData, profile] = await Promise.all([
        apiFetch('/credits'),
        apiFetch('/lines'),
        apiFetch('/profile'),
      ]);
      applyResellerProfileState(profile || null);
      const lines = linesData.lines || [];
      const now = Math.floor(Date.now() / 1000);
      const active = lines.filter(l => l.admin_enabled === 1 && (!l.exp_date || l.exp_date >= now)).length;
      const expired = lines.filter(l => l.exp_date && l.exp_date < now).length;
      const trial = lines.filter(l => l.is_trial).length;

      const welcomeEl = $('#dashWelcome');
      if (welcomeEl && credData.username) welcomeEl.textContent = 'Welcome, ' + credData.username;

      $('#dashStats').innerHTML = `
        <div class="dash-stat-card">
          <div class="dash-stat-icon purple"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${lines.length}</div>
            <div class="dash-stat-label">Connections</div>
          </div>
        </div>
        <div class="dash-stat-card">
          <div class="dash-stat-icon green"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${active}</div>
            <div class="dash-stat-label">Lines Online</div>
          </div>
        </div>
        <div class="dash-stat-card">
          <div class="dash-stat-icon pink"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${active}</div>
            <div class="dash-stat-label">Active Lines</div>
          </div>
        </div>
        <div class="dash-stat-card">
          <div class="dash-stat-icon blue"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
          <div class="dash-stat-info">
            <div class="dash-stat-value">${credData.credits || 0}</div>
            <div class="dash-stat-label">Credits</div>
          </div>
        </div>
      `;
    } catch (e) { console.error(e); }
  }

  // ─── Lines ──────────────────────────────────────────────────────

  async function loadLines() {
    try {
      const data = await apiFetch('/lines');
      const lines = data.lines || [];
      const search = ($('#linesSearch')?.value || '').toLowerCase();
      const filtered = lines.filter(l => {
        if (search && !l.username?.toLowerCase().includes(search)) return false;
        return true;
      });
      const tbody = $('#linesTable tbody');
      const canDelete = _profile && Number(_profile.delete_users) === 1;
      tbody.innerHTML = filtered.map(l => {
        const badge = lineStatusBadge(l);
        const activeCons = l.active_cons || 0;
        const maxCons = l.max_connections || 1;
        const connColor = activeCons >= maxCons ? '#f85149' : '#3fb950';
        return `<tr>
          <td>${l.id}</td>
          <td>${escHtml(l.username || '')}</td>
          <td>${escHtml(l.password || '')}</td>
          <td>${badge}</td>
          <td>${l.exp_date ? formatDate(l.exp_date) : '<span style="color:#8b949e">Never</span>'}</td>
          <td>${daysLeft(l.exp_date)}</td>
          <td><span style="color:${connColor}">${activeCons}</span> / ${maxCons}</td>
          <td>
            <button class="btn btn-xs btn-secondary" onclick="RSL.openPlaylistModal('${escHtml(l.username || '')}', '${escHtml(l.password || '')}')">Playlist</button>
            ${canDelete ? `<button class="btn btn-xs btn-danger" onclick="RSL.deleteLine(${l.id})">Del</button>` : ''}
          </td>
        </tr>`;
      }).join('');
    } catch (e) { toast(e.message, 'error'); }
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
    const cost = pkg.is_trial ? (pkg.trial_credits || 0) : (pkg.official_credits || 0);
    $('#pkgSumConn').textContent = pkg.max_connections || 1;
    $('#pkgSumDuration').textContent = dur;
    $('#pkgSumBouquets').textContent = bqs;
    $('#pkgSumOutputs').textContent = outs;
    $('#pkgSumCredits').textContent = cost;
    sum.style.display = 'block';
  }

  function openLineForm() {
    navigateTo('line-form');
    populateSelect('#linePackage', _packages, 'id', 'package_name', '-- Select Package --');
    const pkgSel = $('#linePackage');
    if (pkgSel) pkgSel.onchange = () => showPackageSummary(pkgSel.value);
    $('#lineFormTitle').textContent = 'Add Line';
    $('#lineFormId').value = '';
    $('#lineUsername').value = '';
    $('#linePassword').value = '';
    $('#linePackageSummary').style.display = 'none';
  }

  async function saveLine() {
    const pkgId = $('#linePackage').value;
    if (!pkgId) return toast('Please select a package', 'error');
    const body = {
      username: $('#lineUsername').value,
      password: $('#linePassword').value,
      package_id: parseInt(pkgId, 10),
    };
    if (!body.username || !body.password) return toast('Username and password required', 'error');
    try {
      await apiFetch('/lines', { method: 'POST', body: JSON.stringify(body) });
      toast('Line created');
      navigateTo('lines');
    } catch (e) {
      if (e.message === 'insufficient_credits') toast('Not enough credits', 'error');
      else if (e.message === 'trial_limit_exceeded') toast('Trial generation limit reached for your group', 'error');
      else if (e.message === 'package_forbidden') toast('This package is not available to your member group', 'error');
      else toast(e.message, 'error');
    }
  }

  async function deleteLine(id) {
    if (!confirm('Delete this line?')) return;
    try {
      await apiFetch(`/lines/${id}`, { method: 'DELETE' });
      toast('Line deleted');
      loadLines();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Profile ────────────────────────────────────────────────────

  async function loadProfile() {
    try {
      const [profile, credData] = await Promise.all([
        apiFetch('/profile'),
        apiFetch('/credits'),
      ]);
      applyResellerProfileState(profile || null);
      $('#profileInfo').innerHTML = `
        <div class="form-row"><label>Username</label><div class="form-input"><strong>${escHtml(profile.username || '')}</strong></div></div>
        <div class="form-row"><label>Email</label><div class="form-input"><strong>${escHtml(profile.email || '-')}</strong></div></div>
        <div class="form-row"><label>Member Group</label><div class="form-input"><strong>${escHtml(profile.group_name || '-')}</strong></div></div>
        <div class="form-row"><label>Credits</label><div class="form-input"><strong style="color:#3fb950;font-size:1.2em">${credData.credits || 0}</strong></div></div>
      `;
      const logs = credData.logs || [];
      $('#creditLogsTable tbody').innerHTML = logs.map(log => `<tr>
        <td style="color:${log.amount >= 0 ? '#3fb950' : '#f85149'}">${log.amount >= 0 ? '+' : ''}${log.amount}</td>
        <td>${escHtml(log.reason || '')}</td>
        <td>${formatDate(log.date)}</td>
      </tr>`).join('');
    } catch (e) { toast(e.message, 'error'); }
  }

  function buildExpiryRow(item = {}) {
    return `<div class="input-with-btn" style="margin-bottom:8px"><input type="text" class="form-control rem-country" placeholder="Country code (blank = default)" value="${escHtml(item.country_code || '')}" style="max-width:180px"><input type="text" class="form-control rem-url" placeholder="https://example.com/media.m3u8" value="${escHtml(item.media_url || '')}"><button class="btn btn-xs btn-danger" onclick="RSL.removeExpiryRow(this)">X</button></div>`;
  }

  function renderExpiryRows(items = []) {
    const expiringWrap = $('#rslExpiryExpiringRows');
    const expiredWrap = $('#rslExpiryExpiredRows');
    if (expiringWrap) {
      const rows = (items || []).filter((item) => item.scenario === 'expiring');
      expiringWrap.innerHTML = (rows.length ? rows : [{}]).map((item) => buildExpiryRow(item)).join('');
    }
    if (expiredWrap) {
      const rows = (items || []).filter((item) => item.scenario === 'expired');
      expiredWrap.innerHTML = (rows.length ? rows : [{}]).map((item) => buildExpiryRow(item)).join('');
    }
  }

  function collectExpiryRows(selector, scenario) {
    const wrap = $(selector);
    if (!wrap) return [];
    return [...wrap.querySelectorAll('.input-with-btn')]
      .map((row, index) => ({
        scenario,
        country_code: row.querySelector('.rem-country')?.value || '',
        media_url: row.querySelector('.rem-url')?.value || '',
        sort_order: index,
      }))
      .filter((item) => String(item.media_url || '').trim());
  }

  async function loadExpiryMedia() {
    try {
      const profile = _profile || await apiFetch('/profile');
      applyResellerProfileState(profile || null);
      if (!profile || Number(profile.manage_expiry_media) !== 1) {
        $('#expiryMediaDenied').style.display = '';
        $('#expiryMediaEditorCard').style.display = 'none';
        return;
      }
      $('#expiryMediaDenied').style.display = 'none';
      $('#expiryMediaEditorCard').style.display = '';
      const data = await apiFetch('/expiry-media');
      _expiryMediaService = data.service || null;
      $('#rslExpiryActive').checked = !_expiryMediaService || Number(_expiryMediaService.active) === 1;
      $('#rslExpiryWindowDays').value = String(_expiryMediaService && _expiryMediaService.warning_window_days || 7);
      $('#rslExpiryRepeatHours').value = String(_expiryMediaService && _expiryMediaService.repeat_interval_hours || 6);
      renderExpiryRows(data.items || []);
    } catch (e) { toast(e.message, 'error'); }
  }

  function addExpiryRow(scenario) {
    const wrap = scenario === 'expiring' ? $('#rslExpiryExpiringRows') : $('#rslExpiryExpiredRows');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend', buildExpiryRow({}));
  }

  function removeExpiryRow(btn) {
    const row = btn && btn.parentElement;
    const wrap = row && row.parentElement;
    if (row) row.remove();
    if (wrap && !wrap.querySelector('.input-with-btn')) wrap.insertAdjacentHTML('beforeend', buildExpiryRow({}));
  }

  async function saveExpiryMedia() {
    try {
      await apiFetch('/expiry-media', {
        method: 'PUT',
        body: JSON.stringify({
          active: $('#rslExpiryActive').checked ? 1 : 0,
          warning_window_days: parseInt($('#rslExpiryWindowDays').value || '7', 10) || 7,
          repeat_interval_hours: parseInt($('#rslExpiryRepeatHours').value || '6', 10) || 6,
          items: [
            ...collectExpiryRows('#rslExpiryExpiringRows', 'expiring'),
            ...collectExpiryRows('#rslExpiryExpiredRows', 'expired'),
          ],
        }),
      });
      toast('Expiry media updated');
      loadExpiryMedia();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Playlist Modal ─────────────────────────────────────────────

  function openPlaylistModal(username, password) {
    const base = `${location.protocol}//${location.host}`;
    $('#plServerUrl').value = base;
    $('#plUsername').value = username || '';
    $('#plPassword').value = password || '';
    $('#plM3uUrl').value = `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`;
    $('#plEpgUrl').value = `${base}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    $('#plXtreamUrl').value = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    $('#playlistModal').style.display = 'flex';
  }

  function closePlaylistModal() { $('#playlistModal').style.display = 'none'; }

  function copyField(fieldId) {
    const el = $(`#${fieldId}`);
    if (!el) return;
    navigator.clipboard.writeText(el.value).then(() => toast('Copied!')).catch(() => toast('Copy failed', 'error'));
  }

  // ─── Init ───────────────────────────────────────────────────────

  function init() {
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

    const lSearch = $('#linesSearch');
    if (lSearch) lSearch.addEventListener('input', () => { clearTimeout(lSearch._t); lSearch._t = setTimeout(loadLines, 300); });

    checkSession();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.RSL = {
    navigateTo,
    openLineForm,
    saveLine,
    deleteLine,
    loadExpiryMedia,
    saveExpiryMedia,
    addExpiryRow,
    removeExpiryRow,
    openPlaylistModal,
    closePlaylistModal,
    copyField,
  };
})();
