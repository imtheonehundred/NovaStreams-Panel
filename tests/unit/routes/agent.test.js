'use strict';

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { hashApiKey } = require('../../../lib/crypto');

describe('agent routes authentication', () => {
  const originalAgentSecret = process.env.AGENT_SECRET;

  afterAll(() => {
    process.env.AGENT_SECRET = originalAgentSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_SECRET;
  });

  function sign(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  function buildHeartbeatPayload(body) {
    return JSON.stringify({
      server_id: body.server_id,
      ts: body.ts,
      cpu: body.cpu,
      mem: body.mem,
      net_mbps: body.net_mbps,
      ping_ms: body.ping_ms,
      version: body.version,
      capabilities: body.capabilities || undefined,
    });
  }

  function buildApp(dbApiOverrides = {}, serverServiceOverrides = {}) {
    const agentRoutes = require('../../../routes/agent');
    const dbApi = {
      getServerAgentCredentialForValidation: jest.fn(),
      touchServerAgentCredential: jest.fn(),
      leaseServerCommands: jest.fn().mockResolvedValue([]),
      markServerCommandSucceeded: jest.fn(),
      markServerCommandFailed: jest.fn(),
      markServerCommandRunning: jest.fn(),
      reportPlacementRuntimeFromNode: jest.fn(),
      ...dbApiOverrides,
    };
    const serverService = {
      getServer: jest.fn().mockResolvedValue({ id: 1, name: 'Node 1' }),
      applyHeartbeat: jest.fn().mockResolvedValue(true),
      ...serverServiceOverrides,
    };
    const app = express();
    app.use(express.json());
    app.use('/api', agentRoutes({ dbApi, serverService }));
    return { app, dbApi, serverService };
  }

  it('accepts per-node credentials with a matching signature', async () => {
    const secret = 'node-secret';
    const credentialId = 'cred_abc';
    const body = {
      server_id: 1,
      ts: 123,
      cpu: 10,
      mem: 20,
      net_mbps: 30,
      ping_ms: 40,
      version: '1.0.0',
      capabilities: { runtime: true },
    };
    const payload = buildHeartbeatPayload(body);
    const secretHash = await hashApiKey(secret);
    const { app, dbApi } = buildApp({
      getServerAgentCredentialForValidation: jest.fn().mockResolvedValue({
        credential_id: credentialId,
        server_id: 1,
        secret_hash: secretHash,
        status: 'active',
      }),
    });

    await request(app)
      .post('/api/agent/heartbeat')
      .set('X-Agent-Credential-Id', credentialId)
      .set('X-Agent-Secret', secret)
      .set('X-Agent-Signature', sign(secret, payload))
      .send(body)
      .expect(200);

    expect(dbApi.touchServerAgentCredential).toHaveBeenCalledWith(credentialId);
  });

  it('rejects invalid per-node secrets', async () => {
    const secret = 'node-secret';
    const body = {
      server_id: 1,
      ts: 123,
      cpu: 10,
      mem: 20,
      net_mbps: 30,
      ping_ms: 40,
      version: '1.0.0',
    };
    const payload = buildHeartbeatPayload(body);
    const { app } = buildApp({
      getServerAgentCredentialForValidation: jest.fn().mockResolvedValue({
        credential_id: 'cred_bad',
        server_id: 1,
        secret_hash: hashApiKey('different-secret'),
        status: 'active',
      }),
    });

    await request(app)
      .post('/api/agent/heartbeat')
      .set('X-Agent-Credential-Id', 'cred_bad')
      .set('X-Agent-Secret', secret)
      .set('X-Agent-Signature', sign(secret, payload))
      .send(body)
      .expect(401);
  });

  it('still supports the legacy shared-secret fallback', async () => {
    const legacySecret = 'legacy-shared-secret';
    process.env.AGENT_SECRET = legacySecret;
    const body = {
      server_id: 1,
      ts: 999,
      cpu: 5,
      mem: 6,
      net_mbps: 7,
      ping_ms: 8,
      version: '1.0.0',
    };
    const payload = buildHeartbeatPayload(body);
    const { app } = buildApp();

    await request(app)
      .post('/api/agent/heartbeat')
      .set('X-Agent-Signature', sign(legacySecret, payload))
      .send(body)
      .expect(200);
  });
});
