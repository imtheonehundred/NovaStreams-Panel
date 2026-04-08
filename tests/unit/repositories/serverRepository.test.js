'use strict';

const {
  addServerRelationship,
  removeServerRelationship,
  getServerRelationships,
  getServerChildren,
  createPlacement,
  updatePlacementClients,
  getPlacement,
  getActivePlacementsForServer,
  upsertPlacementRuntimeState,
  setPlacementDesiredState,
  markPlacementStarting,
  markPlacementRunning,
  markPlacementStopped,
  markPlacementError,
  getPlacementByAsset,
  getPlacementsByServer,
  openRuntimeSession,
  touchRuntimeSession,
  closeRuntimeSession,
  listActiveRuntimeSessionsByServer,
  countActiveRuntimeSessionsByPlacement,
  countActiveRuntimeSessionsByServer,
  getFailoverRelationships,
  getProxyRelationships,
  getOriginServersForProxy,
  reconcilePlacementClients,
  createServerCommand,
  leaseServerCommands,
  markServerCommandRunning,
  markServerCommandSucceeded,
  markServerCommandFailed,
  expireStaleLeases,
  createServerAgentCredential,
  getActiveServerAgentCredential,
  revokeServerAgentCredential,
  touchServerAgentCredential,
  rotateServerAgentCredential,
  getValidServerCredentials,
  revokeRotatingCredentials,
} = require('../../../repositories/serverRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/crypto', () => ({
  hashApiKey: jest.fn((key) => `hashed_${key}`),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from('randombytes')),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');

describe('Server Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('addServerRelationship', () => {
    it('should add server relationship', async () => {
      insert.mockResolvedValue(1);
      await addServerRelationship(1, 2, 'origin-proxy');
      expect(insert).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO server_relationships'),
        [1, 2, 'origin-proxy']
      );
    });

    it('should throw error for invalid relationship type', async () => {
      await expect(addServerRelationship(1, 2, 'invalid')).rejects.toThrow('invalid relationship_type');
    });
  });

  describe('removeServerRelationship', () => {
    it('should remove server relationship', async () => {
      execute.mockResolvedValue({});
      await removeServerRelationship(1, 2, 'origin-proxy');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM server_relationships'),
        [1, 2, 'origin-proxy']
      );
    });
  });

  describe('getServerRelationships', () => {
    it('should return relationships for server', async () => {
      const mockRels = [{ id: 1, parent_server_id: 1, child_server_id: 2 }];
      query.mockResolvedValue(mockRels);
      const result = await getServerRelationships(1);
      expect(result).toEqual(mockRels);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('parent_server_id = ?'), [1, 1]);
    });
  });

  describe('getServerChildren', () => {
    it('should return children without type filter', async () => {
      query.mockResolvedValue([]);
      await getServerChildren(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('parent_server_id = ?'), [1]);
    });

    it('should return children with type filter', async () => {
      query.mockResolvedValue([]);
      await getServerChildren(1, 'origin-proxy');
      expect(query).toHaveBeenCalledWith(expect.stringContaining('relationship_type = ?'), [1, 'origin-proxy']);
    });
  });

  describe('createPlacement', () => {
    it('should create placement', async () => {
      execute.mockResolvedValue({});
      await createPlacement({ streamType: 'live', streamId: 'abc123', serverId: 1 });
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("'running'"),
        ['live', 'abc123', 1]
      );
    });

    it('should convert streamId to string', async () => {
      execute.mockResolvedValue({});
      await createPlacement({ streamType: 'live', streamId: 12345, serverId: 1 });
      expect(execute).toHaveBeenCalledWith(expect.any(String), ['live', '12345', 1]);
    });
  });

  describe('updatePlacementClients', () => {
    it('should increment clients', async () => {
      execute.mockResolvedValue({});
      await updatePlacementClients('live', 'abc123', 1, 5);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("THEN 'running' ELSE 'stopped'"),
        ['live', 'abc123', 1]
      );
    });

    it('should decrement clients', async () => {
      execute.mockResolvedValue({});
      await updatePlacementClients('live', 'abc123', 1, -3);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('clients = GREATEST(0, clients -'),
        ['live', 'abc123', 1]
      );
    });
  });

  describe('getPlacement', () => {
    it('should return placement by keys', async () => {
      const mockPlacement = { id: 1, stream_type: 'live' };
      queryOne.mockResolvedValue(mockPlacement);
      const result = await getPlacement('live', 'abc123', 1);
      expect(result).toEqual(mockPlacement);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining('stream_type'),
        ['live', 'abc123', 1]
      );
    });
  });

  describe('getActivePlacementsForServer', () => {
    it('should return active placements', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getActivePlacementsForServer(1);
      expect(result).toEqual([{ id: 1 }]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('clients > 0'), [1]);
    });
  });

  describe('upsertPlacementRuntimeState', () => {
    it('should update placement fields', async () => {
      execute.mockResolvedValue({});
      await upsertPlacementRuntimeState({
        streamType: 'live',
        streamId: 'abc123',
        serverId: 1,
        fields: { status: 'running', pid: 12345 }
      });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][0]).toContain('UPDATE stream_server_placement SET');
      expect(execute.mock.calls[0][1]).toContain('running');
    });

    it('should stringify JSON fields', async () => {
      execute.mockResolvedValue({});
      await upsertPlacementRuntimeState({
        streamType: 'live',
        streamId: 'abc123',
        serverId: 1,
        fields: { stream_info_json: { key: 'value' } }
      });
      expect(execute.mock.calls[0][1]).toContain('{"key":"value"}');
    });

    it('should do nothing when no fields', async () => {
      await upsertPlacementRuntimeState({
        streamType: 'live',
        streamId: 'abc123',
        serverId: 1,
        fields: {}
      });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('setPlacementDesiredState', () => {
    it('should set desired state', async () => {
      execute.mockResolvedValue({});
      await setPlacementDesiredState('live', 'abc123', 1, 'running');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('desired_state'),
        ['running', 'live', 'abc123', 1]
      );
    });

    it('should throw error for invalid state', async () => {
      await expect(setPlacementDesiredState('live', 'abc123', 1, 'invalid')).rejects.toThrow('invalid desired_state');
    });
  });

  describe('markPlacementStarting', () => {
    it('should mark placement as starting', async () => {
      execute.mockResolvedValue({});
      await markPlacementStarting('live', 'abc123', 1);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'starting'"),
        ['live', 'abc123', 1]
      );
    });
  });

  describe('markPlacementRunning', () => {
    it('should mark placement as running with timestamp', async () => {
      execute.mockResolvedValue({});
      await markPlacementRunning('live', 'abc123', 1);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'running'"),
        ['live', 'abc123', 1]
      );
    });
  });

  describe('markPlacementStopped', () => {
    it('should mark placement as stopped', async () => {
      execute.mockResolvedValue({});
      await markPlacementStopped('live', 'abc123', 1);
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][0]).toContain('stopped');
    });
  });

  describe('markPlacementError', () => {
    it('should mark placement with error', async () => {
      execute.mockResolvedValue({});
      await markPlacementError('live', 'abc123', 1, 'ERR_CODE', 'Error message');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('error'),
        ['ERR_CODE', 'Error message', 'live', 'abc123', 1]
      );
    });

    it('should handle null error code and text', async () => {
      execute.mockResolvedValue({});
      await markPlacementError('live', 'abc123', 1, null, null);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('error'),
        [null, null, 'live', 'abc123', 1]
      );
    });
  });

  describe('getPlacementByAsset', () => {
    it('should return placements for stream', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getPlacementByAsset('live', 'abc123');
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('getPlacementsByServer', () => {
    it('should return all placements without status filter', async () => {
      query.mockResolvedValue([]);
      await getPlacementsByServer(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('server_id = ?'), [1]);
    });

    it('should filter by status', async () => {
      query.mockResolvedValue([]);
      await getPlacementsByServer(1, 'running');
      expect(query).toHaveBeenCalledWith(expect.stringContaining('status = ?'), [1, 'running']);
    });
  });

  describe('openRuntimeSession', () => {
    it('should open runtime session', async () => {
      insert.mockResolvedValue(1);
      const result = await openRuntimeSession({
        lineId: 1,
        streamType: 'live',
        streamId: 'abc123',
        placementId: 1,
        originServerId: 1,
        proxyServerId: 2,
        container: 'm3u8',
        sessionUuid: 'uuid-123',
        playbackToken: 'token-123',
        userIp: '192.168.1.1',
        userAgent: 'TestAgent',
        geoipCountryCode: 'US',
        isp: 'Comcast',
      });
      expect(result).toBe(1);
      expect(insert).toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      insert.mockResolvedValue(1);
      await openRuntimeSession({
        lineId: 1,
        streamType: 'live',
        streamId: 'abc123',
        sessionUuid: 'uuid-123',
      });
      expect(insert).toHaveBeenCalled();
    });
  });

  describe('touchRuntimeSession', () => {
    it('should update last_seen_at', async () => {
      execute.mockResolvedValue({});
      await touchRuntimeSession('uuid-123');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('last_seen_at = NOW()'),
        ['uuid-123']
      );
    });
  });

  describe('closeRuntimeSession', () => {
    it('should close session with timestamp', async () => {
      execute.mockResolvedValue({});
      await closeRuntimeSession('uuid-123', 1234567890);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('date_end'),
        [1234567890, 'uuid-123']
      );
    });
  });

  describe('listActiveRuntimeSessionsByServer', () => {
    it('should return active sessions', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await listActiveRuntimeSessionsByServer(1);
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('countActiveRuntimeSessionsByPlacement', () => {
    it('should return count', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      const result = await countActiveRuntimeSessionsByPlacement(1);
      expect(result).toBe(5);
    });

    it('should return 0 when no rows', async () => {
      queryOne.mockResolvedValue(null);
      const result = await countActiveRuntimeSessionsByPlacement(1);
      expect(result).toBe(0);
    });
  });

  describe('countActiveRuntimeSessionsByServer', () => {
    it('should return count', async () => {
      queryOne.mockResolvedValue({ c: 10 });
      const result = await countActiveRuntimeSessionsByServer(1);
      expect(result).toBe(10);
    });
  });

  describe('getFailoverRelationships', () => {
    it('should return failover relationships', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getFailoverRelationships(1);
      expect(result).toEqual([{ id: 1 }]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('failover'));
    });
  });

  describe('getProxyRelationships', () => {
    it('should return proxy relationships', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getProxyRelationships(1);
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('getOriginServersForProxy', () => {
    it('should return origin servers', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getOriginServersForProxy(1);
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('reconcilePlacementClients', () => {
    it('should reconcile client count', async () => {
      queryOne.mockResolvedValue({ c: 5 });
      execute.mockResolvedValue({});
      const result = await reconcilePlacementClients('live', 'abc123', 1);
      expect(result).toBeUndefined();
      expect(execute).toHaveBeenCalled();
    });
  });

  describe('createServerCommand', () => {
    it('should create server command', async () => {
      insert.mockResolvedValue(1);
      await createServerCommand({
        serverId: 1,
        streamType: 'live',
        streamId: 'abc123',
        commandType: 'start_stream',
      });
      expect(insert).toHaveBeenCalledWith(
        expect.stringContaining('server_commands'),
        [1, 'live', 'abc123', null, 'start_stream', null, null]
      );
    });

    it('should throw error for invalid command type', async () => {
      await expect(createServerCommand({
        serverId: 1,
        commandType: 'invalid',
      })).rejects.toThrow('invalid command_type');
    });
  });

  describe('leaseServerCommands', () => {
    it('should lease commands', async () => {
      execute.mockResolvedValue({});
      query.mockResolvedValue([{ id: 1 }]);
      await leaseServerCommands(1, 5);
      expect(execute).toHaveBeenCalled();
      expect(query).toHaveBeenCalled();
    });
  });

  describe('markServerCommandRunning', () => {
    it('should mark command as running', async () => {
      execute.mockResolvedValue({});
      await markServerCommandRunning(1);
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'running'"),
        [1]
      );
    });
  });

  describe('markServerCommandSucceeded', () => {
    it('should mark command as succeeded', async () => {
      execute.mockResolvedValue({});
      await markServerCommandSucceeded(1, { result: 'ok' });
      expect(execute).toHaveBeenCalled();
    });
  });

  describe('markServerCommandFailed', () => {
    it('should mark command as failed', async () => {
      execute.mockResolvedValue({});
      await markServerCommandFailed(1, 'Error message');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'failed'"),
        ['Error message', 1]
      );
    });
  });

  describe('expireStaleLeases', () => {
    it('should expire stale leases', async () => {
      execute.mockResolvedValue({});
      await expireStaleLeases();
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("status = 'expired'")
      );
    });
  });

  describe('createServerAgentCredential', () => {
    it('should create agent credential', async () => {
      insert.mockResolvedValue(1);
      const result = await createServerAgentCredential(1, 'secret123');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('credentialId');
      expect(result).toHaveProperty('plainSecret');
      expect(insert).toHaveBeenCalled();
    });
  });

  describe('getActiveServerAgentCredential', () => {
    it('should return active credential', async () => {
      queryOne.mockResolvedValue({ id: 1 });
      const result = await getActiveServerAgentCredential(1);
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('revokeServerAgentCredential', () => {
    it('should revoke credential', async () => {
      execute.mockResolvedValue({});
      await revokeServerAgentCredential(1, 'cred_123');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        [1, 'cred_123']
      );
    });
  });

  describe('touchServerAgentCredential', () => {
    it('should update last_used_at', async () => {
      execute.mockResolvedValue({});
      await touchServerAgentCredential('cred_123');
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('last_used_at'),
        ['cred_123']
      );
    });
  });

  describe('rotateServerAgentCredential', () => {
    it('should rotate credential', async () => {
      execute.mockResolvedValue({});
      insert.mockResolvedValue(1);
      queryOne.mockResolvedValue({ id: 1 });
      const result = await rotateServerAgentCredential(1, 'newsecret');
      expect(result).toHaveProperty('newCredential');
      expect(result).toHaveProperty('oldCredential');
    });
  });

  describe('getValidServerCredentials', () => {
    it('should return valid credentials', async () => {
      query.mockResolvedValue([{ id: 1 }]);
      const result = await getValidServerCredentials(1);
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('revokeRotatingCredentials', () => {
    it('should revoke rotating credentials', async () => {
      execute.mockResolvedValue({ affectedRows: 2 });
      const result = await revokeRotatingCredentials(1);
      expect(result).toBe(2);
    });
  });
});
