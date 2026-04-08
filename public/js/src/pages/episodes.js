// pages/episodes.js - NovaStreams Panel Episodes Management Page Module

function populateSeriesFilter(ctx) {
  const select = ctx.$('#episodesSeriesFilter');
  const modalSelect = ctx.$('#standaloneEpSeries');
  if (select) {
    const current = select.value || '';
    select.innerHTML = ['<option value="">All Series</option>']
      .concat((ctx.getSeriesCache() || []).map((series) => `<option value="${series.id}">${ctx.escHtml(series.name || series.title || `Series ${series.id}`)}</option>`))
      .join('');
    select.value = current;
  }
  if (modalSelect) {
    const current = modalSelect.value || '';
    modalSelect.innerHTML = ['<option value="">Select series...</option>']
      .concat((ctx.getSeriesCache() || []).map((series) => `<option value="${series.id}">${ctx.escHtml(series.name || series.title || `Series ${series.id}`)}</option>`))
      .join('');
    modalSelect.value = current;
  }
}

function fillEpisodeForm(prefix, episode) {
  document.getElementById(`${prefix}Season`).value = episode?.season_num || episode?.season_number || 1;
  document.getElementById(`${prefix}Num`).value = episode?.episode_num || episode?.episode_number || 1;
  document.getElementById(`${prefix}Title`).value = episode?.title || '';
  document.getElementById(`${prefix}Url`).value = episode?.stream_url || '';
  document.getElementById(prefix === 'standaloneEp' ? 'standaloneEpExt' : 'episodeExtension').value = episode?.container_extension || 'mp4';
  document.getElementById(prefix === 'standaloneEp' ? 'standaloneEpServer' : 'episodeServer').value = String(episode?.stream_server_id || 0);
}

function collectEpisodeBody(prefix) {
  return {
    season_num: parseInt(document.getElementById(`${prefix}Season`).value || '1', 10) || 1,
    episode_num: parseInt(document.getElementById(`${prefix}Num`).value || '1', 10) || 1,
    title: document.getElementById(`${prefix}Title`).value.trim(),
    stream_url: document.getElementById(`${prefix}Url`).value.trim(),
    stream_source: document.getElementById(`${prefix}Url`).value.trim(),
    container_extension: document.getElementById(prefix === 'standaloneEp' ? 'standaloneEpExt' : 'episodeExtension').value || 'mp4',
    stream_server_id: parseInt(document.getElementById(prefix === 'standaloneEp' ? 'standaloneEpServer' : 'episodeServer').value || '0', 10) || 0,
  };
}

export async function loadAllEpisodes(ctx) {
  try {
    await ctx.loadRefData();
    if (!ctx.getSeriesCache().length) {
      const seriesData = await ctx.apiFetch('/series').catch(() => ({ series: [] }));
      ctx.setSeriesCache(seriesData.series || []);
    }
    populateSeriesFilter(ctx);

    const search = ctx.$('#episodesSearch')?.value?.trim() || '';
    const seriesId = ctx.$('#episodesSeriesFilter')?.value || '';
    const perPage = parseInt(ctx.$('#episodesPerPage')?.value || '50', 10) || 50;
    const data = await ctx.apiFetch(`/episodes?search=${encodeURIComponent(search)}${seriesId ? `&series_id=${encodeURIComponent(seriesId)}` : ''}&limit=${perPage}&offset=0`);
    ctx.setAllEpisodes(data.episodes || []);
    ctx.renderEpisodesTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderEpisodesTable(ctx) {
  const allEpisodes = ctx.getAllEpisodes() || [];
  const tbody = ctx.$('#allEpisodesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = allEpisodes.map((ep) => `
    <tr>
      <td>${ep.id}</td>
      <td>${ep.series_cover ? `<img src="${ctx.escHtml(ep.series_cover)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : '—'}</td>
      <td>
        <div>${ctx.escHtml(ep.title || '—')}</div>
        <div style="color:#8b949e;font-size:.85rem">${ctx.escHtml(ep.series_title || 'Unknown series')} · S${ep.season_num || 0}E${ep.episode_num || 0}</div>
      </td>
      <td>${ctx.getStreamServerName({ stream_server_id: ep.stream_server_id })}</td>
      <td>${Number(ep.stream_server_id || 0) > 0 ? 'Assigned' : 'Default'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editEpisode" data-app-args="${ep.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteEpisode" data-app-args="${ep.id}">Delete</button>
      </td>
      <td><code>${ctx.escHtml(ep.stream_url || '—')}</code></td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#8b949e;text-align:center;padding:1rem">No episodes found</td></tr>';
}

export async function openEpisodeForm(ctx, episodeId = null) {
  await ctx.loadRefData();
  await ctx.ensureServersCacheForPlaylist();
  const modal = ctx.$('#episodeModal');
  if (!modal) return;
  ctx.populateSelect('#episodeServer', [{ id: 0, name: 'Inherit from series' }, ...ctx.getServersCache()], 'id', 'name');
  const currentSeriesId = ctx.$('#seriesFormId')?.value || ctx.$('#episodeSeriesId')?.value || '';
  ctx.$('#episodeSeriesId').value = currentSeriesId;
  ctx.$('#episodeFormId').value = '';
  ctx.$('#episodeFormTitle').textContent = episodeId ? 'Edit Episode' : 'Add Episode';
  fillEpisodeForm('episode', null);
  if (episodeId) {
    const episode = await ctx.apiFetch(`/episodes/${episodeId}`);
    ctx.$('#episodeFormId').value = episode.id || '';
    ctx.$('#episodeSeriesId').value = episode.series_id || currentSeriesId;
    fillEpisodeForm('episode', episode);
  }
  modal.style.display = 'flex';
}

export function closeEpisodeModal(ctx) {
  const modal = ctx.$('#episodeModal');
  if (modal) modal.style.display = 'none';
}

export async function saveEpisode(ctx) {
  const episodeId = ctx.$('#episodeFormId')?.value || '';
  const seriesId = ctx.$('#episodeSeriesId')?.value || ctx.$('#seriesFormId')?.value || '';
  const body = collectEpisodeBody('episode');
  if (!seriesId && !episodeId) return ctx.toast('Series is required', 'error');
  if (!body.title) return ctx.toast('Episode title is required', 'error');
  if (!body.stream_url) return ctx.toast('Episode URL is required', 'error');
  if (episodeId) await ctx.apiFetch(`/episodes/${episodeId}`, { method: 'PUT', body: JSON.stringify(body) });
  else await ctx.apiFetch(`/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(body) });
  ctx.toast(episodeId ? 'Episode updated' : 'Episode created');
  closeEpisodeModal(ctx);
  if (ctx.getCurrentPage() === 'episodes') return loadAllEpisodes(ctx);
  const seriesData = await ctx.apiFetch(`/series/${seriesId}`);
  const seriesModule = await import('./series.js');
  return seriesModule.openSeriesForm(ctx, seriesData.id);
}

export async function openStandaloneEpisodeForm(ctx, episodeId = null) {
  await ctx.loadRefData();
  await ctx.ensureServersCacheForPlaylist();
  populateSeriesFilter(ctx);
  ctx.populateSelect('#standaloneEpServer', [{ id: 0, name: 'Inherit from series' }, ...ctx.getServersCache()], 'id', 'name');
  const modal = ctx.$('#standaloneEpisodeModal');
  if (!modal) return;
  ctx.$('#standaloneEpisodeModal').dataset.editId = '';
  fillEpisodeForm('standaloneEp', null);
  if (episodeId) {
    const episode = await ctx.apiFetch(`/episodes/${episodeId}`);
    ctx.$('#standaloneEpisodeModal').dataset.editId = String(episode.id || '');
    ctx.$('#standaloneEpSeries').value = String(episode.series_id || '');
    fillEpisodeForm('standaloneEp', episode);
  } else {
    ctx.$('#standaloneEpSeries').value = '';
  }
  modal.style.display = 'flex';
}

export function closeStandaloneEpisodeModal(ctx) {
  const modal = ctx.$('#standaloneEpisodeModal');
  if (modal) modal.style.display = 'none';
}

export async function saveStandaloneEpisode(ctx) {
  const modal = ctx.$('#standaloneEpisodeModal');
  const episodeId = modal?.dataset.editId || '';
  const seriesId = ctx.$('#standaloneEpSeries')?.value || '';
  const body = collectEpisodeBody('standaloneEp');
  if (!seriesId && !episodeId) return ctx.toast('Select a series', 'error');
  if (!body.title) return ctx.toast('Episode title is required', 'error');
  if (!body.stream_url) return ctx.toast('Episode URL is required', 'error');
  if (episodeId) await ctx.apiFetch(`/episodes/${episodeId}`, { method: 'PUT', body: JSON.stringify(body) });
  else await ctx.apiFetch(`/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(body) });
  ctx.toast(episodeId ? 'Episode updated' : 'Episode created');
  closeStandaloneEpisodeModal(ctx);
  return loadAllEpisodes(ctx);
}

export async function editEpisode(ctx, id) {
  if (ctx.getCurrentPage() === 'series-form') return openEpisodeForm(ctx, id);
  return openStandaloneEpisodeForm(ctx, id);
}

export async function deleteEpisode(ctx, id) {
  if (!(await ctx.showConfirm('Delete this episode?'))) return;
  await ctx.apiFetch(`/episodes/${id}`, { method: 'DELETE' });
  ctx.toast('Episode deleted');
  if (ctx.getCurrentPage() === 'episodes') return loadAllEpisodes(ctx);
  const seriesId = ctx.$('#seriesFormId')?.value;
  if (seriesId) {
    const seriesModule = await import('./series.js');
    return seriesModule.openSeriesForm(ctx, seriesId);
  }
}

export function goEpisodesPage(page) {
  return window.APP._goEpisodesPage(page);
}
