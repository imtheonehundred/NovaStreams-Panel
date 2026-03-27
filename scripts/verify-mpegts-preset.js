#!/usr/bin/env node
'use strict';

/**
 * Verifies fast-preset defaults when PREBUFFER_* and STREAM_INGEST_STYLE are unset.
 * Uses lib/streaming-settings.js (env fallback when DB not loaded).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env };
for (const k of [
  'PREBUFFER_ENABLED',
  'PREBUFFER_SIZE_MB',
  'PREBUFFER_ON_DEMAND_MIN_BYTES',
  'PREBUFFER_ON_DEMAND_MAX_WAIT_MS',
  'STREAM_INGEST_STYLE',
  'STREAMING_LOW_LATENCY',
  'STREAMING_PREWARM_ENABLED',
  'FFMPEG_MINIMAL_INGEST',
]) {
  delete env[k];
}

const ssPath = path.join(root, 'lib/streaming-settings.js');
const faPath = path.join(root, 'lib/ffmpeg-args.js');

const snippet = `
const assert = (ok, msg) => { if (!ok) { console.error(msg); process.exit(1); } };
const ss = require(${JSON.stringify(ssPath)});
ss._resetCacheForTests();
assert(ss.isPrebufferEnabled() === true, 'prebuffer should default on');
assert(ss.getPrebufferMaxBytes() === 6 * 1024 * 1024, 'PREBUFFER_SIZE_MB default 6');
assert(ss.getOnDemandMinBytes() === 2097152, 'on-demand min 2 MiB');
assert(ss.getOnDemandMaxWaitMs() === 3000, 'on-demand max wait 3000ms');
const { webappIngestStyle } = require(${JSON.stringify(faPath)});
assert(webappIngestStyle() === true, 'ingest style unset should imply webapp');
console.log('verify-mpegts-preset: defaults OK');
`;

const r = spawnSync(process.execPath, ['-e', snippet], {
  cwd: root,
  env,
  encoding: 'utf8',
});

if (r.status !== 0) {
  process.stderr.write(r.stderr || '');
  process.stdout.write(r.stdout || '');
  process.exit(r.status || 1);
}
process.stdout.write(r.stdout);
