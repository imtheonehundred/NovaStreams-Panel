(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createStreamsModule() {
    function stopStreamsAutoRefresh(ctx) {
      if (ctx.getStreamsAutoRefreshTimer()) {
        clearTimeout(ctx.getStreamsAutoRefreshTimer());
        ctx.setStreamsAutoRefreshTimer(null);
      }
    }

    function updateStreamsAutoRefreshButton(ctx) {
      const btn = ctx.$('#streamsAutoRefreshBtn');
      if (!btn) return;
      btn.classList.toggle('is-active', !!ctx.getStreamsAutoRefreshEnabled());
      btn.textContent = ctx.getStreamsAutoRefreshEnabled() ? 'Auto-Refresh On' : 'Auto-Refresh Off';
    }

    function scheduleStreamsAutoRefresh(ctx) {
      stopStreamsAutoRefresh(ctx);
      if (!ctx.getStreamsAutoRefreshEnabled()) return;
      if (!['manage-channels', 'streams'].includes(ctx.getCurrentPage())) return;
      ctx.setStreamsAutoRefreshTimer(setTimeout(() => {
        loadStreams(ctx, { silent: true }).catch(() => {});
      }, 15000));
    }

    function toggleStreamsAutoRefresh(ctx) {
      ctx.setStreamsAutoRefreshEnabled(!ctx.getStreamsAutoRefreshEnabled());
      updateStreamsAutoRefreshButton(ctx);
      if (ctx.getStreamsAutoRefreshEnabled()) loadStreams(ctx, { silent: true }).catch(() => {});
      else stopStreamsAutoRefresh(ctx);
    }

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

    function buildStreamActionButtonsMarkup(ctx, ch) {
      const isRunning = ch.status === 'running';
      const encodedName = encodeURIComponent(String(ch.name || ''));
      const runButtons = isRunning
        ? `<button class="row-action-btn restart-btn" onclick="APP.restartStream('${ch.id}')" title="Restart"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg></button><button class="row-action-btn stop-btn" onclick="APP.stopStream('${ch.id}')" title="Stop"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg></button>`
        : `<button class="row-action-btn start-btn" onclick="APP.startStream('${ch.id}')" title="Start"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
      return `${runButtons}<button class="row-action-btn edit-btn" onclick="APP.editStream('${ch.id}')" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="row-action-btn delete-btn" onclick="APP.deleteStream('${ch.id}')" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg></button><button class="row-action-btn logs-btn" onclick="APP.viewStreamLogs('${ch.id}')" title="Logs"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></button><button class="row-action-btn play-btn" onclick="APP.openStreamPlayer('${ch.id}', decodeURIComponent('${encodedName}'))" title="Play"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
    }

    function buildStreamRowMarkup(ctx, ch) {
      const isRunning = ch.status === 'running';
      const catName = ctx.getCategories().find((c) => String(c.id) === String(ch.category_id))?.category_name || ch.category || '-';
      const si = ch.streamInfo || {};
      const logo = ch.logoUrl
        ? `<img src="${ctx.escHtml(ch.logoUrl)}" alt="${ctx.escHtml(ch.name || '')}" class="channels-table-logo-img" onerror="this.outerHTML='<span class=\'channels-table-logo-fallback\'>Logo</span>'">`
        : '<span class="channels-table-logo-fallback">Logo</span>';
      const serverName = ctx.getStreamServerName(ch);
      const sourceUrl = ctx.getStreamSourceUrl(ch);
      const views = Number(ch.views || ch.clients || 0);
      const codecLine = [si.video_codec ? String(si.video_codec).toLowerCase() : '', si.audio_codec ? String(si.audio_codec).toLowerCase() : ''].filter(Boolean).join(' / ');
      const bitrateLine = si.bitrate ? `${Math.round(si.bitrate / 1000)} Kbps` : 'No information available';
      const resolutionLine = [si.width && si.height ? `${si.width} x ${si.height}` : '', ctx.formatStreamFps(si.fps)].filter(Boolean).join(' · ');
      const statusClass = isRunning ? 'is-running' : ch.status === 'error' ? 'is-error' : 'is-stopped';
      const triggerBtn = isRunning
        ? `<button class="streams-xc-status-trigger stop" onclick="APP.stopStream('${ch.id}')" title="Stop"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg></button>`
        : `<button class="streams-xc-status-trigger start" onclick="APP.startStream('${ch.id}')" title="Start"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
      const epgEnabled = !!(ch.epgChannelId || ch.epg_source_id);
      const uptimeMarkup = ch.on_demand && !ch.startedAt
        ? `<div class="streams-xc-uptime-card is-ondemand"><div class="streams-xc-uptime-pill">ON DEMAND</div><div class="streams-xc-uptime-meta muted">No information available</div></div>`
        : `<div class="streams-xc-uptime-card"><div class="streams-xc-uptime-pill">${ctx.escHtml(formatUptime(ch.startedAt) || 'Stopped')}</div><div class="streams-xc-uptime-meta"><span>${ctx.escHtml(bitrateLine)}</span>${codecLine ? `<span>${ctx.escHtml(codecLine)}</span>` : ''}</div><div class="streams-xc-uptime-meta muted">${ctx.escHtml(resolutionLine || 'No runtime information')}</div></div>`;
      return `<tr>
        <td><div class="streams-xc-id-cell"><span>${ctx.escHtml(String(ch.id || ''))}</span></div></td>
        <td><button type="button" class="channels-table-logo-btn" onclick="APP.openChannelLogoModal('${ch.id}')" title="Change Channel Icon">${logo}</button></td>
        <td><div class="streams-xc-status-cell"><span class="streams-xc-status-light ${statusClass}"></span>${triggerBtn}</div></td>
        <td><div class="streams-xc-name-cell"><div class="streams-xc-primary-name">${ctx.escHtml(ch.name || '')}</div><div class="streams-xc-secondary-name">${ctx.escHtml(catName || 'Uncategorized')}</div></div></td>
        <td><div class="streams-xc-source-cell"><div class="streams-xc-source-label">${ctx.escHtml(serverName)}</div><div class="streams-xc-source-value">${ctx.escHtml(ctx.formatSourceHost(sourceUrl) || '-')}</div></div></td>
        <td><span class="clients-badge ${Number(ch.clients || 0) > 0 ? 'active' : 'zero'}">${Number(ch.clients || 0)}</span></td>
        <td>${uptimeMarkup}</td>
        <td><div class="row-actions streams-xc-row-actions">${buildStreamActionButtonsMarkup(ctx, ch)}</div></td>
        <td><div class="streams-xc-views-cell">${views}</div></td>
        <td><div class="streams-xc-epg-cell"><span class="streams-xc-epg-dot ${epgEnabled ? 'is-on' : 'is-off'}"></span></div></td>
      </tr>`;
    }

    function renderStreamsPagination(ctx, totalPages, totalCount) {
      const wrap = ctx.$('#streamsPagination');
      if (!wrap) return;
      const start = totalCount === 0 ? 0 : ((ctx.getStreamsPage() - 1) * ctx.getStreamsPerPage()) + 1;
      const end = Math.min(totalCount, ctx.getStreamsPage() * ctx.getStreamsPerPage());
      wrap.innerHTML = `<span class='pagination-info'>Showing ${start} to ${end} of ${totalCount} entries</span><div class='pagination-controls'><button class='btn btn-xs btn-secondary' ${ctx.getStreamsPage() <= 1 ? 'disabled' : ''} onclick='APP._streamsGoPage(${ctx.getStreamsPage() - 1})'>&lsaquo;</button><span class='streams-xc-page-pill'>${ctx.getStreamsPage()}</span><button class='btn btn-xs btn-secondary' ${ctx.getStreamsPage() >= totalPages ? 'disabled' : ''} onclick='APP._streamsGoPage(${ctx.getStreamsPage() + 1})'>&rsaquo;</button></div>`;
    }

    function renderStreamsTable(ctx) {
      const search = (ctx.$('#streamsSearch')?.value || '').toLowerCase();
      const statusF = ctx.$('#streamsStatusFilter')?.value || '';
      const catF = ctx.$('#streamsCategoryFilter')?.value || '';
      const serverF = ctx.$('#streamsServerFilter')?.value || '';
      ctx.setStreamsPerPage(parseInt(ctx.$('#streamsPerPage')?.value || String(ctx.getStreamsPerPage() || 25), 10) || 25);
      const perPage = ctx.getStreamsPerPage();
      const filtered = ctx.getStreamsCache().filter((ch) => {
        const haystack = [ch.name || '', ch.id || '', ctx.getStreamSourceUrl(ch), ch.logoUrl || ''].join(' ').toLowerCase();
        if (search && !haystack.includes(search)) return false;
        if (catF && String(ch.category_id || '') !== catF) return false;
        if (serverF !== '' && String(ch.stream_server_id || 0) !== serverF) return false;
        if (statusF === 'running' && ch.status !== 'running') return false;
        if (statusF === 'stopped' && ch.status !== 'stopped') return false;
        if (statusF === 'error' && ch.status !== 'error') return false;
        if (statusF === 'on_demand' && !ch.on_demand) return false;
        return true;
      });
      ctx.setStreamsTotal(filtered.length);
      const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
      if (ctx.getStreamsPage() > totalPages) ctx.setStreamsPage(totalPages);
      if (ctx.getStreamsPage() < 1) ctx.setStreamsPage(1);
      const start = (ctx.getStreamsPage() - 1) * perPage;
      const pageItems = filtered.slice(start, start + perPage);
      const tbody = ctx.$('#streamsTable tbody');
      if (!tbody) return;
      tbody.innerHTML = pageItems.length ? pageItems.map((ch) => buildStreamRowMarkup(ctx, ch)).join('') : '<tr><td colspan="10" style="text-align:center;color:#8b949e;padding:32px 0">No streams found</td></tr>';
      const perPageSel = ctx.$('#streamsPerPage');
      if (perPageSel) perPageSel.value = String(ctx.getStreamsPerPage());
      renderStreamsPagination(ctx, totalPages, filtered.length);
      ctx.makeSortable(ctx.$('#streamsTable'));
    }

    async function loadStreams(ctx, options = {}) {
      try {
        if (!ctx.getCategories().length) await ctx.loadRefData();
        const data = await fetch('/api/channels', { credentials: 'same-origin' });
        const list = await data.json();
        ctx.setStreamsCache(Array.isArray(list) ? list : []);
        await ctx.ensureServersCacheForPlaylist();
        updateStreamsAutoRefreshButton(ctx);
        const liveCats = ctx.getCategories().filter((c) => c.category_type === 'live');
        const catFilter = ctx.$('#streamsCategoryFilter');
        if (catFilter && catFilter.options.length <= 1) {
          liveCats.forEach((cat) => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.category_name;
            catFilter.appendChild(option);
          });
        }
        const serverFilter = ctx.$('#streamsServerFilter');
        if (serverFilter) {
          const currentValue = serverFilter.value || '';
          serverFilter.innerHTML = '<option value="">All Servers</option><option value="0">Line / Default</option>' + ctx.getServersCache().map((server) => `<option value="${server.id}">${ctx.escHtml(String(server.name || `Server ${server.id}`))}</option>`).join('');
          serverFilter.value = currentValue;
        }
        ctx.fetchHealthData().catch(() => {});
        renderStreamsTable(ctx);
        scheduleStreamsAutoRefresh(ctx);
      } catch (e) {
        scheduleStreamsAutoRefresh(ctx);
        if (!options.silent) ctx.toast(e.message, 'error');
      }
    }

    function updateStreamLogoCache(ctx, streamId, logoUrl) {
      const item = ctx.getStreamsCache().find((row) => String(row.id) === String(streamId));
      if (item) item.logoUrl = logoUrl;
      renderStreamsTable(ctx);
    }

    function renderChannelLogoSearchResults(ctx) {
      const wrap = ctx.$('#channelLogoSearchResults');
      if (!wrap) return;
      if (!ctx.getChannelLogoSearchResults().length) {
        wrap.innerHTML = '';
        return;
      }
      wrap.innerHTML = ctx.getChannelLogoSearchResults().map((item) => `
        <div class="channels-logo-result-card">
          <div class="channels-logo-result-preview">${item.logoUrl ? `<img src="${ctx.escHtml(item.logoUrl)}" alt="${ctx.escHtml(item.name || '')}" class="channels-logo-result-image" onerror="this.outerHTML='<span class=\\'channels-table-logo-fallback\\'>Logo</span>'">` : '<span class="channels-table-logo-fallback">Logo</span>'}</div>
          <div class="channels-logo-result-name">${ctx.escHtml(item.name || '')}</div>
          <button class="btn btn-xs btn-primary" onclick="APP.applyChannelLogoResult(decodeURIComponent('${encodeURIComponent(item.logoUrl || '')}'))">Set Icon</button>
        </div>`).join('');
    }

    async function searchChannelLogos(ctx) {
      const query = (ctx.$('#channelLogoSearchQuery')?.value || '').trim();
      const status = ctx.$('#channelLogoSearchStatus');
      if (!query) {
        ctx.setChannelLogoSearchResults([]);
        renderChannelLogoSearchResults(ctx);
        if (status) status.textContent = 'Enter a channel name to search existing panel logos.';
        return;
      }
      if (status) status.textContent = 'Searching existing channel logos...';
      try {
        const target = ctx.getChannelLogoTarget();
        const data = await ctx.api(`/api/channels/logo-search?q=${encodeURIComponent(query)}&exclude_id=${encodeURIComponent(target ? target.id : '')}`);
        ctx.setChannelLogoSearchResults(data.results || []);
        renderChannelLogoSearchResults(ctx);
        if (status) status.textContent = ctx.getChannelLogoSearchResults().length ? `Found ${ctx.getChannelLogoSearchResults().length} matching logo result(s).` : 'No icons found. Try another channel name or set a custom URL.';
      } catch (e) {
        ctx.setChannelLogoSearchResults([]);
        renderChannelLogoSearchResults(ctx);
        if (status) status.textContent = e.message || 'Logo search failed.';
      }
    }

    async function openChannelLogoModal(ctx, id) {
      const stream = ctx.getStreamsCache().find((row) => String(row.id) === String(id));
      if (!stream) return ctx.toast('Channel not found', 'error');
      ctx.setChannelLogoTarget(stream);
      ctx.$('#channelLogoChannelId').value = stream.id;
      ctx.$('#channelLogoChannelName').textContent = stream.name || 'Channel';
      ctx.$('#channelLogoCustomUrl').value = stream.logoUrl || '';
      ctx.$('#channelLogoSearchQuery').value = stream.name || '';
      ctx.$('#channelLogoSearchResults').innerHTML = '';
      ctx.$('#channelLogoSearchStatus').textContent = 'Search current panel channel logos by name.';
      ctx.updateChannelLogoPreview(stream.logoUrl || '', stream.name || 'Channel');
      ctx.$('#channelLogoModal').style.display = 'flex';
      await searchChannelLogos(ctx);
    }

    function closeChannelLogoModal(ctx) {
      ctx.$('#channelLogoModal').style.display = 'none';
      ctx.setChannelLogoTarget(null);
      ctx.setChannelLogoSearchResults([]);
    }

    async function applyChannelLogoResult(ctx, url) {
      const target = ctx.getChannelLogoTarget();
      if (!target) return;
      try {
        await ctx.api(`/api/channels/${encodeURIComponent(target.id)}`, 'PUT', { logoUrl: url });
        updateStreamLogoCache(ctx, target.id, url);
        ctx.updateChannelLogoPreview(url, target.name || 'Channel');
        ctx.$('#channelLogoCustomUrl').value = url;
        ctx.toast('Channel icon updated');
        closeChannelLogoModal(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function saveChannelLogoFromCustomUrl(ctx) {
      const url = (ctx.$('#channelLogoCustomUrl')?.value || '').trim();
      if (!url) return ctx.toast('Enter a logo URL first', 'error');
      if (!/^https?:\/\//i.test(url)) return ctx.toast('Use a direct http or https image URL', 'error');
      return applyChannelLogoResult(ctx, url);
    }

    return {
      formatUptime,
      buildStreamActionButtonsMarkup,
      stopStreamsAutoRefresh,
      toggleStreamsAutoRefresh,
      renderStreamsTable,
      loadStreams,
      openChannelLogoModal,
      closeChannelLogoModal,
      searchChannelLogos,
      applyChannelLogoResult,
      saveChannelLogoFromCustomUrl,
    };
  }

  root.streams = { createStreamsModule };
}());
