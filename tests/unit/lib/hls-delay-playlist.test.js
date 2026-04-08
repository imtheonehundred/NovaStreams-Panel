'use strict';

const { rewriteMediaPlaylistDelayed } = require('../../../lib/hls-delay-playlist');

describe('HLS Delay Playlist Library', () => {
  describe('rewriteMediaPlaylistDelayed', () => {
    it('should return text unchanged when delay is 0', () => {
      const input = '#EXTM3U\n#EXTINF:10,\nsegment1.ts\n#EXTINF:10,\nsegment2.ts\n';
      expect(rewriteMediaPlaylistDelayed(input, 0, 4)).toBe(input);
    });

    it('should return text unchanged when delay is negative', () => {
      const input = '#EXTM3U\n#EXTINF:10,\nsegment1.ts\n';
      expect(rewriteMediaPlaylistDelayed(input, -5, 4)).toBe(input);
    });

    it('should return text unchanged when input is null/undefined', () => {
      expect(rewriteMediaPlaylistDelayed(null, 5, 4)).toBeNull();
      expect(rewriteMediaPlaylistDelayed(undefined, 5, 4)).toBeUndefined();
    });

    it('should return text unchanged when input is not a string', () => {
      expect(rewriteMediaPlaylistDelayed(123, 5, 4)).toBe(123);
    });

    it('should return text unchanged when no segments found', () => {
      const input = '#EXTM3U\n#EXTHEADER\n';
      expect(rewriteMediaPlaylistDelayed(input, 5, 4)).toBe(input);
    });

    it('should return text unchanged when only one segment', () => {
      const input = '#EXTM3U\n#EXTINF:10,\nsegment1.ts\n';
      expect(rewriteMediaPlaylistDelayed(input, 5, 4)).toBe(input);
    });

    it('should remove segments from end to achieve delay', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg1.ts
#EXTINF:10,
seg2.ts
#EXTINF:10,
seg3.ts
#EXTINF:10,
seg4.ts
`;
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).not.toContain('seg4.ts');
      expect(result).not.toContain('seg3.ts');
      expect(result).toContain('seg1.ts');
      expect(result).toContain('seg2.ts');
    });

    it('should use fallback duration for segments without duration', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg1.ts
#EXTINF:,
seg2.ts
#EXTINF:10,
seg3.ts
#EXTINF:10,
seg4.ts
`;
      const result = rewriteMediaPlaylistDelayed(input, 20, 4);
      expect(result).not.toContain('seg4.ts');
      expect(result).not.toContain('seg3.ts');
      expect(result).toContain('seg1.ts');
      expect(result).toContain('seg2.ts');
    });

    it('should update #EXT-X-TARGETDURATION to max kept segment duration', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:5,
seg1.ts
#EXTINF:8,
seg2.ts
#EXTINF:10,
seg3.ts
#EXTINF:10,
seg4.ts
`;
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).toContain('#EXT-X-TARGETDURATION:8');
    });

    it('should preserve non-targetduration headers', () => {
      const input = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg1.ts
#EXTINF:10,
seg2.ts
#EXTINF:10,
seg3.ts
`;
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).toContain('#EXT-X-VERSION:3');
    });

    it('should preserve #EXT-X-ENDLIST from original even when segments removed', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg1.ts
#EXTINF:10,
seg2.ts
#EXTINF:10,
seg3.ts
#EXT-X-ENDLIST
`;
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).toContain('#EXT-X-ENDLIST');
    });

    it('should keep #EXT-X-ENDLIST when all segments kept', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg1.ts
#EXTINF:10,
seg2.ts
#EXTINF:10,
seg3.ts
#EXT-X-ENDLIST
`;
      const result = rewriteMediaPlaylistDelayed(input, 30, 4);
      expect(result).toContain('#EXT-X-ENDLIST');
    });

    it('should handle CRLF line endings', () => {
      const input = '#EXTM3U\r\n#EXTINF:10,\r\nseg1.ts\r\n#EXTINF:10,\r\nseg2.ts\r\n#EXTINF:10,\r\nseg3.ts\r\n#EXT-X-ENDLIST\r\n';
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).not.toContain('seg3.ts');
    });

    it('should handle segment comments and attributes', () => {
      const input = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10, tvg-name="Test"
seg1.ts
#EXTINF:10,
seg2.ts
#EXTINF:10,
seg3.ts
#EXT-X-ENDLIST
`;
      const result = rewriteMediaPlaylistDelayed(input, 15, 4);
      expect(result).toContain('tvg-name="Test"');
    });
  });
});
