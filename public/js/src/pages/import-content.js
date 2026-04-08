// pages/import-content.js - NovaStreams Panel Content Import Page Module

let importJobId = null;
let importJobPoll = null;

function stopImportPoll() {
  if (importJobPoll) clearTimeout(importJobPoll);
  importJobPoll = null;
}

function bindImportContentPage(ctx) {
  const page = ctx.$('#page-import-content');
  if (!page || page.dataset.importContentBound === 'true') return;
  page.dataset.importContentBound = 'true';
  page.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-import-content-action]');
    if (!btn) return;
    event.preventDefault();
    const action = btn.dataset.importContentAction;
    if (action === 'load-categories') fetchImportCategories(ctx);
    if (action === 'toggle-all-cats') toggleImportCatsAll(btn.dataset.checked === 'true');
    if (action === 'start') startContentImport(ctx);
    if (action === 'cancel') cancelContentImport(ctx);
  });
  const typeSel = ctx.$('#importContentType');
  if (typeSel && typeSel.dataset.importContentBound !== 'true') {
    typeSel.dataset.importContentBound = 'true';
    typeSel.addEventListener('change', () => updateMode(ctx));
  }
}

function updateMode(ctx) {
  const isM3u = (ctx.$('#importContentType')?.value || 'movies') === 'm3u';
  if (ctx.$('#importXtreamBlock')) ctx.$('#importXtreamBlock').style.display = isM3u ? 'none' : '';
  if (ctx.$('#importM3uBlock')) ctx.$('#importM3uBlock').style.display = isM3u ? '' : 'none';
}

function renderJob(ctx, job) {
  if (ctx.$('#importJobPanel')) ctx.$('#importJobPanel').style.display = '';
  if (ctx.$('#importJobStatus')) ctx.$('#importJobStatus').textContent = job.status || 'queued';
  if (ctx.$('#importJobCounts')) ctx.$('#importJobCounts').textContent = `Imported: ${job.imported || 0} | Skipped: ${job.skipped || 0} | Errors: ${job.errors || 0}`;
  if (ctx.$('#importJobLog')) ctx.$('#importJobLog').textContent = Array.isArray(job.log) ? job.log.join('\n') : JSON.stringify(job, null, 2);
}

async function pollJob(ctx) {
  if (!importJobId) return;
  const job = await ctx.apiFetch(`/import/jobs/${importJobId}`);
  renderJob(ctx, job);
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    importJobPoll = setTimeout(() => pollJob(ctx).catch((error) => ctx.toast(error.message, 'error')), 2000);
  }
}

export async function load(ctx) {
  bindImportContentPage(ctx);
  await ctx.loadRefData();
  const data = await ctx.apiFetch('/providers');
  ctx.setProvidersCache(data.providers || []);
  ctx.populateSelect('#importProviderSel', ctx.getProvidersCache(), 'id', 'name');
  ctx.populateSelect('#importBouquetSel', [{ id: 0, bouquet_name: '— None —' }, ...ctx.getBouquets()], 'id', 'bouquet_name');
  updateMode(ctx);
}

export async function fetchImportCategories(ctx) {
  const providerId = parseInt(ctx.$('#importProviderSel')?.value || '', 10);
  const type = ctx.$('#importContentType')?.value || 'movies';
  if (!Number.isFinite(providerId)) return ctx.toast('Select a provider first', 'error');
  const data = await ctx.apiFetch(`/providers/${providerId}/categories`, { method: 'POST', body: JSON.stringify({ type }) });
  const wrap = ctx.$('#importCatCheckboxWrap');
  if (!wrap) return;
  wrap.innerHTML = (data.categories || []).map((row) => `<label style="display:flex;gap:8px;margin-bottom:6px"><input type="checkbox" data-import-category-id="${row.category_id || row.id}"><span>${ctx.escHtml(row.category_name || row.name || `Category ${row.id}`)}</span></label>`).join('') || '<div class="text-muted">No categories returned</div>';
}

export function toggleImportCatsAll(checked) {
  document.querySelectorAll('#importCatCheckboxWrap input[type="checkbox"]').forEach((box) => { box.checked = checked; });
}

export async function startContentImport(ctx) {
  const type = ctx.$('#importContentType')?.value || 'movies';
  let result;
  if (type === 'm3u') {
    result = await ctx.apiFetch('/import/m3u', { method: 'POST', body: JSON.stringify({ m3u_text: ctx.$('#importM3uText')?.value || '', bouquet_id: parseInt(ctx.$('#importBouquetSel')?.value || '0', 10) || 0 }) });
  } else {
    const categoryIds = [...document.querySelectorAll('#importCatCheckboxWrap input[data-import-category-id]:checked')].map((el) => String(el.dataset.importCategoryId));
    result = await ctx.apiFetch(`/import/${type}`, { method: 'POST', body: JSON.stringify({ provider_id: parseInt(ctx.$('#importProviderSel')?.value || '', 10), category_ids: categoryIds }) });
  }
  importJobId = result.job_id;
  stopImportPoll();
  await pollJob(ctx);
  ctx.toast('Import job started');
}

export async function cancelContentImport(ctx) {
  if (!importJobId) return;
  await ctx.apiFetch(`/import/jobs/${importJobId}/cancel`, { method: 'POST' });
  stopImportPoll();
  ctx.toast('Import job cancelled');
}
