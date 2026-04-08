// pages/packages.js - NovaStreams Panel Packages Management Page Module

const PACKAGE_TABS = ['pkg-details', 'pkg-options', 'pkg-groups', 'pkg-bouquets'];

function showPackageTab(tabId) {
  document.querySelectorAll('#packageModal .wizard-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  document.querySelectorAll('#packageModal .wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabId}`));
  const index = PACKAGE_TABS.indexOf(tabId);
  const prev = document.getElementById('pkgBtnPrev');
  const next = document.getElementById('pkgBtnNext');
  const save = document.getElementById('pkgBtnSave');
  const toggleGroups = document.getElementById('pkgBtnToggleGroups');
  const toggleBouquets = document.getElementById('pkgBtnToggleBouquets');
  if (prev) prev.style.display = index > 0 ? '' : 'none';
  if (next) next.style.display = index < PACKAGE_TABS.length - 1 ? '' : 'none';
  if (save) save.style.display = index === PACKAGE_TABS.length - 1 ? '' : 'none';
  if (toggleGroups) toggleGroups.style.display = tabId === 'pkg-groups' ? '' : 'none';
  if (toggleBouquets) toggleBouquets.style.display = tabId === 'pkg-bouquets' ? '' : 'none';
}

function bindPackagesPage(ctx) {
  const page = ctx.$('#page-packages');
  if (page && page.dataset.packagesBound !== 'true') {
    page.dataset.packagesBound = 'true';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-packages-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.packagesAction;
      if (action === 'open-modal') openPackageModal(ctx);
      if (action === 'edit') openPackageModal(ctx, btn.dataset.packageId);
      if (action === 'delete') deletePackage(ctx, btn.dataset.packageId);
    });
  }

  const modal = ctx.$('#packageModal');
  if (modal && modal.dataset.packagesBound !== 'true') {
    modal.dataset.packagesBound = 'true';
    modal.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-packages-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.packagesAction;
      const activeTab = modal.querySelector('.wizard-tab.active')?.dataset.tab || PACKAGE_TABS[0];
      const index = PACKAGE_TABS.indexOf(activeTab);
      if (action === 'close-modal') closePackageModal(ctx);
      if (action === 'prev-tab' && index > 0) showPackageTab(PACKAGE_TABS[index - 1]);
      if (action === 'next-tab' && index < PACKAGE_TABS.length - 1) showPackageTab(PACKAGE_TABS[index + 1]);
      if (action === 'save') savePackage(ctx);
      if (action === 'toggle-groups') toggleCheckboxColumn('#pkgGroupsTable tbody input[type="checkbox"]');
      if (action === 'toggle-bouquets') toggleCheckboxColumn('#pkgBouquetsTable tbody input[type="checkbox"]');
    });
    modal.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) => tab.addEventListener('click', () => showPackageTab(tab.dataset.tab)));
  }
}

function toggleCheckboxColumn(selector) {
  const boxes = [...document.querySelectorAll(selector)];
  const shouldCheck = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = shouldCheck; });
}

function renderPackageTables(ctx, pkg = null) {
  const selectedGroups = new Set((pkg?.groups || []).map((id) => String(id)));
  const selectedBouquets = new Set((pkg?.bouquets || []).map((id) => String(id)));
  const groupsBody = ctx.$('#pkgGroupsTable tbody');
  const bouquetsBody = ctx.$('#pkgBouquetsTable tbody');
  if (groupsBody) {
    groupsBody.innerHTML = ctx.getUserGroups().map((group) => `
      <tr>
        <td><input type="checkbox" data-pkg-group-id="${group.group_id}" ${selectedGroups.has(String(group.group_id)) ? 'checked' : ''}></td>
        <td>${group.group_id}</td>
        <td>${ctx.escHtml(group.group_name || '')}</td>
      </tr>`).join('');
  }
  if (bouquetsBody) {
    bouquetsBody.innerHTML = ctx.getBouquets().map((bouquet) => `
      <tr>
        <td><input type="checkbox" data-pkg-bouquet-id="${bouquet.id}" ${selectedBouquets.has(String(bouquet.id)) ? 'checked' : ''}></td>
        <td>${bouquet.id}</td>
        <td>${ctx.escHtml(bouquet.bouquet_name || '')}</td>
        <td>${Number(bouquet.channels_count || 0)}</td>
        <td>${Number(bouquet.movies_count || 0)}</td>
        <td>${Number(bouquet.series_count || 0)}</td>
        <td>${Number(bouquet.radios_count || 0)}</td>
      </tr>`).join('');
  }
}

function collectPackagePayload(ctx) {
  return {
    package_name: ctx.$('#pkgName')?.value.trim(),
    is_trial: ctx.$('#pkgTrialEnabled')?.checked ? 1 : 0,
    is_official: ctx.$('#pkgOfficialEnabled')?.checked ? 1 : 0,
    trial_credits: parseFloat(ctx.$('#pkgTrialCredits')?.value || '0') || 0,
    official_credits: parseFloat(ctx.$('#pkgOfficialCredits')?.value || '0') || 0,
    trial_duration: parseInt(ctx.$('#pkgTrialDuration')?.value || '0', 10) || 0,
    trial_duration_in: ctx.$('#pkgTrialDurationIn')?.value || 'day',
    official_duration: parseInt(ctx.$('#pkgOfficialDuration')?.value || '0', 10) || 0,
    official_duration_in: ctx.$('#pkgOfficialDurationIn')?.value || 'month',
    is_mag: ctx.$('#pkgIsMag')?.checked ? 1 : 0,
    is_e2: ctx.$('#pkgIsE2')?.checked ? 1 : 0,
    is_line: ctx.$('#pkgIsLine')?.checked ? 1 : 0,
    is_restreamer: ctx.$('#pkgIsRestreamer')?.checked ? 1 : 0,
    forced_country: ctx.$('#pkgForcedCountry')?.value.trim() || '',
    max_connections: parseInt(ctx.$('#pkgMaxConnections')?.value || '1', 10) || 1,
    output_formats: ['pkgOutM3u8', 'pkgOutTs', 'pkgOutRtmp'].flatMap((id) => {
      const el = ctx.$(`#${id}`);
      if (!el?.checked) return [];
      if (id === 'pkgOutM3u8') return ['m3u8'];
      if (id === 'pkgOutTs') return ['ts'];
      return ['rtmp'];
    }),
    groups: [...document.querySelectorAll('#pkgGroupsTable tbody input[data-pkg-group-id]:checked')].map((el) => parseInt(el.dataset.pkgGroupId, 10)).filter(Number.isFinite),
    bouquets: [...document.querySelectorAll('#pkgBouquetsTable tbody input[data-pkg-bouquet-id]:checked')].map((el) => parseInt(el.dataset.pkgBouquetId, 10)).filter(Number.isFinite),
  };
}

export async function load(ctx) {
  bindPackagesPage(ctx);
  await ctx.loadRefData();
  const packages = ctx.getPackages();
  const tbody = ctx.$('#packagesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = packages.map((pkg) => `
    <tr>
      <td>${pkg.id}</td>
      <td>${ctx.escHtml(pkg.package_name || '')}</td>
      <td>${pkg.official_credits || 0}</td>
      <td>${pkg.max_connections || 1}</td>
      <td>${Array.isArray(pkg.bouquets) ? pkg.bouquets.length : 0}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-packages-action="edit" data-package-id="${pkg.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-packages-action="delete" data-package-id="${pkg.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No packages found</td></tr>';
}

export function openPackageModal(ctx, id = null) {
  const modal = ctx.$('#packageModal');
  if (!modal) return;
  const pkg = id ? ctx.getPackages().find((row) => Number(row.id) === Number(id)) : null;
  ctx.$('#pkgModalTitle').textContent = pkg ? 'Edit Package' : 'Add Package';
  ctx.$('#pkgFormId').value = pkg ? String(pkg.id) : '';
  ctx.$('#pkgName').value = pkg?.package_name || '';
  ctx.$('#pkgTrialEnabled').checked = Number(pkg?.is_trial || 0) === 1;
  ctx.$('#pkgOfficialEnabled').checked = Number(pkg?.is_official ?? 1) === 1;
  ctx.$('#pkgTrialCredits').value = String(pkg?.trial_credits || 0);
  ctx.$('#pkgOfficialCredits').value = String(pkg?.official_credits || 0);
  ctx.$('#pkgTrialDuration').value = String(pkg?.trial_duration || 0);
  ctx.$('#pkgTrialDurationIn').value = pkg?.trial_duration_in || 'day';
  ctx.$('#pkgOfficialDuration').value = String(pkg?.official_duration || 0);
  ctx.$('#pkgOfficialDurationIn').value = pkg?.official_duration_in || 'month';
  ctx.$('#pkgIsMag').checked = Number(pkg?.is_mag || 0) === 1;
  ctx.$('#pkgIsE2').checked = Number(pkg?.is_e2 || 0) === 1;
  ctx.$('#pkgIsLine').checked = Number(pkg?.is_line ?? 1) === 1;
  ctx.$('#pkgIsRestreamer').checked = Number(pkg?.is_restreamer || 0) === 1;
  ctx.$('#pkgForcedCountry').value = pkg?.forced_country || '';
  ctx.$('#pkgMaxConnections').value = String(pkg?.max_connections || 1);
  ctx.$('#pkgOutM3u8').checked = (pkg?.output_formats || []).includes('m3u8');
  ctx.$('#pkgOutTs').checked = (pkg?.output_formats || []).includes('ts');
  ctx.$('#pkgOutRtmp').checked = (pkg?.output_formats || []).includes('rtmp');
  renderPackageTables(ctx, pkg || { groups: [], bouquets: [] });
  showPackageTab('pkg-details');
  modal.style.display = 'flex';
}

export function closePackageModal(ctx) {
  const modal = ctx.$('#packageModal');
  if (modal) modal.style.display = 'none';
}

export async function savePackage(ctx) {
  const id = parseInt(ctx.$('#pkgFormId')?.value || '', 10);
  const body = collectPackagePayload(ctx);
  if (!body.package_name) return ctx.toast('Package name is required', 'error');
  try {
    if (Number.isFinite(id)) await ctx.apiFetch(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await ctx.apiFetch('/packages', { method: 'POST', body: JSON.stringify(body) });
    await ctx.loadRefData(true);
    closePackageModal(ctx);
    await load(ctx);
    ctx.toast(Number.isFinite(id) ? 'Package updated' : 'Package created');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function deletePackage(ctx, id) {
  if (!(await ctx.showConfirm('Delete this package?'))) return;
  try {
    await ctx.apiFetch(`/packages/${id}`, { method: 'DELETE' });
    await ctx.loadRefData(true);
    await load(ctx);
    ctx.toast('Package deleted');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
