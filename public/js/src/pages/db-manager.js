// pages/db-manager.js - NovaStreams Panel Database Manager Page Module

function formatDbSize(value) {
  const num = Number(value) || 0;
  return `${Number(num.toFixed(2))} MB`;
}

function renderDbManagerInfo(status, live, perf) {
  const dbSize = document.getElementById('dbSizeMb');
  const totalTables = document.getElementById('dbTotalTables');
  const connections = document.getElementById('dbConnections');
  const slowQueries = document.getElementById('dbSlowQueries');
  const tbody = document.querySelector('#dbTableSizes tbody');

  if (dbSize) dbSize.textContent = formatDbSize(status?.total_size_mb);
  if (totalTables) totalTables.textContent = String(status?.total_tables || 0);
  if (connections) connections.textContent = String(live?.current_connections || 0);
  if (slowQueries) slowQueries.textContent = String(perf?.slowQueries || live?.slow_queries || 0);

  if (tbody) {
    tbody.innerHTML = (status?.tables || []).map((table) => `
      <tr>
        <td>${table.table_name}</td>
        <td>${formatDbSize(table.size_mb)}</td>
      </tr>`).join('') || '<tr><td colspan="2" style="color:#8b949e;text-align:center;padding:1rem">No database tables found</td></tr>';
  }
}

export async function loadDbManager(ctx) {
  try {
    const [status, live, perf] = await Promise.all([
      ctx.apiFetch('/system/db-status'),
      ctx.apiFetch('/system/db-live').catch(() => ({})),
      ctx.apiFetch('/system/db-performance').catch(() => ({})),
    ]);
    renderDbManagerInfo(status, live, perf);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function runDbRepair() {
  return window.APP.runDbRepair();
}

export function runDbOptimize() {
  return window.APP.runDbOptimize();
}
