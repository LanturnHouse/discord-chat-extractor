import { describe, expect, it } from 'vitest';
import { checkRange, endOfDayIso, isInvertedRange, isoToDateInput, startOfDayIso, type RangeFields } from '@/app/components/topbar/dates';
import { formatElapsed } from '@/app/components/topbar/format';
import { FORMAT_CHIPS, FORMAT_NAMES, FORMAT_ORDER } from '@/app/components/topbar/formats';
import { countProcessed, isActiveStatus, isFinishedStatus, overallRatio, processedCount } from '@/app/components/topbar/progress';
import { EXPORT_FORMAT_IDS, type ExportProgress, type TargetProgress, type TargetStatus } from '@/lib/export/types';

describe('dates', () => {
  it('From is the start and To the very end of the LOCAL day', () => {
    const start = new Date(startOfDayIso('2026-10-06') ?? '');
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([2026, 9, 6, 0, 0, 0, 0]);
    const end = new Date(endOfDayIso('2026-10-06') ?? '');
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([2026, 9, 6, 23, 59, 59, 999]);
  });

  it('returns ISO instants (UTC, with milliseconds)', () => {
    expect(startOfDayIso('2026-10-06')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(endOfDayIso('2026-10-06')).toMatch(/Z$/);
  });

  it('a day lasts from the start to the end instant', () => {
    const span = Date.parse(endOfDayIso('2026-03-15') ?? '') - Date.parse(startOfDayIso('2026-03-15') ?? '');
    // 24h minus a millisecond; a daylight-saving change inside the day shifts it by an hour.
    expect([86_399_999, 86_399_999 - 3_600_000, 86_399_999 + 3_600_000]).toContain(span);
  });

  it('rejects empty, malformed and impossible days', () => {
    for (const value of ['', 'abc', '2026-1-1', '2026-13-01', '2026-02-30', '2025-02-29', '20261006', '2026-10-06T00:00', '275760-09-13']) {
      expect(startOfDayIso(value), value).toBeNull();
      expect(endOfDayIso(value), value).toBeNull();
    }
    expect(startOfDayIso('2028-02-29')).not.toBeNull();
  });

  it('years below 100 stay in that year', () => {
    expect(new Date(startOfDayIso('0050-06-07') ?? '').getFullYear()).toBe(50);
  });

  it('isoToDateInput gives the local calendar day, and round-trips with both ends', () => {
    expect(isoToDateInput(startOfDayIso('2026-10-06'))).toBe('2026-10-06');
    expect(isoToDateInput(endOfDayIso('2026-10-06'))).toBe('2026-10-06');
    expect(isoToDateInput(endOfDayIso('2026-12-31'))).toBe('2026-12-31');
    expect(isoToDateInput(startOfDayIso('2026-01-01'))).toBe('2026-01-01');
    expect(isoToDateInput(startOfDayIso('0050-06-07'))).toBe('0050-06-07');
  });

  it('isoToDateInput is empty for null and garbage', () => {
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('not a date')).toBe('');
    expect(isoToDateInput('')).toBe('');
  });

  it('isInvertedRange compares calendar days: only a start AFTER the end is inverted', () => {
    expect(isInvertedRange('2026-10-06', '2026-10-05')).toBe(true);
    expect(isInvertedRange('2027-01-01', '2026-12-31')).toBe(true);
    expect(isInvertedRange('2026-10-05', '2026-10-05')).toBe(false);
    expect(isInvertedRange('2026-10-04', '2026-10-05')).toBe(false);
    expect(isInvertedRange('', '2026-10-05')).toBe(false);
    expect(isInvertedRange('2026-10-05', '')).toBe(false);
    expect(isInvertedRange('', '')).toBe(false);
  });

  it('isInvertedRange compares instants: years with more than 4 digits are not days at all, so never "inverted"', () => {
    expect(isInvertedRange('10000-01-01', '2026-01-01')).toBe(false);
    expect(isInvertedRange('2026-01-01', '10000-01-01')).toBe(false);
    expect(isInvertedRange('0999-12-31', '1000-01-01')).toBe(false);
    expect(isInvertedRange('1000-01-01', '0999-12-31')).toBe(true);
  });
});

describe('checkRange', () => {
  const fields = (patch: Partial<RangeFields> = {}): RangeFields => ({ from: '', to: '', fromPartial: false, toPartial: false, ...patch });

  it('accepts empty fields (no limit), one end and a valid pair', () => {
    expect(checkRange(fields())).toBeNull();
    expect(checkRange(fields({ from: '2026-10-01' }))).toBeNull();
    expect(checkRange(fields({ to: '2026-10-01' }))).toBeNull();
    expect(checkRange(fields({ from: '2026-10-01', to: '2026-10-01' }))).toBeNull();
    expect(checkRange(fields({ from: '2026-09-30', to: '2026-10-01' }))).toBeNull();
  });

  it('From after To is "inverted" and flags both fields', () => {
    expect(checkRange(fields({ from: '2026-10-02', to: '2026-10-01' }))).toEqual({ kind: 'inverted', from: true, to: true });
  });

  it('a value that is not a real day is "invalid" and flags only that field', () => {
    expect(checkRange(fields({ from: '20261-10-06' }))).toEqual({ kind: 'invalid', from: true, to: false });
    expect(checkRange(fields({ from: '2026-10-01', to: '10000-01-01' }))).toEqual({ kind: 'invalid', from: false, to: true });
    expect(checkRange(fields({ from: '2026-02-30' }))).toEqual({ kind: 'invalid', from: true, to: false });
    expect(checkRange(fields({ from: 'abc', to: 'def' }))).toEqual({ kind: 'invalid', from: true, to: true });
  });

  it('an unfinished date is "invalid", even though the value is empty', () => {
    expect(checkRange(fields({ fromPartial: true }))).toEqual({ kind: 'invalid', from: true, to: false });
    expect(checkRange(fields({ to: '2026-10-01', toPartial: true }))).toEqual({ kind: 'invalid', from: false, to: true });
  });

  it('invalid wins over inverted: a bad field cannot be compared', () => {
    expect(checkRange(fields({ from: '20261-10-06', to: '2026-01-01' }))).toEqual({ kind: 'invalid', from: true, to: false });
  });
});

describe('formatElapsed', () => {
  it('prints mm:ss, and h:mm:ss from one hour on', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(1000)).toBe('00:01');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_661_000)).toBe('1:01:01');
    expect(formatElapsed(25 * 3_600_000)).toBe('25:00:00');
  });

  it('never goes negative', () => {
    expect(formatElapsed(-5000)).toBe('00:00');
  });
});

function target(status: TargetStatus, ratio: number | null = 0): TargetProgress {
  return { channelId: status, label: status, status, fetched: 0, ratio };
}

function snapshot(...targets: TargetProgress[]): ExportProgress {
  return { phase: 'fetching', targets, currentIndex: -1, totalMessages: 0 };
}

describe('progress helpers', () => {
  it('classifies the job statuses', () => {
    expect(['running', 'packaging'].every((status) => isActiveStatus(status as 'running'))).toBe(true);
    expect(['idle', 'done', 'cancelled', 'error'].some((status) => isActiveStatus(status as 'idle'))).toBe(false);
    expect(['done', 'cancelled', 'error'].every((status) => isFinishedStatus(status as 'done'))).toBe(true);
    expect(['idle', 'running', 'packaging'].some((status) => isFinishedStatus(status as 'idle'))).toBe(false);
  });

  it('counts processed targets: exported, skipped and failed; not queued, fetching or cancelled', () => {
    expect(countProcessed([target('done'), target('skipped'), target('error'), target('queued'), target('fetching'), target('cancelled')])).toBe(3);
    expect(countProcessed([])).toBe(0);
  });

  it('processedCount handles a missing snapshot and gives the same answer for the same snapshot', () => {
    expect(processedCount(null)).toBe(0);
    const first = snapshot(target('done'), target('queued'));
    expect(processedCount(first)).toBe(1);
    expect(processedCount(first)).toBe(1);
    expect(processedCount(snapshot(target('done'), target('done'), target('skipped')))).toBe(3);
    expect(processedCount(first)).toBe(1);
  });

  it('the overall ratio adds up finished channels and the fraction of the current one', () => {
    expect(overallRatio(null)).toBe(0);
    expect(overallRatio(snapshot())).toBe(0);
    expect(overallRatio(snapshot(target('queued'), target('queued')))).toBe(0);
    expect(overallRatio(snapshot(target('done', 1), target('fetching', 0.5), target('queued'), target('queued')))).toBeCloseTo(0.375);
    expect(overallRatio(snapshot(target('done', 1), target('skipped'), target('error')))).toBe(1);
  });

  it('an unknown ratio counts as 0, out-of-range ratios are clamped, cancelled channels add nothing', () => {
    expect(overallRatio(snapshot(target('fetching', null), target('queued')))).toBe(0);
    expect(overallRatio(snapshot(target('fetching', 7), target('queued')))).toBe(0.5);
    expect(overallRatio(snapshot(target('fetching', -3), target('queued')))).toBe(0);
    expect(overallRatio(snapshot(target('done', 1), target('cancelled')))).toBe(0.5);
  });
});

describe('format facts', () => {
  it('cover every export format, recommended one (HTML) first', () => {
    expect([...FORMAT_ORDER]).toEqual([...EXPORT_FORMAT_IDS]);
    expect(FORMAT_ORDER[0]).toBe('html');
    for (const id of EXPORT_FORMAT_IDS) {
      expect(FORMAT_NAMES[id].length).toBeGreaterThan(0);
      expect(FORMAT_CHIPS[id].length).toBeGreaterThan(0);
      expect(FORMAT_CHIPS[id].length).toBeLessThanOrEqual(4);
    }
    expect(new Set(Object.values(FORMAT_CHIPS)).size).toBe(EXPORT_FORMAT_IDS.length);
  });
});
