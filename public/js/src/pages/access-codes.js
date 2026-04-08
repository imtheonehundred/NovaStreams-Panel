// pages/access-codes.js - NovaStreams Panel Access Codes Management Page Module

export async function loadAccessCodes(ctx) {
  try {
    const data = await ctx.apiFetch('/access-codes');
    ctx.setAccessCodesCache(data.codes || []);
    ctx.renderAccessCodesTable(ctx);
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export function renderAccessCodesTable(ctx) {
  const codes = ctx.getAccessCodesCache() || [];
  const tbody = ctx.$('#accessCodesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = codes.map((c) => `
    <tr>
      <td>${c.id}</td>
      <td><code>${ctx.escHtml(c.code || '')}</code></td>
      <td>${ctx.escHtml(c.role || '—')}</td>
      <td>${Number(c.enabled) === 1 ? 'Yes' : 'No'}</td>
      <td>${ctx.escHtml(c.description || '—')}</td>
      <td>${c.last_used_at ? ctx.formatDate(c.last_used_at) : 'Never'}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-app-action="editAccessCode" data-app-args="${c.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-app-action="deleteAccessCode" data-app-args="${c.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#8b949e;text-align:center;padding:1rem">No access codes found</td></tr>';
}

export function openAccessCodeModal(id) { window.APP._openAccessCodeModal(id); }
export function saveAccessCode() { window.APP._saveAccessCode(); }
export function deleteAccessCode(id) { window.APP._deleteAccessCode(id); }
