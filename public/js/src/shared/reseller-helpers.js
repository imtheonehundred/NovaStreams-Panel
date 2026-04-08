// Shared reseller helpers - extracted from modules/reseller-helpers.js

export function formatUserDate(raw, formatDateFn) {
  if (!raw) return 'Never';
  if (formatDateFn) return formatDateFn(raw);
  return raw;
}

export function getResellerMemberGroups(userGroups) {
  return (userGroups || []).filter((g) => Number(g.is_reseller) === 1);
}

export function renderRegisteredUsersPagination(ctx, total) {
  const bar = ctx.$('#registeredUsersPagination');
  if (!bar) return;
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, ctx.getRegisteredUsersPerPage())));
  const info = `<span class="pagination-info">Page ${ctx.getRegisteredUsersPage()} of ${totalPages} · Total ${total || 0}</span>`;
  const buttons = [
    `<button class="btn btn-xs btn-secondary" ${ctx.getRegisteredUsersPage() <= 1 ? 'disabled' : ''} data-registered-users-page="${ctx.getRegisteredUsersPage() - 1}">Prev</button>`,
    `<button class="btn btn-xs btn-secondary" ${ctx.getRegisteredUsersPage() >= totalPages ? 'disabled' : ''} data-registered-users-page="${ctx.getRegisteredUsersPage() + 1}">Next</button>`,
  ].join('');
  bar.innerHTML = `${info}<div class="pagination-controls">${buttons}</div>`;
}

export function syncRegisteredUsersGroupControls(ctx) {
  const groups = getResellerMemberGroups(ctx.getUserGroups ? ctx.getUserGroups() : []);
  const filter = ctx.$('#registeredUsersGroupFilter');
  const form = ctx.$('#registeredUserGroup');
  const currentFilter = filter ? filter.value : '';
  const currentForm = form ? form.value : '';
  ctx.populateSelect('#registeredUsersGroupFilter', groups, 'group_id', 'group_name', 'All Member Groups');
  ctx.populateSelect('#registeredUserGroup', groups, 'group_id', 'group_name', 'Select reseller group...');
  if (filter) filter.value = currentFilter;
  if (form && currentForm) form.value = currentForm;
}

export function renderRegisteredUserPackageOverridesTable(ctx, overrides, packages) {
  const tbody = ctx.$('#registeredUserPackageOverridesTable tbody');
  if (!tbody) return;
  const overrideMap = new Map((overrides || []).map((row) => [String(row.package_id), row]));
  tbody.innerHTML = (packages || []).map((pkg, index) => {
    const override = overrideMap.get(String(pkg.id)) || {};
    return `
      <tr data-package-id="${pkg.id}">
        <td>${index + 1}</td>
        <td>${ctx.escHtml(pkg.package_name || '')}</td>
        <td>${Number(pkg.trial_credits || 0).toFixed(2)}</td>
        <td>${Number(pkg.official_credits || 0).toFixed(2)}</td>
        <td><input type="number" class="form-control rpo-trial" min="0" step="0.01" value="${override.trial_credits_override != null ? ctx.escHtml(String(override.trial_credits_override)) : ''}" placeholder="Default"></td>
        <td><input type="number" class="form-control rpo-official" min="0" step="0.01" value="${override.official_credits_override != null ? ctx.escHtml(String(override.official_credits_override)) : ''}" placeholder="Default"></td>
        <td><label class="toggle"><input type="checkbox" class="rpo-enabled" ${overrideMap.has(String(pkg.id)) ? (Number(override.enabled) === 1 ? 'checked' : '') : ''}><span class="toggle-slider"></span></label></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" style="color:#8b949e;text-align:center">No packages available</td></tr>';
}

export function collectRegisteredUserPackageOverrides(ctx) {
  return [...document.querySelectorAll('#registeredUserPackageOverridesTable tbody tr[data-package-id]')].map((row) => {
    const packageId = parseInt(row.dataset.packageId, 10);
    const data = {
      package_id: packageId,
      enabled: row.querySelector('.rpo-enabled')?.checked ? 1 : 0,
      trial_credits_override: row.querySelector('.rpo-trial')?.value || '',
      official_credits_override: row.querySelector('.rpo-official')?.value || '',
    };
    return data;
  }).filter((row) => row.enabled || row.trial_credits_override !== '' || row.official_credits_override !== '');
}

export function updateRegisteredUserCreditsPreview(ctx) {
  const target = ctx.getRegisteredUserCreditsTarget();
  if (!target) return;
  const mode = ctx.$('#registeredUserCreditsMode')?.value || 'add';
  const amount = parseFloat(ctx.$('#registeredUserCreditsAmount')?.value || '0') || 0;
  const current = Number(target.credits || 0);
  let next = current;
  if (mode === 'add') next = current + amount;
  else if (mode === 'subtract') next = Math.max(0, current - amount);
  else next = Math.max(0, amount);
  const preview = ctx.$('#registeredUserCreditsPreview');
  if (preview) preview.textContent = `New Balance: ${next.toFixed(2)}`;
}

export function buildExpiryMediaRow(ctx, item = {}) {
  return `
    <div class="reseller-members-expiry-row">
      <input type="text" class="form-control rem-country" placeholder="Country code (blank = default)" value="${ctx.escHtml(item.country_code || '')}">
      <input type="text" class="form-control rem-url" placeholder="https://example.com/media.m3u8" value="${ctx.escHtml(item.media_url || '')}">
      <button type="button" class="btn btn-xs btn-danger" data-app-action="removeExpiryMediaRow" data-app-args="this">Remove</button>
    </div>
  `;
}

export function renderExpiryMediaScenarioRows(ctx, scenario, items) {
  const wrap = scenario === 'expiring' ? ctx.$('#expiryMediaExpiringRows') : ctx.$('#expiryMediaExpiredRows');
  if (!wrap) return;
  const filtered = (items || []).filter((item) => item.scenario === scenario);
  wrap.innerHTML = (filtered.length ? filtered : [{}]).map((item) => buildExpiryMediaRow(ctx, item)).join('');
}

export function collectExpiryMediaRows(ctx, containerSelector, scenario) {
  const wrap = ctx.$(containerSelector);
  if (!wrap) return [];
  return [...wrap.querySelectorAll('.reseller-members-expiry-row')]
    .map((row, index) => ({
      scenario,
      country_code: row.querySelector('.rem-country')?.value || '',
      media_url: row.querySelector('.rem-url')?.value || '',
      sort_order: index,
    }))
    .filter((item) => String(item.media_url || '').trim());
}
