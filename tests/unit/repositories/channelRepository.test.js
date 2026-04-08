'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

const { queryOne, execute } = require('../../../lib/mariadb');
const {
  insertChannel,
  updateChannelRow,
  ConflictError,
} = require('../../../repositories/channelRepository');

describe('channelRepository optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets version=1 on insert', async () => {
    const channel = { name: 'Test', userId: 5 };

    await insertChannel('abcd1234', 5, channel);

    expect(execute).toHaveBeenCalledWith(
      'INSERT INTO channels (id, user_id, json_data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      expect.any(Array)
    );
    expect(channel.version).toBe(1);
  });

  it('increments version on successful update', async () => {
    const channel = { name: 'Updated', userId: 5, version: 3 };
    queryOne.mockResolvedValueOnce({
      json_data: JSON.stringify({ name: 'Old' }),
      version: 3,
    });
    execute.mockResolvedValueOnce({ affectedRows: 1 });

    const nextVersion = await updateChannelRow('abcd1234', 5, channel, 3);

    expect(nextVersion).toBe(4);
    expect(channel.version).toBe(4);
  });

  it('throws ConflictError when expected version does not match', async () => {
    const channel = { name: 'Updated', userId: 5, version: 3 };
    queryOne
      .mockResolvedValueOnce({
        json_data: JSON.stringify({ name: 'Old' }),
        version: 3,
      })
      .mockResolvedValueOnce({ version: 4 });
    execute.mockResolvedValueOnce({ affectedRows: 0 });

    await expect(
      updateChannelRow('abcd1234', 5, channel, 3)
    ).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      currentVersion: 4,
    });
    expect(ConflictError).toBeDefined();
  });
});
