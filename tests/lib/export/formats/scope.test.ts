import { describe, expect, it } from 'vitest';
import { describeScope, formatStamp, getExportStrings } from '../../../../src/lib/export/formats/text';
import type { ExportScope } from '../../../../src/lib/export/types';

const A = '2026-01-01T00:00:00.000Z';
const B = '2026-03-01T00:00:00.000Z';
const scope = (after: string | null, before: string | null, limit: number | null): ExportScope => ({ after, before, limit });

describe('describeScope', () => {
  describe('in English', () => {
    it.each([
      ['the whole history', scope(null, null, null), 'all messages'],
      ['a window from a date', scope(A, null, null), 'from 2026-01-01 00:00:00'],
      ['a window up to a date', scope(null, B, null), 'until 2026-03-01 00:00:00'],
      ['a window between two dates', scope(A, B, null), '2026-01-01 00:00:00 to 2026-03-01 00:00:00'],
      ['the newest N', scope(null, null, 200), 'newest 200 messages'],
      ['the first N from a date', scope(A, null, 500), 'from 2026-01-01 00:00:00: first 500 messages'],
      ['the newest N up to a date', scope(null, B, 200), 'until 2026-03-01 00:00:00: newest 200 messages'],
      ['the first N of a window', scope(A, B, 500), '2026-01-01 00:00:00 to 2026-03-01 00:00:00: first 500 messages'],
    ])('%s', (_name, given, expected) => {
      expect(describeScope(given, 'en', 'UTC')).toBe(expected);
    });

    it('uses the singular for one message and groups thousands', () => {
      expect(describeScope(scope(null, null, 1), 'en', 'UTC')).toBe('newest 1 message');
      expect(describeScope(scope(A, null, 1), 'en', 'UTC')).toBe('from 2026-01-01 00:00:00: first 1 message');
      expect(describeScope(scope(null, null, 1500), 'en', 'UTC')).toBe('newest 1,500 messages');
      expect(describeScope(scope(null, null, 500_000), 'en', 'UTC')).toBe('newest 500,000 messages');
    });
  });

  describe('in Korean', () => {
    it.each([
      ['the whole history', scope(null, null, null), '전체 메시지'],
      ['a window from a date', scope(A, null, null), '2026-01-01 00:00:00부터'],
      ['a window up to a date', scope(null, B, null), '2026-03-01 00:00:00까지'],
      ['a window between two dates', scope(A, B, null), '2026-01-01 00:00:00 ~ 2026-03-01 00:00:00'],
      ['the newest N', scope(null, null, 200), '최근 200개 메시지'],
      ['the first N from a date', scope(A, null, 500), '2026-01-01 00:00:00부터 처음 500개'],
      ['the newest N up to a date', scope(null, B, 200), '2026-03-01 00:00:00까지 최근 200개'],
      ['the first N of a window', scope(A, B, 500), '2026-01-01 00:00:00 ~ 2026-03-01 00:00:00 처음 500개'],
    ])('%s', (_name, given, expected) => {
      expect(describeScope(given, 'ko', 'UTC')).toBe(expected);
    });

    it('groups thousands', () => {
      expect(describeScope(scope(null, null, 12_345), 'ko', 'UTC')).toBe('최근 12,345개 메시지');
    });
  });

  it('prints the dates in the time zone of the export', () => {
    expect(describeScope(scope(A, B, 10), 'en', 'Asia/Seoul')).toBe('2026-01-01 09:00:00 to 2026-03-01 09:00:00: first 10 messages');
    expect(describeScope(scope(null, B, 10), 'ko', 'America/New_York')).toBe('2026-02-28 19:00:00까지 최근 10개');
  });

  it('is a function of the scope alone: the other options of the export do not matter', () => {
    const options = { format: 'html', htmlTheme: 'light', locale: 'ko', timeZone: 'Asia/Seoul', after: A, before: null, limit: 3 } as const;
    expect(describeScope(options, 'en', 'UTC')).toBe('from 2026-01-01 00:00:00: first 3 messages');
  });

  it('falls back to English for an unexpected locale, like every fixed text of an export', () => {
    expect(describeScope(scope(null, null, 3), 'fr' as 'en', 'UTC')).toBe('newest 3 messages');
  });

  it('shows an unparsable date as it was sent (single line) instead of dropping it', () => {
    expect(describeScope(scope('next\nweek', null, 4), 'en', 'UTC')).toBe('from next week: first 4 messages');
  });

  it.each([0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '7', undefined, null])('prints no count for the invalid count %s', (limit) => {
    const given = { after: null, before: null, limit } as unknown as ExportScope;
    expect(describeScope(given, 'en', 'UTC')).toBe('all messages');
    expect(describeScope(given, 'ko', 'UTC')).toBe('전체 메시지');
  });

  it('is the text behind the fixed words of both languages', () => {
    expect(getExportStrings('en').rangeText('X', null, 5)).toBe('from X: first 5 messages');
    expect(getExportStrings('ko').rangeText(null, null, null)).toBe('전체 메시지');
  });
});

describe('formatStamp', () => {
  it('formats an ISO instant in the zone, passes through what is not a date, and ignores non-strings', () => {
    expect(formatStamp('2026-10-06T12:34:56.000Z', 'Asia/Seoul')).toBe('2026-10-06 21:34:56');
    expect(formatStamp('not\na date', 'UTC')).toBe('not a date');
    expect(formatStamp(undefined, 'UTC')).toBe('');
    expect(formatStamp(12, 'UTC')).toBe('');
  });
});
