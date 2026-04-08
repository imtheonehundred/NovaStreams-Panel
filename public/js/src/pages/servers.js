// pages/servers.js - Extracted from modules/server-area.js + app.js
// NovaStreams Panel Servers Management Page Module

export async function loadServers(ctx) {
  try {
    const [data, summaryData] = await Promise.all([
      ctx.apiFetch('/servers'),
      ctx.apiFetch('/servers/monitor-summary').catch(() => ({ servers: [] })),
    ]);
    const summaryMap = new Map((summaryData.servers || []).map((row) => [String(row.id), row]));
    ctx.setServersSummaryCache(summaryData.servers || []);
    ctx.setServersCache((data.servers || []).map((server) => ({ ...server, ...(summaryMap.get(String(server.id)) || {}) })));
    bindServersPage(ctx);
    ctx.renderServersPage();
  } catch (e) { ctx.toast(e.message, 'error'); }
}

function bindServersPage(ctx) {
  const proxyPage = ctx.$('#page-manage-proxy');
  if (proxyPage && proxyPage.dataset.serversBound !== 'true') {
    proxyPage.dataset.serversBound = 'true';
    proxyPage.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-server-action]');
      if (!actionBtn) return;
      event.preventDefault();
      const action = actionBtn.dataset.serverAction;
      if (action === 'add-proxy') addProxyRelationship(ctx);
      if (action === 'delete-proxy') deleteProxyRelationship(ctx, actionBtn.dataset.parentServerId, actionBtn.dataset.childServerId);
    });
  }
}

export async function loadInstallLbPage(ctx) {
  await ctx.getAdminFeatures();
  const notice = ctx.$('#installLbNotice');
  if (notice) {
    const enabled = !!(ctx.getAdminFeaturesCache() && ctx.getAdminFeaturesCache().serverProvisioning);
    notice.className = `server-install-notice ${enabled ? 'info' : 'warning'}`;
    notice.textContent = enabled
      ? 'Provisioning is enabled. Submitting this form will create the server row and start the full origin-runtime install.'
      : 'Provisioning is currently disabled. The full form remains visible for parity, but submit will be blocked until provisioning is enabled.';
  }
  if (ctx.$('#installLbSshPort')) ctx.$('#installLbSshPort').value = '22';
  if (ctx.$('#installLbHttpPort')) ctx.$('#installLbHttpPort').value = ctx.$('#installLbHttpPort').value || '8080';
  if (ctx.$('#installLbHttpsPort')) ctx.$('#installLbHttpsPort').value = ctx.$('#installLbHttpsPort').value || '8443';
  if (ctx.$('#installLbLog')) ctx.$('#installLbLog').textContent = '';
}

export async function loadInstallProxyPage(ctx) {
  await ctx.getAdminFeatures();
  if (!ctx.getServersCache().length) { try { await loadServers(ctx); } catch (_) {} }
  ctx.populateSelect('#installProxyProtectServer', ctx.getServersCache(), 'id', 'name', 'Select Server');
  const notice = ctx.$('#installProxyNotice');
  if (notice) {
    const enabled = !!(ctx.getAdminFeaturesCache() && ctx.getAdminFeaturesCache().serverProvisioning);
    notice.className = `server-install-notice ${enabled ? 'info' : 'warning'}`;
    notice.textContent = enabled
      ? 'Provisioning is enabled. This flow will create the proxy server row, start provisioning, then link it to the protected origin.'
      : 'Provisioning is currently disabled. The full form remains visible for parity, but submit will be blocked until provisioning is enabled.';
  }
  if (ctx.$('#installProxySshPort')) ctx.$('#installProxySshPort').value = '22';
  if (ctx.$('#installProxyApiHttpPort')) ctx.$('#installProxyApiHttpPort').value = ctx.$('#installProxyApiHttpPort').value || '2086';
  if (ctx.$('#installProxyApiHttpsPort')) ctx.$('#installProxyApiHttpsPort').value = ctx.$('#installProxyApiHttpsPort').value || '2083';
  if (ctx.$('#installProxyLog')) ctx.$('#installProxyLog').textContent = '';
}

export async function loadManageProxyPage(ctx) {
  try {
    const [relsResult, serversResult] = await Promise.all([
      ctx.apiFetch('/server-relationships?type=origin-proxy'),
      ctx.apiFetch('/servers'),
    ]);
    const rels = relsResult.relationships || [];
    const servers = serversResult.servers || [];
    const rows = rels.length ? rels.map((r) => `
      <tr>
        <td>${ctx.escHtml(r.parent_name || '')}</td>
        <td>${ctx.escHtml(r.parent_public_host || '')}</td>
        <td>→</td>
        <td>${ctx.escHtml(r.child_name || '')}</td>
        <td>${ctx.escHtml(r.child_public_host || '')}</td>
        <td>${r.enabled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-secondary">No</span>'}</td>
        <td>${r.priority || 0}</td>
        <td><button class="btn btn-xs btn-danger" data-server-action="delete-proxy" data-parent-server-id="${r.parent_server_id}" data-child-server-id="${r.child_server_id}">Remove</button></td>
      </tr>`) : '<tr><td colspan="8" class="text-muted">No proxy relationships defined.</td></tr>';
    const addForm = `
      <div class="card mt-3">
        <div class="card-header"><h4>Add origin-proxy relationship</h4></div>
        <div class="card-body">
          <div class="form-row"><label>Origin server (parent)</label><div class="form-input"><select id="proxyParentServer" class="form-control"><option value="">— select origin —</option>${servers.map((s) => `<option value="${s.id}">${ctx.escHtml(s.name || '')} (${ctx.escHtml(s.public_host || '')})</option>`).join('')}</select></div></div>
          <div class="form-row"><label>Proxy server (child)</label><div class="form-input"><select id="proxyChildServer" class="form-control"><option value="">— select proxy —</option>${servers.map((s) => `<option value="${s.id}">${ctx.escHtml(s.name || '')} (${ctx.escHtml(s.public_host || '')})</option>`).join('')}</select></div></div>
          <div class="form-row"><label>Priority</label><div class="form-input"><input type="number" id="proxyPriority" class="form-control" value="0" min="0"></div></div>
          <div class="form-row"><label>Enabled</label><div class="form-input"><label class="toggle"><input type="checkbox" id="proxyEnabled" checked><span class="toggle-slider"></span></label></div></div>
          <button type="button" class="btn btn-primary" data-server-action="add-proxy">Add relationship</button>
        </div>
      </div>`;
    const tb = ctx.$('#manageProxyTable tbody');
    if (tb) tb.innerHTML = rows;
    const container = ctx.$('#manage-proxy-add-form');
    if (container) container.innerHTML = addForm;
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function addProxyRelationship(ctx) {
  const parentId = parseInt(ctx.$('#proxyParentServer').value, 10);
  const childId = parseInt(ctx.$('#proxyChildServer').value, 10);
  const priority = parseInt(ctx.$('#proxyPriority').value, 10) || 0;
  const enabled = !!ctx.$('#proxyEnabled').checked;
  if (!parentId || !childId) return ctx.toast('Select both origin and proxy servers', 'error');
  if (parentId === childId) return ctx.toast('Origin and proxy must be different servers', 'error');
  try {
    await ctx.apiFetch('/server-relationships', { method: 'POST', body: JSON.stringify({ parent_server_id: parentId, child_server_id: childId, relationship_type: 'origin-proxy', priority, enabled }) });
    ctx.toast('Proxy relationship added', 'success');
    await loadManageProxyPage(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function deleteProxyRelationship(ctx, parentId, childId) {
  if (!confirm('Remove this proxy relationship?')) return;
  try {
    await ctx.apiFetch(`/server-relationships?parentId=${parentId}&childId=${childId}&type=origin-proxy`, { method: 'DELETE' });
    ctx.toast('Proxy relationship removed', 'success');
    await loadManageProxyPage(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function loadServerOrderPage(ctx) {
  try {
    const data = await ctx.apiFetch('/servers');
    ctx.setServerOrder((data.servers || []).slice().sort((a, b) => a.sort_order - b.sort_order));
    ctx.renderServerOrderTable();
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export function moveServerOrder(ctx, idx, dir) {
  const next = ctx.getServerOrder().slice();
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= next.length) return;
  const item = next.splice(idx, 1)[0];
  next.splice(newIdx, 0, item);
  ctx.setServerOrder(next);
  ctx.renderServerOrderTable();
}

export async function saveServerOrder(ctx) {
  const orderings = ctx.getServerOrder().map((s, i) => ({ id: s.id, sort_order: i }));
  try {
    await ctx.apiFetch('/servers/reorder', { method: 'PUT', body: JSON.stringify(orderings) });
    ctx.toast('Server order saved', 'success');
    await loadServers(ctx);
  } catch (e) { ctx.toast(e.message, 'error'); }
}
