'use strict';

const crypto = require('crypto');
const express = require('express');
const { verifyApiKey } = require('../lib/crypto');

module.exports = function agentRoutes({ dbApi, serverService }) {
  const router = express.Router();
  const agentRate = new Map();

  function timingSafeHexEqual(expectedHex, providedHex) {
    try {
      const expected = Buffer.from(String(expectedHex || ''), 'hex');
      const provided = Buffer.from(String(providedHex || ''), 'hex');
      return expected.length > 0 && expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    } catch (_) {
      return false;
    }
  }

  function verifyAgentSignature(secret, payload, signature) {
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
    return timingSafeHexEqual(expected, signature);
  }

  async function authenticateAgentRequest(req, payload, serverId) {
    const credentialId = String(req.get('x-agent-credential-id') || '').trim();
    const presentedSecret = String(req.get('x-agent-secret') || '');
    const signature = String(req.get('x-agent-signature') || '');

    if (credentialId || presentedSecret) {
      if (!credentialId || !presentedSecret) {
        return { ok: false, status: 401, error: 'credential_id and secret are required together' };
      }
      const credential = typeof dbApi.getServerAgentCredentialForValidation === 'function'
        ? await dbApi.getServerAgentCredentialForValidation(credentialId)
        : null;
      if (!credential) {
        return { ok: false, status: 401, error: 'unknown agent credential' };
      }
      if (Number(credential.server_id) !== Number(serverId)) {
        return { ok: false, status: 401, error: 'credential does not belong to server' };
      }
      if (!(await verifyApiKey(presentedSecret, credential.secret_hash))) {
        return { ok: false, status: 401, error: 'invalid agent secret' };
      }
      if (!verifyAgentSignature(presentedSecret, payload, signature)) {
        return { ok: false, status: 401, error: 'invalid signature' };
      }
      if (typeof dbApi.touchServerAgentCredential === 'function') {
        await dbApi.touchServerAgentCredential(credentialId);
      }
      return { ok: true, mode: 'credential', credentialId };
    }

    const legacySecret = String(process.env.AGENT_SECRET || '').trim();
    if (!legacySecret) {
      return { ok: false, status: 503, error: 'agent disabled' };
    }
    if (!verifyAgentSignature(legacySecret, payload, signature)) {
      return { ok: false, status: 401, error: 'invalid signature' };
    }
    return { ok: true, mode: 'legacy' };
  }

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
    const ip = req.ip || req.connection?.remoteAddress || '';
    if (!agentHeartbeatRateOk(String(ip))) return res.status(429).json({ error: 'rate limit' });
    const serverId = parseInt(body.server_id, 10);
    if (!Number.isFinite(serverId) || serverId <= 0) return res.status(400).json({ error: 'server_id required' });
    const auth = await authenticateAgentRequest(req, payload, serverId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
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
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

    const ackPayload = JSON.stringify({
      server_id: body.server_id,
      command_id: body.command_id,
      status: body.status,
      result_json: body.result_json,
      error_text: body.error_text,
      placement_reports: body.placement_reports,
    });

    const serverId = parseInt(body.server_id, 10);
    const commandId = parseInt(body.command_id, 10);
    if (!Number.isFinite(serverId) || serverId <= 0) return res.status(400).json({ error: 'server_id required' });
    const auth = await authenticateAgentRequest(req, ackPayload, serverId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

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
