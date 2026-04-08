// pages/sharing.js - NovaStreams Panel Sharing Detection Page Module

export async function loadSharingPage(ctx) {
  try {
    const data = await ctx.apiFetch('/sharing/detections');
    ctx.setSharingDetections(data.detections || []);
    ctx.renderSharingTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderSharingTable(ctx) {
  const detections = ctx.getSharingDetections() || [];
  const tbody = ctx.$('#sharingTable tbody');
  if (!tbody) return;
  tbody.innerHTML = detections.map((d) => `
    <tr>
      <td>${d.line_id}</td>
      <td>${ctx.escHtml(d.username || '')}</td>
      <td>${d.ip_count}</td>
      <td>${d.first_seen ? ctx.formatDate(d.first_seen) : '—'}</td>
      <td>${d.last_seen ? ctx.formatDate(d.last_seen) : '—'}</td>
      <td>
        <button class="btn btn-xs btn-warning" data-app-action="blockSharingLine" data-app-args="${d.line_id}">Block Line</button>
        <button class="btn btn-xs btn-secondary" data-app-action="viewSharingDetails" data-app-args="${d.line_id}">Details</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No sharing detected</td></tr>';
}

export function blockSharingLine(id) { window.APP._blockSharingLine(id); }
export function viewSharingDetails(id) { window.APP._viewSharingDetails(id); }
