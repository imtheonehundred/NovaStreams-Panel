// pages/lines.js - Extracted from modules/lines.js + app.js lines code
// NovaStreams Panel Lines/Users Management Page Module

function lineStatusBadge(line) {
  const now = Math.floor(Date.now() / 1000);
  if (line.admin_enabled === 0) return '<span class="badge badge-danger">Banned</span>';
  if (line.enabled === 0) return '<span class="badge badge-secondary">Disabled</span>';
  if (line.exp_date && line.exp_date < now) return '<span class="badge badge-warning">Expired</span>';
  if (line.is_trial) return '<span class="badge badge-info">Trial</span>';
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

function renderLinesPagination(ctx, total, perPage, pageCount, startIndex) {
  const bar = ctx.$('#linesPagination');
  if (!bar) return;
  const page = ctx.getLinesPage();
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total ? startIndex + 1 : 0;
  const end = total ? Math.min(total, startIndex + pageCount) : 0;
  const pageInfo = `<span class="page-label">Showing</span> <span class="page-info">${start}-${end}</span> <span class="page-sep">/</span> <span class="page-total">${total}</span>`;
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  let buttons = `<button class="page-btn" ${prevDisabled} data-lines-page="${page - 1}">&lsaquo;</button>`;
  const maxButtons = 7;
  let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);
  for (let p = startPage; p <= endPage; p += 1) {
    const active = p === page ? 'btn-primary' : 'btn-secondary';
    buttons += `<button class="btn btn-xs ${active}" data-lines-page="${p}">${p}</button>`;
  }
  buttons += `<button class="page-btn" ${nextDisabled} data-lines-page="${page + 1}">&rsaquo;</button>`;
  bar.innerHTML = `${pageInfo}${buttons}`;
}

function bindLinesPage(ctx) {
  const page = ctx.$('#page-lines');
  if (!page || page.dataset.linesBound === 'true') return;
  page.dataset.linesBound = 'true';

  page.addEventListener('click', (event) => {
    const pageBtn = event.target.closest('[data-lines-page]');
    if (pageBtn && !pageBtn.disabled) {
      event.preventDefault();
      ctx.setLinesPage(parseInt(pageBtn.dataset.linesPage, 10) || 1);
      loadLines(ctx, { silent: true });
      return;
    }

    const actionBtn = event.target.closest('[data-lines-action]');
    if (!actionBtn) return;
    event.preventDefault();
    const lineId = actionBtn.dataset.lineId;
    const action = actionBtn.dataset.linesAction;
    if (action === 'edit') ctx.navigateTo('add-user', { ctx, id: lineId });
    if (action === 'delete') window.APP.deleteLine(lineId);
    if (action === 'stats') window.APP.openLineStats(lineId);
  });

  ['#linesSearch', '#linesStatusFilter', '#linesResellerFilter', '#linesTypeFilter', '#linesPackageFilter'].forEach((selector) => {
    const el = ctx.$(selector);
    if (!el) return;
    el.addEventListener('input', () => {
      ctx.setLinesPage(1);
      loadLines(ctx, { silent: true });
    });
    el.addEventListener('change', () => {
      ctx.setLinesPage(1);
      loadLines(ctx, { silent: true });
    });
  });

  const perPage = ctx.$('#linesPerPage');
  if (perPage) {
    perPage.addEventListener('change', () => {
      ctx.setLinesPage(1);
      ctx.setLinesPerPage(parseInt(perPage.value, 10) || 50);
      loadLines(ctx, { silent: true });
    });
  }
}

export async function loadLines(ctx, options = {}) {
  bindLinesPage(ctx);
  const { silent = false } = options;
  try {
    await ctx.ensureResellersCache();
    const data = await ctx.apiFetch('/lines');
    const lines = data.lines || [];
    const resellerSel = ctx.$('#linesResellerFilter');
    const resellersCache = ctx.getResellersCache();
    if (resellerSel) {
      const current = resellerSel.value;
      resellerSel.innerHTML = '<option value="">All Resellers</option><option value="0">Admin</option>' +
        (resellersCache || []).map((row) => `<option value="${row.id}">${ctx.escHtml(row.username)}</option>`).join('');
      resellerSel.value = current;
    }
    const pkgSel = ctx.$('#linesPackageFilter');
    if (pkgSel) {
      const current = pkgSel.value;
      ctx.populateSelect('#linesPackageFilter', ctx.getPackages(), 'id', 'package_name', 'All Packages');
      pkgSel.value = current;
    }
    const search = (ctx.$('#linesSearch')?.value || '').toLowerCase();
    const statusF = ctx.$('#linesStatusFilter')?.value || '';
    const resellerF = ctx.$('#linesResellerFilter')?.value ?? '';
    const typeF = ctx.$('#linesTypeFilter')?.value || '';
    const pkgF = ctx.$('#linesPackageFilter')?.value || '';
    const now = Math.floor(Date.now() / 1000);
    const filtered = lines.filter((line) => {
      const hay = [line.username, line.password, line.id].map((value) => String(value || '').toLowerCase()).join(' ');
      if (search && !hay.includes(search)) return false;
      if (resellerF !== '') {
        const memberId = String(line.member_id || 0);
        if (memberId !== String(resellerF)) return false;
      }
      if (typeF === 'trial' && !line.is_trial) return false;
      if (typeF === 'paid' && line.is_trial) return false;
      if (pkgF && String(line.package_id || '') !== String(pkgF)) return false;
      if (statusF === 'active' && (line.admin_enabled !== 1 || line.enabled !== 1 || (line.exp_date && line.exp_date < now))) return false;
      if (statusF === 'trial' && !line.is_trial) return false;
      if (statusF === 'banned' && line.admin_enabled !== 0) return false;
      if (statusF === 'expired' && !(line.exp_date && line.exp_date < now)) return false;
      if (statusF === 'disabled' && line.enabled !== 0) return false;
      return true;
    });
    const perPage = Math.max(1, parseInt(ctx.$('#linesPerPage')?.value || ctx.getLinesPerPage(), 10) || 50);
    ctx.setLinesPerPage(perPage);
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    if (ctx.getLinesPage() > totalPages) ctx.setLinesPage(totalPages);
    if (ctx.getLinesPage() < 1) ctx.setLinesPage(1);
    const start = (ctx.getLinesPage() - 1) * perPage;
    const pageRows = filtered.slice(start, start + perPage);
    const tbody = ctx.$('#linesTable tbody');
    if (!tbody) return;
    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#8b949e;padding:2rem">No lines found</td></tr>';
      renderLinesPagination(ctx, 0, perPage, 0, 0);
      return;
    }
    tbody.innerHTML = pageRows.map((line) => {
      const resellerLabel = ctx.getResellerLabel(line.member_id);
      const pkgName = ctx.getPackages().find((p) => String(p.id) === String(line.package_id))?.package_name || '—';
      const outputs = (() => { try { return JSON.parse(line.outputs_json || line.outputs || '[]'); } catch { return []; } })();
      const outputLabel = outputs.length ? outputs.slice(0, 3).join(', ') + (outputs.length > 3 ? ` +${outputs.length - 3}` : '') : '—';
      return `<tr data-line-id="${line.id}">
        <td><span class="mono">${line.id}</span></td>
        <td><div class="lines-username-cell"><strong>${ctx.escHtml(line.username || '—')}</strong><small>${ctx.escHtml(line.password || '—')}</small></div></td>
        <td>${lineStatusBadge(line)}</td>
        <td>${resellerLabel}</td>
        <td>${ctx.escHtml(line.is_trial ? 'Trial' : 'Paid')}</td>
        <td>${ctx.escHtml(pkgName)}</td>
        <td>${outputLabel}</td>
        <td>${line.max_connections || 1}</td>
        <td>${daysLeft(line.exp_date)}</td>
        <td><div class="row-actions"><button class="row-action-btn" data-lines-action="edit" data-line-id="${line.id}" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="row-action-btn danger" data-lines-action="delete" data-line-id="${line.id}" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path></svg></button><button class="row-action-btn" data-lines-action="stats" data-line-id="${line.id}" title="Stats"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg></button></div></td>
      </tr>`;
    }).join('');
    renderLinesPagination(ctx, filtered.length, perPage, pageRows.length, start);
  } catch (e) {
    if (!silent) ctx.toast(`Failed to load lines: ${e.message}`, 'error');
  }
}

export function resetLineFilters(ctx = window.APP_CTX) {
  const search = document.querySelector('#linesSearch');
  const statusF = document.querySelector('#linesStatusFilter');
  const resellerF = document.querySelector('#linesResellerFilter');
  const typeF = document.querySelector('#linesTypeFilter');
  const pkgF = document.querySelector('#linesPackageFilter');
  if (search) search.value = '';
  if (statusF) statusF.value = '';
  if (resellerF) resellerF.value = '';
  if (typeF) typeF.value = '';
  if (pkgF) pkgF.value = '';
  ctx.setLinesPage(1);
  loadLines(ctx, { silent: true });
}

export function toggleLinesAutoRefresh(ctx) {
  ctx.setLinesAutoRefreshEnabled(!ctx.getLinesAutoRefreshEnabled());
  const btn = ctx.$('#linesAutoRefreshBtn');
  if (btn) {
    btn.classList.toggle('is-active', !!ctx.getLinesAutoRefreshEnabled());
    btn.textContent = ctx.getLinesAutoRefreshEnabled() ? 'Auto-Refresh On' : 'Auto-Refresh Off';
  }
  if (ctx.getLinesAutoRefreshEnabled()) loadLines(ctx, { silent: true }).catch(() => {});
  else stopLinesAutoRefresh(ctx);
}

export function stopLinesAutoRefresh(ctx) {
  if (ctx.getLinesAutoRefreshTimer()) {
    clearTimeout(ctx.getLinesAutoRefreshTimer());
    ctx.setLinesAutoRefreshTimer(null);
  }
}
