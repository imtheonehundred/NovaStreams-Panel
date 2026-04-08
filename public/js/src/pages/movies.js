// pages/movies.js - NovaStreams Panel Movies Management Page Module

let movieCategoryIds = [];
let movieBouquetIds = [];

function bindMovieUi(ctx) {
  const modal = ctx.$('#movieModal');
  if (modal && modal.dataset.bound !== 'true') {
    modal.dataset.bound = 'true';
    modal
      .querySelectorAll('.xc-tab[data-mtab]')
      .forEach((tab) =>
        tab.addEventListener('click', () => switchMovieTab(tab.dataset.mtab))
      );
  }
  const importPage = ctx.$('#page-movie-import');
  if (importPage && importPage.dataset.bound !== 'true') {
    importPage.dataset.bound = 'true';
    importPage.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        importPage
          .querySelectorAll('.wizard-tab')
          .forEach((item) => item.classList.toggle('active', item === tab));
        importPage
          .querySelectorAll('.wizard-panel')
          .forEach((panel) =>
            panel.classList.toggle(
              'active',
              panel.id === `tab-${tab.dataset.tab}`
            )
          );
      })
    );
  }
}

function movieCategories(ctx) {
  return (ctx.getCategories() || []).filter(
    (row) => row.category_type === 'movie'
  );
}

function renderTagList(container, items, removeAction) {
  if (!container) return;
  const actionName = String(removeAction || '').replace(/^APP\./, '');
  container.innerHTML = items
    .map(
      (item) =>
        `<span class="tag-pill">${item.name} <button class="tag-pill-remove" data-app-action="${actionName}" data-app-args="'${item.id}'">&times;</button></span>`
    )
    .join('');
}

function renderMovieCategoryTags(ctx) {
  renderTagList(
    ctx.$('#movieCategoryTags'),
    movieCategoryIds.map((id) => {
      const row = movieCategories(ctx).find(
        (item) => String(item.id) === String(id)
      );
      return {
        id: String(id),
        name: ctx.escHtml(row?.category_name || `Category ${id}`),
      };
    }),
    'APP.removeMovieCatTag'
  );
}

function renderMovieBouquetTags(ctx) {
  renderTagList(
    ctx.$('#movieBouquetTags'),
    movieBouquetIds.map((id) => {
      const row = (ctx.getBouquets() || []).find(
        (item) => String(item.id) === String(id)
      );
      return {
        id: String(id),
        name: ctx.escHtml(row?.bouquet_name || `Bouquet ${id}`),
      };
    }),
    'APP.removeMovieBqTag'
  );
}

function renderMovieSources(sources = []) {
  const wrap = document.getElementById('movieSourceUrls');
  if (!wrap) return;
  wrap.innerHTML = sources
    .map(
      (url, index) => `
    <div class="input-with-btn mt-1" data-movie-source-row="${index}">
      <input type="text" class="form-control movie-source-input" value="${String(url || '').replace(/"/g, '&quot;')}">
      <button type="button" class="btn btn-xs btn-danger" data-app-action="removeClosest" data-app-args="'[data-movie-source-row]', this">Remove</button>
    </div>`
    )
    .join('');
}

function renderMovieSubtitles(subtitles = []) {
  const wrap = document.getElementById('movieSubtitles');
  if (!wrap) return;
  wrap.innerHTML = subtitles
    .map(
      (subtitle, index) => `
    <div class="input-with-btn mt-1" data-movie-subtitle-row="${index}">
      <input type="text" class="form-control movie-subtitle-input" value="${String(subtitle?.url || subtitle || '').replace(/"/g, '&quot;')}" placeholder="Subtitle URL or path">
      <button type="button" class="btn btn-xs btn-danger" data-app-action="removeClosest" data-app-args="'[data-movie-subtitle-row]', this">Remove</button>
    </div>`
    )
    .join('');
}

function switchMovieTab(tabId) {
  document
    .querySelectorAll('#movieModal .xc-tab')
    .forEach((tab) =>
      tab.classList.toggle('active', tab.dataset.mtab === tabId)
    );
  document
    .querySelectorAll('#movieModal .xc-tab-panel')
    .forEach((panel) =>
      panel.classList.toggle('active', panel.id === `mtab-${tabId}`)
    );
}

function collectMoviePayload() {
  const primaryUrl =
    document.getElementById('movieMainUrl')?.value.trim() || '';
  const extraSources = [...document.querySelectorAll('.movie-source-input')]
    .map((el) => el.value.trim())
    .filter(Boolean);
  const subtitles = [...document.querySelectorAll('.movie-subtitle-input')]
    .map((el) => el.value.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
  return {
    name: document.getElementById('movieName')?.value.trim() || '',
    year: document.getElementById('movieYear')?.value || null,
    stream_url: primaryUrl,
    stream_source: primaryUrl,
    category_id: movieCategoryIds[0] || '',
    bouquet_ids: movieBouquetIds.map((id) => Number(id)).filter(Boolean),
    stream_icon: document.getElementById('moviePoster')?.value.trim() || '',
    backdrop_path: document.getElementById('movieBackdrop')?.value.trim() || '',
    plot: document.getElementById('moviePlot')?.value || '',
    movie_cast: document.getElementById('movieCast')?.value || '',
    director: document.getElementById('movieDirector')?.value || '',
    genre: document.getElementById('movieGenre')?.value || '',
    release_date: document.getElementById('movieReleaseDate')?.value || '',
    duration: document.getElementById('movieDuration')?.value || '',
    rating: document.getElementById('movieRating')?.value || '0',
    youtube_trailer: document.getElementById('movieTrailer')?.value || '',
    country: document.getElementById('movieCountry')?.value || '',
    container_extension:
      document.getElementById('movieExtension')?.value || 'mp4',
    tmdb_id: document.getElementById('movieTmdbId')?.value || null,
    stream_server_id:
      parseInt(
        document.getElementById('movieStreamServer')?.value || '0',
        10
      ) || 0,
    subtitles,
    movie_properties: { extra_sources: extraSources },
  };
}

async function readOptionalText(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return '';
  return await file.text();
}

export async function loadMovies(ctx) {
  try {
    bindMovieUi(ctx);
    await ctx.loadRefData();
    const data = await ctx.apiFetch('/movies');
    const movies = data.movies || [];
    ctx.setMoviesCache(movies);
    const cats = movieCategories(ctx);
    ctx.populateSelect(
      '#moviesCatFilter',
      cats,
      'id',
      'category_name',
      'All Categories'
    );
    ctx.populateSelect('#movieImportCat', cats, 'id', 'category_name', 'None');
    ctx.populateSelect(
      '#movieImportBq',
      ctx.getBouquets(),
      'id',
      'bouquet_name',
      'None'
    );
    ctx.renderMoviesTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderMoviesTable(ctx) {
  const search = (ctx.$('#moviesSearch')?.value || '').toLowerCase();
  const catF = ctx.$('#moviesCatFilter')?.value || '';
  const perPage = ctx.getMoviesPerPage();
  const filtered = ctx.getMoviesCache().filter((m) => {
    if (
      search &&
      ![m.name, m.id, m.stream_url].join(' ').toLowerCase().includes(search)
    )
      return false;
    if (catF && String(m.category_id) !== catF) return false;
    return true;
  });
  ctx.setMoviesTotal(filtered.length);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (ctx.getMoviesPage() > totalPages) ctx.setMoviesPage(totalPages);
  if (ctx.getMoviesPage() < 1) ctx.setMoviesPage(1);
  const start = (ctx.getMoviesPage() - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);
  const tbody = ctx.$('#moviesTable tbody');
  if (!tbody) return;
  tbody.innerHTML =
    pageItems
      .map(
        (m) => `
    <tr>
      <td>${m.id}</td>
      <td>${m.poster ? `<img src="${ctx.escHtml(m.poster)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : '—'}</td>
      <td>${ctx.escHtml(m.name || '')}</td>
      <td>${m.category_name || '—'}</td>
      <td>${m.year || '—'}</td>
      <td>${m.rating || '—'}</td>
      <td>${m.tmdb_id || '—'}</td>
      <td>${ctx.getStreamServerName(m)}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editMovie" data-app-args="${m.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteMovie" data-app-args="${m.id}">Delete</button>
      </td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="9" style="color:#8b949e;text-align:center;padding:1rem">No movies found</td></tr>';
  ctx.renderMoviesPagination(ctx, filtered.length);
  const count = ctx.$('#moviesCount');
  if (count) count.textContent = `${filtered.length} total`;
}

export function renderMoviesPagination(ctx, total) {
  const wrap = ctx.$('#moviesPagination');
  if (!wrap) return;
  const totalPages = Math.max(1, Math.ceil(total / ctx.getMoviesPerPage()));
  wrap.innerHTML = `<span class="pagination-info">Page ${ctx.getMoviesPage()} of ${totalPages} · Total ${total}</span>`;
}

export async function openMovieForm(ctx, id = null) {
  bindMovieUi(ctx);
  await ctx.loadRefData();
  await ctx.ensureServersCacheForPlaylist();
  const modal = ctx.$('#movieModal');
  if (!modal) return;

  const cats = movieCategories(ctx);
  ctx.populateSelect(
    '#movieCategory',
    cats,
    'id',
    'category_name',
    'Select category...'
  );
  ctx.populateSelect(
    '#movieBouquet',
    ctx.getBouquets(),
    'id',
    'bouquet_name',
    'Select bouquet...'
  );
  ctx.populateSelect(
    '#movieStreamServer',
    [{ id: 0, name: 'Use line / default' }, ...ctx.getServersCache()],
    'id',
    'name'
  );

  movieCategoryIds = [];
  movieBouquetIds = [];
  renderMovieSources([]);
  renderMovieSubtitles([]);

  if (id) {
    const movie = await ctx.apiFetch(`/movies/${id}`);
    ctx.$('#movieFormTitle').textContent = 'Edit Movie';
    ctx.$('#movieFormId').value = movie.id || '';
    ctx.$('#movieName').value = movie.name || movie.title || '';
    ctx.$('#movieYear').value = movie.year || '';
    ctx.$('#movieMainUrl').value = movie.stream_url || '';
    ctx.$('#moviePoster').value = movie.stream_icon || movie.poster || '';
    ctx.$('#movieBackdrop').value = movie.backdrop_path || '';
    ctx.$('#moviePlot').value = movie.plot || '';
    ctx.$('#movieCast').value = movie.movie_cast || '';
    ctx.$('#movieDirector').value = movie.director || '';
    ctx.$('#movieGenre').value = movie.genre || '';
    ctx.$('#movieReleaseDate').value = movie.release_date || '';
    ctx.$('#movieDuration').value = movie.duration || '';
    ctx.$('#movieRating').value = movie.rating || '';
    ctx.$('#movieTrailer').value = movie.youtube_trailer || '';
    ctx.$('#movieCountry').value = movie.country || '';
    ctx.$('#movieExtension').value =
      movie.container_extension || movie.extension || 'mp4';
    ctx.$('#movieTmdbId').value = movie.tmdb_id || '';
    ctx.$('#movieStreamServer').value = String(movie.stream_server_id || 0);
    movieCategoryIds = movie.category_id ? [String(movie.category_id)] : [];
    movieBouquetIds = Array.isArray(movie.bouquet_ids)
      ? movie.bouquet_ids.map(String)
      : [];
    renderMovieSources(movie.movie_properties?.extra_sources || []);
    renderMovieSubtitles(movie.subtitles || []);
  } else {
    ctx.$('#movieFormTitle').textContent = 'Add Movie';
    [
      'movieFormId',
      'movieName',
      'movieYear',
      'movieMainUrl',
      'moviePoster',
      'movieBackdrop',
      'moviePlot',
      'movieCast',
      'movieDirector',
      'movieGenre',
      'movieReleaseDate',
      'movieDuration',
      'movieRating',
      'movieTrailer',
      'movieCountry',
      'movieTmdbId',
    ].forEach((idName) => {
      const el = ctx.$(`#${idName}`);
      if (el) el.value = '';
    });
    ctx.$('#movieExtension').value = 'mp4';
    ctx.$('#movieStreamServer').value = '0';
  }

  renderMovieCategoryTags(ctx);
  renderMovieBouquetTags(ctx);
  switchMovieTab('movie-details');
  modal.style.display = 'flex';
}

export function closeMovieModal(ctx) {
  const modal = ctx.$('#movieModal');
  if (modal) modal.style.display = 'none';
}

export function addMovieCatTag(ctx, select) {
  const id = String(select?.value || '').trim();
  if (!id) return;
  movieCategoryIds = [id];
  select.value = '';
  renderMovieCategoryTags(ctx);
}

export function addMovieBqTag(ctx, select) {
  const id = String(select?.value || '').trim();
  if (!id || movieBouquetIds.includes(id)) return;
  movieBouquetIds.push(id);
  select.value = '';
  renderMovieBouquetTags(ctx);
}

export function removeMovieCatTag(ctx, id) {
  movieCategoryIds = movieCategoryIds.filter(
    (item) => String(item) !== String(id)
  );
  renderMovieCategoryTags(ctx);
}

export function removeMovieBqTag(ctx, id) {
  movieBouquetIds = movieBouquetIds.filter(
    (item) => String(item) !== String(id)
  );
  renderMovieBouquetTags(ctx);
}

export function addMovieSourceRow() {
  const wrap = document.getElementById('movieSourceUrls');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'input-with-btn mt-1';
  row.innerHTML =
    '<input type="text" class="form-control movie-source-input" placeholder="http://source-server.com/movie-alt.mp4"><button type="button" class="btn btn-xs btn-danger" data-app-action="removeParent" data-app-args="this">Remove</button>';
  wrap.appendChild(row);
}

export function addSubtitleRow() {
  const wrap = document.getElementById('movieSubtitles');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'input-with-btn mt-1';
  row.innerHTML =
    '<input type="text" class="form-control movie-subtitle-input" placeholder="Subtitle URL or path"><button type="button" class="btn btn-xs btn-danger" data-app-action="removeParent" data-app-args="this">Remove</button>';
  wrap.appendChild(row);
}

export function copyMovieUrl(ctx) {
  const value = ctx.$('#movieMainUrl')?.value || '';
  if (!value) return ctx.toast('No movie URL to copy', 'warning');
  navigator.clipboard.writeText(value);
  ctx.toast('Movie URL copied');
}

export function movieTabNext(tabId) {
  switchMovieTab(tabId);
}

export async function saveMovie(ctx) {
  const id = ctx.$('#movieFormId')?.value || '';
  const body = collectMoviePayload();
  if (!body.name) return ctx.toast('Movie name is required', 'error');
  if (!body.stream_url) return ctx.toast('Movie URL is required', 'error');
  if (id)
    await ctx.apiFetch(`/movies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  else
    await ctx.apiFetch('/movies', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  ctx.toast(id ? 'Movie updated' : 'Movie created');
  closeMovieModal(ctx);
  await loadMovies(ctx);
}

export async function editMovie(ctx, id) {
  return openMovieForm(ctx, id);
}

export async function deleteMovie(ctx, id) {
  if (!(await ctx.showConfirm('Delete this movie?'))) return;
  await ctx.apiFetch(`/movies/${id}`, { method: 'DELETE' });
  ctx.toast('Movie deleted');
  await loadMovies(ctx);
}

export async function confirmMovieImport(ctx) {
  const m3uText =
    (ctx.$('#movieImportM3u')?.value || '').trim() ||
    (await readOptionalText(ctx.$('#movieImportFile')));
  if (!m3uText) return ctx.toast('Paste M3U content or choose a file', 'error');
  const result = await ctx.apiFetch('/movies/import', {
    method: 'POST',
    body: JSON.stringify({
      m3u_text: m3uText,
      category_id: ctx.$('#movieImportCat')?.value || '',
      disable_tmdb: !!ctx.$('#movieImportNoTmdb')?.checked,
    }),
  });
  ctx.toast(`Imported ${result.imported || 0} movies`);
  await loadMovies(ctx);
}
