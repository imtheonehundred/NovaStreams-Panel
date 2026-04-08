// pages/transcode-profiles.js - NovaStreams Panel Transcode Profiles Management Page Module

export async function loadTranscodeProfiles(ctx) {
  try {
    const data = await ctx.apiFetch('/transcode-profiles');
    ctx.setTranscodeProfilesCache(data.profiles || []);
    ctx.renderTranscodeProfilesTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderTranscodeProfilesTable(ctx) {
  const profiles = ctx.getTranscodeProfilesCache() || [];
  const tbody = ctx.$('#transcodeProfilesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = profiles.map((p) => `
    <tr>
      <td>${p.id}</td>
      <td>${ctx.escHtml(p.name || '')}</td>
      <td>${p.video_codec || '—'}</td>
      <td>${p.audio_codec || '—'}</td>
      <td>${p.width || '—'}x${p.height || '—'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editTranscodeProfile" data-app-args="${p.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteTranscodeProfile" data-app-args="${p.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">No transcode profiles found</td></tr>';
}

export function openTranscodeProfileModal(id) { window.APP._openTranscodeProfileModal(id); }
export function closeTranscodeProfileModal() { window.APP._closeTranscodeProfileModal(); }
export function saveTranscodeProfile() { window.APP._saveTranscodeProfile(); }
export function deleteTranscodeProfile(id) { window.APP._deleteTranscodeProfile(id); }
