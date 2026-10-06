import { describe, expect, it } from 'vitest';
import { endOfDayIso, startOfDayIso } from '@/app/components/topbar/dates';
import type { NumberFormatter } from '@/app/components/topbar/format';
import {
  checkFields,
  checkLimitText,
  DEFAULT_LIMIT,
  fieldsOf,
  LIMIT_CHIPS,
  sameFields,
  scopeFromFields,
  type ScopeFields,
} from '@/app/components/topbar/scopeFields';
import { describeLimit, describeScope } from '@/app/components/topbar/scopeText';
import { topbarStrings } from '@/app/components/topbar/strings';
import { MAX_EXPORT_LIMIT, type ExportScope } from '@/lib/export/types';

const fmt: NumberFormatter = (value) => new Intl.NumberFormat('en-US').format(value);
const scope = (patch: Partial<ExportScope> = {}): ExportScope => ({ after: null, before: null, limit: null, ...patch });
const fields = (patch: Partial<ScopeFields> = {}): ScopeFields => ({
  from: '',
  to: '',
  fromPartial: false,
  toPartial: false,
  limitMode: 'all',
  limitText: '',
  limitBad: false,
  ...patch,
});

describe('fieldsOf', () => {
  it('shows the local calendar days and the count of a scope', () => {
    expect(fieldsOf(scope())).toEqual(fields());
    expect(fieldsOf(scope({ after: startOfDayIso('2026-01-02'), before: endOfDayIso('2026-03-04'), limit: 250 }))).toEqual(
      fields({ from: '2026-01-02', to: '2026-03-04', limitMode: 'limit', limitText: '250' }),
    );
  });
});

describe('checkLimitText', () => {
  it('accepts whole numbers from 1 to the maximum, with or without leading zeros and spaces', () => {
    for (const text of ['1', '200', '007', ' 42 ', String(MAX_EXPORT_LIMIT)]) expect(checkLimitText(text, false), text).toBeNull();
  });

  it('empty text is "empty", unreadable input is "whole"', () => {
    expect(checkLimitText('', false)).toBe('empty');
    expect(checkLimitText('   ', false)).toBe('empty');
    // The number input reports '' for "1e" and the like: it is not empty, it is not a number.
    expect(checkLimitText('', true)).toBe('whole');
  });

  it('decimals, exponents and text are "whole"', () => {
    for (const text of ['1.5', '0.5', '1e3', '1,000', 'abc', '12abc', '+5', '--5']) expect(checkLimitText(text, false), text).toBe('whole');
  });

  it('0, negative numbers and anything above the maximum are "range"', () => {
    for (const text of ['0', '00', '-1', '-200', String(MAX_EXPORT_LIMIT + 1), '99999999999999999999']) {
      expect(checkLimitText(text, false), text).toBe('range');
    }
  });
});

describe('checkFields', () => {
  it('is null for every valid combination, an empty count in "all" mode included', () => {
    expect(checkFields(fields())).toBeNull();
    expect(checkFields(fields({ limitText: 'ignored while "all" is chosen' }))).toBeNull();
    expect(checkFields(fields({ from: '2026-01-01', limitMode: 'limit', limitText: '10' }))).toBeNull();
    expect(checkFields(fields({ from: '2026-01-01', to: '2026-01-01', limitMode: 'limit', limitText: '10' }))).toBeNull();
  });

  it('reports the date problem and the count problem independently', () => {
    expect(checkFields(fields({ from: '2026-02-01', to: '2026-01-01' }))).toEqual({
      range: { kind: 'inverted', from: true, to: true },
      limit: null,
    });
    expect(checkFields(fields({ limitMode: 'limit', limitText: '0' }))).toEqual({ range: null, limit: 'range' });
    expect(checkFields(fields({ from: '2026-02-30', limitMode: 'limit', limitText: '' }))).toEqual({
      range: { kind: 'invalid', from: true, to: false },
      limit: 'empty',
    });
  });
});

describe('sameFields', () => {
  it('compares every field', () => {
    expect(sameFields(fields(), fields())).toBe(true);
    for (const patch of [
      { from: 'x' },
      { to: 'x' },
      { fromPartial: true },
      { toPartial: true },
      { limitMode: 'limit' as const },
      { limitText: '1' },
      { limitBad: true },
    ]) {
      expect(sameFields(fields(), fields(patch)), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe('scopeFromFields', () => {
  it('turns days into the local start / end instants and the count into a number', () => {
    expect(scopeFromFields(fields({ from: '2026-01-02', to: '2026-03-04', limitMode: 'limit', limitText: ' 25 ' }), scope())).toEqual({
      after: startOfDayIso('2026-01-02'),
      before: endOfDayIso('2026-03-04'),
      limit: 25,
    });
    expect(scopeFromFields(fields(), scope({ limit: 3 }))).toEqual(scope());
  });

  it('keeps the exact instants of a range that was not touched (only the count changed)', () => {
    const stored = scope({ after: '2026-01-02T05:06:07.000Z', before: '2026-03-04T08:09:10.000Z' });
    const shown = fieldsOf(stored);
    expect(scopeFromFields({ ...shown, limitMode: 'limit', limitText: '9' }, stored)).toEqual({ ...stored, limit: 9 });
    // Touching one end writes both ends as whole local days.
    expect(scopeFromFields({ ...shown, to: '2026-03-05' }, stored)).toEqual({
      after: startOfDayIso(shown.from),
      before: endOfDayIso('2026-03-05'),
      limit: null,
    });
  });
});

describe('describeScope', () => {
  const day = (value: string): string | null => startOfDayIso(value);
  const end = (value: string): string | null => endOfDayIso(value);

  it('English phrases for every combination', () => {
    const t = topbarStrings.en;
    expect(describeScope(scope(), t, fmt)).toBe('All messages');
    expect(describeScope(scope({ limit: 200 }), t, fmt)).toBe('Newest 200 messages');
    expect(describeScope(scope({ limit: 1 }), t, fmt)).toBe('Newest message');
    expect(describeScope(scope({ limit: 5000 }), t, fmt)).toBe('Newest 5,000 messages');
    expect(describeScope(scope({ after: day('2026-01-01') }), t, fmt)).toBe('From 2026-01-01');
    expect(describeScope(scope({ before: end('2026-03-31') }), t, fmt)).toBe('Until 2026-03-31');
    expect(describeScope(scope({ after: day('2026-01-01'), before: end('2026-03-31') }), t, fmt)).toBe('2026-01-01 – 2026-03-31');
    expect(describeScope(scope({ after: day('2026-01-01'), limit: 500 }), t, fmt)).toBe('From 2026-01-01: first 500');
    expect(describeScope(scope({ before: end('2026-03-31'), limit: 500 }), t, fmt)).toBe('Until 2026-03-31: newest 500');
    expect(describeScope(scope({ after: day('2026-01-01'), before: end('2026-03-31'), limit: 1000 }), t, fmt)).toBe('2026-01-01 – 2026-03-31: first 1,000');
  });

  it('Korean phrases for every combination', () => {
    const t = topbarStrings.ko;
    expect(describeScope(scope(), t, fmt)).toBe('전체');
    expect(describeScope(scope({ limit: 200 }), t, fmt)).toBe('최근 200개');
    expect(describeScope(scope({ after: day('2026-01-01') }), t, fmt)).toBe('2026-01-01부터');
    expect(describeScope(scope({ before: end('2026-03-31') }), t, fmt)).toBe('2026-03-31까지');
    expect(describeScope(scope({ after: day('2026-01-01'), before: end('2026-03-31') }), t, fmt)).toBe('2026-01-01 ~ 2026-03-31');
    expect(describeScope(scope({ after: day('2026-01-01'), limit: 500 }), t, fmt)).toBe('2026-01-01부터 500개');
    expect(describeScope(scope({ before: end('2026-03-31'), limit: 500 }), t, fmt)).toBe('2026-03-31까지 최근 500개');
    expect(describeScope(scope({ after: day('2026-01-01'), before: end('2026-03-31'), limit: 1000 }), t, fmt)).toBe('2026-01-01 ~ 2026-03-31 중 처음 1,000개');
  });
});

describe('describeLimit: which messages the number picks, for the four date situations', () => {
  it('English', () => {
    const t = topbarStrings.en;
    expect(describeLimit(false, false, 200, t, fmt)).toBe('Starts from the latest message and goes back until 200 messages are collected.');
    expect(describeLimit(true, false, 200, t, fmt)).toBe('Starts at the start date and takes the first 200 messages going forward.');
    expect(describeLimit(true, true, 200, t, fmt)).toBe('Starts at the start date and takes the first 200 messages going forward, never beyond the end date.');
    expect(describeLimit(false, true, 200, t, fmt)).toBe('The 200 newest messages up to the end date.');
  });

  it('English, singular and thousands separators', () => {
    const t = topbarStrings.en;
    expect(describeLimit(false, false, 1, t, fmt)).toBe('Starts from the latest message and goes back until 1 message is collected.');
    expect(describeLimit(true, false, 1, t, fmt)).toBe('Starts at the start date and takes the first 1 message going forward.');
    expect(describeLimit(false, true, 1, t, fmt)).toBe('The newest message up to the end date.');
    expect(describeLimit(false, false, 12345, t, fmt)).toContain('12,345 messages');
  });

  it('Korean', () => {
    const t = topbarStrings.ko;
    expect(describeLimit(false, false, 200, t, fmt)).toBe('가장 최근 메시지부터 거슬러 올라가 200개를 내보내요.');
    expect(describeLimit(true, false, 200, t, fmt)).toBe('시작일부터 200개를 내보내요.');
    expect(describeLimit(true, true, 200, t, fmt)).toBe('시작일부터 200개를 내보내요. 종료일을 넘지는 않아요.');
    expect(describeLimit(false, true, 200, t, fmt)).toBe('종료일까지의 최근 200개를 내보내요.');
  });
});

describe('the quick picks and the default', () => {
  it('are the five numbers of the spec, all valid counts', () => {
    expect(LIMIT_CHIPS).toEqual([100, 500, 1000, 5000, 10000]);
    expect(DEFAULT_LIMIT).toBe(100);
    for (const chip of LIMIT_CHIPS) expect(checkLimitText(String(chip), false)).toBeNull();
  });
});
