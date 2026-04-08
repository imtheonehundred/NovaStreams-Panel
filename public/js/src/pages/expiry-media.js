// pages/expiry-media.js - Extracted from modules/reseller-members.js
// NovaStreams Panel Expiry Media Management Page Module

import { buildExpiryMediaRow, renderExpiryMediaScenarioRows, collectExpiryMediaRows } from '@shared/reseller-helpers';

export async function loadExpiryMedia(ctx) {
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
        <td><button class="btn btn-xs btn-primary" data-app-action="editExpiryMediaService" data-app-args="${service.id}">Edit</button> <button class="btn btn-xs btn-danger" data-app-action="deleteExpiryMediaService" data-app-args="${service.id}, true">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="8" style="color:#8b949e;text-align:center;padding:1rem">No reseller expiry-media services configured</td></tr>';
  } catch (e) { ctx.toast(e.message, 'error'); }
}

export async function loadExpiryMediaEditPage(ctx) {
  if (!ctx.getExpiryMediaEditingServiceId()) return ctx.navigateTo('expiry-media');
  try {
    const service = await ctx.apiFetch(`/expiry-media/services/${ctx.getExpiryMediaEditingServiceId()}`);
    ctx.$('#expiryMediaServiceId').value = service.id;
    ctx.$('#expiryMediaFormTitle').textContent = 'Edit Expiry Media';
    ctx.$('#expiryMediaServiceResellerLabel').textContent = `${service.username || 'Reseller'} · Expiry Media Service`;
    ctx.$('#expiryMediaActive').checked = Number(service.active) === 1;
    ctx.$('#expiryMediaWarningWindowDays').value = String(service.warning_window_days || 7);
    ctx.$('#expiryMediaRepeatIntervalHours').value = String(service.repeat_interval_hours || 6);
    renderExpiryMediaScenarioRows(ctx, 'expiring', service.items || []);
    renderExpiryMediaScenarioRows(ctx, 'expired', service.items || []);
  } catch (e) {
    ctx.toast(e.message, 'error');
    ctx.navigateTo('expiry-media');
  }
}

export async function saveExpiryMediaService(ctx) {
  const serviceId = parseInt(ctx.$('#expiryMediaServiceId')?.value || '', 10);
  if (!Number.isFinite(serviceId)) return ctx.toast('No expiry-media service selected', 'error');
  const items = [
    ...collectExpiryMediaRows(ctx, '#expiryMediaExpiringRows', 'expiring'),
    ...collectExpiryMediaRows(ctx, '#expiryMediaExpiredRows', 'expired'),
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

export async function deleteExpiryMediaService(ctx, id, fromList) {
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

export function editExpiryMediaService(id) {
  window.APP._editExpiryMediaService(id);
}

