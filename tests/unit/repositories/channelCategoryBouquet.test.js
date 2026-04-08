'use strict';

const channelRepo = require('../../../repositories/channelRepository');
const categoryRepo = require('../../../repositories/categoryRepository');
const bouquetRepo = require('../../../repositories/bouquetRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../lib/mysql-datetime', () => ({
  toMysqlDatetimeUtc: jest.fn(v => v),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');

describe('Channel Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('insertChannel', () => {
    it('should insert channel with stripped volatile data', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      const channel = { name: 'Test', status: 'running', hlsUrl: 'http://test', error: 'none' };
      await channelRepo.insertChannel(1, 1, channel);
      expect(execute).toHaveBeenCalled();
      const [sql, params] = execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO channels');
      expect(params[0]).toBe(1);
      expect(params[1]).toBe(1);
      const jsonData = JSON.parse(params[2]);
      expect(jsonData.status).toBe('stopped');
      expect(jsonData.hlsUrl).toBeNull();
      expect(jsonData.error).toBeNull();
    });
  });

  describe('updateChannelRow', () => {
    it('should update channel and merge with existing data', async () => {
      queryOne.mockResolvedValue({ json_data: '{"name":"Old"}' });
      execute.mockResolvedValue({ affectedRows: 1 });
      const result = await channelRepo.updateChannelRow(1, 1, { name: 'New' });
      expect(result).toBe(true);
      expect(execute).toHaveBeenCalled();
    });

    it('should return false if channel not found', async () => {
      queryOne.mockResolvedValue(null);
      const result = await channelRepo.updateChannelRow(1, 1, { name: 'New' });
      expect(result).toBe(false);
    });
  });

  describe('deleteChannelRow', () => {
    it('should delete channel by id', async () => {
      remove.mockResolvedValue(1);
      const result = await channelRepo.deleteChannelRow(1, 1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM channels WHERE id = ? AND user_id = ?', [1, 1]);
      expect(result).toBe(1);
    });
  });

  describe('listChannelRowsForUser', () => {
    it('should list channels for user', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await channelRepo.listChannelRowsForUser(1);
      expect(query).toHaveBeenCalledWith('SELECT id, user_id, json_data FROM channels WHERE user_id = ?', [1]);
      expect(result).toHaveLength(2);
    });
  });

  describe('listAllChannelRows', () => {
    it('should list all channels', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await channelRepo.listAllChannelRows();
      expect(query).toHaveBeenCalledWith('SELECT id, user_id, json_data FROM channels');
      expect(result).toHaveLength(2);
    });
  });

  describe('upsertChannelHealth', () => {
    it('should upsert channel health with clamped score', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      const result = await channelRepo.upsertChannelHealth(1, 1, 150, 'Good', { meta: true });
      expect(execute).toHaveBeenCalled();
      expect(result.stability_score).toBe(100);
    });

    it('should clamp negative scores to 0', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      const result = await channelRepo.upsertChannelHealth(1, 1, -50, 'Bad', {});
      expect(result.stability_score).toBe(0);
    });
  });

  describe('getChannelHealth', () => {
    it('should get channel health', async () => {
      queryOne.mockResolvedValue({ channel_id: 1, stability_score: 95 });
      const result = await channelRepo.getChannelHealth(1, 1);
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT channel_id, stability_score, last_checked, status_text, meta_json FROM channel_health WHERE channel_id = ? AND user_id = ?',
        [1, 1]
      );
      expect(result.stability_score).toBe(95);
    });
  });

  describe('insertQoeMetric', () => {
    it('should insert QoE metric row', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      const row = { channel_id: 1, user_id: 1, startup_ms: 100, buffer_events: 2, buffer_duration_ms: 500, errors: 0, latency_ms: 50, bitrate_switches: 1, dropped_frames: 0, playback_ms: 5000, qoe_score: 85 };
      await channelRepo.insertQoeMetric(row);
      expect(execute).toHaveBeenCalled();
    });
  });

  describe('getQoeHistory', () => {
    it('should get QoE history with limit', async () => {
      query.mockResolvedValue([{ startup_ms: 100 }]);
      const result = await channelRepo.getQoeHistory(1, 1, 30);
      expect(query).toHaveBeenCalledWith(
        'SELECT created_at, startup_ms, buffer_events, buffer_duration_ms, errors, latency_ms, qoe_score FROM qoe_metrics WHERE channel_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?',
        [1, 1, 30]
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('getQoeAgg', () => {
    it('should get QoE aggregated data', async () => {
      queryOne.mockResolvedValue({ channel_id: 1, qoe_score: 90 });
      const result = await channelRepo.getQoeAgg(1, 1);
      expect(queryOne).toHaveBeenCalledWith(
        'SELECT channel_id, last_qoe_at, qoe_score, final_score, avg_startup_ms, avg_buffer_ratio, avg_latency_ms FROM qoe_agg WHERE channel_id = ? AND user_id = ?',
        [1, 1]
      );
      expect(result.qoe_score).toBe(90);
    });
  });

  describe('upsertQoeAgg', () => {
    it('should upsert QoE aggregated data', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      const data = { last_qoe_at: '2024-01-01', qoe_score: 85, final_score: 87, avg_startup_ms: 100, avg_buffer_ratio: 0.5, avg_latency_ms: 50 };
      await channelRepo.upsertQoeAgg(1, 1, data);
      expect(execute).toHaveBeenCalled();
    });
  });
});

describe('Category Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listCategories', () => {
    it('should list all categories when no type provided', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await categoryRepo.listCategories();
      expect(query).toHaveBeenCalledWith('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories ORDER BY cat_order, id');
      expect(result).toHaveLength(2);
    });

    it('should filter by type when provided', async () => {
      query.mockResolvedValue([{ id: 1, category_type: 'live' }]);
      const result = await categoryRepo.listCategories('live');
      expect(query).toHaveBeenCalledWith('SELECT id, category_type, category_name, parent_id, cat_order, is_adult FROM stream_categories WHERE category_type = ? ORDER BY cat_order, id', ['live']);
      expect(result).toHaveLength(1);
    });
  });

  describe('getCategoryById', () => {
    it('should get category by id', async () => {
      queryOne.mockResolvedValue({ id: 1, category_name: 'Sports' });
      const result = await categoryRepo.getCategoryById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM stream_categories WHERE id = ?', [1]);
      expect(result.category_name).toBe('Sports');
    });
  });

  describe('createCategory', () => {
    it('should create category with defaults', async () => {
      insert.mockResolvedValue(5);
      const result = await categoryRepo.createCategory({});
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO stream_categories (category_type, category_name, parent_id, cat_order, is_adult) VALUES (?, ?, ?, ?, ?)',
        ['live', 'New', 0, 0, 0]
      );
      expect(result).toBe(5);
    });

    it('should create category with provided data', async () => {
      insert.mockResolvedValue(6);
      const data = { category_type: 'movie', category_name: 'Action', parent_id: 1, cat_order: 5, is_adult: 1 };
      await categoryRepo.createCategory(data);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO stream_categories (category_type, category_name, parent_id, cat_order, is_adult) VALUES (?, ?, ?, ?, ?)',
        ['movie', 'Action', 1, 5, 1]
      );
    });
  });

  describe('updateCategory', () => {
    it('should update category fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await categoryRepo.updateCategory(1, { category_name: 'Updated' });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE stream_categories');
    });

    it('should do nothing if no fields provided', async () => {
      await categoryRepo.updateCategory(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteCategory', () => {
    it('should delete category by id', async () => {
      remove.mockResolvedValue(1);
      const result = await categoryRepo.deleteCategory(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM stream_categories WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});

describe('Bouquet Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listBouquets', () => {
    it('should list all bouquets', async () => {
      query.mockResolvedValue([{ id: 1, bouquet_name: 'Sports' }]);
      const result = await bouquetRepo.listBouquets();
      expect(query).toHaveBeenCalledWith('SELECT * FROM bouquets ORDER BY bouquet_order, id');
      expect(result).toHaveLength(1);
    });
  });

  describe('getBouquetById', () => {
    it('should get bouquet by id', async () => {
      queryOne.mockResolvedValue({ id: 1, bouquet_name: 'Sports' });
      const result = await bouquetRepo.getBouquetById(1);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM bouquets WHERE id = ?', [1]);
      expect(result.bouquet_name).toBe('Sports');
    });
  });

  describe('getBouquetsByIds', () => {
    it('should return empty array for empty ids', async () => {
      const result = await bouquetRepo.getBouquetsByIds([]);
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('should get bouquets by ids', async () => {
      query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await bouquetRepo.getBouquetsByIds([1, 2]);
      expect(query).toHaveBeenCalledWith('SELECT * FROM bouquets WHERE id IN (?,?)', [1, 2]);
      expect(result).toHaveLength(2);
    });
  });

  describe('createBouquet', () => {
    it('should create bouquet with defaults', async () => {
      insert.mockResolvedValue(1);
      const result = await bouquetRepo.createBouquet({});
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO bouquets (bouquet_name, bouquet_channels, bouquet_movies, bouquet_radios, bouquet_series, bouquet_order) VALUES (?, ?, ?, ?, ?, ?)',
        ['New Bouquet', '[]', '[]', '[]', '[]', 0]
      );
      expect(result).toBe(1);
    });

    it('should create bouquet with provided data', async () => {
      insert.mockResolvedValue(2);
      const data = { bouquet_name: 'My Bouquet', bouquet_channels: [1, 2], bouquet_movies: [3], bouquet_radios: [], bouquet_series: [4], bouquet_order: 5 };
      await bouquetRepo.createBouquet(data);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO bouquets (bouquet_name, bouquet_channels, bouquet_movies, bouquet_radios, bouquet_series, bouquet_order) VALUES (?, ?, ?, ?, ?, ?)',
        ['My Bouquet', '[1,2]', '[3]', '[]', '[4]', 5]
      );
    });
  });

  describe('updateBouquet', () => {
    it('should update bouquet fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await bouquetRepo.updateBouquet(1, { bouquet_name: 'Updated', bouquet_order: 10 });
      expect(execute).toHaveBeenCalled();
      const [sql] = execute.mock.calls[0];
      expect(sql).toContain('UPDATE bouquets');
    });

    it('should JSON stringify array fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await bouquetRepo.updateBouquet(1, { bouquet_channels: [1, 2] });
      expect(execute).toHaveBeenCalled();
      const [, params] = execute.mock.calls[0];
      expect(params).toContain('[1,2]');
    });

    it('should do nothing if no fields provided', async () => {
      await bouquetRepo.updateBouquet(1, {});
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteBouquet', () => {
    it('should delete bouquet by id', async () => {
      remove.mockResolvedValue(1);
      const result = await bouquetRepo.deleteBouquet(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM bouquets WHERE id = ?', [1]);
      expect(result).toBe(1);
    });
  });
});
