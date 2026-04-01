'use strict';

/**
 * Phase 2A Assignment Contract Tests
 *
 * These tests verify that the Phase 1 LB assignment foundations are correct:
 * - episode.stream_server_id saves and inherits correctly
 * - series.stream_server_id as series default works
 * - movies.stream_server_id behavior is preserved
 * - lines.force_server_id save/update/load works correctly
 * - getEffectiveEpisodeServerId() resolution chain is correct
 *
 * IMPORTANT: These tests do NOT verify selector policy or route consumers.
 * They only verify that assignment storage and inheritance resolution work correctly.
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

describe('Phase 2A Assignment Contract Tests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockExecute.mockReset();
    mockInsert.mockReset();
    mockRemove.mockReset();
  });

  // ─── Episode Assignment Storage ─────────────────────────────────────────

  describe('episode.stream_server_id storage', () => {
    /**
     * INSERT INTO episodes (series_id, season_num, episode_num, title, stream_url,
     *   stream_source, direct_source, container_extension, info_json,
     *   movie_properties, movie_subtitles, stream_server_id, added)
     * VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     * Index:  0         1          2         3        4          5             6              7                  8           9                10              11                  12
     */

    it('createEpisode stores stream_server_id=0 as 0 (inherit from series)', async () => {
      mockInsert.mockResolvedValueOnce(42);

      await dbApi.createEpisode({ series_id: 1, stream_server_id: 0 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[11]).toBe(0); // stream_server_id is at index 11
    });

    it('createEpisode stores explicit positive stream_server_id', async () => {
      mockInsert.mockResolvedValueOnce(42);

      await dbApi.createEpisode({ series_id: 1, stream_server_id: 7 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[11]).toBe(7);
    });

    it('createEpisode normalizes non-positive stream_server_id to 0', async () => {
      mockInsert.mockResolvedValueOnce(42);

      await dbApi.createEpisode({ series_id: 1, stream_server_id: -5 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[11]).toBe(0);
    });

    it('createEpisode treats undefined stream_server_id as 0', async () => {
      mockInsert.mockResolvedValueOnce(42);

      await dbApi.createEpisode({ series_id: 1 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[11]).toBe(0);
    });

    it('createEpisode treats NaN stream_server_id as 0', async () => {
      mockInsert.mockResolvedValueOnce(42);

      await dbApi.createEpisode({ series_id: 1, stream_server_id: NaN });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[11]).toBe(0);
    });

    it('updateEpisode sets stream_server_id to 0 when explicitly passed', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateEpisode(42, { stream_server_id: 0 });

      const call = mockExecute.mock.calls[0];
      const sql = call[0];
      const vals = call[1];
      expect(sql).toContain('stream_server_id');
      // vals: [...sets, stream_server_id, id] → stream_server_id is second-to-last
      expect(vals[vals.length - 2]).toBe(0);
    });

    it('updateEpisode sets explicit positive stream_server_id', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateEpisode(42, { stream_server_id: 11 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(11);
    });

    it('updateEpisode normalizes non-positive stream_server_id to 0', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateEpisode(42, { stream_server_id: -3 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(0);
    });

    it('updateEpisode ignores stream_server_id when undefined', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateEpisode(42, { title: 'New Title' });

      const call = mockExecute.mock.calls[0];
      const sql = call[0];
      expect(sql).not.toContain('stream_server_id');
    });

    it('getEpisodeById returns stream_server_id in full row', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 5, series_id: 1, stream_server_id: 9 });

      const ep = await dbApi.getEpisodeById(5);

      expect(ep).toEqual({ id: 5, series_id: 1, stream_server_id: 9 });
    });

    it('listEpisodes includes stream_server_id column in output', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, stream_server_id: 0 },
        { id: 2, stream_server_id: 7 },
      ]);

      const rows = await dbApi.listEpisodes(1);

      expect(rows[0].stream_server_id).toBe(0);
      expect(rows[1].stream_server_id).toBe(7);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('stream_server_id');
    });

    it('listAllEpisodes includes stream_server_id column in output', async () => {
      mockQueryOne.mockResolvedValueOnce({ c: 2 });
      mockQuery.mockResolvedValueOnce([
        { id: 1, stream_server_id: 5 },
        { id: 2, stream_server_id: 0 },
      ]);

      const result = await dbApi.listAllEpisodes({});

      expect(result.episodes[0].stream_server_id).toBe(5);
      expect(result.episodes[1].stream_server_id).toBe(0);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('stream_server_id');
    });
  });

  // ─── Series Assignment Storage ─────────────────────────────────────────

  describe('series.stream_server_id storage', () => {
    /**
     * INSERT INTO series (title, category_id, cover, cover_big, plot, series_cast,
     *   director, genre, rating, rating_5based, release_date, backdrop_path,
     *   year, youtube_trailer, episode_run_time, seasons, similar, stream_server_id)
     * VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     * Index:   0        1           2       3         4       5            6
     *          7        8           9       10        11      12           13
     *          14       15          16      17
     * stream_server_id is at index 17
     */

    it('createSeries stores stream_server_id=0 as series default', async () => {
      mockInsert.mockResolvedValueOnce(3);

      await dbApi.createSeries({ title: 'Test Series', stream_server_id: 0 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[17]).toBe(0); // stream_server_id is at index 17
    });

    it('createSeries stores explicit positive stream_server_id', async () => {
      mockInsert.mockResolvedValueOnce(3);

      await dbApi.createSeries({ title: 'Test Series', stream_server_id: 5 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[17]).toBe(5);
    });

    it('updateSeriesRow sets explicit positive stream_server_id', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateSeriesRow(3, { stream_server_id: 8 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(8);
    });

    it('updateSeriesRow normalizes non-positive stream_server_id to 0', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateSeriesRow(3, { stream_server_id: -1 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(0);
    });
  });

  // ─── Movie Assignment Storage ──────────────────────────────────────────

  describe('movies.stream_server_id storage', () => {
    /**
     * INSERT INTO movies (name, stream_url, stream_source, category_id, stream_icon,
     *   rating, rating_5based, plot, movie_cast, director, genre, duration,
     *   duration_secs, container_extension, movie_properties, tmdb_id, backdrop_path,
     *   year, subtitles_json, release_date, youtube_trailer, country, similar,
     *   stream_server_id, added)
     * VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     * Index:  0        1           2             3           4            5
     *         6            7        8           9         10       11         12
     *         13                  14        15            16       17           18
     *         19              20           21        22        23                 24
     * stream_server_id is at index 23
     */

    it('createMovie stores stream_server_id=0 correctly', async () => {
      mockInsert.mockResolvedValueOnce(99);

      await dbApi.createMovie({ name: 'Test Movie', stream_server_id: 0 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[23]).toBe(0); // stream_server_id at index 23
    });

    it('createMovie stores explicit positive stream_server_id', async () => {
      mockInsert.mockResolvedValueOnce(99);

      await dbApi.createMovie({ name: 'Test Movie', stream_server_id: 6 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[23]).toBe(6);
    });

    it('updateMovie sets explicit stream_server_id', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateMovie(99, { stream_server_id: 12 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(12);
    });

    it('updateMovie normalizes non-positive stream_server_id to 0', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateMovie(99, { stream_server_id: -4 });

      const call = mockExecute.mock.calls[0];
      const vals = call[1];
      expect(vals[vals.length - 2]).toBe(0);
    });
  });

  // ─── Line Assignment Storage ───────────────────────────────────────────

  describe('lines.force_server_id storage', () => {
    /**
     * INSERT INTO lines (username, password, password_hash, password_enc, member_id, exp_date, admin_enabled, enabled,
     *   bouquet, allowed_outputs, max_connections, is_trial, is_mag, is_e2, is_restreamer,
     *   allowed_ips, allowed_ua, forced_country, is_isplock, package_id, contact,
     *   force_server_id, bypass_ua, access_token, created_at)
     * VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     * force_server_id is at index 21, bypass_ua at 22
     */

    it('createLine stores force_server_id=0 as default', async () => {
      mockInsert.mockResolvedValueOnce(7);

      await dbApi.createLine({ username: 'alice', password: 'secret', package_id: 1, force_server_id: 0 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[21]).toBe(0);
    });

    it('createLine stores explicit positive force_server_id', async () => {
      mockInsert.mockResolvedValueOnce(7);

      await dbApi.createLine({ username: 'alice', password: 'secret', package_id: 1, force_server_id: 5 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[21]).toBe(5);
    });

    it('createLine handles undefined force_server_id as 0', async () => {
      mockInsert.mockResolvedValueOnce(7);

      await dbApi.createLine({ username: 'alice', password: 'secret', package_id: 1 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[21]).toBe(0);
    });

    it('createLine stores bypass_ua correctly', async () => {
      mockInsert.mockResolvedValueOnce(7);

      await dbApi.createLine({ username: 'alice', password: 'secret', package_id: 1, bypass_ua: 1 });

      const call = mockInsert.mock.calls[0];
      const values = call[1];
      expect(values[22]).toBe(1);
    });

    it('updateLine sets force_server_id explicitly', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updateLine(7, { force_server_id: 11 });

      const call = mockExecute.mock.calls[0];
      const sql = call[0];
      const vals = call[1];
      expect(sql).toContain('force_server_id');
      expect(vals[vals.length - 2]).toBe(11);
    });

    it('listLines includes force_server_id in SELECT without member_id filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ c: 1 });
      mockQuery.mockResolvedValueOnce([
        { id: 1, username: 'alice', force_server_id: 5 },
      ]);

      const result = await dbApi.listLines();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('force_server_id');
      expect(result.lines[0].force_server_id).toBe(5);
    });

    it('listLines includes force_server_id in SELECT with member_id filter', async () => {
      mockQueryOne.mockResolvedValueOnce({ c: 1 });
      mockQuery.mockResolvedValueOnce([
        { id: 2, username: 'bob', force_server_id: 9 },
      ]);

      const result = await dbApi.listLines(1);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('force_server_id');
      expect(result.lines[0].force_server_id).toBe(9);
    });
  });

  // ─── Inheritance Resolution ───────────────────────────────────────────

  describe('getEffectiveEpisodeServerId() inheritance resolution', () => {
    /**
     * Resolution order: episode override → series default → default_stream_server_id setting → 0
     * Calls queryOne exactly once for the episode row if override exists (override > 0)
     * Calls queryOne twice if series fallback is needed (episode override = 0, series > 0)
     * Calls queryOne three times if settings fallback is needed (both episode and series = 0, default > 0)
     */

    it('returns episode override when episode.stream_server_id > 0', async () => {
      // Only episode query needed
      mockQueryOne.mockResolvedValueOnce({ stream_server_id: 7, series_id: 1 });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(7);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('falls through to series when episode.stream_server_id === 0 and series has default', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 }) // episode
        .mockResolvedValueOnce({ stream_server_id: 9 });                // series

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(9);
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
    });

    it('episode value 0 correctly inherits from series', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })
        .mockResolvedValueOnce({ stream_server_id: 4 });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(4);
    });

    it('falls through to default_stream_server_id setting when series.stream_server_id === 0', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })  // episode
        .mockResolvedValueOnce({ stream_server_id: 0 })                // series
        .mockResolvedValueOnce({ value: '12' });                       // settings

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(12);
      expect(mockQueryOne).toHaveBeenCalledTimes(3);
    });

    it('falls through to default_stream_server_id when both episode and series are 0', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })  // episode = 0
        .mockResolvedValueOnce({ stream_server_id: 0 })                  // series = 0
        .mockResolvedValueOnce({ value: '8' });                          // settings

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(8);
    });

    it('returns 0 when no assignment exists anywhere', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })  // episode
        .mockResolvedValueOnce({ stream_server_id: 0 })                  // series
        .mockResolvedValueOnce(null);                                     // settings

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(0);
    });

    it('returns 0 when episode does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await dbApi.getEffectiveEpisodeServerId(999);

      expect(result).toBe(0);
    });

    it('series lookup is skipped when episode has explicit override', async () => {
      mockQueryOne.mockResolvedValueOnce({ stream_server_id: 7, series_id: 99 });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(7);
      expect(mockQueryOne).toHaveBeenCalledTimes(1); // episode only
    });

    it('settings lookup is skipped when series has explicit default', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })  // episode = 0
        .mockResolvedValueOnce({ stream_server_id: 11 });               // series has default

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(11);
      expect(mockQueryOne).toHaveBeenCalledTimes(2); // episode + series only
    });

    it('handles episode with null series_id gracefully (returns 0)', async () => {
      mockQueryOne.mockResolvedValueOnce({ stream_server_id: 0, series_id: null });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(0);
    });

    it('handles series row not found gracefully (returns 0)', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 999 })
        .mockResolvedValueOnce(null); // series not found

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(0);
    });

    it('handles settings row with non-numeric value (returns 0)', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })
        .mockResolvedValueOnce({ stream_server_id: 0 })
        .mockResolvedValueOnce({ value: 'invalid' });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(0); // NaN from parseInt should not be returned
    });

    it('handles settings row with 0 value (explicit 0 means no default, returns 0)', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ stream_server_id: 0, series_id: 5 })
        .mockResolvedValueOnce({ stream_server_id: 0 })
        .mockResolvedValueOnce({ value: '0' });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(0); // parseInt('0') = 0, but check is `def > 0` so 0 is falsy
    });

    it('parseInt handles string stream_server_id values from DB', async () => {
      mockQueryOne.mockResolvedValueOnce({ stream_server_id: '7', series_id: 1 });

      const result = await dbApi.getEffectiveEpisodeServerId(42);

      expect(result).toBe(7);
    });
  });

  // ─── Phase 1 Ensures ─────────────────────────────────────────────────

  describe('Phase 1 schema ensure functions exist and are callable', () => {
    it('ensureEpisodesStreamServerIdColumn is exported', () => {
      expect(typeof dbApi.ensureEpisodesStreamServerIdColumn).toBe('function');
    });

    it('ensureServerRelationshipsTable is exported', () => {
      expect(typeof dbApi.ensureServerRelationshipsTable).toBe('function');
    });

    it('ensureStreamServerPlacementTable is exported', () => {
      expect(typeof dbApi.ensureStreamServerPlacementTable).toBe('function');
    });

    it('getEffectiveEpisodeServerId is exported', () => {
      expect(typeof dbApi.getEffectiveEpisodeServerId).toBe('function');
    });
  });

  // ─── Server Relationship Helpers ──────────────────────────────────────

  describe('server_relationships repository helpers', () => {
    it('addServerRelationship creates relationship correctly', async () => {
      mockInsert.mockResolvedValueOnce(1);

      await dbApi.addServerRelationship(1, 2, 'origin-proxy');

      const call = mockInsert.mock.calls[0];
      expect(call[0]).toContain('server_relationships');
      expect(call[1]).toEqual([1, 2, 'origin-proxy']);
    });

    it('addServerRelationship rejects invalid relationship_type', async () => {
      await expect(
        dbApi.addServerRelationship(1, 2, 'invalid_type')
      ).rejects.toThrow('invalid relationship_type');
    });

    it('removeServerRelationship deletes relationship', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.removeServerRelationship(1, 2, 'origin-proxy');

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('DELETE FROM server_relationships');
    });

    it('getServerRelationships returns all relationships for a server (as parent or child)', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, parent_server_id: 1, child_server_id: 2, relationship_type: 'origin-proxy' },
      ]);

      const result = await dbApi.getServerRelationships(1);

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('server_relationships'),
        [1, 1]
      );
    });

    it('getServerChildren returns only children of a parent server', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, parent_server_id: 1, child_server_id: 3, relationship_type: 'lb-member' },
      ]);

      const result = await dbApi.getServerChildren(1);

      expect(result).toHaveLength(1);
      expect(result[0].child_server_id).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('server_relationships WHERE parent_server_id = ?'),
        [1]
      );
    });
  });

  // ─── Placement Helpers ────────────────────────────────────────────────

  describe('stream_server_placement repository helpers', () => {
    it('createPlacement inserts placement row with correct values', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.createPlacement({ streamType: 'episode', streamId: '42', serverId: 7 });

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('stream_server_placement');
      expect(call[1]).toEqual(['episode', '42', 7]);
    });

    it('updatePlacementClients updates client count with delta', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

      await dbApi.updatePlacementClients('live', '100', 3, 1);

      const call = mockExecute.mock.calls[0];
      expect(call[0]).toContain('GREATEST(0, clients');
      expect(call[1]).toContain('live');
      expect(call[1]).toContain('100');
    });

    it('getPlacement retrieves specific placement row', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, stream_type: 'movie', stream_id: '55', server_id: 4 });

      const result = await dbApi.getPlacement('movie', '55', 4);

      expect(result.stream_type).toBe('movie');
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('stream_server_placement'),
        ['movie', '55', 4]
      );
    });

    it('getActivePlacementsForServer returns active placements (clients > 0) for server', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, stream_type: 'live', clients: 5 },
        { id: 2, stream_type: 'movie', clients: 2 },
      ]);

      const result = await dbApi.getActivePlacementsForServer(3);

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('stream_server_placement'),
        [3]
      );
    });
  });
});
