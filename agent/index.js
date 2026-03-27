#!/usr/bin/env node
'use strict';

/**
 * Remote agent: install on edge/LB nodes. Env:
 *   SERVER_ID       — panel streaming_servers.id
 *   PANEL_URL       — https://panel.example.com (no trailing slash)
 *   AGENT_SECRET    — same as panel AGENT_SECRET
 *   AGENT_INTERVAL_MS — optional, default 30000
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
const INTERVAL_MS = Math.max(5000, parseInt(process.env.AGENT_INTERVAL_MS || '30000', 10) || 30000);
const VERSION = '1.0.0';

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
    const payload = canonicalBody(body);
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

function canonicalBody(b) {
  return JSON.stringify({
    server_id: b.server_id,
    ts: b.ts,
    cpu: b.cpu,
    mem: b.mem,
    net_mbps: b.net_mbps,
    ping_ms: b.ping_ms,
    version: b.version,
  });
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
  };
  const url = `${PANEL_URL}/api/agent/heartbeat`;
  await postJson(url, body);
  console.log(`[agent] heartbeat ok ${new Date().toISOString()}`);
}

async function main() {
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
