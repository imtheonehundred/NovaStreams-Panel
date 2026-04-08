'use strict';

const hlsIdle = require('../../../lib/hlsIdle');

describe('HLS Idle Library', () => {
  beforeEach(() => {
    hlsIdle.delete('test-id');
    hlsIdle.delete('another-id');
  });

  describe('touch', () => {
    it('should set last access time for id', () => {
      hlsIdle.touch('test-id');
      const lastAccess = hlsIdle.get('test-id');
      expect(lastAccess).toBeDefined();
      expect(typeof lastAccess).toBe('number');
      expect(lastAccess).toBeGreaterThan(0);
    });

    it('should convert id to string', () => {
      hlsIdle.touch(123);
      expect(hlsIdle.get('123')).toBeDefined();
      hlsIdle.delete(123);
    });

    it('should update existing entry', () => {
      hlsIdle.touch('test-id');
      const first = hlsIdle.get('test-id');
      hlsIdle.touch('test-id');
      const second = hlsIdle.get('test-id');
      expect(second).toBeGreaterThanOrEqual(first);
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent id', () => {
      expect(hlsIdle.get('non-existent')).toBeUndefined();
    });

    it('should return timestamp after touch', () => {
      hlsIdle.touch('test-id');
      expect(hlsIdle.get('test-id')).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should remove entry', () => {
      hlsIdle.touch('test-id');
      expect(hlsIdle.get('test-id')).toBeDefined();
      hlsIdle.delete('test-id');
      expect(hlsIdle.get('test-id')).toBeUndefined();
    });

    it('should not throw for non-existent id', () => {
      expect(() => hlsIdle.delete('non-existent')).not.toThrow();
    });

    it('should convert id to string', () => {
      hlsIdle.touch(456);
      hlsIdle.delete(456);
      expect(hlsIdle.get('456')).toBeUndefined();
    });
  });
});
