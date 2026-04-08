#!/usr/bin/env node
'use strict';

/**
 * Remote agent: install on edge/LB nodes. Env:
 *   SERVER_ID       — panel streaming_servers.id
 *   PANEL_URL       — https://panel.example.com (no trailing slash)
 *   AGENT_SECRET    — per-node secret issued by the panel
 *   AGENT_INTERVAL_MS — optional, default 30000
 *   CREDENTIAL_ID   — per-node credential id (set by provisioner)
 *   AGENT_PROFILE   — 'origin-runtime'|'proxy-delivery'|'agent-only'
 */
require('dotenv').config();
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SERVER_ID = parseInt(process.env.SERVER_ID || '0', 10);
const PANEL_URL = String(process.env.PANEL_URL || '').replace(/\/+$/, '');
const AGENT_SECRET = String(process.env.AGENT_SECRET || '');
const CREDENTIAL_ID = String(process.env.CREDENTIAL_ID || '');
const AGENT_PROFILE = String(process.env.AGENT_PROFILE || 'agent-only');
const INTERVAL_MS = Math.max(5000, parseInt(process.env.AGENT_INTERVAL_MS || '30000', 10) || 30000);
const STREAM_PORT = Math.max(1024, parseInt(process.env.AGENT_STREAM_PORT || '8899', 10) || 8899);
const VERSION = '1.2.0';

function getCapabilities() {
  switch (AGENT_PROFILE) {
    case 'origin-runtime':
      return { runtime: true, proxy: false, controller: false, profile: AGENT_PROFILE };
    case 'proxy-delivery':
      return { runtime: false, proxy: true, controller: false, profile: AGENT_PROFILE };
    case 'agent-only':
    default:
      return { runtime: false, proxy: false, controller: false, profile: AGENT_PROFILE };
  }
}

function cpuLoadPct() {
  const load = os.loadavg()[0];
  const n = os.cpus().length || 1;
  return Math.min(100, Math.round((load / n) * 100));
}

function memUsedPct() {
  const t = os.totalmem();
  if (!t) return 0;
  return Math.min(100, Math.round(((t - os.freemem()) / t) * 100));
}

function postJson(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', AGENT_SECRET).update(payload).digest('hex');
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Agent-Signature': sig,
        'X-Agent-Credential-Id': CREDENTIAL_ID,
        'X-Agent-Secret': AGENT_SECRET,
        ...headers,
      },
    };
    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw);
        else reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getText(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        ...headers,
      },
    };
    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw);
        else reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Execute a command handler. Returns { status: 'succeeded'|'failed', result?: object, error_text?: string }.
 */
async function executeCommand(cmd) {
  const { command_type: cmdType, stream_type: streamType, stream_id: streamId, payload } = cmd;
  switch (cmdType) {
    case 'start_stream':
    case 'stop_stream':
    case 'restart_stream':
    case 'probe_stream':
    case 'sync_server_config':
    case 'reconcile_runtime':
    case 'reconcile_sessions':
      return handleDeScopedCommand(cmdType);
    case 'reload_proxy_config':
      // Reload nginx proxy configuration
      return await handleReloadProxyConfig();
    case 'sync_proxy_upstream':
      // Sync nginx upstream origins config and reload
      return await handleSyncProxyUpstream(payload);
    case 'restart_services':
      return await handleRestartServices();
    case 'reboot_server':
      return await handleRebootServer();
    default:
      console.log(`[agent] unknown command type: ${cmdType}`);
      return { status: 'failed', error_text: `unknown command type: ${cmdType}` };
  }
}

function handleDeScopedCommand(cmdType) {
  console.warn(`[agent] ${cmdType} rejected: command de-scoped in TARGET`);
  return { status: 'failed', error_text: `command de-scoped in TARGET: ${cmdType}` };
}

async function handleReloadProxyConfig() {
  try {
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec('nginx -t && systemctl reload nginx', (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
    console.log(`[agent] proxy config reloaded`);
    return { status: 'succeeded', result: { reloaded: true } };
  } catch (e) {
    console.error(`[agent] proxy config reload failed: ${e.message}`);
    return { status: 'failed', error_text: e.message };
  }
}

async function handleRestartServices() {
  try {
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec(`sh -c 'systemctl restart nginx || true; nohup sh -c "sleep 2; systemctl restart iptv-panel-agent" >/dev/null 2>&1 &'`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
    return { status: 'succeeded', result: { restarted: true } };
  } catch (e) {
    return { status: 'failed', error_text: e.message };
  }
}

async function handleRebootServer() {
  try {
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec(`nohup sh -c 'sleep 2; shutdown -r now' >/dev/null 2>&1 &`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
    return { status: 'succeeded', result: { rebooting: true } };
  } catch (e) {
    return { status: 'failed', error_text: e.message };
  }
}

/**
 * Phase 7 — Sync nginx upstream origins config and reload.
 * Called when the panel updates origin-proxy relationships.
 * Writes the upstream config to iptv_proxy_upstream.conf and reloads nginx.
 * @param {object} payload — { upstreamConfig: string }
 */
async function handleSyncProxyUpstream(payload) {
  if (AGENT_PROFILE !== 'proxy-delivery') {
    return { status: 'failed', error_text: 'not a proxy-delivery node' };
  }
  const upstreamConfig = payload && payload.upstream_config;
  if (!upstreamConfig || typeof upstreamConfig !== 'string') {
    return { status: 'failed', error_text: 'upstream_config required' };
  }
  try {
    const { exec } = require('child_process');
    const fs = require('fs');
    const confPath = '/etc/nginx/conf.d/iptv_proxy_upstream.conf';
    // Write the upstream config (may be empty string to remove previous config)
    if (upstreamConfig.trim()) {
      fs.writeFileSync(confPath, upstreamConfig, 'utf8');
    } else {
      // Remove the file if empty config
      try { fs.unlinkSync(confPath); } catch {}
    }
    // Validate and reload
    await new Promise((resolve, reject) => {
      exec('nginx -t && systemctl reload nginx', (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
    console.log(`[agent] proxy upstream config synced and nginx reloaded`);
    return { status: 'succeeded', result: { synced: true, lines: upstreamConfig.split('\n').length } };
  } catch (e) {
    console.error(`[agent] sync_proxy_upstream failed: ${e.message}`);
    return { status: 'failed', error_text: e.message };
  }
}

/**
 * POST /api/agent/command/ack — report command result and placement reports
 */
async function sendCommandAck(commandId, status, result, errorText, placementReports) {
  const body = {
    server_id: SERVER_ID,
    command_id: commandId,
    status,
    result_json: result,
    error_text: errorText || undefined,
    placement_reports: placementReports || [],
  };
  const url = `${PANEL_URL}/api/agent/command/ack`;
  await postJson(url, body);
  console.log(`[agent] ack sent for command ${commandId} status=${status}`);
}

async function beat() {
  if (!SERVER_ID || !PANEL_URL || !AGENT_SECRET) {
    console.error('[agent] Set SERVER_ID, PANEL_URL, AGENT_SECRET');
    process.exit(1);
  }
  const body = {
    server_id: SERVER_ID,
    ts: Date.now(),
    cpu: cpuLoadPct(),
    mem: memUsedPct(),
    net_mbps: 0,
    ping_ms: 0,
    version: VERSION,
    capabilities: getCapabilities(),
  };
  const url = `${PANEL_URL}/api/agent/heartbeat`;
  const raw = await postJson(url, body);
  console.log(`[agent] heartbeat ok ${new Date().toISOString()} profile=${AGENT_PROFILE}`);

  // Phase 3: parse and execute any leased commands from the panel
  let resp;
  try {
    resp = JSON.parse(raw);
  } catch (_) {
    return; // heartbeat only, no commands
  }

  const commands = Array.isArray(resp.commands) ? resp.commands : [];
  if (commands.length === 0) return;

  console.log(`[agent] received ${commands.length} command(s)`);
  for (const cmd of commands) {
    try {
      const result = await executeCommand(cmd);
      await sendCommandAck(
        cmd.id,
        result.status,
        result.result || null,
        result.error_text || null,
        [] // placement reports populated in Phase 4
      );
    } catch (e) {
      console.error(`[agent] command ${cmd.id} (${cmd.command_type}) failed: ${e.message}`);
      await sendCommandAck(cmd.id, 'failed', null, e.message, []).catch(() => {});
    }
  }
}

/**
 * Phase 5 — HTTP streaming server for movie/episode serving.
 *
 * Listens on STREAM_PORT and handles requests from redirected clients.
 * Validates auth with the panel via /api/stream/node-validate, then
 * fetches the source URL and pipes the content back to the client.
 *
 * nginx config (add to /etc/nginx/conf.d/iptv_origin.conf):
 *   location /stream/ {
 *     proxy_pass http://127.0.0.1:STREAM_PORT/stream/;
 *     proxy_http_version 1.1;
 *     proxy_set_header Host $host;
 *     proxy_set_header X-Real-IP $remote_addr;
 *     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *     proxy_buffering off;
 *   }
 */

const CONTENT_TYPES = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  m3u8: 'application/vnd.apple.mpegurl',
};

/**
 * Validate a streaming request with the panel and get the source URL.
 * Returns { ok, sourceUrl, container, streamId, lineId } or { ok: false, error }.
 */
async function validateWithPanel(asset, id, token, expires, sig) {
  const u = new URL(`${PANEL_URL}/api/stream/node-validate`);
  u.searchParams.set('token', token);
  u.searchParams.set('expires', expires);
  u.searchParams.set('sig', sig);
  u.searchParams.set('asset', asset);
  u.searchParams.set('id', String(id));
  const raw = await getText(u.toString());
  if (!raw) return { ok: false, error: 'panel unreachable' };
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid panel response' };
  }
}

/**
 * Fetch a URL and pipe its response to the client, handling Range requests.
 */
async function pipeStream(sourceUrl, req, res, contentType) {
  const rangeHeader = req.headers.range || null;
  const fetchHeaders = { 'User-Agent': req.headers['user-agent'] || 'IPTV-Node/1.0' };
  if (rangeHeader) fetchHeaders['Range'] = rangeHeader;

  let upstream;
  try {
    upstream = await fetch(sourceUrl, { headers: fetchHeaders, redirect: 'follow', timeout: 30000 });
  } catch (e) {
    console.error(`[agent:stream] fetch failed: ${e.message}`);
    res.status(502).send('upstream fetch failed');
    return;
  }

  res.status(upstream.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  const cl = upstream.headers.get('content-length');
  if (cl) res.setHeader('Content-Length', cl);
  const cr = upstream.headers.get('content-range');
  if (cr) res.setHeader('Content-Range', cr);

  upstream.body.pipe(res);
  upstream.body.on('error', () => { try { res.end(); } catch {} });
  req.on('close', () => { try { upstream.body.destroy(); } catch {} });
}

function startStreamingServer() {
  if (AGENT_PROFILE === 'agent-only') {
    console.log('[agent:stream] agent-only profile — streaming server disabled');
    return;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    const movieMatch = pathname.match(/^\/stream\/movie\/[^/]+\/[^/]+\/(\d+)\.(\w+)$/);
    const episodeMatch = pathname.match(/^\/stream\/episode\/[^/]+\/[^/]+\/(\d+)\.(\w+)$/);

    if (!movieMatch && !episodeMatch) {
      res.status(404).send('Not found');
      return;
    }

    const isMovie = !!movieMatch;
    const id = isMovie ? movieMatch[1] : episodeMatch[1];
    const ext = (isMovie ? movieMatch[2] : episodeMatch[2]).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const asset = isMovie ? 'movie' : 'episode';
    const token = url.searchParams.get('token') || '';
    const expires = url.searchParams.get('expires') || '';
    const sig = url.searchParams.get('sig') || '';

    if (!token || !expires || !sig) {
      res.status(400).send('missing auth params');
      return;
    }

    const validation = await validateWithPanel(asset, id, token, expires, sig);
    if (!validation.ok) {
      console.warn(`[agent:stream] panel validation failed for ${asset}:${id} — ${validation.error}`);
      res.status(401).send(validation.error || 'unauthorized');
      return;
    }

    console.log(`[agent:stream] streaming ${asset}:${id} from ${validation.sourceUrl}`);
    await pipeStream(validation.sourceUrl, req, res, contentType);
  });

  server.listen(STREAM_PORT, () => {
    console.log(`[agent:stream] streaming server listening on port ${STREAM_PORT}`);
  });

  server.on('error', (e) => {
    console.error(`[agent:stream] server error: ${e.message}`);
  });
}

async function main() {
  startStreamingServer();
  for (;;) {
    try {
      await beat();
    } catch (e) {
      console.error('[agent]', e.message || e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
