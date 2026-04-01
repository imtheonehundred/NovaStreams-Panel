(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createSecurityModule() {
    function renderRbacTables(ctx, rbac) {
      const { roles = [], permissions = [], rolePermissions = [] } = rbac;
      const tb = document.querySelector('#rolesTable tbody');
      if (tb) {
        tb.innerHTML = roles.map((role) => `
          <tr>
            <td><strong>${ctx.escHtml(role.name)}</strong></td>
            <td>${ctx.escHtml(role.description || '')}</td>
            <td>
              <button class="btn btn-xs btn-primary" onclick="APP.editRolePerms(${role.id})">Permissions</button>
              ${role.id !== 1 ? `<button class="btn btn-xs btn-danger" onclick="APP.deleteRole(${role.id})">Del</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="3" style="color:#8b949e;text-align:center">No roles</td></tr>';
      }
      const list = document.getElementById('permissionsList');
      if (!list) return;
      const grouped = {};
      permissions.forEach((perm) => {
        if (!grouped[perm.resource]) grouped[perm.resource] = [];
        grouped[perm.resource].push(perm);
      });
      list.innerHTML = Object.entries(grouped).map(([resource, perms]) => `
        <div style="margin-bottom:0.75rem">
          <div style="color:#6b9ef5;font-size:0.75rem;font-weight:600;margin-bottom:4px;text-transform:uppercase">${ctx.escHtml(resource)}</div>
          ${perms.map((perm) => `
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;padding:2px 0">
              <input type="checkbox" class="perm-cb" data-role="0" data-perm="${perm.id}" value="${perm.id}">
              <span style="color:#e6edf3;font-size:0.78rem">${ctx.escHtml(perm.action)}</span>
            </label>`).join('')}
        </div>`).join('');
    }

    async function loadSecurity(ctx) {
      try {
        const [ips, uas, vpnSettings, vpnLog, asnBlocked, mlSettings, mlLines, rbac] = await Promise.all([
          ctx.apiFetch('/security/blocked-ips'),
          ctx.apiFetch('/security/blocked-uas'),
          ctx.apiFetchOptional('/vpn/settings', { enabled: false, blockVpn: false }),
          ctx.apiFetchOptional('/vpn/log', { events: [] }),
          ctx.apiFetchOptional('/asn/blocked', { blocked: [] }),
          ctx.apiFetchOptional('/multilogin/settings', { enabled: false, maxConnections: 1 }),
          ctx.apiFetchOptional('/multilogin', { lines: [] }),
          ctx.apiFetchOptional('/permissions', { roles: [], permissions: [], rolePermissions: [] }),
        ]);

        ctx.$('#blockedIpsTable tbody').innerHTML = (ips.items || []).map((item) => `
          <tr><td>${item.id}</td><td>${ctx.escHtml(item.ip)}</td><td>${ctx.escHtml(item.notes || '')}</td><td>${item.created_at || ''}</td>
          <td><button class="btn btn-xs btn-danger" onclick="APP.removeBlockedIp(${item.id})">Del</button></td></tr>`).join('');
        ctx.$('#blockedUasTable tbody').innerHTML = (uas.items || []).map((item) => `
          <tr><td>${item.id}</td><td>${ctx.escHtml(item.user_agent)}</td><td>${ctx.escHtml(item.notes || '')}</td><td>${item.created_at || ''}</td>
          <td><button class="btn btn-xs btn-danger" onclick="APP.removeBlockedUa(${item.id})">Del</button></td></tr>`).join('');

        const ven = document.getElementById('vpnEnabled');
        const bvn = document.getElementById('blockVpn');
        if (ven) ven.checked = vpnSettings.enabled;
        if (bvn) bvn.checked = vpnSettings.blockVpn;
        ctx.$('#vpnLogTable tbody').innerHTML = (vpnLog.events || []).map((event, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${ctx.escHtml(event.username || '—')}</td>
            <td><code style="font-size:0.78rem">${ctx.escHtml(event.ip || '')}</code></td>
            <td><span class="status-badge error">VPN Detected</span></td>
            <td>${event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No VPN events logged</td></tr>';

        ctx.$('#blockedAsnTable tbody').innerHTML = (asnBlocked.blocked || []).map((asn) => `
          <tr>
            <td>${asn.id}</td>
            <td><code>${ctx.escHtml(asn.asn)}</code></td>
            <td>${ctx.escHtml(asn.org || '—')}</td>
            <td>${ctx.escHtml(asn.notes || '—')}</td>
            <td>${asn.created_at ? new Date(asn.created_at).toLocaleDateString() : '—'}</td>
            <td><button class="btn btn-xs btn-danger" onclick="APP.unblockAsn('${ctx.escHtml(asn.asn)}')">Unblock</button></td>
          </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No ASNs blocked</td></tr>';

        const mle = document.getElementById('multiloginEnabled');
        const mcc = document.getElementById('maxConnsPerLine');
        if (mle) mle.checked = mlSettings.enabled;
        if (mcc) mcc.value = mlSettings.maxConnections || 1;
        ctx.$('#multiloginTable tbody').innerHTML = (mlLines.lines || []).map((line) => `
          <tr>
            <td>${line.lineId}</td>
            <td>—</td>
            <td>${line.count}</td>
            <td>${line.connections.map((conn) => `<code style="font-size:0.7rem;margin-right:4px">${ctx.escHtml(conn.ip)}</code>`).join('')}</td>
            <td><button class="btn btn-xs btn-warning" onclick="APP.disconnectLine(${line.lineId})">Disconnect</button></td>
          </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No concurrent sessions detected</td></tr>';

        renderRbacTables(ctx, rbac);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function addBlockedIp(ctx) {
      const ip = prompt('Enter IP to block:');
      if (!ip) return;
      try { await ctx.apiFetch('/security/blocked-ips', { method: 'POST', body: JSON.stringify({ ip }) }); ctx.toast('IP blocked'); await loadSecurity(ctx); }
      catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function addBlockedUa(ctx) {
      const ua = prompt('Enter User Agent to block:');
      if (!ua) return;
      try { await ctx.apiFetch('/security/blocked-uas', { method: 'POST', body: JSON.stringify({ user_agent: ua }) }); ctx.toast('UA blocked'); await loadSecurity(ctx); }
      catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function removeBlockedIp(ctx, id) {
      if (!confirm('Unblock?')) return;
      try { await ctx.apiFetch(`/security/blocked-ips/${id}`, { method: 'DELETE' }); ctx.toast('Removed'); await loadSecurity(ctx); }
      catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function removeBlockedUa(ctx, id) {
      if (!confirm('Unblock?')) return;
      try { await ctx.apiFetch(`/security/blocked-uas/${id}`, { method: 'DELETE' }); ctx.toast('Removed'); await loadSecurity(ctx); }
      catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function saveVpnSettings(ctx) {
      const enabled = document.getElementById('vpnEnabled')?.checked;
      const blockVpn = document.getElementById('blockVpn')?.checked;
      try {
        await ctx.apiFetch('/vpn/settings', { method: 'PUT', body: JSON.stringify({ enabled, blockVpn }) });
        ctx.toast('VPN settings saved', 'success');
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function blockAsn(ctx) {
      const asn = document.getElementById('asnToBlock')?.value?.trim();
      const org = document.getElementById('asnOrg')?.value?.trim();
      const notes = document.getElementById('asnNotes')?.value?.trim();
      if (!asn) return ctx.toast('ASN required', 'error');
      try {
        await ctx.apiFetch('/asn/block', { method: 'POST', body: JSON.stringify({ asn, org, notes }) });
        ctx.toast(`ASN ${asn} blocked`, 'success');
        document.getElementById('asnToBlock').value = '';
        document.getElementById('asnOrg').value = '';
        document.getElementById('asnNotes').value = '';
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function unblockAsn(ctx, asn) {
      if (!confirm(`Unblock ASN ${asn}?`)) return;
      try {
        await ctx.apiFetch(`/asn/block/${encodeURIComponent(asn)}`, { method: 'DELETE' });
        ctx.toast('ASN unblocked', 'success');
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function saveMultiloginSettings(ctx) {
      const enabled = document.getElementById('multiloginEnabled')?.checked;
      const maxConnections = parseInt(document.getElementById('maxConnsPerLine')?.value || '1', 10);
      try {
        await ctx.apiFetch('/multilogin/settings', { method: 'PUT', body: JSON.stringify({ enabled, maxConnections }) });
        ctx.toast('Multi-login settings saved', 'success');
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function disconnectLine(ctx, lineId) {
      if (!confirm('Disconnect all sessions for this line?')) return;
      try {
        await ctx.apiFetch(`/multilogin/${lineId}/disconnect`, { method: 'POST' });
        ctx.toast('Line disconnected', 'success');
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function addRole(ctx) {
      const name = prompt('Role name:');
      if (!name) return;
      const description = prompt('Description (optional):') || '';
      try {
        await ctx.apiFetch('/roles', { method: 'POST', body: JSON.stringify({ name, description }) });
        ctx.toast('Role created', 'success');
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function deleteRole(ctx, id) {
      if (!confirm('Delete this role?')) return;
      try {
        await ctx.apiFetch(`/roles/${id}`, { method: 'DELETE' });
        ctx.toast('Role deleted', 'success');
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function editRolePerms(ctx, roleId) {
      try {
        const data = await ctx.apiFetch('/permissions');
        const rpMap = {};
        (data.rolePermissions || []).forEach((rp) => {
          if (!rpMap[rp.role_id]) rpMap[rp.role_id] = [];
          rpMap[rp.role_id].push(rp.permission_id);
        });
        const checked = (rpMap[roleId] || []).map(String);
        document.querySelectorAll('.perm-cb').forEach((cb) => {
          cb.dataset.role = roleId;
          cb.checked = checked.includes(cb.value);
        });
        ctx.toast(`Permissions loaded for role ${roleId}. Adjust checkboxes, then click Save Selected Permissions.`, 'info', 5000);
        const saveButton = document.getElementById('saveRolePermsBtn');
        if (saveButton) saveButton.dataset.roleId = String(roleId);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    async function saveRolePerms(ctx, roleId) {
      const checked = [...document.querySelectorAll(`.perm-cb[data-role="${roleId}"]`)].filter((cb) => cb.checked).map((cb) => parseInt(cb.value, 10));
      try {
        await ctx.apiFetch(`/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permission_ids: checked }) });
        ctx.toast('Permissions saved', 'success');
        await loadSecurity(ctx);
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    return {
      loadSecurity,
      renderRbacTables,
      addBlockedIp,
      addBlockedUa,
      removeBlockedIp,
      removeBlockedUa,
      saveVpnSettings,
      blockAsn,
      unblockAsn,
      saveMultiloginSettings,
      disconnectLine,
      addRole,
      deleteRole,
      editRolePerms,
      saveRolePerms,
    };
  }

  root.security = { createSecurityModule };
}());
