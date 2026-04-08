'use strict';

const {
  RENDITION_PRESETS,
  RENDITION_ORDER,
  sortRenditions,
  parseCustomFfmpegArgs,
} = require('../../../lib/ffmpeg-args');

describe('FFmpeg Args Library', () => {
  describe('RENDITION_PRESETS', () => {
    it('should have 360p preset', () => {
      expect(RENDITION_PRESETS['360p']).toEqual({
        height: 360,
        vbr: '800k',
        maxrate: '900k',
        bufsize: '1200k',
      });
    });

    it('should have 480p preset', () => {
      expect(RENDITION_PRESETS['480p']).toEqual({
        height: 480,
        vbr: '1200k',
        maxrate: '1280k',
        bufsize: '1800k',
      });
    });

    it('should have 720p preset', () => {
      expect(RENDITION_PRESETS['720p']).toEqual({
        height: 720,
        vbr: '2800k',
        maxrate: '2990k',
        bufsize: '4200k',
      });
    });

    it('should have 1080p preset', () => {
      expect(RENDITION_PRESETS['1080p']).toEqual({
        height: 1080,
        vbr: '5000k',
        maxrate: '5350k',
        bufsize: '7500k',
      });
    });

    it('should have correct bitrate values', () => {
      Object.entries(RENDITION_PRESETS).forEach(([key, preset]) => {
        expect(preset.height).toBeGreaterThan(0);
        expect(preset.vbr).toMatch(/^\d+k$/);
        expect(preset.maxrate).toMatch(/^\d+k$/);
        expect(preset.bufsize).toMatch(/^\d+k$/);
      });
    });
  });

  describe('RENDITION_ORDER', () => {
    it('should be an array', () => {
      expect(Array.isArray(RENDITION_ORDER)).toBe(true);
    });

    it('should be in ascending order by quality', () => {
      expect(RENDITION_ORDER).toEqual(['360p', '480p', '720p', '1080p']);
    });

    it('should contain all preset keys', () => {
      Object.keys(RENDITION_PRESETS).forEach(preset => {
        expect(RENDITION_ORDER).toContain(preset);
      });
    });
  });

  describe('sortRenditions', () => {
    it('should return empty array for empty input', () => {
      expect(sortRenditions([])).toEqual([]);
    });

    it('should sort renditions in correct order', () => {
      expect(sortRenditions(['720p', '360p', '1080p', '480p'])).toEqual([
        '360p', '480p', '720p', '1080p',
      ]);
    });

    it('should remove duplicates', () => {
      expect(sortRenditions(['720p', '720p', '1080p'])).toEqual(['720p', '1080p']);
    });

    it('should filter out invalid renditions', () => {
      expect(sortRenditions(['720p', 'invalid', '480p'])).toEqual(['480p', '720p']);
    });

    it('should handle single rendition', () => {
      expect(sortRenditions(['1080p'])).toEqual(['1080p']);
    });

    it('should handle undefined values', () => {
      expect(sortRenditions([undefined, '720p'])).toEqual(['720p']);
    });
  });

  describe('parseCustomFfmpegArgs', () => {
    it('should return empty array for empty string', () => {
      expect(parseCustomFfmpegArgs('')).toEqual([]);
      expect(parseCustomFfmpegArgs(null)).toEqual([]);
      expect(parseCustomFfmpegArgs(undefined)).toEqual([]);
    });

    it('should return empty array for whitespace only', () => {
      expect(parseCustomFfmpegArgs('   ')).toEqual([]);
    });

    it('should parse valid args', () => {
      const result = parseCustomFfmpegArgs('-i input -c:v libx264');
      expect(result).toEqual(['-i', 'input', '-c:v', 'libx264']);
    });

    it('should filter out shell metacharacters', () => {
      expect(parseCustomFfmpegArgs('-i input; rm -rf')).toEqual([]);
      expect(parseCustomFfmpegArgs('-i input | grep test')).toEqual([]);
      expect(parseCustomFfmpegArgs('command `whoami`')).toEqual([]);
      expect(parseCustomFfmpegArgs('$HOME/path')).toEqual([]);
      expect(parseCustomFfmpegArgs('test(a)')).toEqual([]);
    });

    it('should handle args with equals sign', () => {
      const result = parseCustomFfmpegArgs('-x264-params=keyint=60');
      expect(result).toEqual(['-x264-params=keyint=60']);
    });
  });

});
