'use strict';

jest.mock('../../../lib/mariadb', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  execute: jest.fn(),
  remove: jest.fn(),
}));

const { query, queryOne, insert, execute, remove } = require('../../../lib/mariadb');
const streamRepository = require('../../../repositories/streamRepository');

describe('streamRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listOutputFormats', () => {
    it('should return output formats', async () => {
      const rows = [{ id: 1, name: 'ts' }, { id: 2, name: 'm3u8' }];
      query.mockResolvedValue(rows);

      const result = await streamRepository.listOutputFormats();

      expect(result).toEqual(rows);
      expect(query).toHaveBeenCalledWith('SELECT * FROM output_formats ORDER BY id');
    });
  });

  describe('listStreamArguments', () => {
    it('should return all arguments when no category', async () => {
      const rows = [{ id: 1, name: 'arg1' }];
      query.mockResolvedValue(rows);

      const result = await streamRepository.listStreamArguments();

      expect(result).toEqual(rows);
      expect(query).toHaveBeenCalledWith('SELECT * FROM stream_arguments ORDER BY id');
    });

    it('should filter by category', async () => {
      const rows = [{ id: 1, name: 'video_args' }];
      query.mockResolvedValue(rows);

      const result = await streamRepository.listStreamArguments('video');

      expect(result).toEqual(rows);
      expect(query).toHaveBeenCalledWith('SELECT * FROM stream_arguments WHERE argument_cat = ? ORDER BY id', ['video']);
    });
  });

  describe('listProfiles', () => {
    it('should return profiles', async () => {
      const rows = [{ id: 1, profile_name: 'Profile 1' }];
      query.mockResolvedValue(rows);

      const result = await streamRepository.listProfiles();

      expect(result).toEqual(rows);
      expect(query).toHaveBeenCalledWith('SELECT * FROM profiles ORDER BY id');
    });
  });

  describe('getProfileById', () => {
    it('should return profile by id', async () => {
      const row = { id: 1, profile_name: 'Test', profile_options: '{}' };
      queryOne.mockResolvedValue(row);

      const result = await streamRepository.getProfileById(1);

      expect(result).toEqual(row);
      expect(queryOne).toHaveBeenCalledWith('SELECT * FROM profiles WHERE id = ?', [1]);
    });

    it('should return null when not found', async () => {
      queryOne.mockResolvedValue(null);

      const result = await streamRepository.getProfileById(999);

      expect(result).toBeNull();
    });
  });

  describe('createProfile', () => {
    it('should create profile with name and options', async () => {
      insert.mockResolvedValue(5);

      const result = await streamRepository.createProfile('Test Profile', { key: 'value' });

      expect(result).toBe(5);
      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO profiles (profile_name, profile_options) VALUES (?, ?)',
        ['Test Profile', '{"key":"value"}']
      );
    });

    it('should handle null options', async () => {
      insert.mockResolvedValue(1);

      await streamRepository.createProfile('Test Profile', null);

      expect(insert).toHaveBeenCalledWith(
        'INSERT INTO profiles (profile_name, profile_options) VALUES (?, ?)',
        ['Test Profile', '{}']
      );
    });
  });

  describe('updateProfile', () => {
    it('should update name and options', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await streamRepository.updateProfile(1, 'Updated Name', { new: 'options' });

      expect(execute).toHaveBeenCalledWith(
        'UPDATE profiles SET profile_name = ?, profile_options = ? WHERE id = ?',
        ['Updated Name', '{"new":"options"}', 1]
      );
    });

    it('should update only name', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await streamRepository.updateProfile(1, 'Only Name');

      expect(execute).toHaveBeenCalledWith(
        'UPDATE profiles SET profile_name = ? WHERE id = ?',
        ['Only Name', 1]
      );
    });

    it('should update only options', async () => {
      execute.mockResolvedValue({ affectedRows: 1 });

      await streamRepository.updateProfile(1, undefined, { only: 'options' });

      expect(execute).toHaveBeenCalledWith(
        'UPDATE profiles SET profile_options = ? WHERE id = ?',
        ['{"only":"options"}', 1]
      );
    });

    it('should not execute when nothing to update', async () => {
      await streamRepository.updateProfile(1);

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile by id', async () => {
      remove.mockResolvedValue(true);

      const result = await streamRepository.deleteProfile(1);

      expect(remove).toHaveBeenCalledWith('DELETE FROM profiles WHERE id = ?', [1]);
      expect(result).toBe(true);
    });
  });
});
