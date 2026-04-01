'use strict';

const fs = require('fs');
const path = require('path');

describe('settings parity implementation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const dbJs = fs.readFileSync(path.join(__dirname, '../../lib/db.js'), 'utf8');

  it('renders the required top-level settings groups', () => {
    expect(html).toContain('data-settings-tab="general"');
    expect(html).toContain('data-settings-tab="xtreammasters"');
    expect(html).toContain('data-settings-tab="reseller"');
    expect(html).toContain('data-settings-tab="streaming"');
    expect(html).toContain('data-settings-tab="database"');
  });

  it('includes the summary strip and database backup list in settings', () => {
    expect(html).toContain('id="settingsUpdateNotice"');
    expect(html).toContain('id="settingsSummaryGrid"');
    expect(html).toContain('Make Local Backup Now');
    expect(html).toContain('id="settingsBackupsTable"');
  });

  it('keeps the settings database/backups cloud surface truthfully de-scoped', () => {
    expect(appJs).toContain('Cloud backup uploads remain intentionally de-scoped in TARGET.');
    expect(appJs).toContain('Google Drive Config Only');
    expect(appJs).toContain('Stored Cloud Provider Config');
    expect(appJs).toContain('stores parity config only. Remote uploads remain de-scoped in TARGET.');
    expect(appJs).toContain('Cloud backup provider settings are parity-only; remote uploads remain de-scoped.');
  });

  it('keeps Telegram reachable inside the settings implementation', () => {
    expect(html).toContain('id="tgBotToken"');
    expect(html).toContain('id="tgAdminChatId"');
    expect(html).toContain('id="tgAlertsEnabled"');
    expect(appJs).toContain('saveTelegramSettings');
  });

  it('wires screenshot parity settings keys in the frontend metadata', () => {
    expect(appJs).toContain('service_logo_url');
    expect(appJs).toContain('player_credentials_user');
    expect(appJs).toContain('reseller_disable_trials');
    expect(appJs).toContain('streaming_main_lb_https');
    expect(appJs).toContain('enable_remote_secure_backups');
  });

  it('seeds new parity defaults in lib/db.js', () => {
    expect(dbJs).toContain("['service_logo_url', '']");
    expect(dbJs).toContain("['player_credentials_user', '']");
    expect(dbJs).toContain("['reseller_disable_trials', '0']");
    expect(dbJs).toContain("['streaming_main_lb_https', '[]']");
    expect(dbJs).toContain("['enable_remote_secure_backups', '0']");
  });
});
