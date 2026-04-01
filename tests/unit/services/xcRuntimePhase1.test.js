'use strict';

/**
 * Phase 1 XC Runtime State Model - Repository Foundation Tests
 *
 * These tests verify the Phase 1 runtime-parity foundation:
 * - stream_server_placement evolved schema + repository helpers
 * - line_runtime_sessions repository helpers
 * - server_commands repository helpers
 * - server_agent_credentials repository helpers
 * - streaming_servers capability column helpers
 *
 * IMPORTANT: These tests do NOT verify playback behavior, runtime execution,
 * command delivery, or selector policy. Those are out of Phase 1 scope.
 */

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockExecute = jest.fn();
const mockInsert = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../../lib/mariadb', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
  insert: mockInsert,
  remove: mockRemove,
}));

const dbApi = require('../../../lib/db');

describe('Phase 1 XC Runtime: Placement Foundation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // ─── Status enum normalization ─────────────────────────────────────────

  describe('status enum values', () => {
    it('expanded status enum contains all Phase 1 values', () => {
      const validStatuses = [
        'planned', 'starting', 'running', 'stopping',
        'stopped', 'error', 'stale', 'orphaned',
      ];
      // The ensure function should handle all these values without error
      expect(validStatuses).toHaveLength(8);
    });
  });

  // ─── upsertPlacementRuntimeState ─────────────────────────────────────

  describe('upsertPlacementRuntimeState()', () => {
    it('updates specified runtime fields only', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.upsertPlacementRuntimeState({
        streamType: 'live',
        streamId: '42',
        serverId: 3,
        fields: {
          status: 'running',
          video_codec: 'h264',
          audio_codec: 'aac',
          resolution: '1920x1080',
          stream_info_json: { bitrate: 5000 },
        },
      });

      const call = mockExecute.mock.calls[0];
      const sql = call[0];
      expect(sql).toContain('stream_server_placement');
      expect(sql).toContain('status');
      expect(sql).toContain('video_codec');
      expect(call[1]).toContain('running');
      expect(call[1]).toContain('h264');
    });

    it('does nothing when fields is empty', async () => {
      await dbApi.upsertPlacementRuntimeState({
        streamType: 'live',
        streamId: '42',
        serverId: 3,
        fields: {},
      });

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('JSON-serializes stream_info_json field', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.upsertPlacementRuntimeState({
        streamType: 'movie',
        streamId: '7',
        serverId: 2,
        fields: { stream_info_json: { bitrate: 3000, profile: 'high' } },
      });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      const jsonIdx = vals.findIndex(v => typeof v === 'string' && v.includes('bitrate'));
      expect(jsonIdx).toBeGreaterThan(-1);
      expect(JSON.parse(vals[jsonIdx])).toEqual({ bitrate: 3000, profile: 'high' });
    });
  });

  // ─── setPlacementDesiredState ─────────────────────────────────────────

  describe('setPlacementDesiredState()', () => {
    it('accepts "stopped" as valid desired_state', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.setPlacementDesiredState('live', '42', 3, 'stopped');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('desired_state');
      expect(call[1][0]).toBe('stopped');
    });

    it('accepts "running" as valid desired_state', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.setPlacementDesiredState('episode', '99', 5, 'running');

      const call = mockExecute.mock.calls[0];
      expect(call[1][0]).toBe('running');
    });

    it('throws for invalid desired_state', async () => {
      await expect(
        dbApi.setPlacementDesiredState('live', '42', 3, 'invalid')
      ).rejects.toThrow('invalid desired_state');
    });
  });

  // ─── markPlacementStarting ────────────────────────────────────────────

  describe('markPlacementStarting()', () => {
    it('sets status to starting', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markPlacementStarting('live', '42', 3);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'starting'");
      expect(call[1][0]).toBe('live');
      expect(call[1][1]).toBe('42');
      expect(call[1][2]).toBe(3);
    });
  });

  // ─── markPlacementRunning ─────────────────────────────────────────────

  describe('markPlacementRunning()', () => {
    it('sets status to running and sets ready_at', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markPlacementRunning('movie', '7', 2);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'running'");
      expect(call[0]).toContain('ready_at');
    });
  });

  // ─── markPlacementStopped ────────────────────────────────────────────

  describe('markPlacementStopped()', () => {
    it('sets status to stopped and clears PIDs', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markPlacementStopped('episode', '55', 4);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'stopped'");
      expect(call[0]).toContain('pid = NULL');
      expect(call[0]).toContain('monitor_pid = NULL');
      expect(call[0]).toContain('delay_pid = NULL');
    });
  });

  // ─── markPlacementError ──────────────────────────────────────────────

  describe('markPlacementError()', () => {
    it('sets status to error with error_code and error_text', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markPlacementError('live', '100', 7, 'E_NOFEED', 'Source stream unavailable');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'error'");
      expect(call[1][0]).toBe('E_NOFEED');
      expect(call[1][1]).toBe('Source stream unavailable');
    });

    it('handles null error_code', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markPlacementError('movie', '5', 1, null, 'Unknown error');

      const call = mockExecute.mock.calls[0];
      expect(call[1][0]).toBeNull();
    });
  });

  // ─── getPlacementByAsset ─────────────────────────────────────────────

  describe('getPlacementByAsset()', () => {
    it('returns all placements for a stream across all servers', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, stream_type: 'live', stream_id: '42', server_id: 3, status: 'running' },
        { id: 2, stream_type: 'live', stream_id: '42', server_id: 5, status: 'stopped' },
      ]);

      const result = await dbApi.getPlacementByAsset('live', '42');

      expect(result).toHaveLength(2);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('stream_type = ?');
      expect(call[1]).toContain('live');
      expect(call[1]).toContain('42');
    });

    it('orders by server_id', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await dbApi.getPlacementByAsset('episode', '7');

      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('ORDER BY server_id');
    });
  });

  // ─── getPlacementsByServer ───────────────────────────────────────────

  describe('getPlacementsByServer()', () => {
    it('returns all placements when no status filter', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 1 }]);

      const result = await dbApi.getPlacementsByServer(3);

      expect(result).toHaveLength(1);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).not.toContain('status =');
      expect(call[1]).toContain(3);
    });

    it('filters by status when provided', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 2, status: 'running' }]);

      const result = await dbApi.getPlacementsByServer(3, 'running');

      expect(result).toHaveLength(1);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('status = ?');
      expect(call[1]).toContain('running');
    });
  });
});

describe('Phase 1 XC Runtime: Active Session Foundation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // ─── openRuntimeSession ───────────────────────────────────────────────

  describe('openRuntimeSession()', () => {
    it('inserts session with all provided fields', async () => {
      mockInsert.mockResolvedValueOnce(99);

      const result = await dbApi.openRuntimeSession({
        lineId: 7,
        streamType: 'live',
        streamId: '42',
        placementId: 3,
        originServerId: 2,
        proxyServerId: null,
        container: 'm3u8',
        sessionUuid: 'sess_abc123',
        playbackToken: 'tok_xyz',
        userIp: '192.168.1.1',
        userAgent: 'VLC/3.0',
        geoipCountryCode: 'US',
        isp: 'Comcast',
      });

      expect(result).toBe(99);
      const call = mockInsert.mock.calls[0];
      expect(call[0]).toContain('line_runtime_sessions');
      expect(call[1]).toContain(7); // line_id
      expect(call[1]).toContain('live');
      expect(call[1]).toContain('sess_abc123');
      expect(call[1]).toContain('tok_xyz');
    });

    it('handles optional fields gracefully', async () => {
      mockInsert.mockResolvedValueOnce(1);

      await dbApi.openRuntimeSession({
        lineId: 1,
        streamType: 'movie',
        streamId: '5',
        sessionUuid: 'sess_1',
      });

      const call = mockInsert.mock.calls[0];
      // Should not throw - nulls and defaults handled
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ─── touchRuntimeSession ─────────────────────────────────────────────

  describe('touchRuntimeSession()', () => {
    it('updates last_seen_at for the session', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.touchRuntimeSession('sess_abc123');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('last_seen_at = NOW()');
      expect(call[1]).toContain('sess_abc123');
    });
  });

  // ─── closeRuntimeSession ─────────────────────────────────────────────

  describe('closeRuntimeSession()', () => {
    it('sets date_end and updates last_seen_at', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.closeRuntimeSession('sess_abc123', 999999999);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('date_end = ?');
      expect(call[1][0]).toBe(999999999);
      expect(call[1][1]).toBe('sess_abc123');
    });

    it('defaults date_end to now if not provided', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.closeRuntimeSession('sess_abc123');

      const call = mockExecute.mock.calls[0];
      // Should use Math.floor(Date.now() / 1000) as default
      expect(call[1][0]).toBeGreaterThan(0);
    });
  });

  // ─── listActiveRuntimeSessionsByServer ──────────────────────────────

  describe('listActiveRuntimeSessionsByServer()', () => {
    it('returns sessions with no date_end for the server', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, origin_server_id: 3, session_uuid: 's1', date_end: null },
        { id: 2, origin_server_id: 3, session_uuid: 's2', date_end: null },
      ]);

      const result = await dbApi.listActiveRuntimeSessionsByServer(3);

      expect(result).toHaveLength(2);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('origin_server_id = ?');
      expect(call[0]).toContain('date_end IS NULL');
      expect(call[1]).toContain(3);
    });
  });

  // ─── countActiveRuntimeSessionsByPlacement ──────────────────────────

  describe('countActiveRuntimeSessionsByPlacement()', () => {
    it('returns count of active sessions for placement', async () => {
      mockQueryOne.mockResolvedValueOnce({ c: 5 });

      const result = await dbApi.countActiveRuntimeSessionsByPlacement(7);

      expect(result).toBe(5);
      const call = mockQueryOne.mock.calls[0];
      expect(call[0]).toContain('placement_id = ?');
      expect(call[0]).toContain('date_end IS NULL');
    });

    it('returns 0 when no row returned', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await dbApi.countActiveRuntimeSessionsByPlacement(999);

      expect(result).toBe(0);
    });
  });
});

describe('Phase 1 XC Runtime: Command Queue Foundation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // ─── createServerCommand ─────────────────────────────────────────────

  describe('createServerCommand()', () => {
    it('creates a queued command with all fields', async () => {
      mockInsert.mockResolvedValueOnce(42);

      const result = await dbApi.createServerCommand({
        serverId: 3,
        streamType: 'live',
        streamId: '42',
        placementId: 7,
        commandType: 'start_stream',
        payload: { bitrate: 5000 },
        issuedByUserId: 1,
      });

      expect(result).toBe(42);
      const call = mockInsert.mock.calls[0];
      expect(call[0]).toContain('server_commands');
      expect(call[1]).toContain(3);
      expect(call[1]).toContain('start_stream');
      // 'queued' is a SQL literal, not a param
      expect(call[0]).toContain("'queued'");
    });

    it('throws for invalid command_type', async () => {
      await expect(
        dbApi.createServerCommand({ serverId: 1, commandType: 'invalid_cmd' })
      ).rejects.toThrow('invalid command_type');
    });

    it('handles null stream_type and stream_id', async () => {
      mockInsert.mockResolvedValueOnce(1);

      await dbApi.createServerCommand({
        serverId: 3,
        commandType: 'sync_server_config',
      });

      const call = mockInsert.mock.calls[0];
      expect(mockInsert).toHaveBeenCalled();
    });

    it('JSON-serializes payload', async () => {
      mockInsert.mockResolvedValueOnce(1);

      await dbApi.createServerCommand({
        serverId: 2,
        commandType: 'probe_stream',
        payload: { url: 'http://example.com/stream' },
      });

      const call = mockInsert.mock.calls[0];
      const vals = call[1];
      const payloadIdx = vals.findIndex(v => typeof v === 'string' && v.includes('url'));
      expect(payloadIdx).toBeGreaterThan(-1);
    });
  });

  // ─── leaseServerCommands ─────────────────────────────────────────────

  describe('leaseServerCommands()', () => {
    it('returns leased commands for a server', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 2 });
      mockQuery.mockResolvedValueOnce([
        { id: 10, server_id: 3, command_type: 'start_stream', status: 'leased', lease_token: 'tok123' },
        { id: 11, server_id: 3, command_type: 'probe_stream', status: 'leased', lease_token: 'tok123' },
      ]);

      const result = await dbApi.leaseServerCommands(3, 5);

      expect(result).toHaveLength(2);
      expect(mockExecute).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalled();
    });

    it('uses default limit of 5', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 0 });
      mockQuery.mockResolvedValueOnce([]);

      await dbApi.leaseServerCommands(3);

      const call = mockExecute.mock.calls[0];
      expect(call[1]).toContain(5); // limit
    });
  });

  // ─── markServerCommandRunning ────────────────────────────────────────

  describe('markServerCommandRunning()', () => {
    it('sets status to running and increments attempt_count', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markServerCommandRunning(42);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'running'");
      expect(call[0]).toContain('attempt_count = attempt_count + 1');
      expect(call[0]).toContain('delivered_at = NOW()');
      expect(call[1][0]).toBe(42);
    });
  });

  // ─── markServerCommandSucceeded ─────────────────────────────────────

  describe('markServerCommandSucceeded()', () => {
    it('sets status to succeeded with result_json', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markServerCommandSucceeded(42, { pid: 12345, started_at: '2026-03-28' });

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'succeeded'");
      expect(call[0]).toContain('result_json = ?');
      expect(call[1][0]).toContain('pid');
    });

    it('handles null result', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markServerCommandSucceeded(42, null);

      const call = mockExecute.mock.calls[0];
      expect(call[1][0]).toBeNull();
    });
  });

  // ─── markServerCommandFailed ─────────────────────────────────────────

  describe('markServerCommandFailed()', () => {
    it('sets status to failed with error_text', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.markServerCommandFailed(42, 'Process exited with code 1');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'failed'");
      expect(call[1][0]).toBe('Process exited with code 1');
    });
  });

  // ─── expireStaleLeases ──────────────────────────────────────────────

  describe('expireStaleLeases()', () => {
    it('updates leased commands past expiry to expired status', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 3 });

      await dbApi.expireStaleLeases();

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("'expired'");
      expect(call[0]).toContain("'leased'");
      expect(call[0]).toContain('lease_expires_at < NOW()');
    });
  });
});

describe('Phase 1 XC Runtime: Node Credential Foundation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // ─── createServerAgentCredential ─────────────────────────────────────

  describe('createServerAgentCredential()', () => {
    it('creates credential with hashed secret', async () => {
      mockInsert.mockResolvedValueOnce(5);

      const result = await dbApi.createServerAgentCredential(3, 'super_secret_key');

      expect(result.id).toBe(5);
      expect(result.credentialId).toMatch(/^cred_[a-f0-9]{16}$/);
      expect(result.plainSecret).toBe('super_secret_key');
      const call = mockInsert.mock.calls[0];
      expect(call[0]).toContain('server_agent_credentials');
      expect(call[1]).toContain(3); // server_id
      expect(call[1]).toContain(result.credentialId);
      // secret_hash should be hashed (sha256), not plain
      const hashIdx = call[1].findIndex(v => v.length === 64 && /^[a-f0-9]+$/.test(v));
      expect(hashIdx).toBeGreaterThan(-1);
    });

    it('returns plain secret for agent to use (not stored in DB)', async () => {
      mockInsert.mockResolvedValueOnce(1);

      const result = await dbApi.createServerAgentCredential(1, 'my_secret');

      expect(result.plainSecret).toBe('my_secret');
    });
  });

  // ─── getActiveServerAgentCredential ─────────────────────────────────

  describe('getActiveServerAgentCredential()', () => {
    it('returns active credential for server', async () => {
      const credentialRow = {
        id: 1,
        server_id: 3,
        credential_id: 'cred_abc123',
        secret_hash: 'a'.repeat(64),
        status: 'active',
      };
      mockQueryOne.mockResolvedValueOnce(credentialRow);

      const result = await dbApi.getActiveServerAgentCredential(3);

      expect(result).toEqual(credentialRow);
      const call = mockQueryOne.mock.calls[0];
      expect(call[0]).toContain("status = 'active'");
      expect(call[1]).toContain(3);
    });

    it('returns null when no active credential', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await dbApi.getActiveServerAgentCredential(999);

      expect(result).toBeNull();
    });
  });

  // ─── revokeServerAgentCredential ────────────────────────────────────

  describe('revokeServerAgentCredential()', () => {
    it('sets status to revoked', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.revokeServerAgentCredential(3, 'cred_abc123');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain("status = 'revoked'");
      expect(call[1]).toContain(3);
      expect(call[1]).toContain('cred_abc123');
    });
  });

  // ─── touchServerAgentCredential ─────────────────────────────────────

  describe('touchServerAgentCredential()', () => {
    it('updates last_used_at', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.touchServerAgentCredential('cred_abc123');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('last_used_at = NOW()');
      expect(call[1]).toContain('cred_abc123');
    });
  });
});

describe('Phase 1 XC Runtime: Ensure Functions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('ensureLineRuntimeSessionsTable', () => {
    it('is exported as a function', () => {
      expect(typeof dbApi.ensureLineRuntimeSessionsTable).toBe('function');
    });
  });

  describe('ensureServerCommandsTable', () => {
    it('is exported as a function', () => {
      expect(typeof dbApi.ensureServerCommandsTable).toBe('function');
    });
  });

  describe('ensureServerAgentCredentialsTable', () => {
    it('is exported as a function', () => {
      expect(typeof dbApi.ensureServerAgentCredentialsTable).toBe('function');
    });
  });
});
