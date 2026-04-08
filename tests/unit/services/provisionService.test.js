'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  insert: jest.fn(),
}));

const { query, queryOne, execute, insert } = require('../../../lib/mariadb');

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
  addPanelLog: jest.fn(),
  createServerAgentCredential: jest.fn(),
  ensureServerProvisioningJobsTable: jest.fn(),
}));

const db = require('../../../lib/db');

const provisionService = require('../../../services/provisionService');

describe('Provision Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initStages', () => {
    it('should initialize all stages as pending', () => {
      const stages = provisionService.initStages();
      expect(stages).toBeDefined();
      expect(stages.connecting).toEqual({ status: 'pending', started_at: null, finished_at: null, result: null });
      expect(stages.validating_credentials).toBeDefined();
      expect(stages.completed).toBeDefined();
    });
  });

  describe('PROVISIONING_STAGES', () => {
    it('should contain all expected stages', () => {
      expect(provisionService.PROVISIONING_STAGES).toContain('connecting');
      expect(provisionService.PROVISIONING_STAGES).toContain('validating_credentials');
      expect(provisionService.PROVISIONING_STAGES).toContain('issuing_node_credentials');
      expect(provisionService.PROVISIONING_STAGES).toContain('installing_runtime_profile');
      expect(provisionService.PROVISIONING_STAGES).toContain('deploying_agent');
      expect(provisionService.PROVISIONING_STAGES).toContain('starting_agent');
      expect(provisionService.PROVISIONING_STAGES).toContain('first_heartbeat');
      expect(provisionService.PROVISIONING_STAGES).toContain('runtime_handshake');
      expect(provisionService.PROVISIONING_STAGES).toContain('completed');
    });
  });

  describe('VALID_PROFILES', () => {
    it('should define valid profile types', () => {
      expect(provisionService.VALID_PROFILES).toContain('origin-runtime');
      expect(provisionService.VALID_PROFILES).toContain('proxy-delivery');
      expect(provisionService.VALID_PROFILES).toContain('agent-only');
    });
  });

  describe('DEFAULT_PROFILE', () => {
    it('should be origin-runtime', () => {
      expect(provisionService.DEFAULT_PROFILE).toBe('origin-runtime');
    });
  });

  describe('isEnvProvisioningMasterEnabled', () => {
    it('should return false when env not set', () => {
      delete process.env.ENABLE_SERVER_PROVISIONING;
      expect(provisionService.isEnvProvisioningMasterEnabled()).toBe(false);
    });

    it('should return true when env is 1', () => {
      process.env.ENABLE_SERVER_PROVISIONING = '1';
      expect(provisionService.isEnvProvisioningMasterEnabled()).toBe(true);
    });

    it('should return false when env is 0', () => {
      process.env.ENABLE_SERVER_PROVISIONING = '0';
      expect(provisionService.isEnvProvisioningMasterEnabled()).toBe(false);
    });
  });

  describe('parseBoolSetting', () => {
    it('should return true for 1', () => {
      expect(provisionService.parseBoolSetting('1')).toBe(true);
    });

    it('should return true for true', () => {
      expect(provisionService.parseBoolSetting('true')).toBe(true);
    });

    it('should return true for yes', () => {
      expect(provisionService.parseBoolSetting('yes')).toBe(true);
    });

    it('should return true for on', () => {
      expect(provisionService.parseBoolSetting('on')).toBe(true);
    });

    it('should return false for 0', () => {
      expect(provisionService.parseBoolSetting('0')).toBe(false);
    });

    it('should return false for false', () => {
      expect(provisionService.parseBoolSetting('false')).toBe(false);
    });

    it('should return false for random strings', () => {
      expect(provisionService.parseBoolSetting('random')).toBe(false);
    });
  });

  describe('parseStagesFromLog', () => {
    it('should return null for empty input', () => {
      expect(provisionService.parseStagesFromLog('')).toBeNull();
    });

    it('should return null when no stages JSON found', () => {
      expect(provisionService.parseStagesFromLog('some log text')).toBeNull();
    });

    it('should parse stages JSON from log', () => {
      const stages = { connecting: { status: 'done' } };
      const log = `some text\n__STAGES_JSON__:${JSON.stringify(stages)}\nmore text`;
      expect(provisionService.parseStagesFromLog(log)).toEqual(stages);
    });

    it('should return null for invalid JSON', () => {
      const log = 'text\n__STAGES_JSON__:not valid json\n';
      expect(provisionService.parseStagesFromLog(log)).toBeNull();
    });
  });

  describe('stagesLogLine', () => {
    it('should return properly formatted line', () => {
      const stages = { connecting: { status: 'done' } };
      const line = provisionService.stagesLogLine(stages);
      expect(line).toBe(`__STAGES_JSON__:${JSON.stringify(stages)}`);
    });
  });

  describe('replaceStagesInLog', () => {
    it('should add stages if not present', () => {
      const buf = 'initial log';
      const stages = { connecting: { status: 'done' } };
      const result = provisionService.replaceStagesInLog(buf, stages);
      expect(result).toContain('__STAGES_JSON__');
    });

    it('should replace existing stages', () => {
      const stages = { connecting: { status: 'done' } };
      const buf = `before\n__STAGES_JSON__:${JSON.stringify({ old: true })}\nafter`;
      const result = provisionService.replaceStagesInLog(buf, stages);
      expect(result).toContain('"connecting"');
      expect(result).not.toContain('"old"');
    });
  });

  describe('getInstallScriptForProfile', () => {
    it('should return origin-runtime script by default', () => {
      const script = provisionService.getInstallScriptForProfile('origin-runtime');
      expect(script).toContain('iptv-panel:origin-runtime');
    });

    it('should return proxy-delivery script', () => {
      const script = provisionService.getInstallScriptForProfile('proxy-delivery');
      expect(script).toContain('iptv-panel:proxy-delivery');
    });

    it('should return agent-only script', () => {
      const script = provisionService.getInstallScriptForProfile('agent-only');
      expect(script).toContain('iptv-panel:agent-only');
    });

    it('should return origin-runtime for unknown profile', () => {
      const script = provisionService.getInstallScriptForProfile('unknown');
      expect(script).toContain('iptv-panel:origin-runtime');
    });
  });

  describe('isProvisioningEnabled', () => {
    it('should return false when env master is disabled', async () => {
      process.env.ENABLE_SERVER_PROVISIONING = '';
      db.getSetting.mockResolvedValue('1');
      expect(await provisionService.isProvisioningEnabled()).toBe(false);
    });

    it('should return false when DB setting is 0', async () => {
      process.env.ENABLE_SERVER_PROVISIONING = '1';
      db.getSetting.mockResolvedValue('0');
      expect(await provisionService.isProvisioningEnabled()).toBe(false);
    });

    it('should return true when both are enabled', async () => {
      process.env.ENABLE_SERVER_PROVISIONING = '1';
      db.getSetting.mockResolvedValue('1');
      expect(await provisionService.isProvisioningEnabled()).toBe(true);
    });
  });

  describe('getProvisioningUiState', () => {
    it('should return provisioning UI state', async () => {
      process.env.ENABLE_SERVER_PROVISIONING = '1';
      db.getSetting.mockResolvedValue('1');
      const state = await provisionService.getProvisioningUiState();
      expect(state).toHaveProperty('streaming_provisioning_enabled');
      expect(state).toHaveProperty('provisioning_env_master_enabled');
      expect(state).toHaveProperty('server_provisioning_effective');
    });
  });

  describe('encryptSecretForAudit', () => {
    it('should return base64 string', () => {
      const result = provisionService.encryptSecretForAudit('test');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should return different values for same input (due to random IV)', () => {
      const result1 = provisionService.encryptSecretForAudit('test');
      const result2 = provisionService.encryptSecretForAudit('test');
      expect(result1).not.toBe(result2);
    });
  });

  describe('maskLogLine', () => {
    it('should mask password', () => {
      const line = 'password=secret123';
      expect(provisionService.maskLogLine(line)).toBe('password=***');
    });

    it('should mask AGENT_SECRET', () => {
      const line = 'AGENT_SECRET=mytoken';
      expect(provisionService.maskLogLine(line)).toBe('AGENT_SECRET=***');
    });

    it('should handle case insensitivity', () => {
      expect(provisionService.maskLogLine('PASSWORD=secret')).toBe('PASSWORD=***');
      expect(provisionService.maskLogLine('Agent_Secret=token')).toBe('Agent_Secret=***');
    });

    it('should return original line if nothing to mask', () => {
      const line = 'normal log message';
      expect(provisionService.maskLogLine(line)).toBe(line);
    });
  });

  describe('appendLog', () => {
    it('should append line with newline if not ending with newline', () => {
      const buf = 'existing';
      const result = provisionService.appendLog(buf, 'new line');
      expect(result).toBe('existing\nnew line');
    });

    it('should append line without extra newline if already ending with newline', () => {
      const buf = 'existing\n';
      const result = provisionService.appendLog(buf, 'new line');
      expect(result).toBe('existing\nnew line\n');
    });
  });

  describe('isProbablyIpv4', () => {
    it('should return true for valid IPv4', () => {
      expect(provisionService.isProbablyIpv4('192.168.1.1')).toBe(true);
      expect(provisionService.isProbablyIpv4('8.8.8.8')).toBe(true);
    });

    it('should return false for hostnames', () => {
      expect(provisionService.isProbablyIpv4('example.com')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(provisionService.isProbablyIpv4('')).toBe(false);
    });
  });

  describe('waitForFirstHeartbeat', () => {
    it('should return ok false when no heartbeat found', async () => {
      queryOne.mockResolvedValue({});
      const result = await provisionService.waitForFirstHeartbeat(1, 100);
      expect(result.ok).toBe(false);
    });

    it('should return ok true when heartbeat found', async () => {
      const now = new Date();
      queryOne.mockResolvedValue({ last_heartbeat_at: now.toISOString() });
      const result = await provisionService.waitForFirstHeartbeat(1, 100);
      expect(result.ok).toBe(true);
    });
  });
});
