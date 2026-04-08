'use strict';

const {
  toMysqlDatetimeUtc,
  sanitizeSqlParamIsoToMysqlDatetime,
  sanitizeSqlParams,
  clampPagination,
  sanitizeReleaseDate,
  RELEASE_DATE_MAX_LEN,
} = require('../../../lib/mysql-datetime');

describe('MySQL DateTime Library', () => {
  describe('toMysqlDatetimeUtc', () => {
    it('should format Date object to MySQL datetime', () => {
      const date = new Date('2026-03-26T02:41:56.000Z');
      const result = toMysqlDatetimeUtc(date);
      expect(result).toBe('2026-03-26 02:41:56');
    });

    it('should format ISO string to MySQL datetime', () => {
      const result = toMysqlDatetimeUtc('2026-03-26T02:41:56.000Z');
      expect(result).toBe('2026-03-26 02:41:56');
    });

    it('should format timestamp to MySQL datetime', () => {
      const date = new Date('2026-03-26T02:41:56.000Z');
      const result = toMysqlDatetimeUtc(date.getTime());
      expect(result).toBe('2026-03-26 02:41:56');
    });

    it('should handle single digit months and days', () => {
      const date = new Date('2026-01-05T08:05:03.000Z');
      const result = toMysqlDatetimeUtc(date);
      expect(result).toBe('2026-01-05 08:05:03');
    });

    it('should return null for invalid date', () => {
      const result = toMysqlDatetimeUtc('invalid-date');
      expect(result).toBeNull();
    });

    it('should return null for NaN date', () => {
      const result = toMysqlDatetimeUtc(new Date('invalid'));
      expect(result).toBeNull();
    });
  });

  describe('sanitizeSqlParamIsoToMysqlDatetime', () => {
    it('should convert ISO 8601 string to MySQL datetime', () => {
      const result = sanitizeSqlParamIsoToMysqlDatetime('2026-03-26T02:41:56.453Z');
      expect(result).toBe('2026-03-26 02:41:56');
    });

    it('should convert ISO string with offset to UTC', () => {
      const result = sanitizeSqlParamIsoToMysqlDatetime('2026-03-26T02:41:56.453+05:00');
      expect(result).toBe('2026-03-25 21:41:56');
    });

    it('should leave non-ISO strings unchanged', () => {
      expect(sanitizeSqlParamIsoToMysqlDatetime('plain text')).toBe('plain text');
      expect(sanitizeSqlParamIsoToMysqlDatetime('2026/03/26')).toBe('2026/03/26');
    });

    it('should leave numbers unchanged', () => {
      expect(sanitizeSqlParamIsoToMysqlDatetime(123)).toBe(123);
      expect(sanitizeSqlParamIsoToMysqlDatetime(null)).toBe(null);
    });

    it('should return value if date parsing fails', () => {
      const result = sanitizeSqlParamIsoToMysqlDatetime('2026-03-26Tinvalid');
      expect(result).toBe('2026-03-26Tinvalid');
    });
  });

  describe('sanitizeSqlParams', () => {
    it('should sanitize array of params', () => {
      const params = [
        '2026-03-26T02:41:56.453Z',
        'plain text',
        123,
      ];
      const result = sanitizeSqlParams(params);
      expect(result).toEqual(['2026-03-26 02:41:56', 'plain text', 123]);
    });

    it('should return empty array', () => {
      expect(sanitizeSqlParams([])).toEqual([]);
    });

    it('should return non-array unchanged', () => {
      expect(sanitizeSqlParams('not an array')).toBe('not an array');
    });
  });

  describe('clampPagination', () => {
    it('should return provided values when valid', () => {
      const result = clampPagination(20, 10);
      expect(result).toEqual({ limit: 20, offset: 10 });
    });

    it('should use defaults for missing values', () => {
      const result = clampPagination(undefined, undefined);
      expect(result).toEqual({ limit: 50, offset: 0 });
    });

    it('should use default limit when 0 is passed', () => {
      const result = clampPagination(0, 0);
      expect(result.limit).toBe(50);
    });

    it('should clamp limit to maxLimit', () => {
      const result = clampPagination(200, 0, 100);
      expect(result.limit).toBe(100);
    });

    it('should clamp negative offset to 0', () => {
      const result = clampPagination(10, -5);
      expect(result.offset).toBe(0);
    });

    it('should parse string values', () => {
      const result = clampPagination('25', '15');
      expect(result).toEqual({ limit: 25, offset: 15 });
    });

    it('should clamp offset to 0 for negative string', () => {
      const result = clampPagination('10', '-5');
      expect(result.offset).toBe(0);
    });
  });

  describe('sanitizeReleaseDate', () => {
    it('should return valid release date', () => {
      expect(sanitizeReleaseDate('2026-03-26')).toBe('2026-03-26');
    });

    it('should trim whitespace', () => {
      expect(sanitizeReleaseDate('  2026-03-26  ')).toBe('2026-03-26');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeReleaseDate(null)).toBe('');
      expect(sanitizeReleaseDate(undefined)).toBe('');
    });

    it('should truncate long strings', () => {
      const longDate = 'a'.repeat(300);
      const result = sanitizeReleaseDate(longDate);
      expect(result.length).toBe(RELEASE_DATE_MAX_LEN);
      expect(result).toBe(longDate.slice(0, RELEASE_DATE_MAX_LEN));
    });

    it('should return empty string for empty input', () => {
      expect(sanitizeReleaseDate('')).toBe('');
    });
  });

  describe('RELEASE_DATE_MAX_LEN', () => {
    it('should be 255', () => {
      expect(RELEASE_DATE_MAX_LEN).toBe(255);
    });
  });
});
