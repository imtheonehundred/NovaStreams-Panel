'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
}));

describe('line password migration and auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LINE_PASSWORD_SECRET = 'test-line-secret';
  });

  afterAll(() => {
    delete process.env.LINE_PASSWORD_SECRET;
  });

  it('migrates a legacy plain-text line password into hash+encrypted storage and clears password column', async () => {
    const dbApi = require('../../../lib/db');
    const mariadb = require('../../../lib/mariadb');
    mariadb.query.mockResolvedValueOnce([
      { id: 7, password: 'secret', password_hash: null, password_enc: null },
    ]);
    mariadb.execute.mockResolvedValue({ affectedRows: 1 });

    await dbApi.migrateLegacyLinePasswords();

    expect(mariadb.execute).toHaveBeenCalledWith(
      'UPDATE `lines` SET password = ?, password_hash = ?, password_enc = ? WHERE id = ?',
      ['', expect.any(String), expect.any(String), 7]
    );
    const values = mariadb.execute.mock.calls[0][1];
    expect(values[1]).not.toBe('secret');
    expect(values[2]).not.toBe('secret');
  });

  it('replaces a stale mixed-state hash when legacy password and stored hash disagree', async () => {
    const dbApi = require('../../../lib/db');
    const mariadb = require('../../../lib/mariadb');
    const staleHash = await dbApi.hashLinePassword('old-secret');
    mariadb.query.mockResolvedValueOnce([
      { id: 9, password: 'fresh-secret', password_hash: staleHash, password_enc: null },
    ]);
    mariadb.execute.mockResolvedValue({ affectedRows: 1 });

    await dbApi.migrateLegacyLinePasswords();

    const values = mariadb.execute.mock.calls[0][1];
    const migratedHash = values[1];
    expect(await dbApi.verifyLinePasswordHash('fresh-secret', migratedHash)).toBe(true);
    expect(await dbApi.verifyLinePasswordHash('old-secret', migratedHash)).toBe(false);
  });

  it('does not auto-hydrate decrypted password on ordinary line reads', async () => {
    const dbApi = require('../../../lib/db');
    const mariadb = require('../../../lib/mariadb');
    const passwordEnc = dbApi.encryptLinePassword('secret');
    mariadb.queryOne.mockResolvedValueOnce({ id: 7, username: 'alice', password: '', password_enc: passwordEnc, password_hash: 'x' });

    const row = await dbApi.getLineById(7);

    expect(row.password).toBe('');
    expect(dbApi.attachLinePassword(row).password).toBe('secret');
  });

  it('authenticates a migrated line via password_hash and preserves the provided password for compatibility emitters', async () => {
    const dbApi = require('../../../lib/db');
    const lineService = require('../../../services/lineService');
    const passwordHash = await dbApi.hashLinePassword('secret');

    jest.spyOn(dbApi, 'getLineByUsername').mockResolvedValue({
      id: 7,
      username: 'alice',
      password: '',
      password_hash: passwordHash,
      password_enc: 'ciphertext',
      admin_enabled: 1,
      enabled: 1,
      exp_date: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await lineService.authenticateLine('alice', 'secret');

    expect(result.ok).toBe(true);
    expect(result.line.password).toBe('secret');
  });
});
