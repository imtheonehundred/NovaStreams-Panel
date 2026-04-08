// pages/add-channels.js - NovaStreams Panel Add Channels Page Module

const STREAM_EDITOR_TABS = ['channel-details', 'channel-advanced', 'channel-map', 'channel-restart', 'channel-epg', 'channel-servers'];

function showStreamTab(tabId) {
  document.querySelectorAll('.stream-editor-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  document.querySelectorAll('.stream-editor-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabId}`));
}

function renderStreamBouquetTags(ctx) {
  const wrap = ctx.$('#streamBouquetTags');
  if (!wrap) return;
  const ids = (ctx.getPendingStreamBouquets?.() || []).map((id) => String(id));
  wrap.innerHTML = ids.map((id) => {
    const bouquet = ctx.getBouquets().find((row) => String(row.id) === id);
    return `<button type="button" class="tag-chip" data-add-channel-action="remove-bouquet-tag" data-bouquet-id="${id}">${ctx.escHtml(bouquet?.bouquet_name || `Bouquet ${id}`)} ×</button>`;
  }).join('');
}

function bindAddChannelsPage(ctx) {
  const page = ctx.$('#page-add-channels');
  if (!page || page.dataset.addChannelsBound === 'true') return;
  page.dataset.addChannelsBound = 'true';

  page.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-add-channel-action]');
    if (!actionBtn) return;
    event.preventDefault();
    const action = actionBtn.dataset.addChannelAction;
    if (action === 'next-tab') {
      const currentTab = page.querySelector('.stream-editor-tab.active')?.dataset.tab || STREAM_EDITOR_TABS[0];
      const currentIndex = STREAM_EDITOR_TABS.indexOf(currentTab);
      if (currentIndex >= 0 && currentIndex < STREAM_EDITOR_TABS.length - 1) showStreamTab(STREAM_EDITOR_TABS[currentIndex + 1]);
      return;
    }
    if (action === 'prev-tab') {
      const currentTab = page.querySelector('.stream-editor-tab.active')?.dataset.tab || STREAM_EDITOR_TABS[0];
      const currentIndex = STREAM_EDITOR_TABS.indexOf(currentTab);
      if (currentIndex > 0) showStreamTab(STREAM_EDITOR_TABS[currentIndex - 1]);
      return;
    }
    if (action === 'save') {
      saveStream(ctx);
      return;
    }
    if (action === 'remove-bouquet-tag') {
      ctx.setPendingStreamBouquets((ctx.getPendingStreamBouquets?.() || []).filter((id) => String(id) !== String(actionBtn.dataset.bouquetId)));
      renderStreamBouquetTags(ctx);
    }
  });

  const bouquetSelect = ctx.$('#streamBouquet');
  if (bouquetSelect && bouquetSelect.dataset.addChannelsBound !== 'true') {
    bouquetSelect.dataset.addChannelsBound = 'true';
    bouquetSelect.addEventListener('change', () => {
      const nextId = bouquetSelect.value;
      if (!nextId) return;
      const current = new Set((ctx.getPendingStreamBouquets?.() || []).map((id) => String(id)));
      current.add(String(nextId));
      ctx.setPendingStreamBouquets([...current]);
      bouquetSelect.value = '';
      renderStreamBouquetTags(ctx);
    });
  }

  page.querySelectorAll('.stream-editor-tab[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => showStreamTab(tab.dataset.tab));
  });
}

export async function load(ctx) {
  bindAddChannelsPage(ctx);
  await ctx.loadRefData();
  await ctx.ensureServersCacheForPlaylist();
  const liveCats = ctx.getCategories().filter((c) => c.category_type === 'live');
  ctx.populateSelect('#streamCategory', liveCats, 'id', 'category_name', 'None');
  ctx.populateSelect('#streamSubCategory', liveCats, 'id', 'category_name', 'Select sub-category...');
  ctx.populateSelect('#streamBouquet', ctx.getBouquets(), 'id', 'bouquet_name', 'Select bouquet...');
  ctx.populateSelect('#streamPlaylistServer', [{ id: 0, name: 'Use line / default' }, ...ctx.getServersCache()], 'id', 'name');
  ctx.setPendingStreamBouquets([]);
  renderStreamBouquetTags(ctx);
  showStreamTab('channel-details');
}

export async function saveStream(ctx = window.APP_CTX) {
  const body = {
    name: ctx.$('#streamName')?.value.trim() || 'Live',
    url: ctx.$('#streamPrimaryUrl')?.value.trim() || ctx.$('#streamSwapUrl')?.value.trim(),
    category_id: ctx.$('#streamCategory')?.value || undefined,
    logo: ctx.$('#streamLogoUrl')?.value.trim() || '',
    epg_channel_id: ctx.$('#streamEpgId')?.value.trim() || '',
    inputType: ctx.$('#streamInputType')?.value || 'auto',
  };
  if (!body.url) return ctx.toast('Stream URL is required', 'error');
  try {
    await ctx.apiFetch('/import-live', { method: 'POST', body: JSON.stringify(body) });
    ctx.toast('Channel created');
    ctx.navigateTo('manage-channels');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
