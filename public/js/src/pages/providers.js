// pages/providers.js - NovaStreams Panel Content Providers Page Module

function providerHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '—';
  }
}

function bindProvidersPage(ctx) {
  const page = ctx.$('#page-providers');
  if (page && page.dataset.providersBound !== 'true') {
    page.dataset.providersBound = 'true';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-providers-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.providersAction;
      if (action === 'open-modal') openProviderModal(ctx);
      if (action === 'edit') openProviderModal(ctx, btn.dataset.providerId);
      if (action === 'delete') deleteProvider(ctx, btn.dataset.providerId);
    });
  }
  const modal = ctx.$('#providerModal');
  if (modal && modal.dataset.providersBound !== 'true') {
    modal.dataset.providersBound = 'true';
    modal.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-providers-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.providersAction;
      if (action === 'close-modal') closeProviderModal(ctx);
      if (action === 'validate') validateProviderForm(ctx);
      if (action === 'save') saveProvider(ctx);
    });
  }
}

export async function load(ctx) {
  bindProvidersPage(ctx);
  await ctx.loadRefData();
  const data = await ctx.apiFetch('/providers');
  ctx.setProvidersCache(data.providers || []);
  renderProvidersTable(ctx);
  ctx.populateSelect('#providerBouquet', [{ id: 0, bouquet_name: '— None —' }, ...ctx.getBouquets()], 'id', 'bouquet_name');
}

export function renderProvidersTable(ctx) {
  const providers = ctx.getProvidersCache() || [];
  const tbody = ctx.$('#providersTableBody');
  if (!tbody) return;
  tbody.innerHTML = providers.map((p) => `
    <tr>
      <td>${p.id}</td>
      <td>${ctx.escHtml(p.name || '')}</td>
      <td>${ctx.escHtml(providerHost(p.url || ''))}</td>
      <td>${Number(p.bouquet_id || 0)}</td>
      <td>${Number(p.update_frequency || 0) > 0 ? `Every ${p.update_frequency}h` : 'Off'}</td>
      <td>${p.last_updated ? ctx.formatDate(p.last_updated) : 'Never'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-providers-action="edit" data-provider-id="${p.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-providers-action="delete" data-provider-id="${p.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#8b949e;text-align:center;padding:1rem">No providers configured</td></tr>';
}

export function openProviderModal(ctx, id = null) {
  const provider = id ? ctx.getProvidersCache().find((row) => Number(row.id) === Number(id)) : null;
  ctx.$('#providerModalTitle').textContent = provider ? 'Edit Provider' : 'Provider';
  ctx.$('#providerEditId').value = provider ? String(provider.id) : '';
  ctx.$('#providerName').value = provider?.name || '';
  ctx.$('#providerUrl').value = provider?.url || '';
  ctx.$('#providerBouquet').value = String(provider?.bouquet_id || 0);
  ctx.$('#providerFreq').value = String(provider?.update_frequency || 0);
  ctx.$('#providerModal').style.display = 'flex';
}

export function closeProviderModal(ctx) {
  if (ctx.$('#providerModal')) ctx.$('#providerModal').style.display = 'none';
}

export async function validateProviderForm(ctx) {
  try {
    await ctx.apiFetch('/providers/validate-preview', { method: 'POST', body: JSON.stringify({ url: ctx.$('#providerUrl')?.value.trim() || '' }) });
    ctx.toast('Connection OK');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function saveProvider(ctx) {
  const id = parseInt(ctx.$('#providerEditId')?.value || '', 10);
  const body = {
    name: ctx.$('#providerName')?.value.trim() || 'Provider',
    url: ctx.$('#providerUrl')?.value.trim() || '',
    bouquet_id: parseInt(ctx.$('#providerBouquet')?.value || '0', 10) || 0,
    update_frequency: parseInt(ctx.$('#providerFreq')?.value || '0', 10) || 0,
  };
  if (!body.url) return ctx.toast('Provider URL is required', 'error');
  try {
    if (Number.isFinite(id)) await ctx.apiFetch(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await ctx.apiFetch('/providers', { method: 'POST', body: JSON.stringify(body) });
    closeProviderModal(ctx);
    await load(ctx);
    ctx.toast(Number.isFinite(id) ? 'Provider updated' : 'Provider created');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function deleteProvider(ctx, id) {
  if (!(await ctx.showConfirm('Delete this provider?'))) return;
  try {
    await ctx.apiFetch(`/providers/${id}`, { method: 'DELETE' });
    await load(ctx);
    ctx.toast('Provider deleted');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
