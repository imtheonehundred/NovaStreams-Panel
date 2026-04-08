'use strict';

jest.mock('../../../lib/db', () => ({
  listEpgSources: jest.fn(),
  createEpgSource: jest.fn(),
  deleteEpgSource: jest.fn(),
  getShortEpg: jest.fn(),
  getEpgForChannel: jest.fn(),
  clearEpgData: jest.fn(),
  insertEpgBatch: jest.fn(),
  updateEpgSourceTimestamp: jest.fn(),
  getAllEpgData: jest.fn(),
}));

jest.mock('../../../services/bouquetService', () => ({
  getChannelsForBouquets: jest.fn(),
}));

jest.mock('node-fetch');

const epgService = require('../../../services/epgService');
const dbApi = require('../../../lib/db');
const bouquetService = require('../../../services/bouquetService');
const fetch = require('node-fetch');

describe('EPG Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listSources', () => {
    it('should call dbApi.listEpgSources', async () => {
      dbApi.listEpgSources.mockResolvedValue([{ id: 1, name: 'Source 1' }]);
      const result = await epgService.listSources();
      expect(dbApi.listEpgSources).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('addSource', () => {
    it('should call dbApi.createEpgSource', async () => {
      dbApi.createEpgSource.mockResolvedValue({ id: 1 });
      await epgService.addSource('Test Source', 'http://example.com/epg.xml');
      expect(dbApi.createEpgSource).toHaveBeenCalledWith('Test Source', 'http://example.com/epg.xml');
    });
  });

  describe('removeSource', () => {
    it('should call dbApi.deleteEpgSource', async () => {
      dbApi.deleteEpgSource.mockResolvedValue(1);
      await epgService.removeSource(1);
      expect(dbApi.deleteEpgSource).toHaveBeenCalledWith(1);
    });
  });

  describe('getShortEpg', () => {
    it('should call dbApi.getShortEpg with channelId and limit', async () => {
      dbApi.getShortEpg.mockResolvedValue([{ title: 'Show 1' }]);
      const result = await epgService.getShortEpg('ch1', 10);
      expect(dbApi.getShortEpg).toHaveBeenCalledWith('ch1', 10);
      expect(result).toHaveLength(1);
    });
  });

  describe('getEpgForChannel', () => {
    it('should call dbApi.getEpgForChannel with channelId and time range', async () => {
      dbApi.getEpgForChannel.mockResolvedValue([{ title: 'Show 1' }]);
      const result = await epgService.getEpgForChannel('ch1', 1000, 2000);
      expect(dbApi.getEpgForChannel).toHaveBeenCalledWith('ch1', 1000, 2000);
      expect(result).toHaveLength(1);
    });
  });

  describe('refreshFromUrl', () => {
    it('should fetch URL and import EPG data', async () => {
      const mockXml = `<?xml version="1.0"?>
        <channel id="ch1"><display-name>Channel 1</display-name></channel>
        <programme start="20240301000000" stop="20240301120000" channel="ch1">
          <title>Test Show</title>
          <desc>Description</desc>
        </programme>`;
      
      fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockXml),
      });
      dbApi.insertEpgBatch.mockResolvedValue(1);

      const result = await epgService.refreshFromUrl('http://example.com/epg.xml', 1);
      expect(result.inserted).toBeGreaterThanOrEqual(0);
    });

    it('should throw on HTTP error', async () => {
      fetch.mockResolvedValue({ ok: false, status: 404 });
      await expect(epgService.refreshFromUrl('http://example.com/notfound.xml')).rejects.toThrow('HTTP 404');
    });

    it('should clear existing data before import', async () => {
      const mockXml = `<?xml version="1.0"?><channel id="ch1"></channel>`;
      fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockXml),
      });

      await epgService.refreshFromUrl('http://example.com/epg.xml', 1);
      expect(dbApi.clearEpgData).toHaveBeenCalled();
    });
  });

  describe('refreshAllSources', () => {
    it('should fetch all sources', async () => {
      dbApi.listEpgSources.mockResolvedValue([
        { id: 1, name: 'Source 1', url: 'http://example1.com/epg.xml' },
        { id: 2, name: 'Source 2', url: 'http://example2.com/epg.xml' },
      ]);
      
      fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<?xml version="1.0"?><channel id="ch1"></channel>'),
      });

      const result = await epgService.refreshAllSources();
      expect(result.sources).toBe(2);
    });

    it('should track errors for failed sources', async () => {
      dbApi.listEpgSources.mockResolvedValue([
        { id: 1, name: 'Source 1', url: 'http://example1.com/epg.xml' },
      ]);
      
      fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await epgService.refreshAllSources();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('HTTP 404');
    });
  });

  describe('xmltv', () => {
    it('should generate XMLTV output', async () => {
      dbApi.getAllEpgData.mockResolvedValue([
        { channel_id: 'ch1', title: 'Show 1', description: 'Desc 1', start: 1709308800, stop: 1709352000, lang: 'en' },
        { channel_id: 'ch1', title: 'Show 2', description: 'Desc 2', start: 1709352000, stop: 1709395200, lang: 'en' },
      ]);

      const result = await epgService.xmltv();
      expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result).toContain('<tv>');
      expect(result).toContain('</tv>');
      expect(result).toContain('<channel id="ch1"');
    });

    it('should filter by bouquet if provided', async () => {
      bouquetService.getChannelsForBouquets.mockResolvedValue(['ch1']);
      dbApi.getAllEpgData.mockResolvedValue([
        { channel_id: 'ch1', title: 'Show 1', description: 'Desc', start: 1709308800, stop: 1709352000, lang: 'en' },
        { channel_id: 'ch2', title: 'Show 2', description: 'Desc', start: 1709308800, stop: 1709352000, lang: 'en' },
      ]);

      const result = await epgService.xmltv([1]);
      expect(result).toContain('ch1');
      expect(result).not.toContain('ch2');
    });

    it('should handle empty EPG data', async () => {
      dbApi.getAllEpgData.mockResolvedValue([]);

      const result = await epgService.xmltv();
      expect(result).toContain('</tv>');
      expect(result).not.toContain('<programme');
    });

    it('should sort programs by start time', async () => {
      dbApi.getAllEpgData.mockResolvedValue([
        { channel_id: 'ch1', title: 'Later Show', description: 'Desc', start: 1709400000, stop: 1709443200, lang: 'en' },
        { channel_id: 'ch1', title: 'Earlier Show', description: 'Desc', start: 1709308800, stop: 1709352000, lang: 'en' },
      ]);

      const result = await epgService.xmltv();
      const earlierIndex = result.indexOf('Earlier Show');
      const laterIndex = result.indexOf('Later Show');
      expect(earlierIndex).toBeLessThan(laterIndex);
    });
  });
});
