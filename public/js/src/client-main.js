// NovaStreams Client Portal - Vite Entry Point
// Converts client-app.js from IIFE to ES6 module format

const API = '/api/client';
let csrfToken = '';

// ─── DOM Helpers ────────────────────────────────────────────────────────────

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function esc(value) {
  if (value == null) return '';
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// ─── Toast Notifications ────────────────────────────────────────────────────

function toast(message, type = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `show ${type}`;
  setTimeout(() => { el.className = ''; }, 3000);
}

// ─── API Client ─────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const options = opts || {};
  const res = await fetch(API + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function ensureCsrfToken(forceRefresh = false) {
  if (csrfToken && !forceRefresh) return csrfToken;
  const data = await apiFetch('/csrf-token');
  csrfToken = data.csrfToken || '';
  if (!csrfToken) throw new Error('Missing CSRF token');
  return csrfToken;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function loadMe() {
  const data = await apiFetch('/me');
  $('#headerUsername').textContent = data.username;

  const expiry = data.exp_date ? new Date(data.exp_date * 1000).toLocaleDateString() : 'Never';
  const expired = data.expired;
  const statusEl = $('#statExpiry');
  statusEl.textContent = expiry;
  statusEl.className = `status-value ${expired ? 'error' : 'ok'}`;

  const statusText = data.expired ? 'Expired' : data.enabled ? 'Active' : 'Disabled';
  const statusColor = data.expired ? 'error' : data.enabled ? 'ok' : 'warn';
  const statStatus = $('#statStatus');
  statStatus.textContent = statusText;
  statStatus.className = `status-value ${statusColor}`;

  $('#statConnections').textContent = data.active_connections || 0;
  $('#statMaxConn').textContent = data.max_connections || 1;

  loadConnections();
}

async function loadConnections() {
  const loading = $('#connectionsLoading');
  const table = $('#connectionsTable');
  try {
    const data = await apiFetch('/connections');
    const conns = data.connections || [];
    if (conns.length === 0) {
      loading.textContent = 'No active connections';
      return;
    }
    loading.style.display = 'none';
    table.style.display = 'table';
    table.querySelector('tbody').innerHTML = conns.map((conn) => `
      <tr>
        <td><code style="font-size:0.82rem">${esc(conn.ip || '—')}</code></td>
        <td><span class="conn-badge ${conn.active ? 'active' : 'expired'}">${conn.active ? 'Active' : 'Expired'}</span></td>
        <td>${conn.date_start ? new Date(conn.date_start * 1000).toLocaleString() : '—'}</td>
      </tr>`).join('');
  } catch (_) {
    loading.textContent = 'Could not load connections';
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function downloadPlaylist() {
  try {
    const res = await fetch(API + '/playlist', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'playlist.m3u';
    link.click();
    URL.revokeObjectURL(url);
    toast('Playlist downloaded', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function downloadEpg() {
  try {
    const res = await fetch(API + '/epg', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'epg.xml';
    link.click();
    URL.revokeObjectURL(url);
    toast('EPG downloaded', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function changePassword() {
  const current = $('#pwCurrent').value;
  const next = $('#pwNew').value;
  const confirm = $('#pwConfirm').value;
  if (!current || !next) return toast('All fields required', 'error');
  if (next !== confirm) return toast('New passwords do not match', 'error');
  if (next.length < 4) return toast('Password too short', 'error');
  try {
    const token = await ensureCsrfToken();
    await apiFetch('/password', {
      method: 'PUT',
      headers: { 'X-CSRF-Token': token },
      body: { current_password: current, new_password: next },
    });
    toast('Password updated', 'success');
    $('#pwCurrent').value = '';
    $('#pwNew').value = '';
    $('#pwConfirm').value = '';
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function logout() {
  try {
    const token = await ensureCsrfToken();
    await fetch(API + '/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': token },
    });
  } catch (_) {
    // Ignore logout network failures and force reload.
  }
  location.reload();
}

// ─── Action Delegation ──────────────────────────────────────────────────────

const actions = {
  logout,
  downloadPlaylist,
  downloadEpg,
  changePassword,
};

function bindActionDelegates() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-client-action]');
    if (!target) return;
    const action = target.dataset.clientAction;
    const handler = action && actions[action];
    if (typeof handler !== 'function') return;
    event.preventDefault();
    handler();
  });
}

// ─── Init ───────────────────────────────────────────────────────────────────

function init() {
  bindActionDelegates();

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#loginUser').value;
    const password = $('#loginPass').value;
    const errEl = $('#loginError');
    errEl.style.display = 'none';
    try {
      const csrf = await ensureCsrfToken();
      const data = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
      }).then((r) => r.json());
      if (data.error) {
        errEl.textContent = data.error;
        errEl.style.display = 'block';
        return;
      }
      csrfToken = '';
      $('#app-login').style.display = 'none';
      $('#app-panel').style.display = 'block';
      loadMe();
    } catch (_) {
      errEl.textContent = 'Login failed. Check your credentials.';
      errEl.style.display = 'block';
    }
  });

  // Auto-login check
  (async () => {
    try {
      await loadMe();
      $('#app-login').style.display = 'none';
      $('#app-panel').style.display = 'block';
    } catch (_) {
      $('#app-login').style.display = 'flex';
      $('#app-panel').style.display = 'none';
    }
  })();
}

// Expose actions globally for inline onclick handlers (temporary bridge)
window.ClientActions = actions;

document.addEventListener('DOMContentLoaded', init);
