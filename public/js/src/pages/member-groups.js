// pages/member-groups.js - Extracted from modules/reseller-members.js
// NovaStreams Panel Member Groups Management Page Module

function bindMemberGroupsPage(ctx) {
  const page = ctx.$('#page-member-groups');
  if (page && page.dataset.memberGroupsBound !== 'true') {
    page.dataset.memberGroupsBound = 'true';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-member-groups-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.memberGroupsAction;
      if (action === 'open-form') openMemberGroupForm(ctx, btn.dataset.groupId);
      if (action === 'delete') deleteMemberGroup(ctx, btn.dataset.groupId);
    });
  }
  const search = ctx.$('#memberGroupsSearch');
  if (search && search.dataset.memberGroupsBound !== 'true') {
    search.dataset.memberGroupsBound = 'true';
    search.addEventListener('input', () => load(ctx));
  }
  const formPage = ctx.$('#page-member-group-form');
  if (formPage && formPage.dataset.memberGroupsBound !== 'true') {
    formPage.dataset.memberGroupsBound = 'true';
    formPage.querySelectorAll('.wizard-tab[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
      formPage.querySelectorAll('.wizard-tab').forEach((item) => item.classList.toggle('active', item === tab));
      formPage.querySelectorAll('.wizard-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`));
    }));
    formPage.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-member-groups-action]');
      if (!btn) return;
      event.preventDefault();
      if (btn.dataset.memberGroupsAction === 'save') saveMemberGroup(ctx);
    });
  }
}

async function populateMemberGroupForm(ctx) {
  const id = ctx.getMemberGroupsEditingId();
  const group = id ? await ctx.apiFetch(`/user-groups/${id}`).catch(() => null) : null;
  ctx.$('#memberGroupFormTitle').textContent = group ? 'Edit Group' : 'Add Group';
  ctx.$('#memberGroupFormId').value = group ? String(group.group_id) : '';
  ctx.$('#memberGroupName').value = group?.group_name || '';
  ctx.$('#memberGroupIsAdmin').checked = Number(group?.is_admin || 0) === 1;
  ctx.$('#memberGroupIsReseller').checked = Number(group?.is_reseller ?? 1) === 1;
  ctx.$('#memberGroupTrialsAllowed').value = String(group?.total_allowed_gen_trials || 0);
  ctx.$('#memberGroupTrialsIn').value = group?.total_allowed_gen_in || 'day';
  ctx.$('#memberGroupDeleteUsers').checked = Number(group?.delete_users || 0) === 1;
  ctx.$('#memberGroupManageExpiryMedia').checked = Number(group?.manage_expiry_media || 0) === 1;
  ctx.$('#memberGroupAnnouncement').value = group?.notice_html || '';
}

export async function load(ctx) {
  bindMemberGroupsPage(ctx);
  if (ctx.getCurrentPage() === 'member-group-form') {
    await populateMemberGroupForm(ctx);
    return;
  }
  const search = (ctx.$('#memberGroupsSearch')?.value || '').toLowerCase();
  try {
    const data = await ctx.apiFetch('/user-groups');
    const groups = (data.groups || []).filter((group) => !search || String(group.group_name || '').toLowerCase().includes(search));
    ctx.setMemberGroupsCurrentRows(groups);
    const tbody = ctx.$('#memberGroupsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = groups.map((group) => `
      <tr>
        <td>${group.group_id}</td>
        <td>${ctx.escHtml(group.group_name || '')}</td>
        <td>${Number(group.member_count || 0)}</td>
        <td>${Number(group.is_admin) === 1 ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-secondary">No</span>'}</td>
        <td>${Number(group.is_reseller) === 1 ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-secondary">No</span>'}</td>
        <td><button class="btn btn-xs btn-primary" data-member-groups-action="open-form" data-group-id="${group.group_id}">Edit</button> <button class="btn btn-xs btn-danger" data-member-groups-action="delete" data-group-id="${group.group_id}">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No member groups found</td></tr>';
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function openMemberGroupForm(ctx, id = null) {
  ctx.setMemberGroupsEditingId(id ? parseInt(id, 10) : null);
  if (ctx.getCurrentPage() !== 'member-group-form') {
    ctx.navigateTo('member-group-form');
    return;
  }
  await populateMemberGroupForm(ctx);
}

export async function saveMemberGroup(ctx) {
  const id = parseInt(ctx.$('#memberGroupFormId')?.value || '', 10);
  const body = {
    group_name: ctx.$('#memberGroupName')?.value.trim(),
    is_admin: ctx.$('#memberGroupIsAdmin')?.checked ? 1 : 0,
    is_reseller: ctx.$('#memberGroupIsReseller')?.checked ? 1 : 0,
    total_allowed_gen_trials: parseInt(ctx.$('#memberGroupTrialsAllowed')?.value || '0', 10) || 0,
    total_allowed_gen_in: ctx.$('#memberGroupTrialsIn')?.value || 'day',
    delete_users: ctx.$('#memberGroupDeleteUsers')?.checked ? 1 : 0,
    manage_expiry_media: ctx.$('#memberGroupManageExpiryMedia')?.checked ? 1 : 0,
    notice_html: ctx.$('#memberGroupAnnouncement')?.value || '',
  };
  if (!body.group_name) return ctx.toast('Group name is required', 'error');
  try {
    if (Number.isFinite(id)) await ctx.apiFetch(`/user-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await ctx.apiFetch('/user-groups', { method: 'POST', body: JSON.stringify(body) });
    ctx.toast(Number.isFinite(id) ? 'Group updated' : 'Group created');
    ctx.navigateTo('member-groups');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function deleteMemberGroup(ctx, id) {
  if (!(await ctx.showConfirm('Delete this member group?'))) return;
  try {
    await ctx.apiFetch(`/user-groups/${id}`, { method: 'DELETE' });
    ctx.toast('Group deleted');
    await load(ctx);
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
