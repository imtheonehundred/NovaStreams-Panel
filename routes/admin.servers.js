'use strict';

const express = require('express');
const serverService = require('../services/serverService');
const provisionService = require('../services/provisionService');
const streamManager = require('../services/streamManager');
const lineService = require('../services/lineService');
const dbApi = require('../lib/db');
const auditService = require('../services/auditService');

const router = express.Router();

function parseIdParam(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function sanitizeServer(server) {
  if (!server || typeof server !== 'object') return server;
  return {
    ...server,
    admin_password: '',
  };
}

router.get('/servers', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    res.json({ servers: servers.map(sanitizeServer) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers', async (req, res) => {
  try {
    const s = await serverService.createServer(req.body || {});
    await auditService.log(
      req.userId,
      'admin.server.create',
      'server',
      s.id,
      { name: s.name, role: s.role },
      req
    );
    res.status(201).json(sanitizeServer(s));
  } catch (e) {
    res.status(400).json({ error: e.message || 'create failed' });
  }
});

router.get('/servers/nginx-export', async (_req, res) => {
  try {
    const snippet = await serverService.buildNginxUpstreamSnippet();
    res.json({ snippet });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/provision', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const b = req.body || {};
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host') || '';
    const panelUrl = String(
      b.panel_url || process.env.PANEL_PUBLIC_URL || `${proto}://${host}`
    ).replace(/\/+$/, '');
    const job = await provisionService.startProvisionJob({
      ...b,
      panel_url: panelUrl,
      userId: req.session && req.session.userId,
    });
    res.status(201).json(job);
  } catch (e) {
    res.status(400).json({ error: e.message || 'provision failed' });
  }
});

router.get('/servers/provision/:jobId', async (req, res) => {
  if (!(await provisionService.isProvisioningEnabled())) {
    return res.status(403).json({ error: 'provisioning disabled' });
  }
  try {
    const job = await provisionService.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({
      id: job.id,
      status: job.status,
      log: job.log || '',
      error: job.error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/servers/monitor-summary', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    const summary = await Promise.all(
      servers.map(async (s) => {
        const placements = await serverService.getRuntimePlacementsForServer(
          s.id
        );
        const activeSessions = await dbApi.countActiveRuntimeSessionsByServer(
          s.id
        );
        const health = await serverService.getServerHealthStatus(s.id);
        const runningPlacements = placements.filter(
          (p) => p.status === 'running'
        ).length;
        const totalPlacements = placements.length;
        return {
          id: s.id,
          name: s.name,
          role: s.role,
          public_host: s.public_host,
          public_ip: s.public_ip,
          private_ip: s.private_ip,
          enabled: s.enabled,
          proxied: s.proxied,
          timeshift_only: s.timeshift_only,
          max_clients: s.max_clients,
          network_mbps_cap: s.network_mbps_cap,
          network_interface: s.network_interface,
          network_speed: s.network_speed,
          os_info: s.os_info,
          ssh_port: s.ssh_port,
          http_port: s.http_port,
          https_port: s.https_port,
          runtime_enabled: s.runtime_enabled,
          proxy_enabled: s.proxy_enabled,
          controller_enabled: s.controller_enabled,
          domains_count: Array.isArray(s.domains) ? s.domains.length : 0,
          last_heartbeat_at: s.last_heartbeat_at,
          heartbeat_fresh: !!health.fresh,
          heartbeat_stale_ms: Number.isFinite(health.staleMs)
            ? health.staleMs
            : null,
          agent_version: s.agent_version,
          health_cpu_pct: s.health_cpu_pct,
          health_mem_pct: s.health_mem_pct,
          health_net_mbps: s.health_net_mbps,
          health_ping_ms: s.health_ping_ms,
          active_sessions: activeSessions,
          running_placements: runningPlacements,
          total_placements: totalPlacements,
        };
      })
    );
    res.json({ servers: summary });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.get('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const s = await serverService.getServer(id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(sanitizeServer(s));
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const body = { ...(req.body || {}) };
    if (
      body.admin_password !== undefined &&
      String(body.admin_password).trim() === ''
    ) {
      delete body.admin_password;
    }
    const s = await serverService.updateServer(id, body);
    if (!s) return res.status(404).json({ error: 'not found' });
    await auditService.log(
      req.userId,
      'admin.server.update',
      'server',
      id,
      { fields: Object.keys(body) },
      req
    );
    res.json(sanitizeServer(s));
  } catch (e) {
    res.status(400).json({ error: e.message || 'update failed' });
  }
});

router.delete('/servers/:id(\\d+)', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });
    const ok = await serverService.deleteServer(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    await auditService.log(
      req.userId,
      'admin.server.delete',
      'server',
      id,
      { name: server.name || '' },
      req
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.put('/servers/reorder', async (req, res) => {
  const orderings = req.body;
  if (!Array.isArray(orderings))
    return res
      .status(400)
      .json({ error: 'body must be an array of {id, sort_order}' });
  try {
    await serverService.reorderServers(orderings);
    await auditService.log(
      req.userId,
      'admin.server.reorder',
      'server',
      null,
      { count: orderings.length },
      req
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'reorder failed' });
  }
});

router.post('/servers/:id/actions/restart-services', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });
    const result = await streamManager.issueRemoteCommand({
      serverId: id,
      commandType: 'restart_services',
      issuedByUserId: req.session && req.session.userId,
    });
    if (!result.ok)
      return res.status(400).json({ error: result.reason || 'failed' });
    res.json({
      ok: true,
      commandId: result.commandId,
      message: 'Restart services command queued',
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/:id/actions/reboot-server', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });
    const result = await streamManager.issueRemoteCommand({
      serverId: id,
      commandType: 'reboot_server',
      issuedByUserId: req.session && req.session.userId,
    });
    if (!result.ok)
      return res.status(400).json({ error: result.reason || 'failed' });
    res.json({
      ok: true,
      commandId: result.commandId,
      message: 'Reboot command queued',
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

router.post('/servers/:id/actions/kill-connections', async (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: 'invalid id' });
  try {
    const server = await serverService.getServer(id);
    if (!server) return res.status(404).json({ error: 'not found' });

    const sessions = await dbApi.listActiveRuntimeSessionsByServer(id);
    const reconcileKeys = new Set();
    let closed = 0;
    for (const session of sessions) {
      try {
        if (
          String(session.stream_type) === 'live' &&
          session.line_id &&
          session.session_uuid
        ) {
          await lineService.closeConnection(
            session.line_id,
            session.session_uuid
          );
        }
      } catch {
        // Best effort; a single closeConnection failure should not abort the bulk close.
      }
      if (session.session_uuid) {
        await lineService.closeRuntimeSession(session.session_uuid);
        reconcileKeys.add(`${session.stream_type}:${session.stream_id}:${id}`);
        closed++;
      }
    }
    for (const key of reconcileKeys) {
      const [streamType, streamId, serverId] = key.split(':');
      await dbApi.reconcilePlacementClients(
        streamType,
        streamId,
        parseInt(serverId, 10)
      );
    }
    res.json({
      ok: true,
      closed,
      message: `Closed ${closed} active connection(s)`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'failed' });
  }
});

module.exports = router;
