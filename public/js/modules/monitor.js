(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createMonitorModule() {
    function renderBwHistoryChart(ctx, points, periodHours) {
      const canvas = document.getElementById('bwHistoryChart');
      if (!canvas) return;
      const bucketSec = periodHours <= 6 ? 60 : periodHours <= 24 ? 300 : 3600;
      const buckets = new Map();
      for (const p of points) {
        const t = new Date(p.time);
        const rounded = new Date(Math.floor(t.getTime() / (bucketSec * 1000)) * (bucketSec * 1000));
        const key = rounded.toISOString();
        if (!buckets.has(key)) buckets.set(key, { rx: [], tx: [] });
        buckets.get(key).rx.push(p.rxMbps || 0);
        buckets.get(key).tx.push(p.txMbps || 0);
      }
      const labels = [];
      const rxData = [];
      const txData = [];
      [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([key, vals]) => {
        const d = new Date(key);
        const label = periodHours <= 24 ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` : `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`;
        labels.push(label);
        rxData.push(+((vals.rx.reduce((a, b) => a + b, 0) / vals.rx.length) || 0).toFixed(3));
        txData.push(+((vals.tx.reduce((a, b) => a + b, 0) / vals.tx.length) || 0).toFixed(3));
      });
      if (ctx.getBwHistoryChart()) {
        ctx.getBwHistoryChart().destroy();
        ctx.setBwHistoryChart(null);
      }
      if (typeof Chart === 'undefined') return;
      ctx.setBwHistoryChart(new Chart(canvas, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'In (Mbps)', data: rxData, borderColor: '#6b9ef5', backgroundColor: 'rgba(107,158,245,0.1)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
          { label: 'Out (Mbps)', data: txData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          scales: {
            x: { ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#8b949e', font: { size: 10 }, callback: (v) => `${v} Mbps` }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
          },
          plugins: { legend: { labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: { label: (chartCtx) => ` ${chartCtx.dataset.label}: ${chartCtx.parsed.y} Mbps` } } },
        },
      }));
    }

    async function loadMonitorPage(ctx) {
      try {
        const [bwData, healthData] = await Promise.all([
          ctx.apiFetch(`/bandwidth?hours=${ctx.getBwPeriod()}`).catch(() => null),
          ctx.apiFetch('/health?days=7').catch(() => null),
        ]);
        if (bwData) {
          document.getElementById('bwTotalIn').textContent = `${bwData.totalRxMB || 0} MB`;
          document.getElementById('bwTotalOut').textContent = `${bwData.totalTxMB || 0} MB`;
          document.getElementById('bwPeakInVal').textContent = `${bwData.peakInMbps || 0} Mbps`;
          document.getElementById('bwPeakOutVal').textContent = `${bwData.peakOutMbps || 0} Mbps`;
          const bucketSec = ctx.getBwPeriod() <= 6 ? 60 : ctx.getBwPeriod() <= 24 ? 300 : 3600;
          const buckets = new Map();
          for (const p of (bwData.points || [])) {
            const t = new Date(p.time);
            const rounded = new Date(Math.floor(t.getTime() / (bucketSec * 1000)) * (bucketSec * 1000));
            const key = rounded.toISOString();
            if (!buckets.has(key)) buckets.set(key, { rx: [], tx: [], totalRx: 0, totalTx: 0, count: 0 });
            const b = buckets.get(key);
            b.rx.push(p.rxMbps || 0);
            b.tx.push(p.txMbps || 0);
            b.totalRx += p.rxMB || 0;
            b.totalTx += p.txMB || 0;
            b.count += 1;
          }
          const rows = [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 50);
          document.getElementById('bwHistoryBody').innerHTML = rows.map(([key, vals]) => {
            const d = new Date(key);
            const timeStr = ctx.getBwPeriod() <= 24 ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` : `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`;
            const avgRx = (vals.rx.reduce((a, b) => a + b, 0) / (vals.rx.length || 1)).toFixed(3);
            const avgTx = (vals.tx.reduce((a, b) => a + b, 0) / (vals.tx.length || 1)).toFixed(3);
            const totalMB = (vals.totalRx + vals.totalTx).toFixed(1);
            return `<tr><td>${timeStr}</td><td>${avgRx}</td><td>${avgTx}</td><td>${totalMB}</td></tr>`;
          }).join('') || '<tr><td colspan="4">No data</td></tr>';
          renderBwHistoryChart(ctx, bwData.points || [], ctx.getBwPeriod());
        } else {
          document.getElementById('bwHistoryBody').innerHTML = '<tr><td colspan="4">Failed to load bandwidth data</td></tr>';
        }
        if (healthData) {
          const dot = document.getElementById('healthDot');
          const status = document.getElementById('healthStatus');
          const meta = document.getElementById('healthMeta');
          if (dot && status) {
            const isUnknown = healthData.status === 'unknown';
            const isUp = healthData.status === 'up';
            dot.style.background = isUnknown ? '#f59e0b' : (isUp ? '#22c55e' : '#ef4444');
            status.textContent = isUnknown ? 'Health Monitor Pending' : (isUp ? 'All Systems Operational' : 'System Unreachable');
            if (meta) {
              const lastChecked = healthData.lastCheckAt ? ctx.dashboardRelativeAge(healthData.lastCheckAt) : '—';
              const response = Number.isFinite(Number(healthData.lastResponseMs)) ? `${healthData.lastResponseMs}ms response` : 'no response sample yet';
              const suffix = healthData.lastError ? ` · ${healthData.lastError}` : '';
              meta.textContent = isUnknown ? 'The panel health monitor has not completed its first check yet.' : `Last checked ${lastChecked} ago · ${response}${suffix}`;
            }
          }
          if (document.getElementById('healthUptime')) document.getElementById('healthUptime').textContent = healthData.today && Number(healthData.today.totalChecks || 0) > 0 && Number.isFinite(Number(healthData.today.uptimePct)) ? `${healthData.today.uptimePct}%` : 'No samples yet';
          if (document.getElementById('healthAvgResp')) document.getElementById('healthAvgResp').textContent = healthData.today && Number.isFinite(Number(healthData.today.avgResponseMs)) ? `${healthData.today.avgResponseMs}ms` : '—';
          if (document.getElementById('healthTotalChecks')) document.getElementById('healthTotalChecks').textContent = healthData.today ? healthData.today.totalChecks : '—';
          if (document.getElementById('healthDownEvents')) document.getElementById('healthDownEvents').textContent = healthData.today ? healthData.today.downCount : '0';
          const cal = document.getElementById('healthCalendar');
          if (cal && healthData.history) {
            cal.innerHTML = healthData.history.map((day) => {
              const hasSamples = Number(day.totalChecks || 0) > 0 && Number.isFinite(Number(day.uptimePct));
              const pct = hasSamples ? Number(day.uptimePct) : 0;
              const color = !hasSamples ? '#8b949e' : (day.downCount > 0 ? (pct >= 99 ? '#f59e0b' : '#ef4444') : '#22c55e');
              return `<div class="health-cal-day"><div class="health-cal-date">${new Date(day.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div><div class="health-cal-bar"><div style="height:${pct}%;background:${color};border-radius:2px;width:100%"></div></div><div class="health-cal-pct" style="color:${color}">${hasSamples ? `${pct}%` : '—'}</div></div>`;
            }).join('');
          }
          document.getElementById('healthHistoryBody').innerHTML = (healthData.history || []).map((day) => `
            <tr>
              <td>${day.date}</td>
              <td><span style="color:${Number(day.totalChecks || 0) > 0 ? (day.downCount > 0 ? (day.uptimePct >= 99 ? '#f59e0b' : '#ef4444') : '#22c55e') : '#8b949e'}">${Number(day.totalChecks || 0) > 0 && Number.isFinite(Number(day.uptimePct)) ? `${day.uptimePct}%` : '—'}</span></td>
              <td>${Number.isFinite(Number(day.avgResponseMs)) ? `${day.avgResponseMs}ms` : '—'}</td>
              <td>${day.totalChecks}</td>
              <td><span style="color:#22c55e">${day.upCount}</span></td>
              <td><span style="color:${day.downCount > 0 ? '#ef4444' : '#8b949e'}">${day.downCount}</span></td>
            </tr>`).join('') || '<tr><td colspan="6">No data</td></tr>';
        }
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    return {
      renderBwHistoryChart,
      loadMonitorPage,
    };
  }

  root.monitor = {
    createMonitorModule,
  };
}());
