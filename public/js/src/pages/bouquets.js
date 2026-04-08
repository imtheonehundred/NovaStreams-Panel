// pages/bouquets.js - NovaStreams Panel Bouquets Management Page Module

function bindBouquetsPage(ctx) {
  const page = ctx.$('#page-bouquets');
  if (page && page.dataset.bouquetsBound !== 'true') {
    page.dataset.bouquetsBound = 'true';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-bouquets-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.bouquetsAction;
      if (action === 'open-modal') openBouquetModal(ctx);
      if (action === 'edit') openBouquetModal(ctx, btn.dataset.bouquetId);
      if (action === 'delete') deleteBouquet(ctx, btn.dataset.bouquetId);
    });
  }

  const modal = ctx.$('#bouquetModal');
  if (modal && modal.dataset.bouquetsBound !== 'true') {
    modal.dataset.bouquetsBound = 'true';
    modal.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-bouquets-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.bouquetsAction;
      if (action === 'close-modal') closeBouquetModal(ctx);
      if (action === 'save') saveBouquet(ctx);
    });
  }
}

export async function load(ctx) {
  bindBouquetsPage(ctx);
  await ctx.loadRefData();
  const bouquets = ctx.getBouquets();
  const tbody = ctx.$('#bouquetsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = bouquets.map((bq) => `
    <tr>
      <td>${bq.id}</td>
      <td>${ctx.escHtml(bq.bouquet_name || '')}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-bouquets-action="edit" data-bouquet-id="${bq.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-bouquets-action="delete" data-bouquet-id="${bq.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" style="color:#8b949e;text-align:center;padding:1rem">No bouquets found</td></tr>';
}

export function openBouquetModal(ctx, id = null) {
  const modal = ctx.$('#bouquetModal');
  if (!modal) return;
  const bouquet = id ? ctx.getBouquets().find((row) => Number(row.id) === Number(id)) : null;
  ctx.$('#bqModalTitle').textContent = bouquet ? 'Edit Bouquet' : 'Add Bouquet';
  ctx.$('#bqFormId').value = bouquet ? String(bouquet.id) : '';
  ctx.$('#bqName').value = bouquet?.bouquet_name || '';
  modal.style.display = 'flex';
}

export function closeBouquetModal(ctx) {
  const modal = ctx.$('#bouquetModal');
  if (modal) modal.style.display = 'none';
}

export async function saveBouquet(ctx) {
  const id = parseInt(ctx.$('#bqFormId')?.value || '', 10);
  const body = { bouquet_name: ctx.$('#bqName')?.value.trim() };
  if (!body.bouquet_name) return ctx.toast('Bouquet name is required', 'error');
  try {
    if (Number.isFinite(id)) await ctx.apiFetch(`/bouquets/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await ctx.apiFetch('/bouquets', { method: 'POST', body: JSON.stringify(body) });
    await ctx.loadRefData(true);
    closeBouquetModal(ctx);
    await load(ctx);
    ctx.toast(Number.isFinite(id) ? 'Bouquet updated' : 'Bouquet created');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function deleteBouquet(ctx, id) {
  if (!(await ctx.showConfirm('Delete this bouquet?'))) return;
  try {
    await ctx.apiFetch(`/bouquets/${id}`, { method: 'DELETE' });
    await ctx.loadRefData(true);
    await load(ctx);
    ctx.toast('Bouquet deleted');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
