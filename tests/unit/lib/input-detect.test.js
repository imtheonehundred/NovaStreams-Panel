'use strict';

const {
  detectInputType,
  resolveEffectiveInputType,
  looksLikeHlsUrl,
} = require('../../../lib/input-detect');

describe('Input Detect Library', () => {
  describe('detectInputType', () => {
    it('should return auto for empty input', () => {
      expect(detectInputType('')).toBe('auto');
      expect(detectInputType(null)).toBe('auto');
      expect(detectInputType(undefined)).toBe('auto');
    });

    it('should detect HLS from .m3u8 extension', () => {
      expect(detectInputType('http://example.com/stream.m3u8')).toBe('hls');
    });

    it('should detect HLS from .m3 extension (non-.m3u8)', () => {
      expect(detectInputType('http://example.com/stream.m3u')).toBe('hls');
    });

    it('should detect HLS from query parameters', () => {
      expect(detectInputType('http://example.com/get.php?type=m3u8')).toBe('hls');
      expect(detectInputType('http://example.com/get.php?output=hls')).toBe('hls');
      expect(detectInputType('http://example.com/get.php?format=hls')).toBe('hls');
      expect(detectInputType('http://example.com/get.php?m3u_plus=1')).toBe('hls');
    });

    it('should detect RTMP', () => {
      expect(detectInputType('rtmp://example.com/live/stream')).toBe('rtmp');
      expect(detectInputType('rtmps://example.com/live/stream')).toBe('rtmp');
    });

    it('should detect SRT', () => {
      expect(detectInputType('srt://example.com:9000')).toBe('srt');
    });

    it('should detect UDP', () => {
      expect(detectInputType('udp://@239.0.0.1:1234')).toBe('udp');
    });

    it('should detect TS', () => {
      expect(detectInputType('http://example.com/stream.ts')).toBe('ts');
    });

    it('should detect DASH', () => {
      expect(detectInputType('http://example.com/stream.mpd')).toBe('dash');
    });

    it('should return auto for unknown types', () => {
      expect(detectInputType('http://example.com/stream.mp4')).toBe('auto');
      expect(detectInputType('http://example.com/stream')).toBe('auto');
    });
  });

  describe('looksLikeHlsUrl', () => {
    it('should return false for non-http URLs', () => {
      expect(looksLikeHlsUrl('rtmp://example.com')).toBe(false);
      expect(looksLikeHlsUrl('')).toBe(false);
      expect(looksLikeHlsUrl(null)).toBe(false);
    });

    it('should detect m3u_plus parameter', () => {
      expect(looksLikeHlsUrl('http://example.com/get.php?m3u_plus=1')).toBe(true);
    });

    it('should detect output=hls parameter', () => {
      expect(looksLikeHlsUrl('http://example.com/get.php?output=hls')).toBe(true);
    });

    it('should detect type=m3u8 parameter', () => {
      expect(looksLikeHlsUrl('http://example.com/get.php?type=m3u8')).toBe(true);
    });

    it('should detect format=hls parameter', () => {
      expect(looksLikeHlsUrl('http://example.com/get.php?format=hls')).toBe(true);
    });

    it('should return false for URLs without HLS indicators', () => {
      expect(looksLikeHlsUrl('http://example.com/stream.mp4')).toBe(false);
    });
  });

  describe('resolveEffectiveInputType', () => {
    it('should return explicit type when not auto', () => {
      expect(resolveEffectiveInputType('http://example.com/stream', 'hls')).toBe('hls');
      expect(resolveEffectiveInputType('http://example.com/stream', 'dash')).toBe('dash');
      expect(resolveEffectiveInputType('http://example.com/stream', 'rtmp')).toBe('rtmp');
    });

    it('should infer from URL when type is auto', () => {
      expect(resolveEffectiveInputType('http://example.com/stream.m3u8', 'auto')).toBe('hls');
      expect(resolveEffectiveInputType('http://example.com/stream.mpd', 'auto')).toBe('dash');
      expect(resolveEffectiveInputType('http://example.com/stream.ts', 'auto')).toBe('ts');
    });

    it('should return auto for auto with no URL inference', () => {
      expect(resolveEffectiveInputType('http://example.com/stream.mp4', 'auto')).toBe('auto');
    });

    it('should handle null/undefined type as auto', () => {
      expect(resolveEffectiveInputType('http://example.com/stream.m3u8', null)).toBe('hls');
      expect(resolveEffectiveInputType('http://example.com/stream.m3u8', undefined)).toBe('hls');
    });
  });
});
