// pages/users.js - NovaStreams Panel Admin Users Management Page Module

export async function loadUsers(ctx) {
  bindUsersPage(ctx);
  try {
    const data = await ctx.apiFetch('/users');
    ctx.setUsersCache(data.users || []);
    renderUsersTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

function bindUsersPage(ctx) {
  const page = ctx.$('#page-users');
  if (page && page.dataset.usersBound !== 'true') {
    page.dataset.usersBound = 'true';
    page.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-users-action]');
      if (!actionBtn) return;
      event.preventDefault();
      const action = actionBtn.dataset.usersAction;
      const userId = actionBtn.dataset.userId;
      if (action === 'open-modal') openUserModal(ctx);
      if (action === 'edit') openUserModal(ctx, userId);
      if (action === 'delete') deleteUser(ctx, userId);
    });
  }

  const modal = ctx.$('#userModal');
  if (modal && modal.dataset.usersBound !== 'true') {
    modal.dataset.usersBound = 'true';
    modal.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-users-action]');
      if (!actionBtn) return;
      event.preventDefault();
      const action = actionBtn.dataset.usersAction;
      if (action === 'close-modal') closeUserModal(ctx);
      if (action === 'save') saveUser(ctx);
    });
  }
}

export function renderUsersTable(ctx) {
  const users = ctx.getUsersCache() || [];
  const tbody = ctx.$('#usersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td>${u.id}</td>
      <td>${ctx.escHtml(u.username || '')}</td>
      <td>${ctx.escHtml(u.email || '')}</td>
      <td>${u.is_admin ? '<span class="badge badge-success">Admin</span>' : '<span class="badge badge-secondary">User</span>'}</td>
      <td>${u.last_login ? ctx.formatDate(u.last_login) : 'Never'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-users-action="edit" data-user-id="${u.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-users-action="delete" data-user-id="${u.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No users found</td></tr>';
}

export async function openUserModal(ctx, id = null) {
  const modal = ctx.$('#userModal');
  if (!modal) return;
  const title = ctx.$('#usrModalTitle');
  const idField = ctx.$('#usrFormId');
  const username = ctx.$('#usrUsername');
  const password = ctx.$('#usrPassword');
  const email = ctx.$('#usrEmail');
  if (id) {
    const user = ctx.getUsersCache().find((row) => Number(row.id) === Number(id)) || await ctx.apiFetch(`/users`).then((data) => (data.users || []).find((row) => Number(row.id) === Number(id)));
    if (!user) return ctx.toast('User not found', 'error');
    if (title) title.textContent = 'Edit User';
    if (idField) idField.value = String(user.id);
    if (username) { username.value = user.username || ''; username.readOnly = true; }
    if (password) password.value = '';
    if (email) email.value = user.email || '';
  } else {
    if (title) title.textContent = 'Add User';
    if (idField) idField.value = '';
    if (username) { username.value = ''; username.readOnly = false; }
    if (password) password.value = '';
    if (email) email.value = '';
  }
  modal.style.display = 'flex';
}

export function closeUserModal(ctx) {
  const modal = ctx.$('#userModal');
  if (modal) modal.style.display = 'none';
}

export async function saveUser(ctx) {
  const id = parseInt(ctx.$('#usrFormId')?.value || '', 10);
  const body = {
    username: ctx.$('#usrUsername')?.value.trim(),
    password: ctx.$('#usrPassword')?.value || '',
    email: ctx.$('#usrEmail')?.value.trim() || '',
  };
  try {
    if (Number.isFinite(id)) {
      const payload = { email: body.email };
      if (body.password) payload.password = body.password;
      await ctx.apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      ctx.toast('User updated');
    } else {
      if (!body.username || !body.password) return ctx.toast('Username and password required', 'error');
      await ctx.apiFetch('/users', { method: 'POST', body: JSON.stringify(body) });
      ctx.toast('User created');
    }
    closeUserModal(ctx);
    await loadUsers(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export async function deleteUser(ctx, id) {
  if (!(await ctx.showConfirm?.('Delete this panel user?') || confirm('Delete this panel user?'))) return;
  try {
    await ctx.apiFetch(`/users/${id}`, { method: 'DELETE' });
    ctx.toast('User deleted');
    await loadUsers(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}
