// pages/settings.js - structured admin settings page

const TMDB_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'tr', label: 'Turkish' },
];

const RELEASE_PARSER_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'simple', label: 'Simple' },
];

const DEFAULT_ENTRY_OPTIONS = ['10', '25', '50', '100', '250'];
const CATEGORY_ORDER_OPTIONS = ['manual', 'alphabetical'];
const SPLIT_CLIENT_OPTIONS = ['disabled', 'enabled'];
const SPLIT_BY_OPTIONS = ['connections', 'geoip', 'country'];
const PROXY_TYPE_OPTIONS = [
  { value: 'hosting', label: 'Hosting' },
  { value: 'vpn', label: 'VPN' },
  { value: 'proxy', label: 'Proxy' },
  { value: 'tor', label: 'Tor' },
];
const GENERATOR_TYPE_OPTIONS = [
  { value: 'numbers', label: 'Numbers' },
  { value: 'letters', label: 'Letters' },
  { value: 'mixed', label: 'Mixed' },
];
const INTERVAL_UNIT_OPTIONS = [
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

let settingsDataCache = {};
let settingsSummaryCache = null;

const GENERAL_SECTIONS = [
  {
    title: 'General',
    rows: [
      [
        { key: 'server_name', label: 'Server Name', type: 'text' },
        { key: 'service_logo_url', label: 'Service Logo URL', type: 'text' },
      ],
      [
        {
          key: 'service_logo_sidebar_url',
          label: 'Service Logo Sidebar URL (180x40)',
          type: 'text',
        },
        {
          key: 'system_timezone',
          label: 'System Timezone',
          type: 'select',
          options: getTimezoneOptions,
        },
      ],
      [
        {
          key: 'force_epg_timezone',
          label: 'Force EPG Timezone',
          type: 'select',
          options: getTimezoneOptions,
        },
        {
          key: 'enigma2_bouquet_name',
          label: 'Enigma2 Bouquet Name',
          type: 'text',
        },
      ],
      [
        {
          key: 'live_streaming_pass',
          label: 'Live Streaming Pass',
          type: 'password',
        },
        {
          key: 'load_balancing_key',
          label: 'Load Balancing Key',
          type: 'password',
        },
      ],
    ],
  },
];

const XTREAM_SECTIONS = [
  {
    title: 'XtreamMasters',
    rows: [
      [
        {
          key: 'player_credentials_user',
          label: 'Player Credentials User',
          type: 'text',
        },
        {
          key: 'player_credentials_pass',
          label: 'Player Credentials Pass',
          type: 'password',
        },
      ],
      [
        { key: 'tmdb_api_key', label: 'TMDB Key', type: 'text' },
        {
          key: 'tmdb_language',
          label: 'TMDB Language',
          type: 'select',
          options: TMDB_LANGUAGE_OPTIONS,
        },
      ],
      [
        { key: 'tmdb_http', label: 'TMDB HTTP', type: 'toggle' },
        {
          key: 'new_playlist_without_ts',
          label: 'New Playlist without .ts',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'release_parser',
          label: 'Release Parser',
          type: 'select',
          options: RELEASE_PARSER_OPTIONS,
        },
        {
          key: 'logout_on_ip_change',
          label: 'Logout On IP Change',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'cloudflare_connecting_ip',
          label: 'Cloudflare Connecting IP',
          type: 'text',
        },
        {
          key: 'maximum_login_attempts',
          label: 'Maximum Login Attempts',
          type: 'number',
        },
      ],
      [
        {
          key: 'minimum_password_length',
          label: 'Minimum Password Length',
          type: 'number',
        },
        {
          key: 'default_entries_to_show',
          label: 'Default Entries to Show',
          type: 'select',
          options: DEFAULT_ENTRY_OPTIONS,
        },
      ],
      [
        {
          key: 'two_factor_authentication',
          label: 'Two Factor Authentication',
          type: 'toggle',
        },
        { key: 'localhost_api', label: 'Localhost API', type: 'toggle' },
      ],
      [
        { key: 'dark_mode_login', label: 'Dark Mode Login', type: 'toggle' },
        {
          key: 'dashboard_stats_enabled',
          label: 'Dashboard Stats',
          type: 'toggle',
        },
      ],
      [
        { key: 'stats_interval', label: 'Stats Interval', type: 'number' },
        {
          key: 'dashboard_world_map_live',
          label: 'Dashboard World Map Live',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'dashboard_world_map_activity',
          label: 'Dashboard World Map Activity',
          type: 'toggle',
        },
        { key: 'download_images', label: 'Download Images', type: 'toggle' },
      ],
      [
        {
          key: 'auto_refresh_default',
          label: 'Auto-Refresh by Default',
          type: 'toggle',
        },
        {
          key: 'alternate_scandir_cloud',
          label: 'Alternate Scandir Method (Cloud)',
          type: 'toggle',
        },
      ],
    ],
  },
];

const RESELLER_SECTIONS = [
  {
    title: 'Reseller',
    rows: [
      [{ key: 'reseller_copyright', label: 'Copyright', type: 'text' }, null],
      [
        {
          key: 'reseller_disable_trials',
          label: 'Disable Trials',
          type: 'toggle',
        },
        {
          key: 'reseller_allow_restrictions',
          label: 'Allow Restrictions',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'reseller_change_usernames',
          label: 'Change Usernames',
          type: 'toggle',
        },
        {
          key: 'reseller_change_own_dns',
          label: 'Change Own DNS',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'reseller_change_own_email',
          label: 'Change Own Email Address',
          type: 'toggle',
        },
        {
          key: 'reseller_change_own_password',
          label: 'Change Own Password',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'reseller_deny_same_user_pass',
          label: 'Deny Same Username & Password',
          type: 'toggle',
        },
        {
          key: 'reseller_deny_weak_username_password',
          label: 'Deny Weak Username or Password',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'reseller_generating_type',
          label: 'Username/Password Generator Type',
          type: 'radio',
          options: GENERATOR_TYPE_OPTIONS,
        },
        {
          key: 'reseller_min_chars',
          label: 'Min Chars For User/Pass',
          type: 'number',
        },
      ],
    ],
  },
];

const STREAMING_SECTIONS = [
  {
    title: 'Load balancing and delivery',
    rows: [
      [
        {
          key: 'streaming_main_lb_https',
          label: 'Main or Loadbalancer Https',
          type: 'taglist',
          clearLabel: 'Clear all',
        },
        null,
      ],
      [
        {
          key: 'use_https_m3u_lines',
          label: 'Use Https M3U Lines',
          type: 'toggle',
        },
        {
          key: 'secure_lb_connection',
          label: 'Secure LB Connection',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'streaming_auto_kick_users',
          label: 'Auto-Kick Users',
          type: 'number',
        },
        {
          key: 'category_order_type',
          label: 'Category Order Type',
          type: 'select',
          options: CATEGORY_ORDER_OPTIONS,
        },
      ],
      [
        {
          key: 'streaming_client_prebuffer',
          label: 'Client Prebuffer',
          type: 'number',
        },
        {
          key: 'streaming_restreamer_prebuffer',
          label: 'Restreamer Prebuffer',
          type: 'number',
        },
      ],
      [
        {
          key: 'split_clients',
          label: 'Split Clients',
          type: 'select',
          options: SPLIT_CLIENT_OPTIONS,
        },
        {
          key: 'split_by',
          label: 'Split By',
          type: 'select',
          options: SPLIT_BY_OPTIONS,
        },
      ],
      [
        {
          key: 'analysis_duration',
          label: 'Analysis Duration',
          type: 'number',
        },
        { key: 'probe_size', label: 'Probe Size', type: 'number' },
      ],
      [
        {
          key: 'save_connection_logs',
          label: 'Save Connection Logs',
          type: 'toggle',
        },
        { key: 'save_client_logs', label: 'Save Client Logs', type: 'toggle' },
      ],
      [
        {
          key: 'disallow_2nd_ip_con',
          label: 'Disallow 2nd IP Connection',
          type: 'toggle',
        },
        {
          key: 'enable_xc_firewall',
          label: 'Enable XC Firewall',
          type: 'toggle',
        },
      ],
      [
        {
          key: 'allow_countries',
          label: 'Allow connections from these countries',
          type: 'taglist',
          clearLabel: 'Allow all countries',
        },
        {
          key: 'disallow_proxy_types',
          label: 'Disallow Following Proxy Types',
          type: 'checklist',
          options: PROXY_TYPE_OPTIONS,
        },
      ],
    ],
  },
  {
    title: 'Status video fallbacks',
    rows: [
      [
        {
          key: 'stream_down_video_enabled',
          label: 'Stream Down Video',
          type: 'toggle',
        },
        {
          key: 'stream_down_video_url',
          label: 'Default Stream Down Video URL',
          type: 'text',
        },
      ],
      [
        { key: 'banned_video_enabled', label: 'Banned Video', type: 'toggle' },
        {
          key: 'banned_video_url',
          label: 'Default Banned Video URL',
          type: 'text',
        },
      ],
      [
        {
          key: 'expired_video_enabled',
          label: 'Expired Video',
          type: 'toggle',
        },
        {
          key: 'expired_video_url',
          label: 'Default Expired Video URL',
          type: 'text',
        },
      ],
    ],
  },
];

const DATABASE_KEYS = new Set([
  'enable_remote_secure_backups',
  'dropbox_access_token',
  'enable_local_backups',
  'local_backup_directory',
  'automatic_backups',
  'backup_interval_hours',
  'backup_interval_unit',
  'backups_to_keep',
  'cloud_backup_type',
  'cloud_backup_key',
  'gdrive_access_token',
  'gdrive_folder_id',
  's3_bucket',
  's3_region',
  's3_access_key',
  's3_secret_key',
]);

function getTimezoneOptions() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone').map((value) => ({
        value,
        label: value,
      }));
    }
  } catch {}
  return [{ value: 'UTC', label: 'UTC' }];
}

function isTruthySetting(value) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getSettingValue(data, key) {
  return data && data[key] != null ? String(data[key]) : '';
}

function getSettingBool(data, key) {
  return isTruthySetting(getSettingValue(data, key));
}

function parseStoredArray(raw) {
  if (Array.isArray(raw))
    return raw.map((item) => String(item).trim()).filter(Boolean);
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {}
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderSettingsField(ctx, field, data) {
  if (!field) return '<div class="settings-parity-field is-empty"></div>';
  const key = field.key;
  const label = ctx.escHtml(field.label || key);
  const type = field.type || 'text';
  const disabledAttr = field.disabled ? ' disabled' : '';
  const titleAttr = field.tooltip
    ? ` title="${ctx.escHtml(field.tooltip)}"`
    : '';

  if (type === 'toggle') {
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><label class="toggle"${titleAttr}><input type="checkbox" class="settings-toggle" data-key="${ctx.escHtml(key)}" ${getSettingBool(data, key) ? 'checked' : ''}${disabledAttr}><span class="toggle-slider"></span></label></div></div>`;
  }

  if (type === 'select') {
    const options =
      typeof field.options === 'function'
        ? field.options()
        : field.options || [];
    const current = getSettingValue(data, key);
    const optionHtml = options
      .map((option) => {
        const value = typeof option === 'string' ? option : option.value;
        const text = typeof option === 'string' ? option : option.label;
        return `<option value="${ctx.escHtml(String(value))}" ${String(current) === String(value) ? 'selected' : ''}>${ctx.escHtml(String(text))}</option>`;
      })
      .join('');
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><select class="form-control settings-input" data-key="${ctx.escHtml(key)}"${disabledAttr}${titleAttr}>${optionHtml}</select></div></div>`;
  }

  if (type === 'textarea') {
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><textarea class="form-control settings-input" data-key="${ctx.escHtml(key)}" rows="4"${disabledAttr}${titleAttr}>${ctx.escHtml(getSettingValue(data, key))}</textarea></div></div>`;
  }

  if (type === 'radio') {
    const current = getSettingValue(data, key);
    const radios = (field.options || [])
      .map(
        (option) => `
      <label class="settings-radio-option"${titleAttr}>
        <input type="radio" name="${ctx.escHtml(key)}" class="settings-radio" data-key="${ctx.escHtml(key)}" value="${ctx.escHtml(option.value)}" ${String(current) === String(option.value) ? 'checked' : ''}${disabledAttr}>
        <span>${ctx.escHtml(option.label)}</span>
      </label>`
      )
      .join('');
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control settings-radio-group">${radios}</div></div>`;
  }

  if (type === 'checklist') {
    const values = new Set(parseStoredArray(getSettingValue(data, key)));
    const checks = (field.options || [])
      .map(
        (option) => `
      <label class="settings-check-option"${titleAttr}>
        <input type="checkbox" class="settings-checklist-item" data-key="${ctx.escHtml(key)}" value="${ctx.escHtml(option.value)}" ${values.has(String(option.value)) ? 'checked' : ''}${disabledAttr}>
        <span>${ctx.escHtml(option.label)}</span>
      </label>`
      )
      .join('');
    return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control settings-checklist">${checks}</div></div>`;
  }

  if (type === 'taglist') {
    const items = parseStoredArray(getSettingValue(data, key));
    const chips = items
      .map(
        (item) =>
          `<span class="settings-chip" data-value="${ctx.escHtml(item)}">${ctx.escHtml(item)} <button type="button" class="settings-chip-remove">&times;</button></span>`
      )
      .join('');
    return `<div class="settings-parity-field settings-parity-field-wide"><label>${label}</label><div class="settings-parity-control"><div class="settings-chip-editor" data-key="${ctx.escHtml(key)}"><div class="settings-chip-list">${chips}</div><div class="settings-chip-input-row"><input type="text" class="form-control settings-chip-input" placeholder="Type and press Enter"></div><input type="hidden" class="settings-tag-hidden" data-key="${ctx.escHtml(key)}" value="${ctx.escHtml(JSON.stringify(items))}"></div>${field.clearLabel ? `<button type="button" class="btn btn-xs btn-secondary settings-chip-clear" data-key="${ctx.escHtml(key)}">${ctx.escHtml(field.clearLabel)}</button>` : ''}</div></div>`;
  }

  const inputType =
    type === 'password' ? 'password' : type === 'number' ? 'number' : 'text';
  return `<div class="settings-parity-field"><label>${label}</label><div class="settings-parity-control"><input type="${inputType}" class="form-control settings-input" data-key="${ctx.escHtml(key)}" value="${ctx.escHtml(getSettingValue(data, key))}"${disabledAttr}${titleAttr}></div></div>`;
}

function renderSettingsSection(ctx, section, data) {
  const rowsHtml = (section.rows || [])
    .map((row) => {
      const cols = Array.isArray(row) ? row : [row];
      return `<div class="settings-parity-grid-row">${cols.map((field) => renderSettingsField(ctx, field, data)).join('')}</div>`;
    })
    .join('');
  return `<section class="settings-parity-section"><h4 class="settings-group-title${section.centerTitle ? ' is-centered' : ''}">${ctx.escHtml(section.title || '')}</h4>${rowsHtml}</section>`;
}

function renderSettingsSections(ctx, sections, data) {
  return sections
    .map((section) => renderSettingsSection(ctx, section, data))
    .join('');
}

function renderDatabaseSettings(ctx, data) {
  const intervalUnit = getSettingValue(data, 'backup_interval_unit') || 'hours';
  const rawHours =
    parseInt(getSettingValue(data, 'backup_interval_hours'), 10) || 0;
  const intervalDisplay =
    intervalUnit === 'days'
      ? Math.max(1, Math.round(rawHours / 24) || 1)
      : Math.max(1, rawHours || 1);
  const cloudDisabledHint =
    'Coming Soon: cloud backup providers are not available yet. NovaStreams currently supports local backups only.';
  return `
    <section class="settings-parity-section">
      <h4 class="settings-group-title">Database / Backups</h4>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 'enable_remote_secure_backups', label: 'Enable Remote Secure Backups', type: 'toggle' }, data)}
        ${renderSettingsField(ctx, { key: 'dropbox_access_token', label: 'DropBox API Key', type: 'password' }, data)}
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 'enable_local_backups', label: 'Enable Local Backups', type: 'toggle' }, data)}
        ${renderSettingsField(ctx, { key: 'local_backup_directory', label: 'Local Backup Directory', type: 'text' }, data)}
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 'automatic_backups', label: 'Enable Auto Backups', type: 'toggle' }, data)}
        <div class="settings-parity-field"><label>Every</label><div class="settings-parity-control settings-inline-pair"><input type="number" class="form-control settings-input" data-key="backup_interval_hours" value="${ctx.escHtml(String(intervalDisplay))}"><select class="form-control settings-input" data-key="backup_interval_unit">${INTERVAL_UNIT_OPTIONS.map((option) => `<option value="${ctx.escHtml(option.value)}" ${intervalUnit === option.value ? 'selected' : ''}>${ctx.escHtml(option.label)}</option>`).join('')}</select></div></div>
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 'backups_to_keep', label: 'Backups to Keep', type: 'number' }, data)}
        ${renderSettingsField(ctx, { key: 'cloud_backup_key', label: 'Cloud Backup Encryption Key', type: 'password' }, data)}
      </div>
      <div class="settings-parity-grid-row">
        <div class="settings-parity-field settings-parity-field-wide">
          <label>Cloud Backup Status</label>
          <div class="settings-parity-control">
            <div class="settings-cloud-coming-soon" title="${ctx.escHtml(cloudDisabledHint)}">
              <strong>Coming Soon</strong>
              <span>Cloud uploads are intentionally hidden until a real provider-backed implementation ships. Local backups remain the only supported backup path.</span>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(
          ctx,
          {
            key: 'cloud_backup_type',
            label: 'Cloud Provider',
            type: 'select',
            disabled: true,
            tooltip: cloudDisabledHint,
            options: [
              { value: '', label: 'Disabled' },
              { value: 'gdrive', label: 'Google Drive (Coming Soon)' },
              { value: 'dropbox', label: 'Dropbox (Coming Soon)' },
              { value: 's3', label: 'Amazon S3 (Coming Soon)' },
            ],
          },
          data
        )}
        ${renderSettingsField(ctx, { key: 'gdrive_access_token', label: 'Google Drive Access Token', type: 'password', disabled: true, tooltip: cloudDisabledHint }, data)}
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 'gdrive_folder_id', label: 'Google Drive Folder ID', type: 'text', disabled: true, tooltip: cloudDisabledHint }, data)}
        ${renderSettingsField(ctx, { key: 'dropbox_access_token', label: 'DropBox Backup Access Token', type: 'password', disabled: true, tooltip: cloudDisabledHint }, data)}
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 's3_bucket', label: 'S3 Bucket', type: 'text', disabled: true, tooltip: cloudDisabledHint }, data)}
        ${renderSettingsField(ctx, { key: 's3_region', label: 'S3 Region', type: 'text', disabled: true, tooltip: cloudDisabledHint }, data)}
      </div>
      <div class="settings-parity-grid-row">
        ${renderSettingsField(ctx, { key: 's3_access_key', label: 'S3 Access Key', type: 'text', disabled: true, tooltip: cloudDisabledHint }, data)}
        ${renderSettingsField(ctx, { key: 's3_secret_key', label: 'S3 Secret Key', type: 'password', disabled: true, tooltip: cloudDisabledHint }, data)}
      </div>
    </section>`;
}

function buildSettingsSummary(ctx, summary) {
  const version = summary.version || {};
  const dbStatus = summary.dbStatus || {};
  const geolite = getSettingValue(summary.settings || {}, 'geolite2_version');
  const patch = getSettingValue(summary.settings || {}, 'security_patch_level');
  return `
    <div class="settings-summary-card purple">
      <div class="settings-summary-label">Installed Version</div>
      <div class="settings-summary-value">${ctx.escHtml(version.current || '—')}</div>
      <div class="settings-summary-status ${version.currentIsOutdated ? 'warn' : 'ok'}">${version.currentIsOutdated ? 'Update Available' : 'Up to Date'}</div>
    </div>
    <div class="settings-summary-card blue">
      <div class="settings-summary-label">GeoLite2 Version</div>
      <div class="settings-summary-value">${ctx.escHtml(geolite || 'Auto')}</div>
      <div class="settings-summary-status ok">Up to Date</div>
    </div>
    <div class="settings-summary-card green">
      <div class="settings-summary-label">Security Patch</div>
      <div class="settings-summary-value">${ctx.escHtml(patch || '5 Levels')}</div>
      <div class="settings-summary-status ok">Up to Date</div>
    </div>
    <div class="settings-summary-card orange">
      <div class="settings-summary-label">Database Tables</div>
      <div class="settings-summary-value">${ctx.escHtml(String(dbStatus.total_tables || 0))}</div>
      <div class="settings-summary-actions">
        <button type="button" class="btn btn-xs btn-secondary" data-app-action="refreshSettingsSummary">Update Now</button>
        <button type="button" class="btn btn-xs btn-primary" data-app-action="runDbOptimize">Optimize Database</button>
      </div>
    </div>`;
}

function applyPanelBranding(data) {
  const panelName = getSettingValue(data, 'server_name') || 'NovaStreams Panel';
  document.title = panelName;
  const brandName = document.querySelector('.brand-name');
  if (brandName) brandName.textContent = panelName;
}

function structuredKeys() {
  const keys = new Set();
  const collect = (sections) => {
    sections.forEach((section) => {
      (section.rows || []).flat().forEach((field) => {
        if (field?.key) keys.add(field.key);
      });
    });
  };
  collect(GENERAL_SECTIONS);
  collect(XTREAM_SECTIONS);
  collect(RESELLER_SECTIONS);
  collect(STREAMING_SECTIONS);
  DATABASE_KEYS.forEach((key) => keys.add(key));
  [
    'streaming_prebuffer_enabled',
    'streaming_prebuffer_size_mb',
    'streaming_low_latency_enabled',
    'streaming_minimal_ingest_enabled',
    'streaming_prewarm_enabled',
    'streaming_provisioning_enabled',
  ].forEach((key) => keys.add(key));
  return keys;
}

function renderAdvancedRawSettings(ctx, data) {
  const keys = Object.keys(data || {})
    .sort()
    .filter((key) => !structuredKeys().has(key));
  const mount = document.getElementById('settingsForm');
  if (!mount) return;
  mount.innerHTML =
    keys
      .map(
        (key) => `
    <div class="form-row settings-pref-row">
      <label>${ctx.escHtml(key)}</label>
      <div class="form-input"><input type="text" class="form-control setting-input" data-key="${ctx.escHtml(key)}" value="${ctx.escHtml(String(data[key] || ''))}"></div>
    </div>`
      )
      .join('') +
    `
    <div class="form-row settings-pref-row">
      <label>Add new key</label>
      <div class="form-input">
        <input type="text" id="newSettingKey" class="form-control" placeholder="key">
        <input type="text" id="newSettingVal" class="form-control mt-1" placeholder="value">
      </div>
    </div>`;
}

function renderSettingsBackupsTable(backups) {
  const tbody = document.querySelector('#settingsBackupsTable tbody');
  if (!tbody) return;
  const rows = Array.isArray(backups) ? backups : [];
  tbody.innerHTML =
    rows
      .map(
        (backup) => `
    <tr>
      <td>${backup.created_at ? new Date(backup.created_at).toLocaleString() : '—'}</td>
      <td>${backup.size_mb || backup.size || 0} MB</td>
      <td>
        <div class="backup-actions compact">
          <button class="btn btn-restore" data-app-action="restoreBackup" data-app-args="${backup.id}, '${ctxSafeFilename(backup.filename)}'">Restore</button>
          <button class="btn btn-download" data-app-action="downloadBackup" data-app-args="${backup.id}">Download</button>
          <button class="btn btn-delete-backup" data-app-action="deleteBackup" data-app-args="${backup.id}">Delete</button>
        </div>
      </td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="3" style="text-align:center;color:#8b949e;padding:2rem">No backups found</td></tr>';
}

function ctxSafeFilename(filename) {
  return String(filename || '').replace(/'/g, '&#39;');
}

function syncSettingsSummary(ctx, summary) {
  settingsSummaryCache = summary;
  const grid = document.getElementById('settingsSummaryGrid');
  if (grid) grid.innerHTML = buildSettingsSummary(ctx, summary);
}

function initSettingsChipEditors() {
  document.querySelectorAll('.settings-chip-editor').forEach((editor) => {
    const hidden = editor.querySelector('.settings-tag-hidden');
    const list = editor.querySelector('.settings-chip-list');
    const input = editor.querySelector('.settings-chip-input');
    if (!hidden || !list || !input || editor.dataset.bound === 'true') return;
    editor.dataset.bound = 'true';

    const syncHidden = () => {
      const values = [...list.querySelectorAll('.settings-chip')]
        .map((chip) => chip.dataset.value)
        .filter(Boolean);
      hidden.value = JSON.stringify(values);
    };

    const addChip = (value) => {
      const next = String(value || '').trim();
      if (!next) return;
      if (
        [...list.querySelectorAll('.settings-chip')].some(
          (chip) => chip.dataset.value === next
        )
      )
        return;
      const chip = document.createElement('span');
      chip.className = 'settings-chip';
      chip.dataset.value = next;
      chip.innerHTML = `${next} <button type="button" class="settings-chip-remove">&times;</button>`;
      list.appendChild(chip);
      syncHidden();
    };

    list.addEventListener('click', (event) => {
      if (!event.target.classList.contains('settings-chip-remove')) return;
      event.target.closest('.settings-chip')?.remove();
      syncHidden();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      addChip(input.value);
      input.value = '';
    });
  });

  document.querySelectorAll('.settings-chip-clear').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const editor = document.querySelector(
        `.settings-chip-editor[data-key="${button.dataset.key}"]`
      );
      if (!editor) return;
      const list = editor.querySelector('.settings-chip-list');
      const hidden = editor.querySelector('.settings-tag-hidden');
      if (list) list.innerHTML = '';
      if (hidden) hidden.value = '[]';
    });
  });
}

export function switchSettingsTab(tabId = 'general') {
  document.querySelectorAll('#settingsTabBar .settings-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.settingsTab === tabId);
  });
  document
    .querySelectorAll('#page-settings [data-settings-panel]')
    .forEach((panel) => {
      const active = panel.dataset.settingsPanel === tabId;
      panel.style.display = active ? 'block' : 'none';
      panel.classList.toggle('active', active);
    });
  try {
    localStorage.setItem('settingsActiveTab', tabId);
  } catch {}
}

async function loadTelegramSettings(ctx) {
  return await ctx.apiFetch('/settings/telegram').catch(() => ({
    bot_token_set: false,
    admin_chat_id: '',
    alerts_enabled: false,
  }));
}

async function saveTelegramSettings(ctx, silent = false) {
  await ctx.apiFetch('/settings/telegram', {
    method: 'PUT',
    body: JSON.stringify({
      bot_token: document.getElementById('tgBotToken')?.value || '',
      admin_chat_id: document.getElementById('tgAdminChatId')?.value || '',
      alerts_enabled: !!document.getElementById('tgAlertsEnabled')?.checked,
    }),
  });
  if (!silent) ctx.toast('Telegram settings saved');
}

function renderSettingsScreen(ctx, payload) {
  settingsDataCache = { ...payload.settings };
  applyPanelBranding(settingsDataCache);

  const general = document.getElementById('settingsGeneralFields');
  const xtream = document.getElementById('settingsXtreamFields');
  const reseller = document.getElementById('settingsResellerFields');
  const streaming = document.getElementById('settingsStreamingFields');
  const database = document.getElementById('settingsDatabaseFields');

  if (general)
    general.innerHTML = renderSettingsSections(
      ctx,
      GENERAL_SECTIONS,
      settingsDataCache
    );
  if (xtream)
    xtream.innerHTML = renderSettingsSections(
      ctx,
      XTREAM_SECTIONS,
      settingsDataCache
    );
  if (reseller)
    reseller.innerHTML = renderSettingsSections(
      ctx,
      RESELLER_SECTIONS,
      settingsDataCache
    );
  if (streaming)
    streaming.innerHTML = renderSettingsSections(
      ctx,
      STREAMING_SECTIONS,
      settingsDataCache
    );
  if (database)
    database.innerHTML = renderDatabaseSettings(ctx, settingsDataCache);

  if (document.getElementById('tgBotToken'))
    document.getElementById('tgBotToken').value = payload.telegram.bot_token_set
      ? '••••••••'
      : '';
  if (document.getElementById('tgAdminChatId'))
    document.getElementById('tgAdminChatId').value =
      payload.telegram.admin_chat_id || '';
  if (document.getElementById('tgAlertsEnabled'))
    document.getElementById('tgAlertsEnabled').checked =
      !!payload.telegram.alerts_enabled;

  renderSettingsBackupsTable(payload.backups.backups || []);
  renderAdvancedRawSettings(ctx, settingsDataCache);
  syncSettingsSummary(ctx, {
    settings: settingsDataCache,
    version: payload.version,
    dbStatus: payload.dbStatus,
  });
  initSettingsChipEditors();

  const activeTab =
    document.querySelector('#settingsTabBar .settings-tab.active')?.dataset
      .settingsTab ||
    localStorage.getItem('settingsActiveTab') ||
    'general';
  switchSettingsTab(activeTab);
}

export async function loadSettings(ctx) {
  try {
    const [settings, telegram, version, dbStatus, backups] = await Promise.all([
      ctx.apiFetch('/settings'),
      loadTelegramSettings(ctx),
      ctx.apiFetch('/version').catch(() => ({})),
      ctx.apiFetch('/system/db-status').catch(() => ({ total_tables: 0 })),
      ctx.apiFetchOptional('/backups', { backups: [] }),
    ]);

    ctx.setSettingsDataCache(settings);
    renderSettingsScreen(ctx, {
      settings,
      telegram,
      version,
      dbStatus,
      backups,
    });
  } catch (e) {
    ctx.toast(e.message, 'error');
  }
}

export async function refreshSettingsSummary(ctx) {
  const [settings, version, dbStatus] = await Promise.all([
    ctx.apiFetch('/settings'),
    ctx.apiFetch('/version').catch(() => ({})),
    ctx.apiFetch('/system/db-status').catch(() => ({ total_tables: 0 })),
  ]);
  syncSettingsSummary(ctx, { settings, version, dbStatus });
  ctx.toast('Settings summary refreshed');
}

export async function saveSettings(ctx) {
  const body = {};
  document
    .querySelectorAll('#page-settings .settings-input[data-key]')
    .forEach((el) => {
      if (el.disabled) return;
      body[el.dataset.key] = el.value;
    });
  document
    .querySelectorAll('#page-settings .settings-toggle[data-key]')
    .forEach((el) => {
      if (el.disabled) return;
      body[el.dataset.key] = el.checked ? '1' : '0';
    });
  document
    .querySelectorAll('#page-settings .settings-radio:checked')
    .forEach((el) => {
      if (el.disabled) return;
      body[el.dataset.key] = el.value;
    });

  const checklistMap = new Map();
  document
    .querySelectorAll('#page-settings .settings-checklist-item[data-key]')
    .forEach((el) => {
      if (el.disabled) return;
      const key = el.dataset.key;
      if (!checklistMap.has(key)) checklistMap.set(key, []);
      if (el.checked) checklistMap.get(key).push(el.value);
    });
  checklistMap.forEach((values, key) => {
    body[key] = JSON.stringify(values);
  });

  document
    .querySelectorAll('#page-settings .settings-tag-hidden[data-key]')
    .forEach((el) => {
      body[el.dataset.key] = el.value || '[]';
    });
  document
    .querySelectorAll('#page-settings .setting-input[data-key]')
    .forEach((el) => {
      body[el.dataset.key] = el.value;
    });

  const newKey = document.getElementById('newSettingKey')?.value?.trim();
  const newVal = document.getElementById('newSettingVal')?.value || '';
  if (newKey) body[newKey] = newVal;

  if (body.backup_interval_hours && body.backup_interval_unit === 'days') {
    body.backup_interval_hours = String(
      (parseInt(body.backup_interval_hours, 10) || 1) * 24
    );
  }

  await ctx.apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  await saveTelegramSettings(ctx, true);
  ctx.toast('Settings saved');
  await loadSettings(ctx);
}

export function openSettingsReleaseUrl() {
  const url = settingsSummaryCache?.version?.releaseUrl;
  if (url) window.open(url, '_blank', 'noopener');
}
