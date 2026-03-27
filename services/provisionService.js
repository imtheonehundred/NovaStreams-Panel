'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { execute, insert, queryOne } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const serverService = require('./serverService');

/** DB key: when ENV master is on, must be truthy for provisioning to run. */
const STREAMING_PROVISIONING_KEY = 'streaming_provisioning_enabled';

const AGENT_DIR = path.join(__dirname, '..', 'agent');
const REMOTE_AGENT_DIR = '/opt/iptv-panel-agent';
const NGINX_LB_CONF = '/etc/nginx/conf.d/iptv_lb.conf';
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
    .replace(/password[=:]\s*\S+/gi, 'password=***')
    .replace(/AGENT_SECRET[=:]\s*\S+/gi, 'AGENT_SECRET=***');
}

function appendLog(buf, line) {
  const safe = maskLogLine(line);
  return buf + (safe.endsWith('\n') ? safe : `${safe}\n`);
}

function isProbablyIpv4(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(h || '').trim());
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
 * @param {{
 *   server_id?: number,
 *   host: string,
 *   port?: number,
 *   user?: string,
 *   password: string,
 *   name?: string,
 *   public_host?: string,
 *   panel_url?: string,
 *   userId?: number
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

  const secret = String(process.env.AGENT_SECRET || '').trim();
  if (!secret) throw new Error('AGENT_SECRET must be set on the panel for agent install');

  let serverId = parseInt(opts.server_id, 10);
  let createdNew = false;

  if (!Number.isFinite(serverId) || serverId <= 0) {
    const name = String(opts.name || `LB ${host}`).trim();
    const publicHost = String(opts.public_host || host).trim();
    const created = await serverService.createServer({
      name,
      role: 'lb',
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
      JSON.stringify({ host, port, user, createdNew, audit: encryptSecretForAudit('x') })
    );
  } catch (_) {}

  setImmediate(() => {
    runLbProvisionJob(jobId, serverId, {
      host,
      port,
      user,
      password,
      panelUrl,
    }).catch(() => {});
  });

  return { id: jobId, server_id: serverId };
}

async function runLbProvisionJob(jobId, serverId, { host, port, user, password, panelUrl }) {
  let buf = '';
  const log = (line) => {
    buf = appendLog(buf, line);
    flushLog(jobId, buf, 'running').catch(() => {});
  };

  log('Starting LB provisioning…');
  const nginxBody = await serverService.buildFullLbNginxConfig();

  let client;
  try {
    await flushLog(jobId, buf, 'running');
    log(`Connecting to ${user}@${host}:${port} (SSH keepalive enabled)…`);
    client = await sshConnect({ host, port, user, password });

    log('Installing nginx, curl, Node.js…');
    await execScript(client, INSTALL_NGINX_AND_NODE);
    log('Packages and nginx install step finished.');

    log('Writing Nginx LB config to ' + NGINX_LB_CONF + '…');
    await sftpWriteFile(client, NGINX_LB_CONF, nginxBody);

    log('Testing and restarting nginx…');
    await execCommand(client, 'nginx -t && systemctl restart nginx');

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
    const secret = String(process.env.AGENT_SECRET || '').trim();

    const envContent = [
      `SERVER_ID=${serverId}`,
      `PANEL_URL=${panel}`,
      `AGENT_SECRET=${secret}`,
      'AGENT_INTERVAL_MS=30000',
      '',
    ].join('\n');

    await sftpWriteFile(client, AGENT_ENV, envContent);
    await execCommand(client, `chmod 600 ${AGENT_ENV}`);

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
    await serverService.updateServer(serverId, {
      enabled: true,
      public_ip: isProbablyIpv4(host) ? host : undefined,
    });

    await flushLog(jobId, buf, 'done');
    try {
      await dbApi.addPanelLog(null, 'server_provision_done', 'server_provisioning_jobs', jobId, JSON.stringify({ server_id: serverId }));
    } catch (_) {}
  } catch (e) {
    const msg = e.message || String(e);
    buf = appendLog(buf, `ERROR: ${msg}`);
    await execute(
      `UPDATE server_provisioning_jobs SET status = 'error', error = ?, log = ?, updated_at = NOW() WHERE id = ?`,
      [msg, buf, jobId]
    );
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
  ensureProvisioningJobsTable,
  startProvisionJob,
  getJob,
  isProvisioningEnabled,
  isEnvProvisioningMasterEnabled,
  getProvisioningUiState,
  STREAMING_PROVISIONING_KEY,
};
