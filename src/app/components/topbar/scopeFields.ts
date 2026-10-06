import { MAX_EXPORT_LIMIT, type ExportScope } from '@/lib/export/types';
import { checkRange, endOfDayIso, isoToDateInput, startOfDayIso, type RangeFields, type RangeProblem } from './dates';

/** What "Limit to N" starts with, and the quick-pick buttons next to the number. */
export const DEFAULT_LIMIT = 100;
export const LIMIT_CHIPS: readonly number[] = [100, 500, 1000, 5000, 10000];

/**
 * What the scope inputs show: the two dates as `<input type="date">` values plus the message count as the user typed it.
 * The stores only ever receive a scope that can be exported; anything else stays in these fields (see `ScopeEditor`).
 */
export interface ScopeFields extends RangeFields {
  /** 'all' = no limit. */
  limitMode: 'all' | 'limit';
  /** The number input's value while the mode is 'limit' (digits as typed; '' when empty or unreadable). */
  limitText: string;
  /** The user typed something the number input cannot read (its value is '' although it shows text). */
  limitBad: boolean;
}

/** empty: nothing typed; whole: not a whole number (decimals, exponent, text); range: a whole number outside 1..MAX_EXPORT_LIMIT. */
export type LimitProblem = 'empty' | 'whole' | 'range';

export interface FieldsProblem {
  range: RangeProblem | null;
  limit: LimitProblem | null;
}

const INTEGER = /^-?\d+$/;

export function fieldsOf(scope: ExportScope): ScopeFields {
  return {
    from: isoToDateInput(scope.after),
    to: isoToDateInput(scope.before),
    fromPartial: false,
    toPartial: false,
    limitMode: scope.limit === null ? 'all' : 'limit',
    limitText: scope.limit === null ? '' : String(scope.limit),
    limitBad: false,
  };
}

export function checkLimitText(text: string, bad: boolean): LimitProblem | null {
  const trimmed = text.trim();
  if (trimmed === '') return bad ? 'whole' : 'empty';
  if (!INTEGER.test(trimmed)) return 'whole';
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_EXPORT_LIMIT ? null : 'range';
}

/** Why the fields cannot be exported as they are (null = they can). An empty date means "no bound", an empty count in 'all' mode is fine. */
export function checkFields(fields: ScopeFields): FieldsProblem | null {
  const range = checkRange(fields);
  const limit = fields.limitMode === 'limit' ? checkLimitText(fields.limitText, fields.limitBad) : null;
  return range === null && limit === null ? null : { range, limit };
}

export function sameFields(a: ScopeFields, b: ScopeFields): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.fromPartial === b.fromPartial &&
    a.toPartial === b.toPartial &&
    a.limitMode === b.limitMode &&
    a.limitText === b.limitText &&
    a.limitBad === b.limitBad
  );
}

/**
 * The scope for fields that passed `checkFields`, starting from the scope that is stored now: a date range that was not touched
 * keeps its exact instants (an instant that does not sit on a day boundary is not rounded just because the count changed).
 */
export function scopeFromFields(fields: ScopeFields, stored: ExportScope): ExportScope {
  const shown = fieldsOf(stored);
  const rangeUntouched = fields.from === shown.from && fields.to === shown.to;
  return {
    after: rangeUntouched ? stored.after : startOfDayIso(fields.from),
    before: rangeUntouched ? stored.before : endOfDayIso(fields.to),
    limit: fields.limitMode === 'limit' ? Number(fields.limitText.trim()) : null,
  };
}
