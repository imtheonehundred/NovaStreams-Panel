// pages/plex.js - NovaStreams Panel Plex Integration Page Module

export async function loadPlexServers(ctx) {
  try {
    const data = await ctx.apiFetch('/plex/servers');
    ctx.setPlexServersCache(data.servers || []);
    ctx.renderPlexServersTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderPlexServersTable(ctx) {
  const servers = ctx.getPlexServersCache() || [];
  const tbody = ctx.$('#plexServersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = servers.map((s) => `
    <tr>
      <td>${s.id}</td>
      <td>${ctx.escHtml(s.name || '')}</td>
      <td>${ctx.escHtml(s.uri || '')}</td>
      <td>${s.owned ? '<span class="badge badge-success">Owned</span>' : '<span class="badge badge-secondary">Connected</span>'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editPlexServer" data-app-args="${s.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deletePlexServer" data-app-args="${s.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No Plex servers connected</td></tr>';
}

export function addPlexServer() { window.APP._addPlexServer(); }
export function editPlexServer(id) { window.APP._editPlexServer(id); }
export function deletePlexServer(id) { window.APP._deletePlexServer(id); }
