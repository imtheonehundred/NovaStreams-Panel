'use strict';

const express = require('express');
const provisionService = require('../services/provisionService');

const router = express.Router();

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

router.get('/features', async (_req, res) => {
  try {
    res.json({
      serverProvisioning: await provisionService.isProvisioningEnabled(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/version', async (req, res) => {
  const current = require('../package.json').version;
  const repo = 'imtheonehundred/NovaStreams-Panel';
  const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const gh = await fetch(ghUrl, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NovaStreams-Panel' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!gh.ok) throw new Error(`GitHub API ${gh.status}`);
    const data = await gh.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    const outdated = compareVersions(latest, current) > 0;
    res.json({
      current,
      latest,
      currentIsOutdated: outdated,
      releaseUrl: data.html_url || `https://github.com/${repo}/releases`,
      publishedAt: data.published_at || null,
    });
  } catch (e) {
    res.json({ current, latest: current, currentIsOutdated: false, releaseUrl: `https://github.com/${repo}/releases` });
  }
});

router.get('/bandwidth', async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 6));
    const { getBandwidthHistory } = require('../services/bandwidthMonitor');
    const data = await getBandwidthHistory(hours);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
