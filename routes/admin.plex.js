'use strict';

const express = require('express');
const { query, execute } = require('../lib/mariadb');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

router.get('/plex/servers', async (_req, res) => {
  try {
    const rows = await query('SELECT id, name, url, plex_token, last_seen FROM plex_servers ORDER BY last_seen DESC');
    res.json({ servers: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/plex/servers', async (req, res) => {
  try {
    const { name, url, plex_token } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const { insertId } = await execute(
      'INSERT INTO plex_servers (name, url, plex_token, last_seen) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name), url=VALUES(url), plex_token=VALUES(plex_token)',
      [name, url, plex_token || '']
    );
    res.json({ ok: true, id: insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/plex/servers/:id', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    await execute('DELETE FROM plex_servers WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/plex/servers/:id/libraries', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [id]);
    if (!server) return res.status(404).json({ error: 'server not found' });

    const headers = { 'Accept': 'application/json' };
    if (server.plex_token) headers['X-Plex-Token'] = server.plex_token;
    const res2 = await require('node-fetch')(`${server.url}/library/sections?X-Plex-Token=${server.plex_token || ''}`, { headers });
    if (!res2.ok) return res.status(502).json({ error: 'Plex server unreachable' });
    const xml = await res2.text();
    const matches = [...xml.matchAll(/<Directory key="(\d+)" title="([^"]+)"/g)];
    const libs = matches.map(m => ({ key: m[1], title: m[2] }));
    res.json({ libraries: libs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/plex/servers/:id/watch-status', async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const [server] = await query('SELECT url, plex_token FROM plex_servers WHERE id = ? LIMIT 1', [id]);
    if (!server) return res.status(404).json({ error: 'server not found' });

    const res2 = await require('node-fetch')(
      `${server.url}/status/sessions?X-Plex-Token=${server.plex_token || ''}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res2.ok) return res.json({ watchers: [] });
    const j = await res2.json();
    const videos = j.MediaContainer?.Video || [];
    const watchers = (Array.isArray(videos) ? videos : [videos]).filter(Boolean).map(v => ({
      title: v.title || '',
      user: v.User?.title || '',
      viewOffset: v.viewOffset || 0,
      duration: v.duration || 0,
    }));
    res.json({ watchers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
