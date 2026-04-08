// pages/stream-import.js - NovaStreams Panel Stream Import Tools Page Module

import { readOptionalFileText, extractFirstHttpUrl } from '@shared/import-helpers';

const STREAM_IMPORT_TABS = ['streamimp-details', 'streamimp-advanced', 'streamimp-server'];

function showImportTab(tabId) {
  document.querySelectorAll('#page-stream-import .wizard-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  document.querySelectorAll('#page-stream-import .wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabId}`));
}

async function readImportInput(ctx) {
  const raw = ctx.$('#streamImportRaw')?.value.trim();
  if (raw) return raw;
  return await readOptionalFileText(ctx.$('#streamImportFile'));
}

function renderImportResult(ctx, title, body) {
  const wrap = ctx.$('#streamImportResult');
  const bodyEl = ctx.$('#streamImportResultBody');
  if (!wrap || !bodyEl) return;
  wrap.style.display = 'block';
  bodyEl.innerHTML = `<strong>${ctx.escHtml(title)}</strong><div style="margin-top:8px">${ctx.escHtml(body)}</div>`;
}

function bindStreamImportPage(ctx) {
  const page = ctx.$('#page-stream-import');
  if (!page || page.dataset.streamImportBound === 'true') return;
  page.dataset.streamImportBound = 'true';

  page.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-stream-import-action]');
    if (!btn) return;
    event.preventDefault();
    const action = btn.dataset.streamImportAction;
    if (action === 'next-tab' || action === 'prev-tab') {
      showImportTab(btn.dataset.targetTab);
      return;
    }
    if (action === 'preview') {
      const text = await readImportInput(ctx);
      const url = extractFirstHttpUrl(text);
      if (!url) return ctx.toast('No importable URL found', 'error');
      renderImportResult(ctx, 'Preview', url);
      return;
    }
    if (action === 'import') {
      const text = await readImportInput(ctx);
      const url = extractFirstHttpUrl(text);
      if (!url) return ctx.toast('No importable URL found', 'error');
      try {
        await ctx.apiFetch('/import-live', {
          method: 'POST',
          body: JSON.stringify({
            url,
            name: ctx.$('#streamImportName')?.value.trim() || 'Imported Stream',
            category_id: ctx.$('#streamImportCat')?.value || undefined,
          }),
        });
        renderImportResult(ctx, 'Import Complete', url);
        ctx.toast('Stream imported');
      } catch (error) {
        ctx.toast(error.message, 'error');
      }
    }
  });

  page.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => showImportTab(tab.dataset.tab));
  });
}

export async function load(ctx) {
  bindStreamImportPage(ctx);
  await ctx.loadRefData();
  const liveCats = ctx.getCategories().filter((c) => c.category_type === 'live');
  ctx.populateSelect('#streamImportCat', liveCats, 'id', 'category_name', 'None');
  ctx.populateSelect('#streamImportBq', ctx.getBouquets(), 'id', 'bouquet_name', 'None');
  if (ctx.$('#streamImportResult')) ctx.$('#streamImportResult').style.display = 'none';
  showImportTab('streamimp-details');
}
