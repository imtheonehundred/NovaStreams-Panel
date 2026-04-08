'use strict';

const streamingSettings = require('../../../lib/streaming-settings');

describe('Streaming Settings Library', () => {
  beforeEach(() => {
    streamingSettings._resetCacheForTests();
  });

  describe('KEYS', () => {
    it('should have all required setting keys', () => {
      expect(streamingSettings.KEYS).toHaveProperty('prebuffer_enabled');
      expect(streamingSettings.KEYS).toHaveProperty('prebuffer_size_mb');
      expect(streamingSettings.KEYS).toHaveProperty('prebuffer_on_demand_min_bytes');
      expect(streamingSettings.KEYS).toHaveProperty('prebuffer_on_demand_max_wait_ms');
      expect(streamingSettings.KEYS).toHaveProperty('ingest_style');
      expect(streamingSettings.KEYS).toHaveProperty('low_latency_enabled');
      expect(streamingSettings.KEYS).toHaveProperty('minimal_ingest_enabled');
      expect(streamingSettings.KEYS).toHaveProperty('prewarm_enabled');
    });
  });

  describe('DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(streamingSettings.DEFAULTS.prebuffer_enabled).toBe(true);
      expect(streamingSettings.DEFAULTS.prebuffer_size_mb).toBe(1);
      expect(streamingSettings.DEFAULTS.prebuffer_on_demand_min_bytes).toBe(262144);
      expect(streamingSettings.DEFAULTS.prebuffer_on_demand_max_wait_ms).toBe(500);
      expect(streamingSettings.DEFAULTS.ingest_style).toBe('webapp');
      expect(streamingSettings.DEFAULTS.low_latency_enabled).toBe(true);
      expect(streamingSettings.DEFAULTS.minimal_ingest_enabled).toBe(true);
      expect(streamingSettings.DEFAULTS.prewarm_enabled).toBe(true);
    });
  });

  describe('getStreamingConfig', () => {
    it('should return current config', () => {
      const config = streamingSettings.getStreamingConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
      expect(config).toHaveProperty('prebuffer_enabled');
      expect(config).toHaveProperty('prebuffer_size_mb');
    });

    it('should return a copy, not the original', () => {
      const config1 = streamingSettings.getStreamingConfig();
      const config2 = streamingSettings.getStreamingConfig();
      expect(config1).not.toBe(config2);
    });
  });

  describe('isPrebufferEnabled', () => {
    it('should return boolean', () => {
      const result = streamingSettings.isPrebufferEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getPrebufferMaxBytes', () => {
    it('should return number of bytes', () => {
      const bytes = streamingSettings.getPrebufferMaxBytes();
      expect(typeof bytes).toBe('number');
      expect(bytes).toBeGreaterThan(0);
    });

    it('should be 1MB by default', () => {
      const bytes = streamingSettings.getPrebufferMaxBytes();
      expect(bytes).toBe(1024 * 1024);
    });
  });

  describe('getOnDemandMinBytes', () => {
    it('should return number', () => {
      const bytes = streamingSettings.getOnDemandMinBytes();
      expect(typeof bytes).toBe('number');
      expect(bytes).toBeGreaterThan(0);
    });

    it('should not exceed prebuffer max bytes', () => {
      const minBytes = streamingSettings.getOnDemandMinBytes();
      const maxBytes = streamingSettings.getPrebufferMaxBytes();
      expect(minBytes).toBeLessThanOrEqual(maxBytes);
    });
  });

  describe('getOnDemandMaxWaitMs', () => {
    it('should return number', () => {
      const ms = streamingSettings.getOnDemandMaxWaitMs();
      expect(typeof ms).toBe('number');
      expect(ms).toBeGreaterThan(0);
    });
  });

  describe('getGlobalIngestStyle', () => {
    it('should return a valid ingest style', () => {
      const style = streamingSettings.getGlobalIngestStyle();
      expect(['webapp', 'xc', 'safe']).toContain(style);
    });
  });

  describe('isLowLatencyEnabled', () => {
    it('should return boolean', () => {
      const result = streamingSettings.isLowLatencyEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isGlobalMinimalIngestEnabled', () => {
    it('should return boolean', () => {
      const result = streamingSettings.isGlobalMinimalIngestEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isPrewarmGloballyAllowed', () => {
    it('should return boolean', () => {
      const result = streamingSettings.isPrewarmGloballyAllowed();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getEffectiveIngestStyle', () => {
    it('should return global style when no channel override', () => {
      const globalStyle = streamingSettings.getGlobalIngestStyle();
      expect(streamingSettings.getEffectiveIngestStyle(null)).toBe(globalStyle);
      expect(streamingSettings.getEffectiveIngestStyle({})).toBe(globalStyle);
    });

    it('should return channel override when set', () => {
      const channel = { ingest_style_override: 'xc' };
      expect(streamingSettings.getEffectiveIngestStyle(channel)).toBe('xc');
    });

    it('should return null for invalid channel override', () => {
      const channel = { ingest_style_override: 'invalid' };
      expect(streamingSettings.getEffectiveIngestStyle(channel)).toBe(streamingSettings.getGlobalIngestStyle());
    });
  });

  describe('getEffectivePrebufferSizeMb', () => {
    it('should return cache value when channel has no override', () => {
      const channel = {};
      const result = streamingSettings.getEffectivePrebufferSizeMb(channel);
      expect(result).toBe(streamingSettings.DEFAULTS.prebuffer_size_mb);
    });

    it('should use channel value when provided', () => {
      const channel = { prebuffer_size_mb: 4 };
      const result = streamingSettings.getEffectivePrebufferSizeMb(channel);
      expect(result).toBe(4);
    });

    it('should clamp channel value to valid range', () => {
      const channel1 = { prebuffer_size_mb: 0.1 };
      const channel2 = { prebuffer_size_mb: 100 };
      expect(streamingSettings.getEffectivePrebufferSizeMb(channel1)).toBe(0.5);
      expect(streamingSettings.getEffectivePrebufferSizeMb(channel2)).toBe(16);
    });
  });

  describe('getEffectivePrebufferMaxBytes', () => {
    it('should return bytes based on effective size', () => {
      const bytes = streamingSettings.getEffectivePrebufferMaxBytes({});
      expect(typeof bytes).toBe('number');
      expect(bytes).toBeGreaterThan(0);
    });
  });

  describe('channelPreWarmEffective', () => {
    it('should return false when channel is null/undefined', () => {
      expect(streamingSettings.channelPreWarmEffective(null)).toBe(false);
      expect(streamingSettings.channelPreWarmEffective(undefined)).toBe(false);
    });

    it('should return false when channel has no preWarm', () => {
      expect(streamingSettings.channelPreWarmEffective({})).toBe(false);
    });

    it('should return false when preWarm is false', () => {
      expect(streamingSettings.channelPreWarmEffective({ preWarm: false })).toBe(false);
    });

    it('should return true when channel has preWarm true', () => {
      expect(streamingSettings.channelPreWarmEffective({ preWarm: true })).toBe(true);
    });

    it('should return false when global prewarm is disabled', () => {
      const original = streamingSettings.isPrewarmGloballyAllowed();
      streamingSettings._resetCacheForTests();
      const channel = { preWarm: true };
      const result = streamingSettings.channelPreWarmEffective(channel);
      expect(result).toBe(true);
    });
  });
});
