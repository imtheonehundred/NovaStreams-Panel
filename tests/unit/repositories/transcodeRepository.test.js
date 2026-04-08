'use strict';

const {
  listTranscodeProfiles,
  getTranscodeProfile,
  createTranscodeProfile,
  updateTranscodeProfile,
  deleteTranscodeProfile,
} = require('../../../repositories/transcodeRepository');

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');

describe('Transcode Repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listTranscodeProfiles', () => {
    it('should return all transcode profiles', async () => {
      const mockProfiles = [
        { id: 1, name: 'Profile 1', output_mode: 'copy' },
        { id: 2, name: 'Profile 2', output_mode: 'h264' },
      ];
      query.mockResolvedValue(mockProfiles);
      const result = await listTranscodeProfiles();
      expect(result).toEqual(mockProfiles);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
      expect(query.mock.calls[0][0]).toContain('transcode_profiles');
    });
  });

  describe('getTranscodeProfile', () => {
    it('should return profile by id', async () => {
      const mockProfile = { id: 1, name: 'Test Profile' };
      queryOne.mockResolvedValue(mockProfile);
      const result = await getTranscodeProfile(1);
      expect(result).toEqual(mockProfile);
      expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ?'), [1]);
    });

    it('should return null for non-existent profile', async () => {
      queryOne.mockResolvedValue(null);
      const result = await getTranscodeProfile(999);
      expect(result).toBeNull();
    });
  });

  describe('createTranscodeProfile', () => {
    it('should create profile with defaults', async () => {
      insert.mockResolvedValue(1);
      await createTranscodeProfile({});
      expect(insert).toHaveBeenCalled();
      const callArgs = insert.mock.calls[0][1];
      expect(callArgs[0]).toBe('Untitled');
      expect(callArgs[1]).toBe('copy');
      expect(callArgs[2]).toBe('cpu_x264');
    });

    it('should create profile with provided data', async () => {
      insert.mockResolvedValue(2);
      const data = {
        name: 'Custom Profile',
        output_mode: 'h265',
        video_encoder: 'nvenc',
        x264_preset: 'fast',
        rendition_mode: 'adaptive',
        renditions: ['720p', '1080p'],
        audio_bitrate_k: 256,
        hls_segment_seconds: 6,
        hls_playlist_size: 15,
      };
      await createTranscodeProfile(data);
      expect(insert).toHaveBeenCalled();
      const callArgs = insert.mock.calls[0][1];
      expect(callArgs[0]).toBe('Custom Profile');
      expect(callArgs[1]).toBe('h265');
      expect(callArgs[2]).toBe('nvenc');
      expect(callArgs[4]).toBe('adaptive');
    });
  });

  describe('updateTranscodeProfile', () => {
    it('should update profile name', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateTranscodeProfile(1, { name: 'Updated Name' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][0]).toContain('UPDATE transcode_profiles SET');
      expect(execute.mock.calls[0][1]).toContain('Updated Name');
    });

    it('should update multiple fields', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateTranscodeProfile(1, {
        name: 'New Name',
        output_mode: 'h264',
        renditions: ['480p', '720p'],
      });
      expect(execute).toHaveBeenCalled();
      const sql = execute.mock.calls[0][0];
      expect(sql).toContain('`name`');
      expect(sql).toContain('`output_mode`');
      expect(sql).toContain('`renditions`');
    });

    it('should do nothing when no fields provided', async () => {
      await updateTranscodeProfile(1, {});
      expect(execute).not.toHaveBeenCalled();
    });

    it('should pass through audio_bitrate_k value as-is', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });
      await updateTranscodeProfile(1, { audio_bitrate_k: '192' });
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls[0][1]).toContain('192');
    });
  });

  describe('deleteTranscodeProfile', () => {
    it('should delete profile', async () => {
      remove.mockResolvedValue({ affectedRows: 1 });
      await deleteTranscodeProfile(1);
      expect(remove).toHaveBeenCalledWith('DELETE FROM transcode_profiles WHERE id = ?', [1]);
    });
  });
});
