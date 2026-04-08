// pages/line-form.js - NovaStreams Panel Line Form Page Module

let selectedBouquetIds = [];

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function unixToDateInput(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return new Date(num * 1000).toISOString().slice(0, 10);
}

function dateInputToUnix(value) {
  if (!value) return null;
  const ts = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

function generatePasswordValue() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function getSelectedPackage(ctx) {
  const packageId = ctx.$('#linePackage')?.value || '';
  return ctx.getPackages().find((pkg) => String(pkg.id) === String(packageId)) || null;
}

function setLineOutputs(ctx, outputs) {
  const list = Array.isArray(outputs) ? outputs.map((value) => String(value).toLowerCase()) : [];
  const hls = ctx.$('#lineOutHls');
  const ts = ctx.$('#lineOutTs');
  if (hls) hls.checked = list.length === 0 || list.includes('m3u8') || list.includes('hls');
  if (ts) ts.checked = list.length === 0 || list.includes('ts');
  updateOutputSummary(ctx);
}

function getLineOutputs(ctx) {
  const outputs = [];
  if (ctx.$('#lineOutHls')?.checked) outputs.push('m3u8');
  if (ctx.$('#lineOutTs')?.checked) outputs.push('ts');
  return outputs;
}

function updateOutputSummary(ctx) {
  const summary = ctx.$('#lineOutputSummary');
  if (!summary) return;
  const outputs = getLineOutputs(ctx);
  summary.textContent = `Output: ${outputs.length ? outputs.join(', ').toUpperCase() : 'All'}`;
}

function renderPackageSummary(ctx) {
  const summary = ctx.$('#linePackageSummary');
  const pkg = getSelectedPackage(ctx);
  if (!summary || !pkg) {
    if (summary) summary.style.display = 'none';
    return;
  }

  const duration = pkg.is_trial
    ? `${pkg.trial_duration || 0} ${pkg.trial_duration_in || 'day'}(s)`
    : `${pkg.official_duration || 0} ${pkg.official_duration_in || 'month'}(s)`;
  const bouquetIds = parseJsonArray(pkg.bouquets_json || pkg.bouquets);
  const outputs = parseJsonArray(pkg.output_formats_json || pkg.output_formats);
  const bouquetNames = bouquetIds.length
    ? bouquetIds.map((id) => ctx.getBouquets().find((row) => String(row.id) === String(id))?.bouquet_name || id).join(', ')
    : 'All';
  ctx.$('#pkgSumConn').textContent = String(pkg.max_connections || 1);
  ctx.$('#pkgSumDuration').textContent = duration;
  ctx.$('#pkgSumBouquets').textContent = bouquetNames;
  ctx.$('#pkgSumOutputs').textContent = outputs.length ? outputs.join(', ') : 'All';
  summary.style.display = 'block';
}

function setLineBouquetSelection(ctx, bouquetIds) {
  selectedBouquetIds = [...new Set((bouquetIds || []).map((id) => String(id)))];
  renderBouquetLists(ctx);
}

function renderBouquetLists(ctx) {
  const allBouquets = ctx.getBouquets();
  const availableSearch = (ctx.$('#lineBouquetSearchAvailable')?.value || '').toLowerCase();
  const selectedSearch = (ctx.$('#lineBouquetSearchSelected')?.value || '').toLowerCase();
  const availableWrap = ctx.$('#lineBouquetAvailable');
  const selectedWrap = ctx.$('#lineBouquetSelected');
  if (!availableWrap || !selectedWrap) return;

  const selectedSet = new Set(selectedBouquetIds);
  const available = allBouquets.filter((row) => !selectedSet.has(String(row.id)));
  const assigned = allBouquets.filter((row) => selectedSet.has(String(row.id)));

  const renderItem = (row, selected, side) => `<button type="button" class="dual-list-item${selected ? ' is-selected' : ''}" data-line-form-action="toggle-bouquet" data-bouquet-side="${side}" data-bouquet-id="${row.id}">${ctx.escHtml(row.bouquet_name || row.name || `Bouquet ${row.id}`)}</button>`;

  const availableSelected = new Set((ctx.$('#lineBouquetAvailable')?.dataset.selectedIds || '').split(',').filter(Boolean));
  const assignedSelected = new Set((ctx.$('#lineBouquetSelected')?.dataset.selectedIds || '').split(',').filter(Boolean));

  availableWrap.innerHTML = available
    .filter((row) => !availableSearch || String(row.bouquet_name || row.name || '').toLowerCase().includes(availableSearch))
    .map((row) => renderItem(row, availableSelected.has(String(row.id)), 'available'))
    .join('') || '<div class="text-muted">No bouquets</div>';
  selectedWrap.innerHTML = assigned
    .filter((row) => !selectedSearch || String(row.bouquet_name || row.name || '').toLowerCase().includes(selectedSearch))
    .map((row) => renderItem(row, assignedSelected.has(String(row.id)), 'selected'))
    .join('') || '<div class="text-muted">No bouquets selected</div>';

  const selectedCount = ctx.$('#lineBouquetSelectedCount');
  const availableCount = ctx.$('#lineBouquetAvailableCount');
  if (selectedCount) selectedCount.textContent = String(assigned.length);
  if (availableCount) availableCount.textContent = String(available.length);
}

function toggleBouquetSelection(ctx, side, bouquetId) {
  const wrap = side === 'selected' ? ctx.$('#lineBouquetSelected') : ctx.$('#lineBouquetAvailable');
  if (!wrap) return;
  const current = new Set((wrap.dataset.selectedIds || '').split(',').filter(Boolean));
  if (current.has(String(bouquetId))) current.delete(String(bouquetId));
  else current.add(String(bouquetId));
  wrap.dataset.selectedIds = [...current].join(',');
  renderBouquetLists(ctx);
}

function getMarkedBouquetIds(ctx, side) {
  const wrap = side === 'selected' ? ctx.$('#lineBouquetSelected') : ctx.$('#lineBouquetAvailable');
  return (wrap?.dataset.selectedIds || '').split(',').filter(Boolean);
}

function clearMarkedBouquets(ctx) {
  if (ctx.$('#lineBouquetSelected')) ctx.$('#lineBouquetSelected').dataset.selectedIds = '';
  if (ctx.$('#lineBouquetAvailable')) ctx.$('#lineBouquetAvailable').dataset.selectedIds = '';
}

function applyLinePackageDefaults(ctx) {
  const pkg = getSelectedPackage(ctx);
  if (!pkg) {
    ctx.toast('Select a package first', 'error');
    return;
  }
  if (ctx.$('#lineMaxConnections')) ctx.$('#lineMaxConnections').value = String(pkg.max_connections || 1);
  if (ctx.$('#lineForcedCountry')) ctx.$('#lineForcedCountry').value = pkg.forced_country || '';
  if (ctx.$('#lineIsTrial')) ctx.$('#lineIsTrial').checked = Number(pkg.is_trial || 0) === 1;
  if (ctx.$('#lineIsMag')) ctx.$('#lineIsMag').checked = Number(pkg.is_mag || 0) === 1;
  if (ctx.$('#lineIsE2')) ctx.$('#lineIsE2').checked = Number(pkg.is_e2 || 0) === 1;
  if (ctx.$('#lineIsRestreamer')) ctx.$('#lineIsRestreamer').checked = Number(pkg.is_restreamer || 0) === 1;
  setLineOutputs(ctx, parseJsonArray(pkg.output_formats_json || pkg.output_formats));
  setLineBouquetSelection(ctx, parseJsonArray(pkg.bouquets_json || pkg.bouquets));
  renderPackageSummary(ctx);
}

function collectLinePayload(ctx) {
  const payload = {
    username: ctx.$('#lineUsername')?.value.trim(),
    password: ctx.$('#linePassword')?.value || '',
    member_id: parseInt(ctx.$('#lineOwner')?.value || '0', 10) || 0,
    package_id: parseInt(ctx.$('#linePackage')?.value || '', 10),
    admin_enabled: parseInt(ctx.$('#lineStatus')?.value || '1', 10) || 0,
    enabled: 1,
    max_connections: parseInt(ctx.$('#lineMaxConnections')?.value || '1', 10) || 1,
    exp_date: ctx.$('#lineExpiryNever')?.checked ? null : dateInputToUnix(ctx.$('#lineExpiryDate')?.value || ''),
    is_e2: ctx.$('#lineIsE2')?.checked ? 1 : 0,
    is_mag: ctx.$('#lineIsMag')?.checked ? 1 : 0,
    is_isplock: ctx.$('#lineIspLock')?.checked ? 1 : 0,
    admin_notes: ctx.$('#lineAdminNotes')?.value || '',
    reseller_notes: ctx.$('#lineResellerNotes')?.value || '',
    contact: ctx.$('#linePrivateDns')?.value || '',
    forced_country: ctx.$('#lineForcedCountry')?.value.trim() || '',
    allowed_outputs: getLineOutputs(ctx),
    bouquet: selectedBouquetIds.map((id) => parseInt(id, 10)).filter(Number.isFinite),
    allowed_ips: (ctx.$('#lineAllowedIps')?.value || '').split('\n').map((row) => row.trim()).filter(Boolean),
    allowed_ua: (ctx.$('#lineAllowedUAs')?.value || '').split('\n').map((row) => row.trim()).filter(Boolean),
    force_server_id: parseInt(ctx.$('#lineForceServer')?.value || '0', 10) || 0,
    is_stalker: ctx.$('#lineIsStalker')?.checked ? 1 : 0,
    is_restreamer: ctx.$('#lineIsRestreamer')?.checked ? 1 : 0,
    is_trial: ctx.$('#lineIsTrial')?.checked ? 1 : 0,
  };
  return payload;
}

function fillLineForm(ctx, line = {}, options = {}) {
  const isEdit = Number.isFinite(Number(line.id));
  ctx.$('#lineFormTitle').textContent = isEdit ? 'Edit User' : (options.trial ? 'Create Trial User' : 'Add New User');
  ctx.$('#lineFormModeChip').textContent = isEdit ? 'Edit Line' : (options.trial ? 'Trial Line' : 'Create Line');
  ctx.$('#lineFormSubtitle').textContent = isEdit ? 'Update credentials, routing policy, restrictions, and bouquet access.' : 'Provision credentials, routing policy, restrictions, and bouquet access in one controlled workflow.';
  ctx.$('#lineFormId').value = isEdit ? String(line.id) : '';
  ctx.$('#lineUsername').value = line.username || '';
  ctx.$('#linePassword').value = line.password || (isEdit ? '' : generatePasswordValue());
  ctx.$('#lineOwner').value = String(line.member_id || 0);
  ctx.$('#linePackage').value = line.package_id ? String(line.package_id) : '';
  ctx.$('#lineStatus').value = String(line.admin_enabled != null ? line.admin_enabled : 1);
  ctx.$('#lineMaxConnections').value = String(line.max_connections || 1);
  ctx.$('#lineCreatedAt').value = line.created_at ? ctx.formatDate(line.created_at) : 'Auto on save';
  ctx.$('#lineExpiryNever').checked = line.exp_date == null || line.exp_date === '';
  ctx.$('#lineExpiryDate').value = line.exp_date ? unixToDateInput(line.exp_date) : '';
  ctx.$('#lineIsE2').checked = Number(line.is_e2 || 0) === 1;
  ctx.$('#lineIsMag').checked = Number(line.is_mag || 0) === 1;
  ctx.$('#lineIspLock').checked = Number(line.is_isplock || 0) === 1;
  ctx.$('#lineAdminNotes').value = line.admin_notes || '';
  ctx.$('#lineResellerNotes').value = line.reseller_notes || '';
  ctx.$('#linePrivateDns').value = line.contact || '';
  ctx.$('#lineForcedCountry').value = line.forced_country || '';
  ctx.$('#lineForceServer').value = String(line.force_server_id || 0);
  ctx.$('#lineIsStalker').checked = Number(line.is_stalker || 0) === 1;
  ctx.$('#lineIsRestreamer').checked = Number(line.is_restreamer || 0) === 1;
  ctx.$('#lineIsTrial').checked = Number(line.is_trial || (options.trial ? 1 : 0)) === 1;
  ctx.$('#lineIspLockInfo').value = line.last_ip || '';
  ctx.$('#lineAllowedIps').value = parseJsonArray(line.allowed_ips).join('\n');
  ctx.$('#lineAllowedUAs').value = parseJsonArray(line.allowed_ua).join('\n');
  setLineOutputs(ctx, parseJsonArray(line.allowed_outputs));
  setLineBouquetSelection(ctx, parseJsonArray(line.bouquet));
  renderPackageSummary(ctx);
  const playlistBtn = ctx.$('#lineDownloadPlaylistBtn');
  if (playlistBtn) playlistBtn.disabled = !isEdit;
}

function bindLineFormPage(ctx) {
  const page = ctx.$('#page-line-form');
  if (!page || page.dataset.lineFormBound === 'true') return;
  page.dataset.lineFormBound = 'true';

  page.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-line-form-action]');
    if (!btn) return;
    event.preventDefault();
    const action = btn.dataset.lineFormAction;
    if (action === 'save') return saveLine(ctx);
    if (action === 'apply-package-defaults') return applyLinePackageDefaults(ctx);
    if (action === 'download-playlist') return downloadLinePlaylist(ctx);
    if (action === 'reset-bouquets-to-package') return applyLinePackageDefaults(ctx);
    if (action === 'toggle-bouquet') return toggleBouquetSelection(ctx, btn.dataset.bouquetSide, btn.dataset.bouquetId);
    if (action === 'add-bouquets') {
      setLineBouquetSelection(ctx, [...selectedBouquetIds, ...getMarkedBouquetIds(ctx, 'available')]);
      clearMarkedBouquets(ctx);
      return;
    }
    if (action === 'remove-bouquets') {
      const marked = new Set(getMarkedBouquetIds(ctx, 'selected'));
      setLineBouquetSelection(ctx, selectedBouquetIds.filter((id) => !marked.has(String(id))));
      clearMarkedBouquets(ctx);
      return;
    }
    if (action === 'move-bouquet') {
      const marked = getMarkedBouquetIds(ctx, 'selected')[0];
      if (!marked) return;
      const currentIndex = selectedBouquetIds.findIndex((id) => String(id) === String(marked));
      const nextIndex = currentIndex + parseInt(btn.dataset.moveDelta || '0', 10);
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedBouquetIds.length) return;
      const next = selectedBouquetIds.slice();
      const [item] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, item);
      setLineBouquetSelection(ctx, next);
      ctx.$('#lineBouquetSelected').dataset.selectedIds = String(marked);
      return;
    }
  });

  ['#lineBouquetSearchAvailable', '#lineBouquetSearchSelected'].forEach((selector) => {
    const el = ctx.$(selector);
    if (!el) return;
    el.addEventListener('input', () => renderBouquetLists(ctx));
  });

  const packageSelect = ctx.$('#linePackage');
  if (packageSelect) {
    packageSelect.addEventListener('change', () => renderPackageSummary(ctx));
  }
  const expiryNever = ctx.$('#lineExpiryNever');
  if (expiryNever) {
    expiryNever.addEventListener('change', () => {
      const expiryDate = ctx.$('#lineExpiryDate');
      if (expiryDate) expiryDate.disabled = expiryNever.checked;
    });
  }
  ['#lineOutHls', '#lineOutTs'].forEach((selector) => {
    const el = ctx.$(selector);
    if (el) el.addEventListener('change', () => updateOutputSummary(ctx));
  });
}

export async function load(ctx, _categoryType, options = {}) {
  bindLineFormPage(ctx);
  await ctx.loadRefData();
  await ctx.ensureResellersCache();
  await ctx.ensureServersCacheForPlaylist();
  ctx.populateSelect('#lineOwner', [{ id: 0, username: 'Admin' }, ...ctx.getResellersCache()], 'id', 'username');
  ctx.populateSelect('#linePackage', ctx.getPackages(), 'id', 'package_name', '-- Select Package --');
  const serverOptions = [{ id: 0, name: 'Auto (use assigned server)' }, ...ctx.getServersCache()];
  ctx.populateSelect('#lineForceServer', serverOptions, 'id', 'name');

  if (options.id) {
    try {
      const line = await ctx.apiFetch(`/lines/${options.id}`);
      fillLineForm(ctx, line, options);
    } catch (error) {
      ctx.toast(error.message, 'error');
      ctx.navigateTo('manage-users');
    }
    return;
  }

  fillLineForm(ctx, { is_trial: options.trial ? 1 : 0 }, options);
}

export async function saveLine(ctx = window.APP_CTX) {
  const lineId = parseInt(ctx.$('#lineFormId')?.value || '', 10);
  const payload = collectLinePayload(ctx);
  if (!payload.package_id) return ctx.toast('Please select a package', 'error');
  if (!payload.username) return ctx.toast('Username is required', 'error');
  if (!Number.isFinite(lineId) && !payload.password) return ctx.toast('Password is required', 'error');
  if (Number.isFinite(lineId) && !payload.password) delete payload.password;

  try {
    if (Number.isFinite(lineId)) {
      await ctx.apiFetch(`/lines/${lineId}`, { method: 'PUT', body: JSON.stringify(payload) });
      ctx.toast('Line updated');
    } else {
      await ctx.apiFetch('/lines', { method: 'POST', body: JSON.stringify(payload) });
      ctx.toast(payload.is_trial ? 'Trial user created' : 'Line created');
    }
    ctx.navigateTo('manage-users');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export function downloadLinePlaylist(ctx = window.APP_CTX) {
  const username = ctx.$('#lineUsername')?.value || '';
  const password = ctx.$('#linePassword')?.value || '';
  if (!username || !password) return ctx.toast('Username and password are required first', 'error');
  const url = `${location.origin}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`;
  window.open(url, '_blank', 'noopener');
}
