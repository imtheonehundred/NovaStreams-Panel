(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createBackupsModule() {
    function renderLocalBackups(ctx, backups) {
      const tb = document.querySelector('#backupsTable tbody');
      if (!tb) return;
      const search = (document.getElementById('backupsSearch')?.value || '').toLowerCase();
      const filtered = (backups || []).filter((b) => (b.filename || '').toLowerCase().includes(search));
      if (!filtered.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:2rem">No backups found</td></tr>';
        return;
      }
      tb.innerHTML = filtered.map((b, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>
            <code style="font-size:0.78rem">${ctx.escHtml(b.filename)}</code>
            ${b.file_present === false ? '<div style="color:#f59e0b;font-size:0.8rem;margin-top:4px">File missing on disk</div>' : ''}
          </td>
          <td class="backup-size">${b.size_mb} MB</td>
          <td>${new Date(b.created_at).toLocaleString()}</td>
          <td><span class="backup-type-badge local">Local</span></td>
          <td>
            <div class="backup-actions">
              <button class="btn btn-download" onclick="APP.downloadBackup(${b.id})" title="Download" ${b.is_restorable === false ? 'disabled' : ''}>↓ Download</button>
              <button class="btn btn-restore" onclick="APP.restoreBackup(${b.id})" title="Restore" ${b.is_restorable === false ? 'disabled' : ''}>↻ Restore</button>
              <button class="btn btn-cloud-upload" onclick="APP.uploadBackupCloud(${b.id})" title="Upload to cloud" ${ctx.getCloudBackupCapability() && ctx.getCloudBackupCapability().supported ? '' : 'disabled'}>↑ Cloud</button>
              <button class="btn btn-delete-backup" onclick="APP.deleteBackup(${b.id})" title="Delete">✕</button>
            </div>
          </td>
        </tr>`).join('');
    }

    async function loadCloudBackups(ctx) {
      try {
        const data = await ctx.apiFetch('/backups/cloud');
        const rows = data.backups || [];
        ctx.setCloudBackupCapability(data.capability || null);
        const tb = document.querySelector('#cloudBackupsTable tbody');
        const note = document.getElementById('cloudBackupTruthNote');
        if (note) note.textContent = data.capability && data.capability.message ? data.capability.message : 'Cloud uploads are disabled.';
        if (!tb) return;
        if (!rows.length) {
          tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:1.5rem">No cloud backups yet</td></tr>';
          renderLocalBackups(ctx, ctx.getBackupsCache() || []);
          return;
        }
        tb.innerHTML = rows.map((b, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><code style="font-size:0.78rem">${ctx.escHtml(b.filename)}</code></td>
            <td class="backup-size">${b.size_mb} MB</td>
            <td>${new Date(b.created_at).toLocaleString()}</td>
            <td><span class="backup-type-badge ${b.type}">${b.type}</span></td>
            <td></td>
          </tr>`).join('');
        renderLocalBackups(ctx, ctx.getBackupsCache() || []);
      } catch (e) {
        ctx.setCloudBackupCapability(null);
        const note = document.getElementById('cloudBackupTruthNote');
        if (note) note.textContent = 'Cloud uploads are currently de-scoped. Local backups remain the supported backup path.';
        const tb = document.querySelector('#cloudBackupsTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="color:#8b949e;text-align:center;padding:1rem">Configure cloud storage below</td></tr>';
        renderLocalBackups(ctx, ctx.getBackupsCache() || []);
      }
    }

    async function loadBackupsPage(ctx) {
      try {
        const data = await ctx.apiFetchOptional('/backups', { backups: [] });
        ctx.setBackupsCache(data.backups || []);
        ctx.setBackupRetentionLimit(Number(data.retentionLimit || 0) || null);
        document.getElementById('backupsCount').textContent = ctx.getBackupsCache().length;
        const retentionEl = document.getElementById('backupsRetentionNote');
        if (retentionEl) {
          retentionEl.textContent = ctx.getBackupRetentionLimit()
            ? `Newest ${ctx.getBackupRetentionLimit()} local backups are retained automatically.`
            : 'Automatic local backup retention is enabled.';
        }
        renderLocalBackups(ctx, ctx.getBackupsCache());
        await loadCloudBackups(ctx);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function createBackup(ctx) {
      try {
        ctx.toast('Creating backup...', 'info');
        await ctx.apiFetch('/backups', { method: 'POST' });
        ctx.toast('Backup created successfully', 'success');
        await loadBackupsPage(ctx);
        if (ctx.getCurrentPage() === 'settings') await ctx.loadSettings();
      } catch (e) {
        ctx.toast(e.message || 'Failed to create backup', 'error');
      }
    }

    function downloadBackup(id) {
      window.open(`/api/admin/backups/${id}/download`, '_blank');
    }

    async function restoreBackup(ctx, id) {
      const backup = (ctx.getBackupsCache() || []).find((row) => Number(row.id) === Number(id));
      if (!backup) return ctx.toast('Backup record not found', 'error');
      if (backup.is_restorable === false) return ctx.toast('This backup file is missing on disk and cannot be restored.', 'error');
      if (!confirm(`Restore ${backup.filename}? This overwrites the current database after creating one fresh safety backup.`)) return;
      const confirmFilename = window.prompt(`Type the exact backup filename to restore:\n\n${backup.filename}`, '');
      if (confirmFilename !== backup.filename) return ctx.toast('Restore cancelled: filename confirmation did not match.', 'warning');
      try {
        ctx.toast('Creating safety backup and restoring...', 'info');
        const result = await ctx.apiFetch(`/backups/${id}/restore`, { method: 'POST', body: JSON.stringify({ confirmFilename, createSafetyBackup: true }) });
        const safetyName = result && result.safetyBackup && result.safetyBackup.filename ? ` Safety backup: ${result.safetyBackup.filename}.` : '';
        ctx.toast(`Backup restored successfully.${safetyName}`, 'success');
        await loadBackupsPage(ctx);
        if (ctx.getCurrentPage() === 'settings') await ctx.loadSettings();
      } catch (e) {
        ctx.toast(e.message || 'Restore failed', 'error');
      }
    }

    async function deleteBackup(ctx, id) {
      if (!confirm('Delete this backup?')) return;
      try {
        await ctx.apiFetch(`/backups/${id}`, { method: 'DELETE' });
        ctx.toast('Backup deleted', 'success');
        await loadBackupsPage(ctx);
        if (ctx.getCurrentPage() === 'settings') await ctx.loadSettings();
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function uploadBackupCloud(ctx, id) {
      if (!ctx.getCloudBackupCapability() || !ctx.getCloudBackupCapability().supported) {
        ctx.toast((ctx.getCloudBackupCapability() && ctx.getCloudBackupCapability().message) || 'Cloud uploads are currently de-scoped.', 'warning');
        return;
      }
      try {
        ctx.toast('Uploading to cloud...', 'info');
        await ctx.apiFetch(`/backups/cloud/upload/${id}`, { method: 'POST' });
        ctx.toast('Uploaded to cloud', 'success');
        await loadCloudBackups(ctx);
        if (ctx.getCurrentPage() === 'settings') await ctx.loadSettings();
      } catch (e) {
        ctx.toast(e.message || 'Cloud upload failed', 'error');
      }
    }

    function toggleCloudConfig() {
      const type = document.getElementById('cloudBackupType')?.value || '';
      document.querySelectorAll('.cloud-config-panel').forEach((p) => { p.style.display = 'none'; });
      if (type === 'gdrive') document.getElementById('cloudGdriveConfig').style.display = 'block';
      else if (type === 'dropbox') document.getElementById('cloudDropboxConfig').style.display = 'block';
      else if (type === 's3') document.getElementById('cloudS3Config').style.display = 'block';
    }

    async function saveCloudConfig(ctx) {
      try {
        const body = {
          cloud_backup_type: document.getElementById('cloudBackupType')?.value || '',
          cloud_backup_key: document.getElementById('cloudBackupKey')?.value || '',
          gdrive_access_token: document.getElementById('gdriveAccessToken')?.value || '',
          gdrive_folder_id: document.getElementById('gdriveFolderId')?.value || '',
          dropbox_access_token: document.getElementById('dropboxAccessToken')?.value || '',
          s3_bucket: document.getElementById('s3Bucket')?.value || '',
          s3_region: document.getElementById('s3Region')?.value || '',
          s3_access_key: document.getElementById('s3AccessKey')?.value || '',
          s3_secret_key: document.getElementById('s3SecretKey')?.value || '',
        };
        await ctx.apiFetch('/settings/cloud_backup', { method: 'PUT', body: JSON.stringify(body) });
        ctx.toast(body.cloud_backup_type ? 'Cloud config saved. Provider uploads remain de-scoped in the current TARGET runtime.' : 'Cloud config saved', body.cloud_backup_type ? 'warning' : 'success');
        await loadCloudBackups(ctx);
        if (ctx.getCurrentPage() === 'settings') await ctx.loadSettings();
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    return {
      renderLocalBackups,
      loadCloudBackups,
      loadBackupsPage,
      createBackup,
      downloadBackup,
      restoreBackup,
      deleteBackup,
      uploadBackupCloud,
      toggleCloudConfig,
      saveCloudConfig,
    };
  }

  root.backups = {
    createBackupsModule,
  };
}());
