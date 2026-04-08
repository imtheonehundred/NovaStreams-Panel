'use strict';

jest.mock('../../../lib/db', () => ({
  listPackages: jest.fn(),
  getPackageById: jest.fn(),
  createPackage: jest.fn(),
  updatePackage: jest.fn(),
  deletePackage: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getChannelsForBouquets: jest.fn().mockResolvedValue(['1', '2']),
  getMoviesForBouquets: jest.fn().mockResolvedValue(['10', '20']),
  getSeriesForBouquets: jest.fn().mockResolvedValue(['100', '200']),
}));

const packageService = require('../../../services/packageService');
const dbApi = require('../../../lib/db');
const bouquetService = require('../../../services/bouquetService');

describe('Package Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should return parsed package rows', async () => {
      const mockPackages = [
        { id: 1, package_name: 'Gold', groups_json: '["cat1"]' },
        { id: 2, package_name: 'Silver', groups_json: '["cat2"]' },
      ];
      dbApi.listPackages.mockResolvedValue(mockPackages);
      const result = await packageService.list();
      expect(result).toHaveLength(2);
      expect(result[0].groups).toEqual(['cat1']);
      expect(result[1].groups).toEqual(['cat2']);
    });

    it('should handle empty list', async () => {
      dbApi.listPackages.mockResolvedValue([]);
      const result = await packageService.list();
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should return parsed package by id', async () => {
      dbApi.getPackageById.mockResolvedValue({
        id: 1,
        package_name: 'Gold',
        bouquets_json: '[1, 2, 3]',
        options_json: '{"trial": true}',
      });
      const result = await packageService.getById(1);
      expect(result.id).toBe(1);
      expect(result.bouquets).toEqual([1, 2, 3]);
      expect(result.options).toEqual({ trial: true });
    });

    it('should return null for non-existent package', async () => {
      dbApi.getPackageById.mockResolvedValue(null);
      const result = await packageService.getById(999);
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create package with defaults', async () => {
      dbApi.createPackage.mockResolvedValue({ id: 1 });
      const result = await packageService.create({});
      expect(dbApi.createPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          package_name: 'New Package',
          groups: [],
          bouquets: [],
          output_formats: [],
          options: {},
        })
      );
    });

    it('should use name if package_name not provided', async () => {
      dbApi.createPackage.mockResolvedValue({ id: 1 });
      await packageService.create({ name: 'My Package' });
      expect(dbApi.createPackage).toHaveBeenCalledWith(
        expect.objectContaining({ package_name: 'My Package' })
      );
    });

    it('should pass through all package options', async () => {
      dbApi.createPackage.mockResolvedValue({ id: 1 });
      await packageService.create({
        package_name: 'Test',
        is_trial: 1,
        is_official: 0,
        trial_credits: 100,
        official_credits: 500,
        max_connections: 5,
      });
      expect(dbApi.createPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          is_trial: 1,
          is_official: 0,
          trial_credits: 100,
          official_credits: 500,
          max_connections: 5,
        })
      );
    });
  });

  describe('update', () => {
    it('should call dbApi.updatePackage', async () => {
      dbApi.updatePackage.mockResolvedValue({ id: 1 });
      await packageService.update(1, { package_name: 'Updated' });
      expect(dbApi.updatePackage).toHaveBeenCalledWith(1, { package_name: 'Updated' });
    });
  });

  describe('remove', () => {
    it('should call dbApi.deletePackage', async () => {
      dbApi.deletePackage.mockResolvedValue(1);
      await packageService.remove(1);
      expect(dbApi.deletePackage).toHaveBeenCalledWith(1);
    });
  });

  describe('applyPackageToLine', () => {
    it('should return null for non-existent package', async () => {
      dbApi.getPackageById.mockResolvedValue(null);
      const result = await packageService.applyPackageToLine(999);
      expect(result).toBeNull();
    });

    it('should return line configuration from package', async () => {
      dbApi.getPackageById.mockResolvedValue({
        id: 1,
        package_name: 'Gold',
        groups_json: '["cat1"]',
        bouquets_json: '[1, 2]',
        output_formats_json: '["hls", "ts"]',
        options_json: '{"trial": true}',
        max_connections: 5,
        forced_country: 'US',
        is_mag: 1,
        is_e2: 0,
        is_restreamer: 0,
        is_line: 1,
        is_trial: 0,
        is_official: 1,
        trial_credits: 0,
        official_credits: 500,
        trial_duration: 0,
        trial_duration_in: 'day',
        official_duration: 30,
        official_duration_in: 'month',
      });
      const result = await packageService.applyPackageToLine(1);
      expect(result.bouquets).toEqual(['1', '2']);
      expect(result.output_formats).toEqual(['hls', 'ts']);
      expect(result.max_connections).toBe(5);
    });

    it('should use defaults for missing values', async () => {
      dbApi.getPackageById.mockResolvedValue({
        id: 1,
        package_name: 'Minimal',
        groups_json: '[]',
        bouquets_json: '[]',
        output_formats_json: '[]',
        options_json: '{}',
      });
      const result = await packageService.applyPackageToLine(1);
      expect(result.max_connections).toBe(1);
      expect(result.official_duration).toBe(30);
      expect(result.official_duration_in).toBe('month');
    });
  });

  describe('assignPackage / getUserPackages', () => {
    beforeEach(() => {
      dbApi.getSetting.mockResolvedValue('{"1": ["10", "20"]}');
    });

    it('should assign packages to user', async () => {
      dbApi.getSetting.mockResolvedValue('{}');
      await packageService.assignPackage(1, ['10', '20']);
      expect(dbApi.setSetting).toHaveBeenCalledWith(
        'user_package_assignments',
        expect.stringContaining('"1"')
      );
    });

    it('should get user packages', async () => {
      const result = await packageService.getUserPackages(1);
      expect(result).toEqual(['10', '20']);
    });

    it('should return empty array for user with no packages', async () => {
      dbApi.getSetting.mockResolvedValue('{}');
      const result = await packageService.getUserPackages(999);
      expect(result).toEqual([]);
    });
  });

  describe('isChannelAllowed / isMovieAllowed / isSeriesAllowed', () => {
    beforeEach(() => {
      dbApi.getSetting.mockResolvedValue('{"1": ["10"]}');
    });

    it('should return true if user has no packages assigned', async () => {
      dbApi.getSetting.mockResolvedValue('{}');
      expect(await packageService.isChannelAllowed(999, 1)).toBe(true);
      expect(await packageService.isMovieAllowed(999, 1)).toBe(true);
      expect(await packageService.isSeriesAllowed(999, 1)).toBe(true);
    });

    it('should check against package bouquets', async () => {
      const resultChannel = await packageService.isChannelAllowed(1, '1');
      expect(resultChannel).toBe(true);

      const resultMovie = await packageService.isMovieAllowed(1, '10');
      expect(resultMovie).toBe(true);

      const resultSeries = await packageService.isSeriesAllowed(1, '100');
      expect(resultSeries).toBe(true);
    });
  });

  describe('filterChannels / filterMovies / filterSeries', () => {
    beforeEach(() => {
      dbApi.getSetting.mockResolvedValue('{"1": ["10"]}');
    });

    it('should return all items if user has no packages', async () => {
      dbApi.getSetting.mockResolvedValue('{}');
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = await packageService.filterChannels(999, items);
      expect(result).toEqual(items);
    });

    it('should filter channels by bouquet', async () => {
      const items = [{ stream_id: '1' }, { stream_id: '2' }, { stream_id: '3' }];
      const result = await packageService.filterChannels(1, items);
      expect(result).toHaveLength(2);
    });
  });

  describe('listPackages (alias)', () => {
    it('should be an alias for list', async () => {
      dbApi.listPackages.mockResolvedValue([]);
      await packageService.listPackages();
      expect(dbApi.listPackages).toHaveBeenCalled();
    });
  });

  describe('createPackage (legacy alias)', () => {
    it('should call create with mapped parameters', async () => {
      dbApi.createPackage.mockResolvedValue({ id: 1 });
      await packageService.createPackage({ name: 'Legacy Package', categories: ['cat1'] });
      expect(dbApi.createPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          package_name: 'Legacy Package',
          groups: ['cat1'],
          bouquets: [],
        })
      );
    });
  });
});
