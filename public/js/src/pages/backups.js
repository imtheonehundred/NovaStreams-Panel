// pages/backups.js - NovaStreams Panel Backup Management Page Module

export async function loadBackupsPage(ctx) {
  try {
    const data = await ctx.apiFetch('/backups');
    ctx.setBackupsCache(data.backups || []);
    ctx.renderBackupsTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderBackupsTable(ctx) {
  const backups = ctx.getBackupsCache() || [];
  const tbody = ctx.$('#backupsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = backups.map((b) => `
    <tr>
      <td>${b.id}</td>
      <td>${b.filename || b.name || '—'}</td>
      <td>${b.size_mb || b.size || 0} MB</td>
      <td>${b.created_at ? ctx.formatDate(b.created_at) : '—'}</td>
      <td>${b.type || 'local'}</td>
      <td>
        <button class="btn btn-xs btn-warning" data-app-action="restoreBackup" data-app-args="${b.id}, '${String(b.filename || '').replace(/'/g, '&#39;')}'">Restore</button>
        <button class="btn btn-xs btn-secondary" data-app-action="downloadBackup" data-app-args="${b.id}">Download</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteBackup" data-app-args="${b.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No backups found</td></tr>';
}

export function createBackup() { window.APP._createBackup(); }
export function downloadBackup(id) { window.APP._downloadBackup(id); }
export function deleteBackup(id) { window.APP._deleteBackup(id); }
export function restoreBackup(id) { window.APP._restoreBackup(id); }
