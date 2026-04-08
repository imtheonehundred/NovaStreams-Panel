'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/db', () => ({
  getSetting: jest.fn(),
  createPlacement: jest.fn(),
  getServerRelationships: jest.fn(),
  getEffectiveEpisodeServerId: jest.fn(),
  getPlacementByAsset: jest.fn(),
  getPlacementsByServer: jest.fn(),
  getFailoverRelationships: jest.fn(),
  getProxyRelationships: jest.fn(),
  getOriginServersForProxy: jest.fn(),
}));

jest.mock('../../../lib/public-stream-origin', () => ({
  publicStreamOrigin: jest.fn(),
}));

const { query, queryOne, insert } = require('../../../lib/mariadb');
const serverService = require('../../../services/serverService');

describe('serverService Phase 1 hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encrypts admin passwords before storing them', async () => {
    insert.mockResolvedValue(1);
    queryOne.mockResolvedValue({ id: 1, role: 'edge', meta_json: null });
    query.mockResolvedValue([]);

    await serverService.createServer({
      name: 'Secure Server',
      admin_password: 'rootpass123',
    });

    const insertArgs = insert.mock.calls[0][1];
    expect(insertArgs).toContainEqual(expect.stringMatching(/^v1:/));
    expect(insertArgs).not.toContain('rootpass123');
  });
});
