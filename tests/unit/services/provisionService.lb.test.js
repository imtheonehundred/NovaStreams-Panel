'use strict';

jest.mock('../../../lib/mariadb', () => ({
  execute: jest.fn(),
  insert: jest.fn(),
  queryOne: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  ensureServerProvisioningJobsTable: jest.fn(),
  getSetting: jest.fn(),
  addPanelLog: jest.fn(),
  createServerAgentCredential: jest.fn(),
}));

jest.mock('../../../services/serverService', () => ({
  updateServer: jest.fn(),
  buildFullLbNginxConfig: jest.fn().mockResolvedValue('upstream {}'),
}));

const mariadb = require('../../../lib/mariadb');
const db = require('../../../lib/db');
const provisionService = require('../../../services/provisionService');

describe('provisionService LB helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('detects the first heartbeat within the timeout window', async () => {
    mariadb.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ last_heartbeat_at: new Date().toISOString() });

    const pending = provisionService.waitForFirstHeartbeat(5, 7000);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.heartbeatAt).toBeTruthy();
  });

  it('times out cleanly when heartbeat never arrives', async () => {
    mariadb.queryOne.mockResolvedValue(null);

    const pending = provisionService.waitForFirstHeartbeat(7, 3000);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.heartbeatAt).toBeNull();
  });

  it('initializes all provisioning stages as pending', () => {
    const stages = provisionService.initStages();

    expect(Object.keys(stages)).toEqual(provisionService.PROVISIONING_STAGES);
    expect(stages.first_heartbeat.status).toBe('pending');
    expect(stages.completed.result).toBeNull();
  });

  it('has the correct ordered stages including handshake stages', () => {
    const stages = provisionService.PROVISIONING_STAGES;
    expect(stages).toContain('issuing_node_credentials');
    expect(stages).toContain('installing_runtime_profile');
    expect(stages).toContain('runtime_handshake');
    const idx = stages.indexOf('first_heartbeat');
    expect(stages.indexOf('runtime_handshake')).toBeGreaterThan(idx);
  });

  it('waitForCapabilityHandshake returns ok when agent_profile matches expected profile', async () => {
    mariadb.queryOne.mockResolvedValue({
      runtime_enabled: 1,
      proxy_enabled: 0,
      controller_enabled: 0,
      meta_json: JSON.stringify({ agent_profile: 'origin-runtime' }),
    });

    const pending = provisionService.waitForCapabilityHandshake(5, 'origin-runtime', 7000);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({
      runtime: true,
      proxy: false,
      controller: false,
      profile: 'origin-runtime',
    });
  });

  it('waitForCapabilityHandshake returns ok=false when profile does not match', async () => {
    mariadb.queryOne.mockResolvedValue({
      runtime_enabled: 1,
      proxy_enabled: 0,
      controller_enabled: 0,
      meta_json: JSON.stringify({ agent_profile: 'proxy-delivery' }),
    });

    const pending = provisionService.waitForCapabilityHandshake(5, 'origin-runtime', 7000);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.ok).toBe(false);
  });

  it('waitForCapabilityHandshake times out when agent_profile not set', async () => {
    mariadb.queryOne.mockResolvedValue({
      runtime_enabled: 0,
      proxy_enabled: 0,
      controller_enabled: 0,
      meta_json: JSON.stringify({}),
    });

    const pending = provisionService.waitForCapabilityHandshake(5, 'origin-runtime', 3000);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.capabilities).toBeNull();
  });

  it('VALID_PROFILES contains all three profiles', () => {
    expect(provisionService.VALID_PROFILES).toContain('origin-runtime');
    expect(provisionService.VALID_PROFILES).toContain('proxy-delivery');
    expect(provisionService.VALID_PROFILES).toContain('agent-only');
    expect(provisionService.VALID_PROFILES).toHaveLength(3);
  });

  it('getInstallScriptForProfile returns a string for each profile', () => {
    const scripts = provisionService.VALID_PROFILES.map(p =>
      provisionService.getInstallScriptForProfile(p)
    );
    scripts.forEach(s => {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    });
  });

  it('getInstallScriptForProfile defaults to origin-runtime for unknown profile', () => {
    const script = provisionService.getInstallScriptForProfile('unknown-profile');
    const originScript = provisionService.getInstallScriptForProfile('origin-runtime');
    expect(script).toBe(originScript);
  });
});
