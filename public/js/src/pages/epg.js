// pages/epg.js - NovaStreams Panel EPG Management Page Module

export async function loadEpg(ctx) {
  try {
    const data = await ctx.apiFetch('/epg');
    ctx.setEpgCache(data.epg || []);
    ctx.renderEpgTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderEpgTable(ctx) {
  const epg = ctx.getEpgCache() || [];
  const tbody = ctx.$('#epgTable tbody');
  if (!tbody) return;
  tbody.innerHTML = epg.map((e) => `
    <tr>
      <td>${e.id}</td>
      <td>${ctx.escHtml(e.name || '')}</td>
      <td>${e.channel_count || 0}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editEpg" data-app-args="${e.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteEpg" data-app-args="${e.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:#8b949e;text-align:center;padding:1rem">No EPG sources found</td></tr>';
}

export function editEpg(id) { window.APP._editEpg(id); }
export function deleteEpg(id) { window.APP._deleteEpg(id); }
export function addEpg() { window.APP._addEpg(); }
