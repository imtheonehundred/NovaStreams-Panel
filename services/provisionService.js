'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { execute, insert, queryOne } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const serverService = require('./serverService');

/** Valid node profile types for provisioning. */
const VALID_PROFILES = ['origin-runtime', 'proxy-delivery', 'agent-only'];

/** Default profile when none specified. */
const DEFAULT_PROFILE = 'origin-runtime';

/** Ordered provisioning stages. */
const PROVISIONING_STAGES = [
  'connecting',
  'validating_credentials',
  'issuing_node_credentials',
  'installing_runtime_profile',
  'deploying_agent',
  'starting_agent',
  'first_heartbeat',
  'runtime_handshake',
  'completed',
];

/** DB key: when ENV master is on, must be truthy for provisioning to run. */
const STREAMING_PROVISIONING_KEY = 'streaming_provisioning_enabled';

const AGENT_DIR = path.join(__dirname, '..', 'agent');
const REMOTE_AGENT_DIR = '/opt/iptv-panel-agent';
const NGINX_LB_CONF = '/etc/nginx/conf.d/iptv_lb.conf';
const NGINX_ORIGIN_CONF = '/etc/nginx/conf.d/iptv_origin.conf';
const AGENT_ENV = '/etc/iptv-panel-agent.env';
const SYSTEMD_UNIT = '/etc/systemd/system/iptv-panel-agent.service';

async function ensureProvisioningJobsTable() {
  await dbApi.ensureServerProvisioningJobsTable();
}

function encryptSecretForAudit(_plain) {
  const key = crypto.scryptSync(
    String(process.env.PROVISIONING_SECRET || process.env.AGENT_SECRET || 'change-me-provisioning'),
    'iptv-panel-salt',
    32
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update('x', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function maskLogLine(line) {
  return String(line || '')
    .replace(/(password)[=:]\s*\S+/gi, (_match, key) => `${key}=***`)
    .replace(/(AGENT_SECRET)[=:]\s*\S+/gi, (_match, key) => `${key}=***`);
}

function appendLog(buf, line) {
  const safe = maskLogLine(line);
  const prefix = String(buf || '');
  if (!prefix) return safe;
  const needsPrefixNewline = !prefix.endsWith('\n');
  const needsSuffixNewline = prefix.endsWith('\n') && !safe.endsWith('\n');
  return `${prefix}${needsPrefixNewline ? '\n' : ''}${safe}${needsSuffixNewline ? '\n' : ''}`;
}

function isProbablyIpv4(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(h || '').trim());
}

/**
 * Build an initial stages map with all stages set to 'pending'.
 * @returns {Object} Map of stage name -> {status, started_at, finished_at, result}.
 */
function initStages() {
  const map = {};
  for (const name of PROVISIONING_STAGES) {
    map[name] = { status: 'pending', started_at: null, finished_at: null, result: null };
  }
  return map;
}

/**
 * Parse existing stages from a job row's log field or return fresh stages.
 * The stages JSON is stored on a dedicated line prefixed with __STAGES_JSON__.
 * @param {string} logText
 * @returns {Object|null} Parsed stages or null if not found.
 */
function parseStagesFromLog(logText) {
  if (!logText) return null;
  const lines = String(logText).split('\n');
  for (const line of lines) {
    if (line.startsWith('__STAGES_JSON__:')) {
      try {
        return JSON.parse(line.slice('__STAGES_JSON__:'.length));
      } catch { return null; }
    }
  }
  return null;
}

/**
 * Serialise stages JSON into a log-prefix line.
 * @param {Object} stages
 * @returns {string}
 */
function stagesLogLine(stages) {
  return `__STAGES_JSON__:${JSON.stringify(stages)}`;
}

/**
 * Replace (or append) the stages line in a log buffer.
 * @param {string} buf - Current log text.
 * @param {Object} stages - Stages map.
 * @returns {string} Updated log text.
 */
function replaceStagesInLog(buf, stages) {
  const lines = String(buf || '').split('\n');
  const replaced = lines.some((line, i) => {
    if (line.startsWith('__STAGES_JSON__:')) {
      lines[i] = stagesLogLine(stages);
      return true;
    }
    return false;
  });
  if (!replaced) {
    lines.push(stagesLogLine(stages));
  }
  return lines.join('\n');
}

/**
 * Mark a stage as started.
 * @param {Object} stages
 * @param {string} name
 * @returns {Object} Mutated stages (same reference).
 */
function startStage(stages, name) {
  if (stages[name]) {
    stages[name].status = 'running';
    stages[name].started_at = new Date().toISOString();
  }
  return stages;
}

/**
 * Mark a stage as finished.
 * @param {Object} stages
 * @param {string} name
 * @param {string} result - 'success', 'failed', or 'skipped'.
 * @returns {Object} Mutated stages (same reference).
 */
function finishStage(stages, name, result) {
  if (stages[name]) {
    stages[name].status = 'done';
    stages[name].finished_at = new Date().toISOString();
    stages[name].result = result;
  }
  return stages;
}

/**
 * Wait for the first heartbeat from a newly provisioned server.
 * Polls streaming_servers.last_heartbeat_at for up to timeoutMs.
 * @param {number} serverId
 * @param {number} [timeoutMs=60000] - Maximum wait in milliseconds.
 * @returns {Promise<{ok: boolean, heartbeatAt: string|null, waitedMs: number}>}
 */
async function waitForFirstHeartbeat(serverId, timeoutMs = 60000) {
  const pollIntervalMs = 3000;
  const deadline = Date.now() + timeoutMs;
  const start = Date.now();

  while (Date.now() < deadline) {
    const row = await queryOne(
      'SELECT last_heartbeat_at FROM streaming_servers WHERE id = ?',
      [serverId]
    );
    if (row && row.last_heartbeat_at) {
      const hbTime = new Date(row.last_heartbeat_at).getTime();
      if (hbTime >= start - 5000) {
        return { ok: true, heartbeatAt: row.last_heartbeat_at, waitedMs: Date.now() - start };
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return { ok: false, heartbeatAt: null, waitedMs: Date.now() - start };
}

function isEnvProvisioningMasterEnabled() {
  return String(process.env.ENABLE_SERVER_PROVISIONING || '').trim() === '1';
}

function parseBoolSetting(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  return false;
}

/**
 * ENV=false → always off. ENV=true → DB `streaming_provisioning_enabled` must be truthy.
 */
async function isProvisioningEnabled() {
  if (!isEnvProvisioningMasterEnabled()) return false;
  const v = await dbApi.getSetting(STREAMING_PROVISIONING_KEY);
  return parseBoolSetting(v);
}

/** For Settings UI + streaming-performance API. */
async function getProvisioningUiState() {
  const envMaster = isEnvProvisioningMasterEnabled();
  const dbBool = parseBoolSetting(await dbApi.getSetting(STREAMING_PROVISIONING_KEY));
  return {
    streaming_provisioning_enabled: dbBool,
    provisioning_env_master_enabled: envMaster,
    server_provisioning_effective: envMaster && dbBool,
  };
}

function sshConnect(opts) {
  const idleMs = Math.max(60000, parseInt(process.env.PROVISIONING_SSH_IDLE_MS || '180000', 10) || 180000);
  return new Promise((resolve, reject) => {
    const client = new Client();
    const t = setTimeout(() => {
      try { client.end(); } catch (_) {}
      reject(new Error('SSH connection timeout'));
    }, idleMs);
    client.on('ready', () => {
      clearTimeout(t);
      resolve(client);
    });
    client.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.user,
      password: opts.password,
      readyTimeout: 35000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 4,
      tryKeyboard: false,
    });
  });
}

function execScript(client, script) {
  return new Promise((resolve, reject) => {
    client.exec('bash -s', (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', (d) => { out += String(d); });
      stream.stderr.on('data', (d) => { errOut += String(d); });
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`remote script exit ${code}\n${errOut || out}`.slice(0, 4000)));
        } else {
          resolve({ stdout: out, stderr: errOut });
        }
      });
      stream.write(script);
      stream.end();
    });
  });
}

function execCommand(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', (d) => { out += String(d); });
      stream.stderr.on('data', (d) => { errOut += String(d); });
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`command failed (${code}): ${cmd}\n${errOut || out}`.slice(0, 4000)));
        } else {
          resolve({ stdout: out, stderr: errOut });
        }
      });
    });
  });
}

function sftpWriteFile(client, remotePath, content) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath);
      stream.on('error', reject);
      stream.on('close', () => resolve());
      stream.end(Buffer.from(content, 'utf8'));
    });
  });
}

async function flushLog(jobId, text, status) {
  await execute(
    `UPDATE server_provisioning_jobs SET log = ?, status = ?, updated_at = NOW() WHERE id = ?`,
    [text, status, jobId]
  );
}

const INSTALL_NGINX_AND_NODE = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[iptv-panel] $*"; }

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx curl ca-certificates
  systemctl enable nginx
  systemctl start nginx || true
  rm -f /etc/nginx/sites-enabled/default
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx curl ca-certificates || yum install -y nginx curl
  systemctl enable nginx
  systemctl start nginx || true
  rm -f /etc/nginx/conf.d/default.conf
else
  log "ERROR: need apt-get or yum"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs || yum module install -y nodejs:20/minimal || true
  fi
fi
command -v node >/dev/null && log "node $(node -v)" || true
log "nginx ok"
`;

/**
 * origin-runtime profile: installs FFmpeg/FFprobe, runtime dirs, nginx for origin delivery.
 * Used for nodes that will own FFmpeg stream processes.
 */
const INSTALL_ORIGIN_RUNTIME = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[iptv-panel:origin-runtime] $*"; }

# Install base tools
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx curl ca-certificates git yasm libx264-dev libvpx-dev libopus-dev libass-dev libfreetype6-dev pkg-config
  systemctl enable nginx
  systemctl start nginx || true
  rm -f /etc/nginx/sites-enabled/default
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx curl git yasm x264-devel libvpx-devel opus-devel freetype-devel pkgconfig
  systemctl enable nginx
  systemctl start nginx || true
fi

# Install FFmpeg if not present
if ! command -v ffmpeg >/dev/null 2>&1; then
  log "Installing FFmpeg from static build..."
  curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C /usr/local --strip-components=1 || true
fi
command -v ffmpeg >/dev/null && log "ffmpeg detected" || log "ffmpeg not found in PATH"

# Install Node.js if not present
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs || yum module install -y nodejs:20/minimal || true
  fi
fi
command -v node >/dev/null && log "node $(node -v)" || true

# Create runtime directories
mkdir -p /opt/iptv-streams /opt/iptv-logs /opt/iptv-hls
chmod 755 /opt/iptv-streams /opt/iptv-logs /opt/iptv-hls
log "runtime dirs ok"
log "origin-runtime profile installed"
`;

/**
 * proxy-delivery profile: installs nginx for forwarding, no FFmpeg.
 * Used for pure proxy/edge nodes that forward to origin nodes.
 */
const INSTALL_PROXY_DELIVERY = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[iptv-panel:proxy-delivery] $*"; }

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx curl ca-certificates
  systemctl enable nginx
  systemctl start nginx || true
  rm -f /etc/nginx/sites-enabled/default
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx curl ca-certificates || yum install -y nginx curl
  systemctl enable nginx
  systemctl start nginx || true
  rm -f /etc/nginx/conf.d/default.conf
fi

# Install Node.js if not present
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs || yum module install -y nodejs:20/minimal || true
  fi
fi
command -v node >/dev/null && log "node $(node -v)" || true
log "proxy-delivery profile installed"
`;

/**
 * agent-only profile: minimal install, just node for heartbeat and agent.
 * Used for non-streaming nodes that only report telemetry.
 */
const INSTALL_AGENT_ONLY = `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[iptv-panel:agent-only] $*"; }

# Install Node.js if not present
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs || yum module install -y nodejs:20/minimal || true
  fi
fi
command -v node >/dev/null && log "node $(node -v)" || true
log "agent-only profile installed"
`;

/** Get the install script for a given profile. */
function getInstallScriptForProfile(profile) {
  switch (String(profile || 'origin-runtime')) {
    case 'proxy-delivery': return INSTALL_PROXY_DELIVERY;
    case 'agent-only': return INSTALL_AGENT_ONLY;
    case 'origin-runtime':
    default: return INSTALL_ORIGIN_RUNTIME;
  }
}

/**
 * @param {{
 *   server_id?: number,
 *   host: string,
 *   port?: number,
 *   user?: string,
 *   password: string,
 *   name?: string,
 *   public_host?: string,
 *   panel_url?: string,
 *   userId?: number,
 *   profile?: string
 * }} opts
 */
async function startProvisionJob(opts) {
  await ensureProvisioningJobsTable();
  if (!(await isProvisioningEnabled())) {
    throw new Error('server provisioning is disabled (check ENABLE_SERVER_PROVISIONING and Settings → Streaming)');
  }
  const host = String(opts.host || '').trim();
  if (!host) throw new Error('host required');
  if (!String(opts.password || '').trim()) throw new Error('password required for SSH');

  // Validate profile
  const profile = VALID_PROFILES.includes(opts.profile) ? opts.profile : DEFAULT_PROFILE;

  let serverId = parseInt(opts.server_id, 10);
  let createdNew = false;

  if (!Number.isFinite(serverId) || serverId <= 0) {
    const name = String(opts.name || `Node ${host}`).trim();
    const publicHost = String(opts.public_host || host).trim();
    const created = await serverService.createServer({
      name,
      role: profile === 'agent-only' ? 'edge' : 'lb',
      public_host: publicHost,
      public_ip: isProbablyIpv4(host) ? host : '',
      private_ip: '',
      enabled: false,
      proxied: false,
      domains: publicHost ? [publicHost] : [],
    });
    serverId = created.id;
    createdNew = true;
  }

  const jobId = await insert(
    `INSERT INTO server_provisioning_jobs (server_id, status, log) VALUES (?, 'pending', '')`,
    [serverId]
  );

  const port = parseInt(opts.port, 10) || 22;
  const user = String(opts.user || 'root').trim() || 'root';
  const password = String(opts.password || '');
  const panelUrl = String(opts.panel_url || '').replace(/\/+$/, '');

  try {
    await dbApi.addPanelLog(
      opts.userId || null,
      'server_provision_start',
      'streaming_server',
      serverId,
      JSON.stringify({ host, port, user, createdNew, profile, audit: encryptSecretForAudit('x') })
    );
  } catch (_) {}

  setImmediate(() => {
    runLbProvisionJob(jobId, serverId, {
      host,
      port,
      user,
      password,
      panelUrl,
      profile,
    }).catch(() => {});
  });

  return { id: jobId, server_id: serverId };
}

/**
 * Wait for a node to report its capabilities via the capability handshake.
 * The node sends its profile and capabilities on first heartbeat (or via a separate
 * capability report). We poll the server row for profile/capability fields.
 * @param {number} serverId
 * @param {string} expectedProfile
 * @param {number} [timeoutMs=60000]
 * @returns {Promise<{ok: boolean, capabilities: object|null, waitedMs: number}>}
 */
async function waitForCapabilityHandshake(serverId, expectedProfile, timeoutMs = 60000) {
  const pollIntervalMs = 3000;
  const deadline = Date.now() + timeoutMs;
  const start = Date.now();

  while (Date.now() < deadline) {
    const row = await queryOne(
      'SELECT runtime_enabled, proxy_enabled, controller_enabled, meta_json FROM streaming_servers WHERE id = ?',
      [serverId]
    );
    if (row) {
      const meta = parseJsonField(row.meta_json, {});
      // Node signals it has reported capabilities by setting meta_json.agent_profile
      if (meta.agent_profile) {
        const match = meta.agent_profile === expectedProfile;
        return {
          ok: match,
          capabilities: {
            runtime: !!row.runtime_enabled,
            proxy: !!row.proxy_enabled,
            controller: !!row.controller_enabled,
            profile: meta.agent_profile,
          },
          waitedMs: Date.now() - start,
        };
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return { ok: false, capabilities: null, waitedMs: Date.now() - start };
}

function parseJsonField(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch (_) { return fallback; }
}

async function runLbProvisionJob(jobId, serverId, { host, port, user, password, panelUrl, profile }) {
  let buf = '';
  /** Write current log + stages + status to DB. */
  const persist = (status) => {
    const logWithStages = replaceStagesInLog(buf, stages);
    flushLog(jobId, logWithStages, status).catch(() => {});
  };

  const log = (line) => {
    buf = appendLog(buf, line);
    persist('running');
  };

  /** Start a stage, log it, persist. */
  const beginStage = (name) => {
    startStage(stages, name);
    log(`Stage: ${name} — started`);
  };

  /** Finish a stage, log it, persist. */
  const endStage = (name, result) => {
    finishStage(stages, name, result);
    log(`Stage: ${name} — ${result}`);
  };

  const stages = initStages();
  log(`Starting LB provisioning for profile: ${profile}…`);

  let client;
  let credentialIdForAudit = null;
  try {
    await persist('running');

    // ── Stage: connecting ─────────────────────────────────────────
    beginStage('connecting');
    log(`Connecting to ${user}@${host}:${port} (SSH keepalive enabled)…`);
    try {
      client = await sshConnect({ host, port, user, password });
      endStage('connecting', 'success');
    } catch (e) {
      endStage('connecting', 'failed');
      throw e;
    }

    // ── Stage: validating_credentials ──────────────────────────────
    beginStage('validating_credentials');
    try {
      await execCommand(client, 'echo ok');
      endStage('validating_credentials', 'success');
    } catch (e) {
      endStage('validating_credentials', 'failed');
      throw new Error(`credential validation failed: ${e.message}`);
    }

    // ── Stage: issuing_node_credentials ────────────────────────────
    beginStage('issuing_node_credentials');
    let plainSecret;
    try {
      // Generate a per-node secret for this server's agent credential.
      // The raw secret is written ONLY to the remote node's env file — never stored in panel logs.
      plainSecret = crypto.randomBytes(24).toString('base64');
      const created = await dbApi.createServerAgentCredential(serverId, plainSecret);
      credentialIdForAudit = created.credentialId;
      log(`Issued credential ${created.credentialId} for server ${serverId}`);
      endStage('issuing_node_credentials', 'success');
    } catch (e) {
      endStage('issuing_node_credentials', 'failed');
      throw new Error(`credential issuance failed: ${e.message}`);
    }

    // ── Stage: installing_runtime_profile ───────────────────────────
    beginStage('installing_runtime_profile');
    let nginxBody = '';
    try {
      const installScript = getInstallScriptForProfile(profile);
      log(`Running ${profile} install script…`);
      await execScript(client, installScript);

      // Write profile-specific nginx config for origin-runtime and proxy-delivery
      if (profile === 'origin-runtime' || profile === 'proxy-delivery') {
        nginxBody = await serverService.buildFullLbNginxConfig();
        const nginxConf = profile === 'origin-runtime' ? NGINX_ORIGIN_CONF : NGINX_LB_CONF;
        log(`Writing nginx config to ${nginxConf}…`);
        await sftpWriteFile(client, nginxConf, nginxBody);

        // Phase 5: Append streaming proxy location blocks for movie/episode serving.
        // The agent's HTTP streaming server listens on port 8899 on the node.
        // This allows origin-runtime and proxy-delivery nodes to serve VOD content
        // by redirecting through the node rather than the panel.
        // Phase 7: added /stream/live/ for proxy-delivery nodes.
        const streamLocations = `
# Phase 5/7: streaming via node-side agent (movie/episode/live)
location /stream/movie/ {
    proxy_pass http://127.0.0.1:8899/stream/movie/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
}
location /stream/episode/ {
    proxy_pass http://127.0.0.1:8899/stream/episode/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
}
location /stream/live/ {
    proxy_pass http://127.0.0.1:8899/stream/live/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
}
`;
        const confWithStreams = nginxBody + streamLocations;
        await sftpWriteFile(client, nginxConf, confWithStreams);
        log('Testing and restarting nginx…');
        await execCommand(client, 'nginx -t && systemctl restart nginx');
      }

      endStage('installing_runtime_profile', 'success');
      log(`Profile ${profile} installed successfully.`);
    } catch (e) {
      endStage('installing_runtime_profile', 'failed');
      throw new Error(`${profile} install failed: ${e.message}`);
    }

    // ── Stage: deploying_agent ─────────────────────────────────────
    beginStage('deploying_agent');
    try {
      log('Preparing remote agent directory…');
      await execCommand(client, `mkdir -p ${REMOTE_AGENT_DIR} && chmod 755 ${REMOTE_AGENT_DIR}`);

      const pkgPath = path.join(AGENT_DIR, 'package.json');
      const idxPath = path.join(AGENT_DIR, 'index.js');
      if (!fs.existsSync(pkgPath) || !fs.existsSync(idxPath)) {
        throw new Error('agent package missing locally (expected agent/package.json and agent/index.js)');
      }
      const pkgJson = fs.readFileSync(pkgPath, 'utf8');
      const idxJs = fs.readFileSync(idxPath, 'utf8');

      await sftpWriteFile(client, path.join(REMOTE_AGENT_DIR, 'package.json'), pkgJson);
      await sftpWriteFile(client, path.join(REMOTE_AGENT_DIR, 'index.js'), idxJs);

      log('Running npm install in ' + REMOTE_AGENT_DIR + '…');
      await execCommand(client, `cd ${REMOTE_AGENT_DIR} && npm install --omit=dev`);

      const panel = String(panelUrl || process.env.PANEL_PUBLIC_URL || '').replace(/\/+$/, '');
      if (!panel) throw new Error('panel_url missing — set PANEL_PUBLIC_URL on the panel or pass panel_url');

      // Write env file with per-node credential — plainSecret written ONLY to remote node
      const envContent = [
        `SERVER_ID=${serverId}`,
        `PANEL_URL=${panel}`,
        `CREDENTIAL_ID=${credentialIdForAudit}`,
        `AGENT_SECRET=${plainSecret}`,
        `AGENT_PROFILE=${profile}`,
        'AGENT_INTERVAL_MS=30000',
        '',
      ].join('\n');

      await sftpWriteFile(client, AGENT_ENV, envContent);
      await execCommand(client, `chmod 600 ${AGENT_ENV}`);

      endStage('deploying_agent', 'success');
    } catch (e) {
      endStage('deploying_agent', 'failed');
      throw new Error(`agent deploy failed: ${e.message}`);
    }

    // ── Stage: starting_agent ──────────────────────────────────────
    beginStage('starting_agent');
    try {
      const nodeWhich = await execCommand(client, 'command -v node || true');
      const nodePath = (nodeWhich.stdout || '').trim().split('\n')[0] || '/usr/bin/node';

      const unit = `[Unit]
Description=IPTV Panel remote agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_AGENT_DIR}
EnvironmentFile=${AGENT_ENV}
ExecStart=${nodePath} ${REMOTE_AGENT_DIR}/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
      await sftpWriteFile(client, SYSTEMD_UNIT, unit);
      await execCommand(client, 'systemctl daemon-reload && systemctl enable iptv-panel-agent && systemctl restart iptv-panel-agent');

      log('Registering server as enabled in panel DB…');
      const profileCapabilityFlags = {
        'origin-runtime': { runtime_enabled: 1, proxy_enabled: 0, controller_enabled: 0 },
        'proxy-delivery': { runtime_enabled: 0, proxy_enabled: 1, controller_enabled: 0 },
        'agent-only': { runtime_enabled: 0, proxy_enabled: 0, controller_enabled: 0 },
      };
      const caps = profileCapabilityFlags[profile] || profileCapabilityFlags['agent-only'];
      await serverService.updateServer(serverId, {
        enabled: true,
        public_ip: isProbablyIpv4(host) ? host : undefined,
        ...caps,
      });

      endStage('starting_agent', 'success');
    } catch (e) {
      endStage('starting_agent', 'failed');
      throw new Error(`agent start failed: ${e.message}`);
    }

    // ── Stage: first_heartbeat ────────────────────────────────────
    beginStage('first_heartbeat');
    log('Waiting for first heartbeat from agent (timeout 60s)…');
    const hb = await waitForFirstHeartbeat(serverId, 60000);
    if (hb.ok) {
      endStage('first_heartbeat', 'success');
      log(`First heartbeat received after ${hb.waitedMs}ms at ${hb.heartbeatAt}`);
    } else {
      endStage('first_heartbeat', 'failed');
      log('ERROR: first heartbeat not received within timeout.');
      try {
        await serverService.updateServer(serverId, { enabled: false });
      } catch (_) {}
      throw new Error('first heartbeat not received within 60s — provisioning failed');
    }

    // ── Stage: runtime_handshake ──────────────────────────────────
    beginStage('runtime_handshake');
    log(`Verifying node capabilities match profile "${profile}" (timeout 60s)…`);
    const handshake = await waitForCapabilityHandshake(serverId, profile, 60000);
    if (handshake.ok) {
      endStage('runtime_handshake', 'success');
      log(`Capability handshake confirmed: profile=${handshake.capabilities.profile}, runtime=${handshake.capabilities.runtime}, proxy=${handshake.capabilities.proxy}, controller=${handshake.capabilities.controller}`);
    } else {
      endStage('runtime_handshake', 'failed');
      log('ERROR: node capability handshake did not complete or profile mismatch.');
      throw new Error(`capability handshake failed — node profile does not match expected "${profile}"`);
    }

    // ── Stage: completed ───────────────────────────────────────────
    startStage(stages, 'completed');
    endStage('completed', 'success');
    log('Provisioning completed successfully.');

    const logWithStages = replaceStagesInLog(buf, stages);
    await flushLog(jobId, logWithStages, 'done');
    try {
      await dbApi.addPanelLog(null, 'server_provision_done', 'server_provisioning_jobs', jobId, JSON.stringify({ server_id: serverId, heartbeat_ok: hb.ok, profile, waited_ms: hb.waitedMs }));
    } catch (_) {}
  } catch (e) {
    const msg = e.message || String(e);
    buf = appendLog(buf, `ERROR: ${msg}`);
    const logWithStages = replaceStagesInLog(buf, stages);
    await execute(
      `UPDATE server_provisioning_jobs SET status = 'error', error = ?, log = ?, updated_at = NOW() WHERE id = ?`,
      [msg, logWithStages, jobId]
    );
    try {
      await serverService.updateServer(serverId, { enabled: false });
    } catch (_) {}
    try {
      await dbApi.addPanelLog(null, 'server_provision_error', 'server_provisioning_jobs', jobId, JSON.stringify({ error: msg, server_id: serverId }));
    } catch (_) {}
  } finally {
    try {
      if (client) client.end();
    } catch (_) {}
  }
}

async function getJob(jobId) {
  await ensureProvisioningJobsTable();
  const id = parseInt(jobId, 10);
  if (!Number.isFinite(id)) return null;
  return await queryOne('SELECT * FROM server_provisioning_jobs WHERE id = ?', [id]);
}

module.exports = {
  maskLogLine,
  appendLog,
  isProbablyIpv4,
  encryptSecretForAudit,
  parseBoolSetting,
  stagesLogLine,
  replaceStagesInLog,
  ensureProvisioningJobsTable,
  startProvisionJob,
  getJob,
  isProvisioningEnabled,
  isEnvProvisioningMasterEnabled,
  getProvisioningUiState,
  STREAMING_PROVISIONING_KEY,
  PROVISIONING_STAGES,
  VALID_PROFILES,
  DEFAULT_PROFILE,
  waitForFirstHeartbeat,
  waitForCapabilityHandshake,
  initStages,
  parseStagesFromLog,
  getInstallScriptForProfile,
};
