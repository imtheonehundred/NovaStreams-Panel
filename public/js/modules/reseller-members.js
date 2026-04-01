(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createResellerMembersModule() {
    async function loadRegisteredUsers(ctx) {
      await ctx.loadRefData();
      ctx.syncRegisteredUsersGroupControls();
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
            <td>${ctx.formatUserDate(row.last_login)}</td>
            <td>${ctx.formatUserDate(row.created_at)}</td>
            <td>
              <details class="reseller-members-row-actions">
                <summary class="btn btn-xs btn-secondary">Actions</summary>
                <div class="reseller-members-row-actions-menu">
                  <button type="button" class="btn btn-xs btn-secondary" onclick="APP.openRegisteredUserNotes(${row.id})">Notes</button>
                  <button type="button" class="btn btn-xs btn-primary" onclick="APP.editRegisteredUser(${row.id})">Edit User</button>
                  <button type="button" class="btn btn-xs btn-secondary" onclick="APP.openRegisteredUserCredits(${row.id})">Manage Credits</button>
                  <button type="button" class="btn btn-xs btn-warning" onclick="APP.toggleRegisteredUserStatus(${row.id})">${Number(row.status) === 1 ? 'Disable' : 'Enable'}</button>
                  <button type="button" class="btn btn-xs btn-danger" onclick="APP.deleteRegisteredUser(${row.id})">Delete</button>
                </div>
              </details>
            </td>
          </tr>`).join('') || '<tr><td colspan="11" style="color:#8b949e;text-align:center;padding:1rem">No registered users found</td></tr>';
        ctx.renderRegisteredUsersPagination(data.total || items.length);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function loadRegisteredUserFormPage(ctx) {
      await ctx.loadRefData();
      ctx.syncRegisteredUsersGroupControls();
      const usernameInput = ctx.$('#registeredUserUsername');
      const passwordInput = ctx.$('#registeredUserPassword');
      if (ctx.getRegisteredUsersEditingId()) {
        try {
          const user = await ctx.apiFetch(`/resellers/${ctx.getRegisteredUsersEditingId()}`);
          ctx.$('#registeredUserFormTitle').textContent = 'Edit Registered User';
          ctx.$('#registeredUserFormSubtitle').textContent = 'Update reseller account details, group assignment, notes, and package credit overrides for this registered reseller member.';
          ctx.$('#registeredUserFormId').value = user.id;
          if (usernameInput) { usernameInput.value = user.username || ''; usernameInput.readOnly = true; }
          if (passwordInput) passwordInput.value = '';
          ctx.$('#registeredUserEmail').value = user.email || '';
          ctx.$('#registeredUserGroup').value = String(user.member_group_id || '');
          ctx.$('#registeredUserCredits').value = String(Number(user.credits || 0));
          ctx.$('#registeredUserDns').value = user.reseller_dns || '';
          ctx.$('#registeredUserStatus').checked = Number(user.status) === 1;
          ctx.$('#registeredUserNotes').value = user.notes || '';
          ctx.$('#registeredUserCreatedAt').value = ctx.formatUserDate(user.created_at);
          ctx.$('#registeredUserLastLogin').value = ctx.formatUserDate(user.last_login);
          ctx.setRegisteredUserPackageOverrides(user.package_overrides || []);
          ctx.renderRegisteredUserPackageOverridesTable(ctx.getRegisteredUserPackageOverrides());
        } catch (e) {
          ctx.toast(e.message, 'error');
          ctx.navigateTo('registered-users');
        }
        return;
      }
      ctx.$('#registeredUserFormTitle').textContent = 'Add Registered User';
      ctx.$('#registeredUserFormSubtitle').textContent = 'Provision a reseller operator account, assign its member group, and optionally override package credit pricing for that reseller.';
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
      const groups = ctx.getResellerMemberGroups();
      if (groups.length && ctx.$('#registeredUserGroup')) ctx.$('#registeredUserGroup').value = String(groups[0].group_id);
      ctx.renderRegisteredUserPackageOverridesTable([]);
    }

    function openRegisteredUserForm(ctx, id) {
      const nextId = parseInt(id, 10);
      ctx.setRegisteredUsersEditingId(Number.isFinite(nextId) ? nextId : null);
      const targetPage = ctx.getRegisteredUsersEditingId() ? 'registered-user-form' : 'add-registered-user';
      if (ctx.getCurrentPage() !== targetPage) return ctx.navigateTo(targetPage);
      return loadRegisteredUserFormPage(ctx);
    }

    async function saveRegisteredUser(ctx) {
      const id = parseInt(ctx.$('#registeredUserFormId')?.value || '', 10);
      const body = {
        email: ctx.$('#registeredUserEmail').value,
        notes: ctx.$('#registeredUserNotes').value,
        member_group_id: parseInt(ctx.$('#registeredUserGroup').value, 10),
        credits: parseFloat(ctx.$('#registeredUserCredits').value) || 0,
        reseller_dns: ctx.$('#registeredUserDns').value,
        status: ctx.$('#registeredUserStatus').checked ? 1 : 0,
        package_overrides: ctx.collectRegisteredUserPackageOverrides(),
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

    async function openRegisteredUserNotes(ctx, id) {
      try {
        const user = await ctx.apiFetch(`/resellers/${id}`);
        ctx.setRegisteredUserNotesTarget(user);
        ctx.$('#registeredUserNotesId').value = user.id;
        ctx.$('#registeredUserNotesTitle').textContent = `Notes: ${user.username || 'Registered User'}`;
        ctx.$('#registeredUserNotesModalValue').value = user.notes || '';
        ctx.$('#registeredUserNotesModal').style.display = 'flex';
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    function closeRegisteredUserNotesModal(ctx) { ctx.$('#registeredUserNotesModal').style.display = 'none'; }

    async function saveRegisteredUserNotes(ctx) {
      const id = parseInt(ctx.$('#registeredUserNotesId')?.value || '', 10);
      if (!Number.isFinite(id)) return;
      try {
        await ctx.apiFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify({ notes: ctx.$('#registeredUserNotesModalValue').value }) });
        ctx.toast('Notes updated');
        closeRegisteredUserNotesModal(ctx);
        if (ctx.getCurrentPage() === 'registered-users') await loadRegisteredUsers(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function openRegisteredUserCredits(ctx, id) {
      try {
        const user = await ctx.apiFetch(`/resellers/${id}`);
        ctx.setRegisteredUserCreditsTarget(user);
        ctx.$('#registeredUserCreditsId').value = user.id;
        ctx.$('#registeredUserCreditsTitle').textContent = `Manage Credits: ${user.username || ''}`;
        ctx.$('#registeredUserCurrentBalance').textContent = `Current Balance: ${Number(user.credits || 0).toFixed(2)}`;
        ctx.$('#registeredUserCreditsMode').value = 'add';
        ctx.$('#registeredUserCreditsAmount').value = '0';
        ctx.$('#registeredUserCreditsReason').value = '';
        ctx.updateRegisteredUserCreditsPreview();
        ctx.$('#registeredUserCreditsModal').style.display = 'flex';
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    function closeRegisteredUserCreditsModal(ctx) { ctx.$('#registeredUserCreditsModal').style.display = 'none'; }

    async function saveRegisteredUserCredits(ctx) {
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

    async function toggleRegisteredUserStatus(ctx, id) {
      const current = ctx.getRegisteredUsersCurrentRows().find((row) => Number(row.id) === Number(id));
      const next = current && Number(current.status) === 1 ? 0 : 1;
      try {
        await ctx.apiFetch(`/resellers/${id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
        ctx.toast(next === 1 ? 'Registered user enabled' : 'Registered user disabled');
        await loadRegisteredUsers(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function deleteRegisteredUser(ctx, id) {
      if (!confirm('Delete this registered user? They must not own any lines.')) return;
      try {
        await ctx.apiFetch(`/resellers/${id}`, { method: 'DELETE' });
        ctx.toast('Registered user deleted');
        await loadRegisteredUsers(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function loadMemberGroups(ctx) {
      await ctx.loadRefData();
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
            <td><button class="btn btn-xs btn-primary" onclick="APP.openMemberGroupForm(${group.group_id})">Edit</button> <button class="btn btn-xs btn-danger" onclick="APP.deleteMemberGroup(${group.group_id})">Delete</button></td>
          </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No member groups found</td></tr>';
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function loadExpiryMedia(ctx) {
      await ctx.loadRefData();
      try {
        const search = ctx.$('#expiryMediaSearch')?.value || '';
        const params = new URLSearchParams({ limit: '100', offset: '0' });
        if (search.trim()) params.set('search', search.trim());
        const data = await ctx.apiFetch(`/expiry-media/services?${params.toString()}`);
        const services = data.services || [];
        ctx.setExpiryMediaCurrentRows(services);
        const tbody = ctx.$('#expiryMediaTable tbody');
        if (!tbody) return;
        tbody.innerHTML = services.map((service) => `
          <tr>
            <td>${service.id}</td>
            <td>${ctx.escHtml(service.username || '')}</td>
            <td>${Number(service.active) === 1 ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-secondary">Disabled</span>'}</td>
            <td>${Number(service.expiring_count || 0)}</td>
            <td>${Number(service.expired_count || 0)}</td>
            <td>${Number(service.warning_window_days || 7)} day(s)</td>
            <td>${Number(service.repeat_interval_hours || 6)} hour(s)</td>
            <td><button class="btn btn-xs btn-primary" onclick="APP.editExpiryMediaService(${service.id})">Edit</button> <button class="btn btn-xs btn-danger" onclick="APP.deleteExpiryMediaService(${service.id}, true)">Delete</button></td>
          </tr>`).join('') || '<tr><td colspan="8" style="color:#8b949e;text-align:center;padding:1rem">No reseller expiry-media services configured</td></tr>';
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function loadExpiryMediaEditPage(ctx) {
      if (!ctx.getExpiryMediaEditingServiceId()) return ctx.navigateTo('expiry-media');
      try {
        const service = await ctx.apiFetch(`/expiry-media/services/${ctx.getExpiryMediaEditingServiceId()}`);
        ctx.$('#expiryMediaServiceId').value = service.id;
        ctx.$('#expiryMediaFormTitle').textContent = 'Edit Expiry Media';
        ctx.$('#expiryMediaServiceResellerLabel').textContent = `${service.username || 'Reseller'} · Expiry Media Service`;
        ctx.$('#expiryMediaActive').checked = Number(service.active) === 1;
        ctx.$('#expiryMediaWarningWindowDays').value = String(service.warning_window_days || 7);
        ctx.$('#expiryMediaRepeatIntervalHours').value = String(service.repeat_interval_hours || 6);
        ctx.renderExpiryMediaScenarioRows('expiring', service.items || []);
        ctx.renderExpiryMediaScenarioRows('expired', service.items || []);
      } catch (e) {
        ctx.toast(e.message, 'error');
        ctx.navigateTo('expiry-media');
      }
    }

    async function saveExpiryMediaService(ctx) {
      const serviceId = parseInt(ctx.$('#expiryMediaServiceId')?.value || '', 10);
      if (!Number.isFinite(serviceId)) return ctx.toast('No expiry-media service selected', 'error');
      const items = [
        ...ctx.collectExpiryMediaRows('#expiryMediaExpiringRows', 'expiring'),
        ...ctx.collectExpiryMediaRows('#expiryMediaExpiredRows', 'expired'),
      ];
      try {
        await ctx.apiFetch(`/expiry-media/services/${serviceId}`, {
          method: 'PUT',
          body: JSON.stringify({
            active: ctx.$('#expiryMediaActive').checked ? 1 : 0,
            warning_window_days: parseInt(ctx.$('#expiryMediaWarningWindowDays').value || '7', 10) || 7,
            repeat_interval_hours: parseInt(ctx.$('#expiryMediaRepeatIntervalHours').value || '6', 10) || 6,
            items,
          }),
        });
        ctx.toast('Expiry media updated');
        ctx.navigateTo('expiry-media');
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function deleteExpiryMediaService(ctx, id, fromList) {
      const serviceId = parseInt(id || ctx.$('#expiryMediaServiceId')?.value || '', 10);
      if (!Number.isFinite(serviceId)) return;
      if (!confirm('Delete this expiry-media service?')) return;
      try {
        await ctx.apiFetch(`/expiry-media/services/${serviceId}`, { method: 'DELETE' });
        ctx.toast('Expiry media service deleted');
        ctx.setExpiryMediaEditingServiceId(null);
        if (fromList) await loadExpiryMedia(ctx);
        else ctx.navigateTo('expiry-media');
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function loadResellers(ctx) { await loadRegisteredUsers(ctx); }

    return {
      loadRegisteredUsers,
      loadRegisteredUserFormPage,
      openRegisteredUserForm,
      saveRegisteredUser,
      openRegisteredUserNotes,
      closeRegisteredUserNotesModal,
      saveRegisteredUserNotes,
      openRegisteredUserCredits,
      closeRegisteredUserCreditsModal,
      saveRegisteredUserCredits,
      toggleRegisteredUserStatus,
      deleteRegisteredUser,
      loadMemberGroups,
      loadExpiryMedia,
      loadExpiryMediaEditPage,
      saveExpiryMediaService,
      deleteExpiryMediaService,
      loadResellers,
    };
  }

  root.resellerMembers = { createResellerMembersModule };
}());
