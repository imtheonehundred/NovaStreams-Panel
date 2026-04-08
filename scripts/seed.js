'use strict';

const { queryOne, execute } = require('../lib/mariadb');
const { runMigrations } = require('./migrations');

// Import ensure* functions from repositories
const {
  ensureUserMetaTable,
  migrateLegacyUserMetaFromJson,
} = require('../repositories/userMetaRepository');

const {
  ensureImportProvidersTable,
} = require('../repositories/importProviderRepository');

const {
  ensureAccessCodesTable,
} = require('../repositories/accessCodeRepository');

const {
  ensureLinePasswordSecurityColumns,
  migrateLegacyLinePasswords,
  dropLegacyLinePasswordColumnIfSafe,
} = require('../repositories/lineRepository');

const {
  ensureStreamingServersTables,
  ensureServerProvisioningJobsTable,
  ensureServerRelationshipsTable,
  ensureStreamServerPlacementTable,
  ensureLineRuntimeSessionsTable,
  ensureServerCommandsTable,
  ensureServerAgentCredentialsTable,
} = require('../repositories/serverRepository');

const UNSAFE_DEFAULT_ACCESS_CODES = new Set([
  'admin',
  'reseller',
  'change_me_use_random_string',
]);

function readRequiredAccessCode(envKey, fallback) {
  const value = String(process.env[envKey] || fallback).trim();
  if (!value) {
    throw new Error(
      `${envKey} environment variable is required before seeding access codes`
    );
  }
  if (UNSAFE_DEFAULT_ACCESS_CODES.has(value.toLowerCase())) {
    throw new Error(`Change ${envKey} from the default value before seeding.`);
  }
  return value;
}

/**
 * Seed default data into the database.
 * Called at startup after runMigrations().
 */
async function seedDefaults() {
  // Run all migrations first
  await runMigrations();

  // Schema migrations from repositories
  await ensureUserMetaTable();
  await ensureImportProvidersTable();
  await ensureAccessCodesTable();
  await ensureLinePasswordSecurityColumns();
  await migrateLegacyLinePasswords();
  await dropLegacyLinePasswordColumnIfSafe();

  // Schema migrations from migrations.js
  const {
    ensurePackagesOptionsJsonColumn,
    ensureMoviesSeriesStreamServerIdColumns,
    ensureReleaseDateColumnsWide,
    ensureEpisodesStreamServerIdColumn,
    ensureDefaultStreamServerIdSetting,
    ensureStreamingPerformanceDefaults,
    ensureSettingsParityDefaults,
  } = require('./migrations');

  await ensurePackagesOptionsJsonColumn();
  await ensureMoviesSeriesStreamServerIdColumns();
  await ensureReleaseDateColumnsWide();
  await ensureEpisodesStreamServerIdColumn();
  await ensureDefaultStreamServerIdSetting();
  await ensureStreamingPerformanceDefaults();
  await ensureSettingsParityDefaults();

  // Server repository migrations (ensureServerRelationshipsTable, etc. are from serverRepository - already imported above)
  await ensureServerRelationshipsTable();
  await ensureStreamServerPlacementTable();
  await ensureLineRuntimeSessionsTable();
  await ensureServerCommandsTable();
  await ensureServerAgentCredentialsTable();
  await ensureStreamingServersTables();
  await ensureServerProvisioningJobsTable();

  // Legacy migration
  await migrateLegacyUserMetaFromJson();

  // Seed default user groups if none exist
  const gc = await queryOne('SELECT COUNT(*) AS c FROM user_groups');
  if (gc.c === 0) {
    await execute(
      "INSERT INTO user_groups (group_name, is_admin, is_reseller) VALUES ('Administrators', 1, 0)"
    );
    await execute(
      "INSERT INTO user_groups (group_name, is_admin, is_reseller) VALUES ('Resellers', 0, 1)"
    );
  }

  // Seed output formats if none exist
  const ofc = await queryOne('SELECT COUNT(*) AS c FROM output_formats');
  if (ofc.c === 0) {
    await execute(
      "INSERT INTO output_formats (output_key, output_name) VALUES ('m3u8', 'HLS (m3u8)')"
    );
    await execute(
      "INSERT INTO output_formats (output_key, output_name) VALUES ('ts', 'MPEG-TS')"
    );
    await execute(
      "INSERT INTO output_formats (output_key, output_name) VALUES ('rtmp', 'RTMP')"
    );
  }

  // Seed stream arguments if none exist
  const sac = await queryOne('SELECT COUNT(*) AS c FROM stream_arguments');
  if (sac.c === 0) {
    const args = [
      [
        'fetch',
        'User Agent',
        'Set a Custom User Agent',
        'http',
        'user_agent',
        '-user_agent "%s"',
        'text',
        'Mozilla/5.0',
      ],
      [
        'fetch',
        'HTTP Proxy',
        'Set an HTTP Proxy (ip:port)',
        'http',
        'proxy',
        '-http_proxy "%s"',
        'text',
        null,
      ],
      [
        'transcode',
        'Video Bit Rate (kbps)',
        'Change the video bitrate',
        null,
        'bitrate',
        '-b:v %dk',
        'text',
        null,
      ],
      [
        'transcode',
        'Audio Bitrate (kbps)',
        'Change the audio bitrate',
        null,
        'audio_bitrate',
        '-b:a %dk',
        'text',
        null,
      ],
      [
        'transcode',
        'Min Bitrate (kbps)',
        'Minimum bitrate tolerance',
        null,
        'minimum_bitrate',
        '-minrate %dk',
        'text',
        null,
      ],
      [
        'transcode',
        'Max Bitrate (kbps)',
        'Maximum bitrate tolerance',
        null,
        'maximum_bitrate',
        '-maxrate %dk',
        'text',
        null,
      ],
      [
        'transcode',
        'Buffer Size (kbps)',
        'Rate control buffer size',
        null,
        'bufsize',
        '-bufsize %dk',
        'text',
        null,
      ],
      [
        'transcode',
        'CRF Value',
        'Quantizer scale 0-51 (lower = better)',
        null,
        'crf',
        '-crf %d',
        'text',
        null,
      ],
      [
        'transcode',
        'Scaling',
        'Width:Height (e.g. 1280:720 or 1280:-1)',
        null,
        'scaling',
        '-filter_complex "scale=%s"',
        'text',
        null,
      ],
      [
        'transcode',
        'Aspect Ratio',
        'e.g. 16:9',
        null,
        'aspect',
        '-aspect %s',
        'text',
        null,
      ],
      [
        'transcode',
        'Frame Rate',
        'Target video frame rate',
        null,
        'video_frame_rate',
        '-r %d',
        'text',
        null,
      ],
      [
        'transcode',
        'Audio Sample Rate',
        'Audio sample rate in Hz',
        null,
        'audio_sample_rate',
        '-ar %d',
        'text',
        null,
      ],
      [
        'transcode',
        'Audio Channels',
        'Number of audio channels',
        null,
        'audio_channels',
        '-ac %d',
        'text',
        null,
      ],
      [
        'transcode',
        'Delogo Filter',
        'Remove area: x=0:y=0:w=100:h=77:band=10',
        null,
        'delogo',
        '-filter_complex "delogo=%s"',
        'text',
        null,
      ],
      [
        'transcode',
        'Threads',
        '0 = auto-detect optimal',
        null,
        'threads',
        '-threads %d',
        'text',
        null,
      ],
      [
        'transcode',
        'Logo Path',
        'Overlay logo (upper-left, requires H.264)',
        null,
        'logo',
        '-i "%s" -filter_complex "overlay"',
        'text',
        null,
      ],
      [
        'fetch',
        'Cookie',
        'HTTP Cookie for fetching source',
        'http',
        'cookie',
        "-cookies '%s'",
        'text',
        null,
      ],
      [
        'transcode',
        'Deinterlace',
        'Yadif deinterlacing filter',
        null,
        'deinterlace',
        '-filter_complex "yadif"',
        'radio',
        '0',
      ],
      [
        'fetch',
        'Headers',
        'Custom HTTP headers',
        'http',
        'headers',
        "-headers $'%s\\r\\n'",
        'text',
        null,
      ],
      [
        'fetch',
        'Force Input Audio Codec',
        'Force input audio codec (e.g. aac, ac3)',
        null,
        'force_input_acodec',
        '-acodec %s',
        'text',
        null,
      ],
      [
        'fetch',
        'Skip FFProbe',
        'Skip codec detection via ffprobe',
        null,
        'skip_ffprobe',
        '',
        'radio',
        '0',
      ],
    ];
    for (const a of args) {
      await execute(
        'INSERT INTO stream_arguments (argument_cat, argument_name, argument_description, argument_wprotocol, argument_key, argument_cmd, argument_type, argument_default_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        a
      );
    }
  }

  // Seed default settings if none exist
  const sc = await queryOne('SELECT COUNT(*) AS c FROM settings');
  if (sc.c === 0) {
    const defaults = {
      server_name: 'IPTV Panel',
      server_port: '80',
      server_protocol: 'http',
      domain_name: '',
      disable_player_api: '0',
      disable_ministra: '1',
      allow_countries: '',
      auth_flood_limit: '10',
      auth_flood_window_sec: '300',
      bruteforce_max_attempts: '10',
      bruteforce_window_sec: '600',
      restrict_playlists: '0',
      restrict_same_ip: '0',
      disallow_2nd_ip_con: '0',
      user_auto_kick_hours: '0',
      tmdb_api_key: '',
      tmdb_language: 'en',
      automatic_backups: '0',
      backup_interval_hours: '24',
      cache_playlists: '0',
      encrypt_playlist: '0',
      live_streaming_pass: '',
      detect_restream: '0',
      api_redirect: '0',
      legacy_panel_api: '0',
      stream_user_agent: '',
    };
    for (const [k, v] of Object.entries(defaults)) {
      await execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', [
        k,
        v,
      ]);
    }
  }

  // Seed default access codes if none exist
  const acc = await queryOne('SELECT COUNT(*) AS c FROM access_codes');
  if ((acc && acc.c) === 0) {
    const adminCode = readRequiredAccessCode(
      'DEFAULT_ADMIN_ACCESS_CODE',
      'admin'
    );
    const resellerCode = readRequiredAccessCode(
      'DEFAULT_RESELLER_ACCESS_CODE',
      'reseller'
    );
    if (/^[A-Za-z0-9_-]{3,128}$/.test(adminCode)) {
      await execute(
        'INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, 1, ?)',
        [adminCode, 'admin', 'Default admin gateway']
      );
    }
    if (
      /^[A-Za-z0-9_-]{3,128}$/.test(resellerCode) &&
      resellerCode !== adminCode
    ) {
      await execute(
        'INSERT INTO access_codes (code, role, enabled, description) VALUES (?, ?, 1, ?)',
        [resellerCode, 'reseller', 'Default reseller gateway']
      );
    }
  }
}

module.exports = { seedDefaults };
