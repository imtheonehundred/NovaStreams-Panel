// pages/registered-users.js - Extracted from modules/reseller-members.js
// NovaStreams Panel Registered Users (Resellers) Management Page Module

import { syncRegisteredUsersGroupControls, renderRegisteredUsersPagination, formatUserDate, renderRegisteredUserPackageOverridesTable, collectRegisteredUserPackageOverrides, updateRegisteredUserCreditsPreview } from '@shared/reseller-helpers';

export async function loadRegisteredUsers(ctx) {
  bindRegisteredUsersPage(ctx);
  await ctx.loadRefData();
  syncRegisteredUsersGroupControls(ctx);
  const search = ctx.$('#registeredUsersSearch')?.value || '';
  const groupId = ctx.$('#registeredUsersGroupFilter')?.value || '';
  const status = ctx.$('#registeredUsersStatusFilter')?.value || '';
  ctx.setRegisteredUsersPerPage(parseInt(ctx.$('#registeredUsersPerPage')?.value || '25', 10) || 25);
  const offset = (ctx.getRegisteredUsersPage() - 1) * ctx.getRegisteredUsersPerPage();
  try {
    const params = new URLSearchParams({ limit: String(ctx.getRegisteredUsersPerPage()), offset: String(offset) });
    if (search.trim()) params.set('search', search.trim());
    if (groupId) params.set('group_id', groupId);
    if (status !== '') params.set('status', status);
    const data = await ctx.apiFetch(`/resellers?${params.toString()}`);
    const items = data.resellers || [];
    ctx.setRegisteredUsersCurrentRows(items);
    const tbody = ctx.$('#registeredUsersTable tbody');
    if (!tbody) return;
    tbody.innerHTML = items.map((row) => `
      <tr>
        <td>${row.id}</td>
        <td>${ctx.escHtml(row.username || '')}</td>
        <td>${ctx.escHtml(row.email || '')}</td>
        <td>${ctx.escHtml(row.group_name || '-')}</td>
        <td>${Number(row.credits || 0).toFixed(2)}</td>
        <td>${ctx.statusBadge(Number(row.status) === 1, false, false)}</td>
        <td>${Number(row.line_count || 0)}</td>
        <td>${ctx.escHtml(row.reseller_dns || '')}</td>
        <td>${formatUserDate(row.last_login, ctx.formatDate)}</td>
        <td>${formatUserDate(row.created_at, ctx.formatDate)}</td>
        <td>
          <details class="reseller-members-row-actions">
            <summary class="btn btn-xs btn-secondary">Actions</summary>
            <div class="reseller-members-row-actions-menu">
              <button type="button" class="btn btn-xs btn-secondary" data-registered-users-action="notes" data-user-id="${row.id}">Notes</button>
              <button type="button" class="btn btn-xs btn-primary" data-registered-users-action="edit" data-user-id="${row.id}">Edit User</button>
              <button type="button" class="btn btn-xs btn-secondary" data-registered-users-action="credits" data-user-id="${row.id}">Manage Credits</button>
              <button type="button" class="btn btn-xs btn-warning" data-registered-users-action="toggle-status" data-user-id="${row.id}">${Number(row.status) === 1 ? 'Disable' : 'Enable'}</button>
              <button type="button" class="btn btn-xs btn-danger" data-registered-users-action="delete" data-user-id="${row.id}">Delete</button>
            </div>
          </details>
        </td>
      </tr>`).join('') || '<tr><td colspan="11" style="color:#8b949e;text-align:center;padding:1rem">No registered users found</td></tr>';
    renderRegisteredUsersPagination(ctx, data.total || items.length);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function loadRegisteredUserFormPage(ctx) {
  await ctx.loadRefData();
  syncRegisteredUsersGroupControls(ctx);
  const usernameInput = ctx.$('#registeredUserUsername');
  const passwordInput = ctx.$('#registeredUserPassword');
  if (ctx.getRegisteredUsersEditingId()) {
    try {
      const user = await ctx.apiFetch(`/resellers/${ctx.getRegisteredUsersEditingId()}`);
      ctx.$('#registeredUserFormTitle').textContent = 'Edit Registered User';
      ctx.$('#registeredUserFormSubtitle').textContent = 'Update reseller account details, group assignment, notes, and package credit overrides.';
      ctx.$('#registeredUserFormId').value = user.id;
      if (usernameInput) { usernameInput.value = user.username || ''; usernameInput.readOnly = true; }
      if (passwordInput) passwordInput.value = '';
      ctx.$('#registeredUserEmail').value = user.email || '';
      ctx.$('#registeredUserGroup').value = String(user.member_group_id || '');
      ctx.$('#registeredUserCredits').value = String(Number(user.credits || 0));
      ctx.$('#registeredUserDns').value = user.reseller_dns || '';
      ctx.$('#registeredUserStatus').checked = Number(user.status) === 1;
      ctx.$('#registeredUserNotes').value = user.notes || '';
      ctx.$('#registeredUserCreatedAt').value = formatUserDate(user.created_at, ctx.formatDate);
      ctx.$('#registeredUserLastLogin').value = formatUserDate(user.last_login, ctx.formatDate);
      ctx.setRegisteredUserPackageOverrides(user.package_overrides || []);
      renderRegisteredUserPackageOverridesTable(ctx, ctx.getRegisteredUserPackageOverrides(), ctx.getPackages());
    } catch (e) {
      ctx.toast(e.message, 'error');
      ctx.navigateTo('registered-users');
    }
    return;
  }
  ctx.$('#registeredUserFormTitle').textContent = 'Add Registered User';
  ctx.$('#registeredUserFormSubtitle').textContent = 'Provision a reseller operator account.';
  ctx.$('#registeredUserFormId').value = '';
  if (usernameInput) { usernameInput.value = ''; usernameInput.readOnly = false; }
  if (passwordInput) passwordInput.value = '';
  ctx.$('#registeredUserEmail').value = '';
  ctx.$('#registeredUserCredits').value = '0';
  ctx.$('#registeredUserDns').value = '';
  ctx.$('#registeredUserStatus').checked = true;
  ctx.$('#registeredUserNotes').value = '';
  ctx.$('#registeredUserCreatedAt').value = 'Auto on save';
  ctx.$('#registeredUserLastLogin').value = 'Never';
  ctx.setRegisteredUserPackageOverrides([]);
  const groups = ctx.getUserGroups().filter((g) => Number(g.is_reseller) === 1);
  if (groups.length && ctx.$('#registeredUserGroup')) ctx.$('#registeredUserGroup').value = String(groups[0].group_id);
  renderRegisteredUserPackageOverridesTable(ctx, [], ctx.getPackages());
}

export function openRegisteredUserForm(ctx, id) {
  const nextId = parseInt(id, 10);
  ctx.setRegisteredUsersEditingId(Number.isFinite(nextId) ? nextId : null);
  const targetPage = ctx.getRegisteredUsersEditingId() ? 'registered-user-form' : 'add-registered-user';
  if (ctx.getCurrentPage() !== targetPage) return ctx.navigateTo(targetPage);
  return loadRegisteredUserFormPage(ctx);
}

function bindRegisteredUsersPage(ctx) {
  const listPage = ctx.$('#page-registered-users');
  if (listPage && listPage.dataset.registeredUsersBound !== 'true') {
    listPage.dataset.registeredUsersBound = 'true';
    listPage.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-registered-users-action], [data-registered-users-page]');
      if (!actionBtn) return;
      event.preventDefault();
      if (actionBtn.dataset.registeredUsersPage) {
        ctx.setRegisteredUsersPage(parseInt(actionBtn.dataset.registeredUsersPage, 10) || 1);
        loadRegisteredUsers(ctx);
        return;
      }
      const userId = actionBtn.dataset.userId;
      const action = actionBtn.dataset.registeredUsersAction;
      if (action === 'notes') openRegisteredUserNotes(ctx, userId);
      if (action === 'edit') openRegisteredUserForm(ctx, userId);
      if (action === 'credits') openRegisteredUserCredits(ctx, userId);
      if (action === 'toggle-status') toggleRegisteredUserStatus(ctx, userId);
      if (action === 'delete') deleteRegisteredUser(ctx, userId);
    });
  }

  ['#registeredUsersSearch', '#registeredUsersGroupFilter', '#registeredUsersStatusFilter', '#registeredUsersPerPage'].forEach((selector) => {
    const el = ctx.$(selector);
    if (!el || el.dataset.registeredUsersBound === 'true') return;
    el.dataset.registeredUsersBound = 'true';
    const reload = () => {
      ctx.setRegisteredUsersPage(1);
      loadRegisteredUsers(ctx);
    };
    el.addEventListener('input', reload);
    el.addEventListener('change', reload);
  });
}

export async function saveRegisteredUser(ctx) {
  const id = parseInt(ctx.$('#registeredUserFormId')?.value || '', 10);
  const body = {
    email: ctx.$('#registeredUserEmail').value,
    notes: ctx.$('#registeredUserNotes').value,
    member_group_id: parseInt(ctx.$('#registeredUserGroup').value, 10),
    credits: parseFloat(ctx.$('#registeredUserCredits').value) || 0,
    reseller_dns: ctx.$('#registeredUserDns').value,
    status: ctx.$('#registeredUserStatus').checked ? 1 : 0,
    package_overrides: collectRegisteredUserPackageOverrides(ctx),
  };
  if (!Number.isFinite(body.member_group_id)) return ctx.toast('Select a reseller member group', 'error');
  if (Number.isFinite(id)) {
    const nextPassword = ctx.$('#registeredUserPassword').value.trim();
    if (nextPassword) body.password = nextPassword;
    try {
      await ctx.apiFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      ctx.toast('Registered user updated');
      ctx.setRegisteredUsersEditingId(null);
      ctx.navigateTo('registered-users');
    } catch (e) { ctx.toast(e.message, 'error'); }
    return;
  }
  body.username = ctx.$('#registeredUserUsername').value.trim();
  body.password = ctx.$('#registeredUserPassword').value.trim();
  if (!body.username || !body.password) return ctx.toast('Username and password required', 'error');
  try {
    await ctx.apiFetch('/resellers', { method: 'POST', body: JSON.stringify(body) });
    ctx.toast('Registered user created');
    ctx.navigateTo('registered-users');
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function openRegisteredUserNotes(ctx, id) {
  try {
    const user = await ctx.apiFetch(`/resellers/${id}`);
    ctx.setRegisteredUserNotesTarget(user);
    ctx.$('#registeredUserNotesId').value = user.id;
    ctx.$('#registeredUserNotesTitle').textContent = `Notes: ${user.username || 'Registered User'}`;
    ctx.$('#registeredUserNotesModalValue').value = user.notes || '';
    ctx.$('#registeredUserNotesModal').style.display = 'flex';
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export function closeRegisteredUserNotesModal(ctx) { ctx.$('#registeredUserNotesModal').style.display = 'none'; }

export async function saveRegisteredUserNotes(ctx) {
  const id = parseInt(ctx.$('#registeredUserNotesId')?.value || '', 10);
  if (!Number.isFinite(id)) return;
  try {
    await ctx.apiFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify({ notes: ctx.$('#registeredUserNotesModalValue').value }) });
    ctx.toast('Notes updated');
    closeRegisteredUserNotesModal(ctx);
    if (ctx.getCurrentPage() === 'registered-users') await loadRegisteredUsers(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function openRegisteredUserCredits(ctx, id) {
  try {
    const user = await ctx.apiFetch(`/resellers/${id}`);
    ctx.setRegisteredUserCreditsTarget(user);
    ctx.$('#registeredUserCreditsId').value = user.id;
    ctx.$('#registeredUserCreditsTitle').textContent = `Manage Credits: ${user.username || ''}`;
    ctx.$('#registeredUserCurrentBalance').textContent = `Current Balance: ${Number(user.credits || 0).toFixed(2)}`;
    ctx.$('#registeredUserCreditsMode').value = 'add';
    ctx.$('#registeredUserCreditsAmount').value = '0';
    ctx.$('#registeredUserCreditsReason').value = '';
    updateRegisteredUserCreditsPreview(ctx);
    ctx.$('#registeredUserCreditsModal').style.display = 'flex';
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export function closeRegisteredUserCreditsModal(ctx) { ctx.$('#registeredUserCreditsModal').style.display = 'none'; }

export async function saveRegisteredUserCredits(ctx) {
  const target = ctx.getRegisteredUserCreditsTarget();
  if (!target) return;
  const mode = ctx.$('#registeredUserCreditsMode').value;
  const amount = parseFloat(ctx.$('#registeredUserCreditsAmount').value || '0') || 0;
  const reason = ctx.$('#registeredUserCreditsReason').value || '';
  const current = Number(target.credits || 0);
  let next = current;
  if (mode === 'add') next = current + amount;
  else if (mode === 'subtract') next = Math.max(0, current - amount);
  else next = Math.max(0, amount);
  try {
    await ctx.apiFetch(`/resellers/${target.id}/credits`, { method: 'PUT', body: JSON.stringify({ credits: next, reason }) });
    ctx.toast('Credits updated');
    closeRegisteredUserCreditsModal(ctx);
    if (ctx.getCurrentPage() === 'registered-users') await loadRegisteredUsers(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function toggleRegisteredUserStatus(ctx, id) {
  const current = ctx.getRegisteredUsersCurrentRows().find((row) => Number(row.id) === Number(id));
  const next = current && Number(current.status) === 1 ? 0 : 1;
  try {
    await ctx.apiFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
    ctx.toast(next === 1 ? 'Registered user enabled' : 'Registered user disabled');
    await loadRegisteredUsers(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function deleteRegisteredUser(ctx, id) {
  if (!confirm('Delete this registered user? They must not own any lines.')) return;
  try {
    await ctx.apiFetch(`/resellers/${id}`, { method: 'DELETE' });
    ctx.toast('Registered user deleted');
    await loadRegisteredUsers(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}
