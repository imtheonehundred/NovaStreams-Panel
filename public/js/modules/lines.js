(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createLinesModule() {
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
      let buttons = `<button class="page-btn" ${prevDisabled} onclick="APP.goLinesPage(${page - 1})">&lsaquo;</button>`;
      const maxButtons = 7;
      let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);
      for (let p = startPage; p <= endPage; p += 1) {
        const active = p === page ? 'btn-primary' : 'btn-secondary';
        buttons += `<button class="btn btn-xs ${active}" onclick="APP.goLinesPage(${p})">${p}</button>`;
      }
      buttons += `<button class="page-btn" ${nextDisabled} onclick="APP.goLinesPage(${page + 1})">&rsaquo;</button>`;
      bar.innerHTML = `${pageInfo}${buttons}`;
    }

    async function loadLines(ctx) {
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
          tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:28px 0">No users found</td></tr>';
        } else {
          tbody.innerHTML = pageRows.map((line) => {
            const badge = lineStatusBadge(line);
            const activeCons = line.active_cons || 0;
            const maxCons = line.max_connections || 1;
            const connColor = activeCons >= maxCons ? '#f85149' : '#3fb950';
            const ownerLabel = ctx.getResellerLabel(line.member_id);
            const banLabel = line.admin_enabled ? 'Ban' : 'Unban';
            const disableLabel = line.enabled ? 'Disable' : 'Enable';
            return `<tr>
              <td>${line.id}</td>
              <td>${ctx.escHtml(line.username || '')}</td>
              <td>${ctx.escHtml(line.password || '')}</td>
              <td>${ownerLabel}</td>
              <td>${badge}</td>
              <td>${line.exp_date ? ctx.formatDate(line.exp_date) : '<span style="color:#8b949e">Never</span>'}</td>
              <td>${daysLeft(line.exp_date)}</td>
              <td><span style="color:${connColor}">${activeCons}</span> / ${maxCons}</td>
              <td>
                <div class="line-actions" data-line-action-wrap="${line.id}">
                  <button class="line-action-btn info-btn" onclick="APP.toggleLineInfoMenu(event, ${line.id})" title="Info"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>
                  <button class="line-action-btn settings-btn" onclick="APP.toggleLineSettingsMenu(event, ${line.id})" title="Actions"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.06a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.06a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.06a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
                  <div class="line-actions-menu" id="lineInfoMenu-${line.id}">
                    <button type="button" class="line-actions-menu-item" onclick="APP.openPlaylistModal(${line.id}, '${ctx.escHtml(line.username || '')}', '${ctx.escHtml(line.password || '')}')">Download Playlist</button>
                    <button type="button" class="line-actions-menu-item" onclick="APP.openLineStats(${line.id})">User Stats</button>
                  </div>
                  <div class="line-actions-menu" id="lineSettingsMenu-${line.id}">
                    <button type="button" class="line-actions-menu-item" onclick="APP.editLine(${line.id})">Edit</button>
                    <button type="button" class="line-actions-menu-item" onclick="APP.openLineRestrictions(${line.id})">Restriction</button>
                    <button type="button" class="line-actions-menu-item" onclick="APP.openLineExtendModal(${line.id})">Extend User</button>
                    <div class="line-actions-divider"></div>
                    <button type="button" class="line-actions-menu-item" onclick="APP.toggleBanLine(${line.id}, ${line.admin_enabled})">${banLabel}</button>
                    <button type="button" class="line-actions-menu-item" onclick="APP.killLineConnections(${line.id})">Kill Connection</button>
                    <button type="button" class="line-actions-menu-item" onclick="APP.toggleDisableLine(${line.id}, ${line.enabled})">${disableLabel}</button>
                    <div class="line-actions-divider"></div>
                    <button type="button" class="line-actions-menu-item danger" onclick="APP.deleteLine(${line.id})">Delete</button>
                  </div>
                </div>
              </td>
            </tr>`;
          }).join('');
        }
        renderLinesPagination(ctx, filtered.length, perPage, pageRows.length, start);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    function goLinesPage(ctx, page) {
      ctx.setLinesPage(Math.max(1, parseInt(page, 10) || 1));
      return loadLines(ctx);
    }

    function resetLineFilters(ctx) {
      if (ctx.$('#linesSearch')) ctx.$('#linesSearch').value = '';
      if (ctx.$('#linesResellerFilter')) ctx.$('#linesResellerFilter').value = '';
      if (ctx.$('#linesStatusFilter')) ctx.$('#linesStatusFilter').value = '';
      if (ctx.$('#linesTypeFilter')) ctx.$('#linesTypeFilter').value = '';
      if (ctx.$('#linesPackageFilter')) ctx.$('#linesPackageFilter').value = '';
      if (ctx.$('#linesPerPage')) ctx.$('#linesPerPage').value = String(ctx.getLinesPerPage());
      ctx.setLinesPage(1);
      return loadLines(ctx);
    }

    async function toggleBanLine(ctx, id, currentEnabled) {
      try {
        await ctx.apiFetch(`/lines/${id}/${currentEnabled ? 'ban' : 'unban'}`, { method: 'POST' });
        ctx.toast(currentEnabled ? 'User banned' : 'User unbanned');
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function deleteLine(ctx, id) {
      if (!confirm('Delete this line?')) return;
      try {
        await ctx.apiFetch(`/lines/${id}`, { method: 'DELETE' });
        ctx.toast('Line deleted');
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function deleteExpiredLines(ctx) {
      if (!confirm('Delete all expired users?')) return;
      try {
        const result = await ctx.apiFetch('/lines/expired/delete', { method: 'POST', body: JSON.stringify({}) });
        ctx.toast(`Deleted ${result.deleted || 0} expired users`);
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    function stopLinesAutoRefresh(ctx) {
      const timer = ctx.getLinesAutoRefreshTimer();
      if (!timer) return;
      clearInterval(timer);
      ctx.setLinesAutoRefreshTimer(null);
      const btn = ctx.$('#linesAutoRefreshBtn');
      if (btn) btn.textContent = 'Auto-Refresh';
    }

    function toggleLinesAutoRefresh(ctx) {
      if (ctx.getLinesAutoRefreshTimer()) {
        stopLinesAutoRefresh(ctx);
        ctx.toast('Auto-refresh disabled', 'info');
        return;
      }
      ctx.setLinesAutoRefreshTimer(setInterval(() => loadLines(ctx), 15000));
      const btn = ctx.$('#linesAutoRefreshBtn');
      if (btn) btn.textContent = 'Auto-Refresh On';
      ctx.toast('Auto-refresh enabled', 'info');
    }

    function createTrialUser(ctx) {
      const trialPkg = ctx.getPackages().find((pkg) => Number(pkg.is_trial) === 1);
      if (!trialPkg) return ctx.toast('No trial package available', 'error');
      return ctx.openLineForm(null, { packageId: trialPkg.id });
    }

    function createPaidUser(ctx) {
      const paidPkg = ctx.getPackages().find((pkg) => Number(pkg.is_trial) !== 1);
      if (!paidPkg) return ctx.toast('No paid package available', 'error');
      return ctx.openLineForm(null, { packageId: paidPkg.id });
    }

    async function toggleDisableLine(ctx, id, enabled) {
      try {
        await ctx.apiFetch(`/lines/${id}`, { method: 'PUT', body: JSON.stringify({ enabled: enabled ? 0 : 1 }) });
        ctx.toast(enabled ? 'User disabled' : 'User enabled');
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function killLineConnections(ctx, id) {
      if (!confirm('Kill all active connections for this user?')) return;
      try {
        const data = await ctx.apiFetch(`/lines/${id}/kill-connections`, { method: 'POST', body: JSON.stringify({}) });
        ctx.toast(`Killed ${data.killed || 0} connection(s)`);
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    function closeLineActionMenus(ctx) {
      ctx.$$('.line-actions-menu.open').forEach((menu) => menu.classList.remove('open'));
    }

    function positionLineActionMenu(ctx, menu, wrap) {
      if (!menu || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      const menuWidth = 210;
      const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
      let left = rect.right - menuWidth;
      if (left < 12) left = 12;
      if (left + menuWidth > viewportW - 12) left = Math.max(12, viewportW - menuWidth - 12);
      let top = rect.bottom + 6;
      const estimatedMenuHeight = Math.min(320, menu.scrollHeight || 240);
      if (top + estimatedMenuHeight > viewportH - 12) top = Math.max(12, rect.top - estimatedMenuHeight - 6);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.maxHeight = `${Math.max(160, viewportH - top - 12)}px`;
    }

    function toggleLineInfoMenu(ctx, event, lineId) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const wrap = document.querySelector(`[data-line-action-wrap="${lineId}"]`);
      const menu = ctx.$(`#lineInfoMenu-${lineId}`);
      if (!wrap || !menu) return;
      const willOpen = !menu.classList.contains('open');
      closeLineActionMenus(ctx);
      if (willOpen) {
        menu.classList.add('open');
        requestAnimationFrame(() => positionLineActionMenu(ctx, menu, wrap));
      }
    }

    function toggleLineSettingsMenu(ctx, event, lineId) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const wrap = document.querySelector(`[data-line-action-wrap="${lineId}"]`);
      const menu = ctx.$(`#lineSettingsMenu-${lineId}`);
      if (!wrap || !menu) return;
      const willOpen = !menu.classList.contains('open');
      closeLineActionMenus(ctx);
      if (willOpen) {
        menu.classList.add('open');
        requestAnimationFrame(() => positionLineActionMenu(ctx, menu, wrap));
      }
    }

    async function loadLineStats(ctx, id) {
      const targetId = id || ctx.getLineStatsTargetId();
      if (!targetId) return;
      try {
        const [line, conns] = await Promise.all([
          ctx.apiFetch(`/lines/${targetId}`),
          ctx.apiFetch(`/lines/${targetId}/connections`),
        ]);
        ctx.$('#lineStatsSubtitle').textContent = `${line.username || 'User'} · ${ctx.lineStatusLabel(line)}`;
        ctx.$('#lineStatsStatus').textContent = ctx.lineStatusLabel(line);
        ctx.$('#lineStatsExpiry').textContent = line.exp_date ? ctx.formatDate(line.exp_date) : 'Never';
        ctx.$('#lineStatsConnections').textContent = String((conns.connections || []).length);
        ctx.$('#lineStatsMaxConn').textContent = String(line.max_connections || 1);
        ctx.$('#lineStatsLastIp').textContent = line.last_ip || '—';
        ctx.$('#lineStatsLastSeen').textContent = line.last_activity ? ctx.formatDate(line.last_activity) : '—';
        const tbody = ctx.$('#lineStatsConnectionsTable tbody');
        if (tbody) {
          const rows = (conns.connections || []).map((conn) => `
            <tr>
              <td>${ctx.escHtml(conn.user_ip || '')}</td>
              <td>${ctx.escHtml(conn.user_agent || '')}</td>
              <td>${ctx.escHtml(String(conn.stream_id || ''))}</td>
              <td>${ctx.escHtml(conn.container || '')}</td>
              <td>${conn.date_start ? ctx.formatDate(conn.date_start) : '-'}</td>
              <td>${ctx.escHtml(conn.geoip_country_code || '')}</td>
            </tr>
          `).join('');
          tbody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:24px 0">No active connections</td></tr>';
        }
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function openLineRestrictions(ctx, id) {
      try {
        const line = await ctx.apiFetch(`/lines/${id}`);
        ctx.$('#lineRestrictionsId').value = line.id;
        ctx.$('#lineRestrictionsIps').value = (line.allowed_ips || []).join('\n');
        ctx.$('#lineRestrictionsUas').value = (line.allowed_ua || []).join('\n');
        ctx.$('#lineRestrictionsModal').style.display = 'flex';
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    function closeLineRestrictionsModal(ctx) {
      ctx.$('#lineRestrictionsModal').style.display = 'none';
    }

    async function saveLineRestrictions(ctx) {
      const id = ctx.$('#lineRestrictionsId').value;
      if (!id) return;
      try {
        await ctx.apiFetch(`/lines/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            allowed_ips: ctx.parseTextareaList('#lineRestrictionsIps'),
            allowed_ua: ctx.parseTextareaList('#lineRestrictionsUas'),
          }),
        });
        ctx.toast('Restrictions updated');
        closeLineRestrictionsModal(ctx);
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function openLineExtendModal(ctx, id) {
      try {
        const line = await ctx.apiFetch(`/lines/${id}`);
        ctx.setLineExtendTarget(line);
        ctx.$('#lineExtendId').value = line.id;
        ctx.$('#lineExtendCurrent').value = line.exp_date ? ctx.formatDate(line.exp_date) : 'Never';
        ctx.$('#lineExtendDays').value = '';
        ctx.$('#lineExtendDate').value = '';
        ctx.$('#lineExtendNever').checked = !line.exp_date;
        const extendNever = ctx.$('#lineExtendNever');
        if (extendNever) {
          extendNever.onchange = () => {
            const dateInput = ctx.$('#lineExtendDate');
            if (extendNever.checked && dateInput) dateInput.value = '';
            if (dateInput) dateInput.disabled = extendNever.checked;
          };
        }
        ctx.$('#lineExtendModal').style.display = 'flex';
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    function closeLineExtendModal(ctx) {
      ctx.$('#lineExtendModal').style.display = 'none';
    }

    async function saveLineExtension(ctx) {
      const id = ctx.$('#lineExtendId').value;
      if (!id) return;
      const never = ctx.$('#lineExtendNever').checked;
      const dateInput = ctx.$('#lineExtendDate').value;
      const days = parseInt(ctx.$('#lineExtendDays').value, 10);
      let expDate = null;
      if (never) expDate = null;
      else if (dateInput) expDate = ctx.parseDateInputValue(dateInput);
      else if (Number.isFinite(days) && days > 0) {
        const current = ctx.getLineExtendTarget();
        const base = current && current.exp_date ? Number(current.exp_date) : Math.floor(Date.now() / 1000);
        expDate = base + (days * 86400);
      }
      try {
        await ctx.apiFetch(`/lines/${id}`, { method: 'PUT', body: JSON.stringify({ exp_date: expDate }) });
        ctx.toast('User extended');
        closeLineExtendModal(ctx);
        await loadLines(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    return {
      loadLines,
      goLinesPage,
      resetLineFilters,
      toggleBanLine,
      deleteLine,
      deleteExpiredLines,
      stopLinesAutoRefresh,
      toggleLinesAutoRefresh,
      createTrialUser,
      createPaidUser,
      toggleDisableLine,
      killLineConnections,
      closeLineActionMenus,
      toggleLineInfoMenu,
      toggleLineSettingsMenu,
      loadLineStats,
      openLineRestrictions,
      closeLineRestrictionsModal,
      saveLineRestrictions,
      openLineExtendModal,
      closeLineExtendModal,
      saveLineExtension,
    };
  }

  root.lines = { createLinesModule };
}());
