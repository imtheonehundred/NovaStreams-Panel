'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  remove: jest.fn(),
  execute: jest.fn(),
  getPool: jest.fn(() => ({
    getConnection: jest.fn(),
  })),
}));

jest.mock('../../../lib/mysql-datetime', () => ({
  sanitizeSqlParams: jest.fn(v => v),
}));

const { query, queryOne, insert, remove, execute, getPool } = require('../../../lib/mariadb');
const epgRepo = require('../../../repositories/epgRepository');

describe('EPG Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listEpgSources', () => {
    it('should list all EPG sources', async () => {
      query.mockResolvedValue([{ id: 1, name: 'Source 1' }]);
      const result = await epgRepo.listEpgSources();
      expect(query).toHaveBeenCalledWith('SELECT * FROM epg_sources ORDER BY id');
      expect(result).toHaveLength(1);
    });
  });

  describe('createEpgSource', () => {
    it('should create EPG source with name and url', async () => {
      insert.mockResolvedValue(1);
      await epgRepo.createEpgSource('EPG1', 'http://example.com/epg.xml');
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO epg_sources (name, url) VALUES (?, ?)',
        ['EPG1', 'http://example.com/epg.xml']
      );
    });

    it('should use empty name if not provided', async () => {
      insert.mockResolvedValue(1);
      await epgRepo.createEpgSource('', 'http://example.com/epg.xml');
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO epg_sources (name, url) VALUES (?, ?)',
        ['', 'http://example.com/epg.xml']
      );
    });
  });

  describe('deleteEpgSource', () => {
    it('should delete EPG source by id', async () => {
      remove.mockResolvedValue(1);
      await epgRepo.deleteEpgSource(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM epg_sources WHERE id = ?', [1]);
    });
  });

  describe('updateEpgSourceTimestamp', () => {
    it('should update last_updated timestamp', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await epgRepo.updateEpgSourceTimestamp(1);
      expect(execute).toHaveBeenCalledWith('UPDATE epg_sources SET last_updated = NOW() WHERE id = ?', [1]);
    });
  });

  describe('clearEpgData', () => {
    it('should delete all EPG data', async () => {
      execute.mockResolvedValue({ affectedRows: 100 });
      await epgRepo.clearEpgData();
      expect(execute).toHaveBeenCalledWith('DELETE FROM epg_data');
    });
  });

  describe('insertEpgProgram', () => {
    it('should insert EPG program with defaults', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await epgRepo.insertEpgProgram(1, 'Title', 'Description', 1000, 2000, 'en');
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)',
        [1, 'Title', 'Description', 1000, 2000, 'en']
      );
    });

    it('should use default language if not provided', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await epgRepo.insertEpgProgram(1, 'Title', 'Description', 1000, 2000);
      expect(execute).toHaveBeenCalledWith(
        'INSERT INTO epg_data (channel_id, title, description, start, stop, lang) VALUES (?, ?, ?, ?, ?, ?)',
        [1, 'Title', 'Description', 1000, 2000, 'en']
      );
    });
  });

  describe('insertEpgBatch', () => {
    it('should return early for empty programs array', async () => {
      await epgRepo.insertEpgBatch([]);
      expect(insert).not.toHaveBeenCalled();
    });

    it('should batch insert programs in transaction', async () => {
      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      getPool.mockReturnValue({
        getConnection: jest.fn().mockResolvedValue(mockConn),
      });
      execute.mockResolvedValue({ affectedRows: 1 });

      await epgRepo.insertEpgBatch([
        { channel_id: 1, title: 'Prog1', description: 'Desc1', start: 1000, stop: 2000, lang: 'en' },
        { channel_id: 1, title: 'Prog2', description: 'Desc2', start: 2000, stop: 3000, lang: 'en' },
      ]);

      expect(mockConn.beginTransaction).toHaveBeenCalled();
      expect(mockConn.execute).toHaveBeenCalledTimes(2);
      expect(mockConn.commit).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn().mockRejectedValue(new Error('DB Error')),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };
      getPool.mockReturnValue({
        getConnection: jest.fn().mockResolvedValue(mockConn),
      });

      await expect(epgRepo.insertEpgBatch([
        { channel_id: 1, title: 'Prog1', start: 1000, stop: 2000 },
      ])).rejects.toThrow('DB Error');

      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });
  });

  describe('getEpgForChannel', () => {
    it('should get EPG for channel within time range', async () => {
      query.mockResolvedValue([{ id: 1, title: 'Prog1' }]);
      const result = await epgRepo.getEpgForChannel(1, 1000, 2000);
      expect(query).toHaveBeenCalledWith(
        'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? AND start < ? ORDER BY start',
        [1, 1000, 2000]
      );
      expect(result).toHaveLength(1);
    });

    it('should use default time range when not provided', async () => {
      query.mockResolvedValue([]);
      await epgRepo.getEpgForChannel(1);
      const [, params] = query.mock.calls[0];
      expect(params).toContain(0);
      expect(params).toContain(9999999999);
    });
  });

  describe('getShortEpg', () => {
    it('should get limited EPG for channel', async () => {
      query.mockResolvedValue([{ id: 1, title: 'Prog1' }]);
      const result = await epgRepo.getShortEpg(1, 4);
      expect(query).toHaveBeenCalledWith(
        'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data WHERE channel_id = ? AND stop > ? ORDER BY start LIMIT ?',
        [1, expect.any(Number), 4]
      );
    });

    it('should use default limit of 4', async () => {
      query.mockResolvedValue([]);
      await epgRepo.getShortEpg(1);
      const [, params] = query.mock.calls[0];
      expect(params[2]).toBe(4);
    });
  });

  describe('getAllEpgData', () => {
    it('should get all EPG data ordered by start', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await epgRepo.getAllEpgData();
      expect(query).toHaveBeenCalledWith(
        'SELECT id, channel_id, title, description, start, stop, lang FROM epg_data ORDER BY start'
      );
      expect(result).toHaveLength(2);
    });
  });
});
