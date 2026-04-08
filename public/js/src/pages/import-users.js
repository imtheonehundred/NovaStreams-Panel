// pages/import-users.js - NovaStreams Panel Import Users Page Module

import { parseBulkUsersText } from '@shared/import-helpers';

function bindImportUsersPage(ctx) {
  const page = ctx.$('#page-import-users');
  if (!page || page.dataset.importUsersBound === 'true') return;
  page.dataset.importUsersBound = 'true';
  page.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-import-users-action]');
    if (!btn) return;
    event.preventDefault();
    const action = btn.dataset.importUsersAction;
    if (action === 'validate') validateImportUsers(ctx);
    if (action === 'execute') executeImportUsers(ctx);
  });
  const search = ctx.$('#importUsersBouquetSearch');
  if (search && search.dataset.importUsersBound !== 'true') {
    search.dataset.importUsersBound = 'true';
    search.addEventListener('input', () => renderBouquets(ctx));
  }
}

function renderBouquets(ctx) {
  const wrap = ctx.$('#importUsersBouquetList');
  if (!wrap) return;
  const selected = new Set((ctx.getImportUsersSelectedBouquets() || []).map((id) => String(id)));
  const search = (ctx.$('#importUsersBouquetSearch')?.value || '').toLowerCase();
  wrap.innerHTML = ctx.getBouquets().filter((row) => !search || String(row.bouquet_name || '').toLowerCase().includes(search)).map((row) => `
    <label style="display:flex;gap:8px;margin-bottom:6px"><input type="checkbox" data-import-users-bouquet-id="${row.id}" ${selected.has(String(row.id)) ? 'checked' : ''}><span>${ctx.escHtml(row.bouquet_name || '')}</span></label>
  `).join('');
  wrap.querySelectorAll('input[data-import-users-bouquet-id]').forEach((box) => {
    box.addEventListener('change', () => {
      const next = new Set((ctx.getImportUsersSelectedBouquets() || []).map((id) => String(id)));
      const id = box.dataset.importUsersBouquetId;
      if (box.checked) next.add(String(id));
      else next.delete(String(id));
      ctx.setImportUsersSelectedBouquets([...next]);
    });
  });
}

function renderResults(ctx, result) {
  if (ctx.$('#importUsersResults')) ctx.$('#importUsersResults').style.display = '';
  if (ctx.$('#importUsersPrimaryLabel')) ctx.$('#importUsersPrimaryLabel').textContent = result.test_mode ? 'Valid' : 'Created';
  if (ctx.$('#importUsersCreated')) ctx.$('#importUsersCreated').textContent = String(result.created || 0);
  if (ctx.$('#importUsersSkipped')) ctx.$('#importUsersSkipped').textContent = String(result.skipped || 0);
  if (ctx.$('#importUsersErrors')) ctx.$('#importUsersErrors').textContent = String(result.errors || 0);
  if (ctx.$('#importUsersResultsTitle')) ctx.$('#importUsersResultsTitle').textContent = result.test_mode ? 'Validation Results' : 'Import Results';
  if (ctx.$('#importUsersResultsMeta')) ctx.$('#importUsersResultsMeta').textContent = `Processed ${result.total || 0} rows.`;
  if (ctx.$('#importUsersLog')) ctx.$('#importUsersLog').textContent = (result.details || []).map((row) => `${row.username}: ${row.status} - ${row.message}`).join('\n');
}

export async function load(ctx) {
  bindImportUsersPage(ctx);
  await ctx.loadRefData();
  await ctx.ensureResellersCache();
  ctx.populateSelect('#importUsersReseller', [{ id: 0, username: 'Admin' }, ...ctx.getResellersCache()], 'id', 'username');
  ctx.populateSelect('#importUsersPackage', ctx.getPackages(), 'id', 'package_name', '-- Select Package --');
  ctx.setImportUsersSelectedBouquets([]);
  renderBouquets(ctx);
  if (ctx.$('#importUsersResults')) ctx.$('#importUsersResults').style.display = 'none';
}

export async function validateImportUsers(ctx) {
  const users = parseBulkUsersText(ctx.$('#importUsersText')?.value || '', ctx.$('#importUsersDateFormat')?.value || 'ymd');
  if (!users.length) return ctx.toast('Add at least one user row', 'error');
  renderResults(ctx, {
    test_mode: true,
    created: users.filter((row) => row.username).length,
    skipped: 0,
    errors: users.filter((row) => !row.username).length,
    total: users.length,
    details: users.map((row) => ({ username: row.username || '(empty)', status: row.username ? 'valid' : 'error', message: row.username ? 'Ready to import' : 'Username required' })),
  });
}

export async function executeImportUsers(ctx) {
  const users = parseBulkUsersText(ctx.$('#importUsersText')?.value || '', ctx.$('#importUsersDateFormat')?.value || 'ymd');
  const packageId = parseInt(ctx.$('#importUsersPackage')?.value || '', 10);
  if (!users.length) return ctx.toast('Add at least one user row', 'error');
  if (!Number.isFinite(packageId)) return ctx.toast('Select a package', 'error');
  const result = await ctx.apiFetch('/lines/bulk', {
    method: 'POST',
    body: JSON.stringify({
      users,
      package_id: packageId,
      member_id: parseInt(ctx.$('#importUsersReseller')?.value || '0', 10) || 0,
      test_mode: ctx.$('#importUsersTestMode')?.checked ? 1 : 0,
      skip_duplicates: ctx.$('#importUsersSkipDuplicates')?.checked ? 1 : 0,
      max_connections: parseInt(ctx.$('#importUsersMaxConnections')?.value || '1', 10) || 1,
      is_trial: ctx.$('#importUsersTrial')?.checked ? 1 : 0,
      bouquet: (ctx.getImportUsersSelectedBouquets() || []).map((id) => parseInt(id, 10)).filter(Number.isFinite),
    }),
  });
  renderResults(ctx, result);
  ctx.toast(result.test_mode ? 'Validation completed' : 'Import completed');
}
