// pages/drm-streams.js - NovaStreams Panel DRM Streams Management Page Module

import { api } from '../core/api.js';

function collectDrmBody() {
  return {
    name: document.getElementById('drmName')?.value.trim() || '',
    mpdUrl: document.getElementById('drmMpdUrl')?.value.trim() || '',
    kid: document.getElementById('drmKid')?.value.trim() || '',
    key: document.getElementById('drmKey')?.value.trim() || '',
    userAgent: document.getElementById('drmUserAgent')?.value.trim() || '',
    headers: document.getElementById('drmHeaders')?.value || '',
    transcode_profile_id:
      document.getElementById('drmTranscodeProfile')?.value || '',
    version:
      parseInt(document.getElementById('drmVersion')?.value || '0', 10) ||
      undefined,
  };
}

async function loadTranscodeProfiles() {
  const select = document.getElementById('drmTranscodeProfile');
  if (!select) return;
  try {
    const profiles = await api('/api/transcode-profiles', 'GET');
    select.innerHTML =
      '<option value="">None (copy mode)</option>' +
      profiles
        .map(
          (profile) => `<option value="${profile.id}">${profile.name}</option>`
        )
        .join('');
  } catch {
    select.innerHTML = '<option value="">None (copy mode)</option>';
  }
}

export async function loadDrmStreams(ctx) {
  try {
    const data = await api('/api/drm-restreams', 'GET');
    ctx.setDrmStreamsCache(Array.isArray(data) ? data : data.streams || []);
    ctx.renderDrmStreamsTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderDrmStreamsTable(ctx) {
  const streams = ctx.getDrmStreamsCache() || [];
  const tbody = ctx.$('#drmStreamsTable tbody');
  if (!tbody) return;
  tbody.innerHTML =
    streams
      .map(
        (s) => `
    <tr>
      <td>${s.id}</td>
      <td>${ctx.escHtml(s.name || '')}</td>
      <td>${s.status || '—'}</td>
      <td>${s.output_url ? `<code>${ctx.escHtml(s.output_url)}</code>` : '—'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="openDrmStreamModal" data-app-args="'${s.id}'">Edit</button>
        <button class="btn btn-xs btn-secondary" data-app-action="copyDrmOutput" data-app-args="'${ctx.escHtml(s.output_url || '')}'">Copy URL</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteDrmStream" data-app-args="'${s.id}'">Delete</button>
      </td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="5" style="color:#8b949e;text-align:center;padding:1rem">No DRM streams found</td></tr>';
}

export async function openDrmStreamModal(ctx, id = null) {
  await loadTranscodeProfiles();
  const modal = ctx.$('#drmStreamModal');
  if (!modal) return;
  ctx.$('#drmId').value = '';
  ctx.$('#drmVersion').value = '';
  ctx.$('#drmStreamModalTitle').textContent = id
    ? 'Edit DRM Stream'
    : 'Add DRM Stream';
  [
    'drmName',
    'drmMpdUrl',
    'drmKid',
    'drmKey',
    'drmUserAgent',
    'drmHeaders',
  ].forEach((fieldId) => {
    const el = ctx.$(`#${fieldId}`);
    if (el) el.value = '';
  });
  ctx.$('#drmTranscodeProfile').value = '';
  if (id) {
    const row = (ctx.getDrmStreamsCache() || []).find(
      (stream) => String(stream.id) === String(id)
    );
    if (row) {
      ctx.$('#drmId').value = row.id || '';
      ctx.$('#drmVersion').value = row.version || 1;
      ctx.$('#drmName').value = row.name || '';
      ctx.$('#drmMpdUrl').value = row.mpdUrl || '';
      ctx.$('#drmKid').value = row.kid || '';
      ctx.$('#drmKey').value = row.key || '';
      ctx.$('#drmUserAgent').value = row.userAgent || '';
      ctx.$('#drmHeaders').value =
        typeof row.headers === 'object'
          ? Object.entries(row.headers)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')
          : row.headers || '';
      ctx.$('#drmTranscodeProfile').value = row.transcode_profile_id || '';
    }
  }
  modal.style.display = 'flex';
}

export function closeDrmStreamModal(ctx) {
  const modal = ctx.$('#drmStreamModal');
  if (modal) modal.style.display = 'none';
}

export async function parseDrmImport(ctx) {
  const rawText = ctx.$('#drmImportRawText')?.value || '';
  if (!rawText.trim()) return ctx.toast('Paste a DRM dump first', 'error');
  const data = await api('/api/drm-restreams/parse-preview', 'POST', {
    rawText,
  });
  ctx.$('#drmName').value = data.name || '';
  ctx.$('#drmMpdUrl').value = data.mpdUrl || '';
  ctx.$('#drmKid').value = data.kid || '';
  ctx.$('#drmKey').value = data.key || '';
  ctx.$('#drmUserAgent').value = data.userAgent || '';
  ctx.$('#drmHeaders').value =
    typeof data.headers === 'object'
      ? Object.entries(data.headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
      : '';
  await openDrmStreamModal(ctx);
}

export async function saveDrmStream(ctx) {
  const id = ctx.$('#drmId')?.value || '';
  const body = collectDrmBody();
  if (!body.name || !body.mpdUrl || !body.kid || !body.key)
    return ctx.toast('Name, MPD URL, KID, and Key are required', 'error');
  if (id) await api(`/api/drm-restreams/${id}`, 'PUT', body);
  else await api('/api/drm-restreams', 'POST', body);
  ctx.toast(id ? 'DRM stream updated' : 'DRM stream created');
  closeDrmStreamModal(ctx);
  await loadDrmStreams(ctx);
}

export async function deleteDrmStream(ctx, id) {
  if (!(await ctx.showConfirm('Delete this DRM stream?'))) return;
  await api(`/api/drm-restreams/${id}`, 'DELETE');
  ctx.toast('DRM stream deleted');
  await loadDrmStreams(ctx);
}
