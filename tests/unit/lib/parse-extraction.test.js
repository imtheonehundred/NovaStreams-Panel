'use strict';

const { parseExtractionDump } = require('../../../lib/parse-extraction');

describe('Parse Extraction Library', () => {
  describe('parseExtractionDump', () => {
    it('should return empty object for null input', () => {
      expect(parseExtractionDump(null)).toEqual({});
    });

    it('should return empty object for undefined input', () => {
      expect(parseExtractionDump(undefined)).toEqual({});
    });

    it('should return empty object for non-string input', () => {
      expect(parseExtractionDump(123)).toEqual({});
      expect(parseExtractionDump({})).toEqual({});
    });

    it('should return empty object for empty string', () => {
      expect(parseExtractionDump('')).toEqual({});
    });

    describe('KID extraction', () => {
      it('should extract KID from text', () => {
        const text = 'Some text KID: 1234567890abcdef1234567890abcdef Some more text';
        const result = parseExtractionDump(text);
        expect(result.kid).toBe('1234567890abcdef1234567890abcdef');
      });

      it('should convert KID to lowercase', () => {
        const text = 'KID: ABCDEF1234567890ABCDEF1234567890';
        const result = parseExtractionDump(text);
        expect(result.kid).toBe('abcdef1234567890abcdef1234567890');
      });
    });

    describe('key extraction', () => {
      it('should extract key from text', () => {
        const text = 'Key: fedcba0987654321fedcba0987654321';
        const result = parseExtractionDump(text);
        expect(result.key).toBe('fedcba0987654321fedcba0987654321');
      });

      it('should handle key on its own line', () => {
        const text = 'Some content\n  Key: 1234567890abcdef1234567890abcdef\nMore';
        const result = parseExtractionDump(text);
        expect(result.key).toBe('1234567890abcdef1234567890abcdef');
      });
    });

    describe('PSSH extraction', () => {
      it('should extract PSSH block', () => {
        const text = 'PSSH Data:\n base64encodeddata==\n\nmore';
        const result = parseExtractionDump(text);
        expect(result.pssh).toBeDefined();
      });

      it('should handle PSSH without Data keyword', () => {
        const text = 'PSSH:\n datawith=\n\nend';
        const result = parseExtractionDump(text);
        expect(result.pssh).toBeDefined();
      });
    });

    describe('MPD URL extraction', () => {
      it('should extract MPD URL', () => {
        const text = 'Stream URL: https://example.com/manifest.mpd?params';
        const result = parseExtractionDump(text);
        expect(result.mpdUrl).toBe('https://example.com/manifest.mpd?params');
      });

      it('should extract MPD URL from multiple matches', () => {
        const text = 'First: https://first.com/a.mpd Second: https://second.com/b.mpd';
        const result = parseExtractionDump(text);
        expect(result.mpdUrl).toBe('https://second.com/b.mpd');
      });

      it('should extract MPD URL from URL: format', () => {
        const text = 'Manifest URL: https://example.com/stream.mpd';
        const result = parseExtractionDump(text);
        expect(result.mpdUrl).toBe('https://example.com/stream.mpd');
      });
    });

    describe('headers extraction', () => {
      it('should extract headers object', () => {
        const text = 'Headers: {"Authorization":"Bearer token","Referer":"https://example.com"}';
        const result = parseExtractionDump(text);
        expect(result.headers).toBeDefined();
        expect(result.headers.Authorization).toBe('Bearer token');
      });

      it('should handle headers with newlines', () => {
        const text = 'Headers:\n{"Key":"Value"}';
        const result = parseExtractionDump(text);
        expect(result.headers).toBeDefined();
      });
    });

    describe('page URL extraction', () => {
      it('should extract page URL with emoji prefix', () => {
        const text = '🔗 URL\n  https://example.com/page';
        const result = parseExtractionDump(text);
        expect(result.pageUrl).toBe('https://example.com/page');
      });

      it('should extract page URL with URL: prefix', () => {
        const text = 'Some text\nURL: https://example.com/path\nmore';
        const result = parseExtractionDump(text);
        expect(result.pageUrl).toBe('https://example.com/path');
      });
    });

    describe('type extraction', () => {
      it('should extract WIDEVINE type', () => {
        const text = 'Type: WIDEVINE';
        const result = parseExtractionDump(text);
        expect(result.type).toBe('WIDEVINE');
      });

      it('should extract PLAYREADY type', () => {
        const text = 'Type: PLAYREADY';
        const result = parseExtractionDump(text);
        expect(result.type).toBe('PLAYREADY');
      });

      it('should extract CLEARKEY type', () => {
        const text = 'Type: CLEARKEY';
        const result = parseExtractionDump(text);
        expect(result.type).toBe('CLEARKEY');
      });

      it('should handle type on separate line', () => {
        const text = 'Type\nWIDEVINE';
        const result = parseExtractionDump(text);
        expect(result.type).toBe('WIDEVINE');
      });
    });

    describe('name hint extraction', () => {
      it('should extract name from page URL', () => {
        const text = 'URL: https://example.com/channels/video.m3u8';
        const result = parseExtractionDump(text);
        expect(result.nameHint).toBeDefined();
        expect(result.nameHint).toContain('video');
      });

      it('should decode URL encoded names', () => {
        const text = 'URL: https://example.com/channels/stream%20name.m3u8';
        const result = parseExtractionDump(text);
        expect(result.nameHint).toBeDefined();
      });
    });

    it('should extract multiple fields from complete dump', () => {
      const text = `
        KID: 1234567890abcdef1234567890abcdef
        Key: fedcba0987654321fedcba0987654321
        MPD URL: https://example.com/manifest.mpd
        Type: WIDEVINE
      `;
      const result = parseExtractionDump(text);
      expect(result.kid).toBe('1234567890abcdef1234567890abcdef');
      expect(result.key).toBe('fedcba0987654321fedcba0987654321');
      expect(result.mpdUrl).toBe('https://example.com/manifest.mpd');
      expect(result.type).toBe('WIDEVINE');
    });
  });
});
