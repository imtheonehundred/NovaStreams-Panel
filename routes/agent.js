'use strict';

const crypto = require('crypto');
const express = require('express');

module.exports = function agentRoutes({ dbApi, serverService }) {
  const router = express.Router();
  const agentRate = new Map();

  function agentHeartbeatRateOk(ip) {
    const now = Date.now();
    const windowMs = 60000;
    const max = 60;
    let arr = agentRate.get(ip) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    agentRate.set(ip, arr);
    return true;
  }

  router.post('/agent/heartbeat', async (req, res) => {
    const secret = String(process.env.AGENT_SECRET || '').trim();
    if (!secret) return res.status(503).json({ error: 'agent disabled' });
    const sig = String(req.get('x-agent-signature') || '');
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const capabilities = body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : null;
    const payload = JSON.stringify({
      server_id: body.server_id,
      ts: body.ts,
      cpu: body.cpu,
      mem: body.mem,
      net_mbps: body.net_mbps,
      ping_ms: body.ping_ms,
      version: body.version,
      capabilities: capabilities || undefined,
    });
    const expect = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    let sigOk = false;
    try {
      const a = Buffer.from(expect, 'hex');
      const b = Buffer.from(sig, 'hex');
      if (a.length === b.length && a.length > 0) sigOk = crypto.timingSafeEqual(a, b);
    } catch (_) {}
    if (!sigOk) return res.status(401).json({ error: 'invalid signature' });
    const ip = req.ip || req.connection?.remoteAddress || '';
    if (!agentHeartbeatRateOk(String(ip))) return res.status(429).json({ error: 'rate limit' });
    const serverId = parseInt(body.server_id, 10);
    if (!Number.isFinite(serverId) || serverId <= 0) return res.status(400).json({ error: 'server_id required' });
    const row = await serverService.getServer(serverId);
    if (!row) return res.status(404).json({ error: 'unknown server' });
    try {
      await serverService.applyHeartbeat(serverId, {
        cpu: body.cpu,
        mem: body.mem,
        net_mbps: body.net_mbps,
        ping_ms: body.ping_ms,
        version: body.version,
      }, capabilities);

      const leasedCommands = await dbApi.leaseServerCommands(serverId, 5);

      res.json({
        ok: true,
        commands: leasedCommands.map((cmd) => ({
          id: cmd.id,
          command_type: cmd.command_type,
          stream_type: cmd.stream_type,
          stream_id: cmd.stream_id,
          placement_id: cmd.placement_id,
          payload: cmd.payload_json ? (() => { try { return JSON.parse(cmd.payload_json); } catch (_) { return null; } })() : null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'failed' });
    }
  });

  router.post('/agent/command/ack', async (req, res) => {
    const secret = String(process.env.AGENT_SECRET || '').trim();
    if (!secret) return res.status(503).json({ error: 'agent disabled' });
    const sig = String(req.get('x-agent-signature') || '');
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

    const ackPayload = JSON.stringify({
      server_id: body.server_id,
      command_id: body.command_id,
      status: body.status,
      result_json: body.result_json,
      error_text: body.error_text,
      placement_reports: body.placement_reports,
    });
    const expect = crypto.createHmac('sha256', secret).update(ackPayload).digest('hex');
    let sigOk = false;
    try {
      const a = Buffer.from(expect, 'hex');
      const b = Buffer.from(sig, 'hex');
      if (a.length === b.length && a.length > 0) sigOk = crypto.timingSafeEqual(a, b);
    } catch (_) {}
    if (!sigOk) return res.status(401).json({ error: 'invalid signature' });

    const serverId = parseInt(body.server_id, 10);
    const commandId = parseInt(body.command_id, 10);
    if (!Number.isFinite(serverId) || serverId <= 0) return res.status(400).json({ error: 'server_id required' });

    try {
      if (Number.isFinite(commandId) && commandId > 0) {
        const status = String(body.status || '');
        if (status === 'succeeded') {
          await dbApi.markServerCommandSucceeded(commandId, body.result_json);
        } else if (status === 'failed') {
          await dbApi.markServerCommandFailed(commandId, body.error_text || null);
        } else {
          await dbApi.markServerCommandRunning(commandId);
        }
      }

      const reports = Array.isArray(body.placement_reports) ? body.placement_reports : [];
      if (reports.length > 0) {
        await dbApi.reportPlacementRuntimeFromNode(serverId, reports);
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'failed' });
    }
  });

  return router;
};
