import { describe, expect, it } from 'vitest';
import {
  DISCORD_EPOCH,
  MAX_SNOWFLAKE,
  compareSnowflakes,
  snowflakeToTimestamp,
  sortByIdAsc,
  timestampToSnowflake,
} from '@/lib/discord/snowflake';

describe('snowflakeToTimestamp', () => {
  it("decodes the example from Discord's documentation", () => {
    expect(snowflakeToTimestamp('175928847299117063')).toBe(1462015105796);
  });

  it('decodes the Discord epoch itself', () => {
    expect(snowflakeToTimestamp('0')).toBe(Number(DISCORD_EPOCH));
  });

  it('is exact for ids above 2^53 (no float precision loss)', () => {
    const id = '1234567890123456789';
    expect(Number(id).toString()).not.toBe(id); // the id really is not representable as a double
    expect(snowflakeToTimestamp(id)).toBe(Number((1234567890123456789n >> 22n) + DISCORD_EPOCH));
  });
});

describe('timestampToSnowflake', () => {
  it('round-trips with snowflakeToTimestamp', () => {
    for (const ms of [1462015105796, Date.UTC(2020, 5, 17, 12, 30, 15, 123), Date.UTC(2026, 9, 6)]) {
      expect(snowflakeToTimestamp(timestampToSnowflake(ms))).toBe(ms);
    }
  });

  it('clamps times at or before the Discord epoch to "0"', () => {
    expect(timestampToSnowflake(Number(DISCORD_EPOCH))).toBe('0');
    expect(timestampToSnowflake(0)).toBe('0');
    expect(timestampToSnowflake(-5)).toBe('0');
  });

  it('floors fractional milliseconds', () => {
    expect(timestampToSnowflake(1462015105796.9)).toBe(timestampToSnowflake(1462015105796));
  });

  it('produces the smallest id of that millisecond (all low bits zero)', () => {
    expect(BigInt(timestampToSnowflake(1462015105796)) & 0x3fffffn).toBe(0n);
    expect(compareSnowflakes(timestampToSnowflake(1462015105796), '175928847299117063')).toBe(-1);
  });

  describe('times the id space cannot hold', () => {
    // The first millisecond whose bare id no longer fits a signed 64-bit integer (2084-09-06).
    const FIRST_UNREPRESENTABLE_MS = 3619093655552;

    it('has the largest id fit 63 bits', () => {
      expect(MAX_SNOWFLAKE).toBe('9223372036854775807');
      expect(snowflakeToTimestamp(MAX_SNOWFLAKE) + 1).toBe(FIRST_UNREPRESENTABLE_MS);
    });

    it('is exact up to the last representable millisecond and clamps from the next one on', () => {
      expect(timestampToSnowflake(FIRST_UNREPRESENTABLE_MS - 1)).toBe(String((2n ** 41n - 1n) << 22n));
      expect(snowflakeToTimestamp(timestampToSnowflake(FIRST_UNREPRESENTABLE_MS - 1))).toBe(FIRST_UNREPRESENTABLE_MS - 1);
      expect(timestampToSnowflake(FIRST_UNREPRESENTABLE_MS)).toBe(MAX_SNOWFLAKE);
      expect(timestampToSnowflake(FIRST_UNREPRESENTABLE_MS + 1)).toBe(MAX_SNOWFLAKE);
    });

    it.each([
      ['2099-01-01', Date.UTC(2099, 0, 1)],
      ['2154 (the 64-bit limit of an unsigned id)', Date.UTC(2154, 5, 1)],
      ['2769', Date.UTC(2769, 0, 1)],
      ['9999-12-31 (the last date a date input accepts)', Date.UTC(9999, 11, 31, 23, 59, 59, 999)],
      ['the largest JS date', 8.64e15],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('turns %s into the largest id instead of one that is too long to send', (_label, ms) => {
      expect(timestampToSnowflake(ms)).toBe(MAX_SNOWFLAKE);
      expect(BigInt(timestampToSnowflake(ms)) < 1n << 64n).toBe(true);
    });

    it('never gives a longer id than 19 digits and never goes backwards as time grows', () => {
      let previous = -1n;
      for (const ms of [-Infinity, -1, 0, 1420070400000, 1420070400001, Date.UTC(2026, 9, 6), Date.UTC(2084, 8, 6), Date.UTC(2084, 8, 7), Date.UTC(3000, 0, 1), Date.UTC(9999, 11, 31), Infinity]) {
        const id = timestampToSnowflake(ms);
        expect(id.length).toBeLessThanOrEqual(19);
        expect(BigInt(id) >= previous).toBe(true);
        previous = BigInt(id);
      }
    });

    it('turns what is not a time into "0" (the start of every channel)', () => {
      expect(timestampToSnowflake(Number.NaN)).toBe('0');
      expect(timestampToSnowflake(Number.NEGATIVE_INFINITY)).toBe('0');
      expect(timestampToSnowflake(Date.UTC(1999, 0, 1))).toBe('0');
    });
  });
});

describe('compareSnowflakes', () => {
  it('compares numerically even when lengths differ', () => {
    expect(compareSnowflakes('999999999999999999', '1000000000000000000')).toBe(-1);
    expect(compareSnowflakes('1000000000000000000', '999999999999999999')).toBe(1);
    expect(compareSnowflakes('9', '10')).toBe(-1);
  });

  it('compares equal-length ids lexicographically', () => {
    expect(compareSnowflakes('175928847299117063', '175928847299117064')).toBe(-1);
    expect(compareSnowflakes('275928847299117063', '175928847299117064')).toBe(1);
  });

  it('returns 0 for identical ids', () => {
    expect(compareSnowflakes('42', '42')).toBe(0);
  });
});

describe('sortByIdAsc', () => {
  const items = [{ id: '1000000000000000000' }, { id: '999999999999999999' }, { id: '1000000000000000001' }];

  it('sorts oldest first without mutating the input', () => {
    const before = items.map((i) => i.id);
    expect(sortByIdAsc(items).map((i) => i.id)).toEqual(['999999999999999999', '1000000000000000000', '1000000000000000001']);
    expect(items.map((i) => i.id)).toEqual(before);
  });

  it('handles empty and single-element arrays', () => {
    expect(sortByIdAsc([])).toEqual([]);
    expect(sortByIdAsc([{ id: '5' }])).toEqual([{ id: '5' }]);
  });
});
