(function () {
  'use strict';

  const root = window.AdminDomainModules = window.AdminDomainModules || {};

  function createSettingsModule() {
    async function loadSettings(ctx) {
      const activeTab = document.querySelector('#settingsTabBar .settings-tab.active')?.dataset.settingsTab
        || (function () { try { return localStorage.getItem('settingsActiveTab'); } catch { return ''; } }())
        || 'general';
      try {
        const [data, streamingPerf, telegram, version, dbStatus, backups, cloudInfo] = await Promise.all([
          ctx.apiFetch('/settings'),
          ctx.apiFetch('/settings/streaming-performance').catch(() => ({})),
          ctx.loadTelegramSettings(),
          ctx.apiFetch('/version').catch(() => ({})),
          ctx.apiFetch('/system/db-status').catch(() => ({ total_tables: 0 })),
          ctx.apiFetchOptional('/backups', { backups: [] }),
          ctx.apiFetch('/backups/cloud').catch(() => ({ backups: [], configured: null })),
        ]);

        const nextSettings = { ...data };
        ctx.setSettingsDataCache(nextSettings);
        ctx.applyPanelBranding(nextSettings);
        nextSettings.streaming_prebuffer_enabled = streamingPerf.prebuffer_enabled ? '1' : '0';
        nextSettings.streaming_prebuffer_size_mb = String(streamingPerf.prebuffer_size_mb ?? ctx.SETTINGS_PARITY_DEFAULTS.streaming_client_prebuffer);
        nextSettings.streaming_prebuffer_on_demand_min_bytes = String(streamingPerf.prebuffer_on_demand_min_bytes ?? '262144');
        nextSettings.streaming_prebuffer_on_demand_max_wait_ms = String(streamingPerf.prebuffer_on_demand_max_wait_ms ?? '500');
        nextSettings.streaming_ingest_style = String(streamingPerf.ingest_style || 'webapp');
        nextSettings.streaming_low_latency_enabled = streamingPerf.low_latency_enabled ? '1' : '0';
        nextSettings.streaming_minimal_ingest_enabled = streamingPerf.minimal_ingest_enabled ? '1' : '0';
        nextSettings.streaming_prewarm_enabled = streamingPerf.prewarm_enabled ? '1' : '0';
        nextSettings.streaming_provisioning_enabled = streamingPerf.streaming_provisioning_enabled ? '1' : '0';
        nextSettings.block_vod_download = streamingPerf.block_vod_download ? '1' : '0';

        if (ctx.$('#settingsGeneralFields')) ctx.$('#settingsGeneralFields').innerHTML = ctx.renderSettingsSections(ctx.SETTINGS_GENERAL_SECTIONS, nextSettings);
        if (ctx.$('#settingsXtreamFields')) ctx.$('#settingsXtreamFields').innerHTML = ctx.renderSettingsSections(ctx.SETTINGS_XTREAM_SECTIONS, nextSettings);
        if (ctx.$('#settingsResellerFields')) ctx.$('#settingsResellerFields').innerHTML = ctx.renderSettingsSections(ctx.SETTINGS_RESELLER_SECTIONS, nextSettings);
        if (ctx.$('#settingsStreamingFields')) ctx.$('#settingsStreamingFields').innerHTML = ctx.renderStreamingPerformanceBlock(streamingPerf) + ctx.renderSettingsSections(ctx.SETTINGS_STREAMING_SECTIONS, nextSettings);
        if (ctx.$('#settingsDatabaseFields')) ctx.$('#settingsDatabaseFields').innerHTML = ctx.renderDatabaseSettings(nextSettings);

        if (ctx.$('#tgBotToken')) ctx.$('#tgBotToken').value = telegram.bot_token_set ? '••••••••' : '';
        if (ctx.$('#tgAdminChatId')) ctx.$('#tgAdminChatId').value = telegram.admin_chat_id || '';
        if (ctx.$('#tgAlertsEnabled')) ctx.$('#tgAlertsEnabled').checked = !!telegram.alerts_enabled;
        if (ctx.$('#settingsDbCloudType')) ctx.$('#settingsDbCloudType').value = ctx.getSettingValue(nextSettings, 'cloud_backup_type');

        ctx.renderSettingsBackupsTable(backups.backups || []);
        ctx.renderAdvancedRawSettings(nextSettings);
        ctx.syncSettingsSummary({ settings: nextSettings, version, dbStatus, cloudInfo });
        ctx.initSettingsChipEditors();
        await ctx.loadStreamingPerformanceSettings();
        ctx.switchSettingsTab(activeTab);
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    async function saveSettings(ctx) {
      const body = {};
      ctx.$$('#page-settings .settings-input[data-key]').forEach((el) => { body[el.dataset.key] = el.value; });
      ctx.$$('#page-settings .settings-toggle[data-key]').forEach((el) => { body[el.dataset.key] = el.checked ? '1' : '0'; });
      ctx.$$('#page-settings .settings-radio:checked').forEach((el) => { body[el.dataset.key] = el.value; });
      const checklistMap = new Map();
      ctx.$$('#page-settings .settings-checklist-item').forEach((el) => {
        const key = el.dataset.key;
        if (!checklistMap.has(key)) checklistMap.set(key, []);
        if (el.checked) checklistMap.get(key).push(el.value);
      });
      checklistMap.forEach((vals, key) => { body[key] = JSON.stringify(vals); });
      ctx.$$('#page-settings .settings-tag-hidden[data-key]').forEach((el) => { body[el.dataset.key] = el.value || '[]'; });
      ctx.$$('#page-settings .setting-input').forEach((el) => { body[el.dataset.key] = el.value; });
      const nk = ctx.$('#newSettingKey')?.value?.trim();
      const nv = ctx.$('#newSettingVal')?.value;
      if (nk) body[nk] = nv || '';
      const currentProvToggle = ctx.$('#spProvisioningEnabled');
      if (currentProvToggle) body.streaming_provisioning_enabled = currentProvToggle.checked ? '1' : '0';
      if (body.backup_interval_hours && body.backup_interval_unit === 'days') {
        const days = parseInt(body.backup_interval_hours, 10) || 1;
        body.backup_interval_hours = String(days * 24);
      }

      try {
        await ctx.apiFetch('/settings', { method: 'PUT', body: JSON.stringify(body) });
        await ctx.saveTelegramSettings(true);
        if (body.cloud_backup_type) {
          ctx.toast('Settings saved. Cloud backup provider settings are parity-only; remote uploads remain de-scoped.', 'warning');
        } else {
          ctx.toast('Settings saved', 'success');
        }
        await loadSettings(ctx);
        ctx.checkForUpdates();
      } catch (e) {
        ctx.toast(e.message, 'error');
      }
    }

    return { loadSettings, saveSettings };
  }

  root.settings = { createSettingsModule };
}());
