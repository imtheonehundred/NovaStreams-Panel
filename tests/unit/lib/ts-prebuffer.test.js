'use strict';

const tsPrebuffer = require('../../../lib/ts-prebuffer');

describe('TS Prebuffer Library', () => {
  describe('appendPrebufferChunk', () => {
    it('should not throw when prebuffer is disabled', () => {
      const b = { prebufferChunks: [], prebufferBytes: 0 };
      expect(() => {
        tsPrebuffer.appendPrebufferChunk(b, Buffer.from([1, 2, 3]), 0);
      }).not.toThrow();
    });

    it('should not throw when buffer is null', () => {
      expect(() => {
        tsPrebuffer.appendPrebufferChunk(null, Buffer.from([1, 2, 3]), 1000);
      }).not.toThrow();
    });

    it('should not throw when chunk is empty', () => {
      const b = { prebufferChunks: [], prebufferBytes: 0 };
      expect(() => {
        tsPrebuffer.appendPrebufferChunk(b, Buffer.from([]), 1000);
      }).not.toThrow();
    });

    it('should not throw when maxBytes is undefined', () => {
      const b = { prebufferChunks: [], prebufferBytes: 0 };
      expect(() => {
        tsPrebuffer.appendPrebufferChunk(b, Buffer.from([1, 2, 3]), undefined);
      }).not.toThrow();
    });

    it('should not throw when chunk is not a buffer', () => {
      const b = { prebufferChunks: [], prebufferBytes: 0 };
      expect(() => {
        tsPrebuffer.appendPrebufferChunk(b, [1, 2, 3], 1000);
      }).not.toThrow();
    });
  });

  describe('clearPrebuffer', () => {
    it('should not throw when buffer is null', () => {
      expect(() => tsPrebuffer.clearPrebuffer(null)).not.toThrow();
    });

    it('should clear prebuffer chunks and bytes', () => {
      const b = {
        prebufferChunks: [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])],
        prebufferBytes: 6
      };
      tsPrebuffer.clearPrebuffer(b);
      expect(b.prebufferChunks).toEqual([]);
      expect(b.prebufferBytes).toBe(0);
    });

    it('should handle missing properties', () => {
      const b = {};
      expect(() => tsPrebuffer.clearPrebuffer(b)).not.toThrow();
    });
  });

  describe('snapshotPrebuffer', () => {
    it('should return empty buffer for null input', () => {
      const result = tsPrebuffer.snapshotPrebuffer(null);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should return empty buffer when no chunks', () => {
      const b = { prebufferChunks: [], prebufferBytes: 0 };
      const result = tsPrebuffer.snapshotPrebuffer(b);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should return concatenated buffers', () => {
      const b = {
        prebufferChunks: [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])],
        prebufferBytes: 6
      };
      const result = tsPrebuffer.snapshotPrebuffer(b);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(6);
      expect(result).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
    });
  });

  describe('waitForPrebuffer', () => {
    it('should resolve immediately when buffer is null', async () => {
      await expect(tsPrebuffer.waitForPrebuffer(null, 100, 1000)).resolves.toBeUndefined();
    });

    it('should resolve immediately when minBytes is 0 or negative', async () => {
      await expect(tsPrebuffer.waitForPrebuffer({}, 0, 1000)).resolves.toBeUndefined();
      await expect(tsPrebuffer.waitForPrebuffer({}, -1, 1000)).resolves.toBeUndefined();
    });

    it('should resolve immediately when already has enough bytes', async () => {
      const b = { prebufferBytes: 500 };
      await expect(tsPrebuffer.waitForPrebuffer(b, 100, 10000)).resolves.toBeUndefined();
    });

    it('should resolve when timeout is reached', async () => {
      const b = { prebufferBytes: 0 };
      const start = Date.now();
      await tsPrebuffer.waitForPrebuffer(b, 1000, 50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
