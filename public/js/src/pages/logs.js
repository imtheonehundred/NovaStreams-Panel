// pages/logs.js - NovaStreams Panel Activity Logs Page Module

export async function loadLogs(ctx) {
  try {
    const type = ctx.$('#logTypeFilter')?.value || 'all';
    const page = parseInt(ctx.$('#logsPage')?.value || '1', 10) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (type !== 'all') params.set('type', type);
    const data = await ctx.apiFetch(`/logs?${params.toString()}`);
    ctx.setLogsCache(data.logs || []);
    ctx.renderLogsTable(ctx, data.total || 0);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderLogsTable(ctx, total) {
  const logs = ctx.getLogsCache() || [];
  const tbody = ctx.$('#logsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = logs.map((log) => `
    <tr>
      <td>${log.id}</td>
      <td>${log.timestamp ? ctx.formatDate(log.timestamp) : '—'}</td>
      <td>${ctx.escHtml(log.level || '')}</td>
      <td>${ctx.escHtml(log.message || '')}</td>
      <td>${ctx.escHtml(log.user || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No logs found</td></tr>';
}

export function filterLogs() { window.APP._filterLogs(); }
