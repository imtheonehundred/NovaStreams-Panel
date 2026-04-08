// pages/series.js - NovaStreams Panel Series Management Page Module

let seriesBouquetIds = [];

function bindSeriesUi(ctx) {
  const formPage = ctx.$('#page-series-form');
  if (formPage && formPage.dataset.bound !== 'true') {
    formPage.dataset.bound = 'true';
    formPage.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
      formPage.querySelectorAll('.wizard-tab').forEach((item) => item.classList.toggle('active', item === tab));
      formPage.querySelectorAll('.wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`));
    }));
  }
  const importPage = ctx.$('#page-series-import');
  if (importPage && importPage.dataset.bound !== 'true') {
    importPage.dataset.bound = 'true';
    importPage.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
      importPage.querySelectorAll('.wizard-tab').forEach((item) => item.classList.toggle('active', item === tab));
      importPage.querySelectorAll('.wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`));
    }));
  }
}

function seriesCategories(ctx) {
  return (ctx.getCategories() || []).filter((row) => row.category_type === 'series');
}

function renderSeriesBouquetTags(ctx) {
  const wrap = ctx.$('#seriesBouquetTags');
  if (!wrap) return;
  wrap.innerHTML = seriesBouquetIds.map((id) => {
    const row = (ctx.getBouquets() || []).find((item) => String(item.id) === String(id));
    return `<span class="tag-pill">${ctx.escHtml(row?.bouquet_name || `Bouquet ${id}`)} <button class="tag-pill-remove" data-app-action="removeSeriesBqTag" data-app-args="'${id}'">&times;</button></span>`;
  }).join('');
}

function renderSeriesEpisodes(ctx, series) {
  const panel = ctx.$('#seriesEpisodesPanel');
  const seasonTabs = ctx.$('#seasonTabs');
  const tbody = ctx.$('#episodesTable tbody');
  if (!panel || !seasonTabs || !tbody) return;
  const seasons = series?.seasons || [];
  if (!series?.id) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const activeSeason = seasons[0]?.season_number || 1;
  seasonTabs.innerHTML = seasons.map((season) => `<button class="wizard-tab ${season.season_number === activeSeason ? 'active' : ''}" data-season-number="${season.season_number}">Season ${season.season_number}</button>`).join('');
  const renderSeason = (seasonNumber) => {
    seasonTabs.querySelectorAll('[data-season-number]').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.seasonNumber) === Number(seasonNumber)));
    const season = seasons.find((item) => Number(item.season_number) === Number(seasonNumber)) || { episodes: [] };
    tbody.innerHTML = season.episodes.map((ep) => `
      <tr>
        <td>${ep.episode_num || ep.episode_number || 0}</td>
        <td>${ctx.escHtml(ep.title || '')}</td>
        <td><code>${ctx.escHtml(ep.stream_url || '')}</code></td>
        <td>${ctx.escHtml(ep.container_extension || 'mp4')}</td>
        <td>
          <button class="btn btn-xs btn-primary" data-app-action="editEpisode" data-app-args="${ep.id}">Edit</button>
          <button class="btn btn-xs btn-danger" data-app-action="deleteEpisode" data-app-args="${ep.id}">Delete</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No episodes found</td></tr>';
    };
  if (!seasonTabs.dataset.bound) {
    seasonTabs.dataset.bound = 'true';
    seasonTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-season-number]');
      if (!btn) return;
      renderSeason(btn.dataset.seasonNumber);
    });
  }
  renderSeason(activeSeason);
}

function collectSeriesPayload() {
  return {
    title: document.getElementById('seriesTitle')?.value.trim() || '',
    year: document.getElementById('seriesYear')?.value || null,
    category_id: document.getElementById('seriesCategory')?.value || '',
    cover: document.getElementById('seriesCover')?.value.trim() || '',
    backdrop_path: document.getElementById('seriesBackdrop')?.value.trim() || '',
    plot: document.getElementById('seriesPlot')?.value || '',
    series_cast: document.getElementById('seriesCastField')?.value || '',
    director: document.getElementById('seriesDirector')?.value || '',
    genre: document.getElementById('seriesGenre')?.value || '',
    release_date: document.getElementById('seriesReleaseDate')?.value || '',
    rating: document.getElementById('seriesRating')?.value || '0',
    youtube_trailer: document.getElementById('seriesTrailer')?.value || '',
    tmdb_id: document.getElementById('seriesTmdbId')?.value || null,
    stream_server_id: parseInt(document.getElementById('seriesStreamServer')?.value || '0', 10) || 0,
    bouquet_ids: seriesBouquetIds.map((id) => Number(id)).filter(Boolean),
  };
}

async function readOptionalText(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return '';
  return await file.text();
}

export async function loadSeriesList(ctx) {
  try {
    bindSeriesUi(ctx);
    await ctx.loadRefData();
    const data = await ctx.apiFetch('/series');
    const series = data.series || [];
    ctx.setSeriesCache(series);
    const cats = seriesCategories(ctx);
    ctx.populateSelect('#seriesCatFilter', cats, 'id', 'category_name', 'All Categories');
    ctx.populateSelect('#seriesImportCat', cats, 'id', 'category_name', 'None');
    ctx.populateSelect('#seriesImportBq', ctx.getBouquets(), 'id', 'bouquet_name', 'None');
    ctx.renderSeriesTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderSeriesTable(ctx) {
  const search = (ctx.$('#seriesSearch')?.value || '').toLowerCase();
  const catF = ctx.$('#seriesCatFilter')?.value || '';
  const perPage = ctx.getSeriesPerPage();
  const filtered = ctx.getSeriesCache().filter((s) => {
    if (search && ![s.name, s.id].join(' ').toLowerCase().includes(search)) return false;
    if (catF && String(s.category_id) !== catF) return false;
    return true;
  });
  ctx.setSeriesTotal(filtered.length);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (ctx.getSeriesPage() > totalPages) ctx.setSeriesPage(totalPages);
  if (ctx.getSeriesPage() < 1) ctx.setSeriesPage(1);
  const start = (ctx.getSeriesPage() - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);
  const tbody = ctx.$('#seriesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = pageItems.map((s) => `
    <tr>
      <td>${s.id}</td>
      <td>${s.poster ? `<img src="${ctx.escHtml(s.poster)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : '—'}</td>
      <td>${ctx.escHtml(s.name || '')}</td>
      <td>${s.category_name || '—'}</td>
      <td>${s.season_count || s.seasons || 0}</td>
      <td>${s.rating || '—'}</td>
      <td>${s.tmdb_id || '—'}</td>
      <td>${ctx.getStreamServerName(s)}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editSeries" data-app-args="${s.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteSeries" data-app-args="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="9" style="color:#8b949e;text-align:center;padding:1rem">No series found</td></tr>';
  ctx.renderSeriesPagination(ctx, filtered.length);
  const count = ctx.$('#seriesCount');
  if (count) count.textContent = `${filtered.length} total`;
}

export function renderSeriesPagination(ctx, total) {
  const wrap = ctx.$('#seriesPagination');
  if (!wrap) return;
  const totalPages = Math.max(1, Math.ceil(total / ctx.getSeriesPerPage()));
  wrap.innerHTML = `<span class="pagination-info">Page ${ctx.getSeriesPage()} of ${totalPages} · Total ${total}</span>`;
}

export async function openSeriesForm(ctx, id = null) {
  bindSeriesUi(ctx);
  await ctx.loadRefData();
  await ctx.ensureServersCacheForPlaylist();
  ctx.navigateTo('series-form');
  ctx.populateSelect('#seriesCategory', seriesCategories(ctx), 'id', 'category_name', 'None');
  ctx.populateSelect('#seriesBouquet', ctx.getBouquets(), 'id', 'bouquet_name', 'Select bouquet...');
  ctx.populateSelect('#seriesStreamServer', [{ id: 0, name: 'Use line / default' }, ...ctx.getServersCache()], 'id', 'name');
  seriesBouquetIds = [];

  if (id) {
    const series = await ctx.apiFetch(`/series/${id}`);
    ctx.$('#seriesFormTitle').textContent = 'Edit Series';
    ctx.$('#seriesFormId').value = series.id || '';
    ctx.$('#seriesTitle').value = series.title || series.name || '';
    ctx.$('#seriesYear').value = series.year || '';
    ctx.$('#seriesCategory').value = series.category_id || '';
    ctx.$('#seriesStreamServer').value = String(series.stream_server_id || 0);
    ctx.$('#seriesCover').value = series.cover || series.poster || '';
    ctx.$('#seriesBackdrop').value = series.backdrop_path || '';
    ctx.$('#seriesPlot').value = series.plot || '';
    ctx.$('#seriesCastField').value = series.series_cast || '';
    ctx.$('#seriesDirector').value = series.director || '';
    ctx.$('#seriesGenre').value = series.genre || '';
    ctx.$('#seriesReleaseDate').value = series.release_date || '';
    ctx.$('#seriesRating').value = series.rating || '';
    ctx.$('#seriesTrailer').value = series.youtube_trailer || '';
    ctx.$('#seriesTmdbId').value = series.tmdb_id || '';
    seriesBouquetIds = Array.isArray(series.bouquet_ids) ? series.bouquet_ids.map(String) : [];
    renderSeriesEpisodes(ctx, series);
  } else {
    ctx.$('#seriesFormTitle').textContent = 'Add Series';
    ['seriesFormId','seriesTitle','seriesYear','seriesCover','seriesBackdrop','seriesPlot','seriesCastField','seriesDirector','seriesGenre','seriesReleaseDate','seriesRating','seriesTrailer','seriesTmdbId'].forEach((idName) => {
      const el = ctx.$(`#${idName}`);
      if (el) el.value = '';
    });
    ctx.$('#seriesCategory').value = '';
    ctx.$('#seriesStreamServer').value = '0';
    if (ctx.$('#seriesEpisodesPanel')) ctx.$('#seriesEpisodesPanel').style.display = 'none';
  }
  renderSeriesBouquetTags(ctx);
}

export function addSeriesBqTag(ctx, select) {
  const id = String(select?.value || '').trim();
  if (!id || seriesBouquetIds.includes(id)) return;
  seriesBouquetIds.push(id);
  select.value = '';
  renderSeriesBouquetTags(ctx);
}

export function removeSeriesBqTag(ctx, id) {
  seriesBouquetIds = seriesBouquetIds.filter((item) => String(item) !== String(id));
  renderSeriesBouquetTags(ctx);
}

export async function saveSeries(ctx) {
  const id = ctx.$('#seriesFormId')?.value || '';
  const body = collectSeriesPayload();
  if (!body.title) return ctx.toast('Series title is required', 'error');
  if (id) await ctx.apiFetch(`/series/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  else await ctx.apiFetch('/series', { method: 'POST', body: JSON.stringify(body) });
  ctx.toast(id ? 'Series updated' : 'Series created');
  await loadSeriesList(ctx);
  ctx.navigateTo('series');
}

export async function editSeries(ctx, id) {
  return openSeriesForm(ctx, id);
}

export async function deleteSeries(ctx, id) {
  if (!(await ctx.showConfirm('Delete this series and all episodes?'))) return;
  await ctx.apiFetch(`/series/${id}`, { method: 'DELETE' });
  ctx.toast('Series deleted');
  await loadSeriesList(ctx);
}

export async function confirmSeriesImport(ctx) {
  const m3uText = (ctx.$('#seriesImportM3u')?.value || '').trim() || await readOptionalText(ctx.$('#seriesImportFile'));
  if (!m3uText) return ctx.toast('Paste M3U content or choose a file', 'error');
  const result = await ctx.apiFetch('/series/import', {
    method: 'POST',
    body: JSON.stringify({
      m3u_text: m3uText,
      category_id: ctx.$('#seriesImportCat')?.value || '',
      disable_tmdb: !!ctx.$('#seriesImportNoTmdb')?.checked,
    }),
  });
  const wrap = ctx.$('#seriesImportResult');
  const body = ctx.$('#seriesImportResultBody');
  if (wrap && body) {
    wrap.style.display = 'block';
    body.textContent = `Imported ${result.imported || 0} series`;
  }
  ctx.toast(`Imported ${result.imported || 0} series`);
  await loadSeriesList(ctx);
}
