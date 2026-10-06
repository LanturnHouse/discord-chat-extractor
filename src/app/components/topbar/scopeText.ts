import type { ExportScope } from '@/lib/export/types';
import { isoToDateInput } from './dates';
import type { NumberFormatter } from './format';
import type { topbarStrings } from './strings';

type Strings = (typeof topbarStrings)['en'];

/** A short phrase for a scope ("Newest 200 messages", "From 2026-01-01: first 500"): what a row of the selection list and the progress list say. */
export function describeScope(scope: ExportScope, t: Strings, fmt: NumberFormatter): string {
  const from = isoToDateInput(scope.after);
  const to = isoToDateInput(scope.before);
  const { limit } = scope;
  if (limit === null) {
    if (from === '' && to === '') return t.scopeAll;
    if (to === '') return t.scopeFrom(from);
    if (from === '') return t.scopeUntil(to);
    return t.scopeBetween(from, to);
  }
  if (from === '' && to === '') return t.scopeNewest(limit, fmt);
  if (to === '') return t.scopeFromLimit(from, limit, fmt);
  if (from === '') return t.scopeUntilLimit(to, limit, fmt);
  return t.scopeBetweenLimit(from, to, limit, fmt);
}

/**
 * The sentence under the count: which messages the number picks, given which dates are set. No start date counts back from the
 * present (or from the end date); a start date counts forward from it and never passes the end date.
 */
export function describeLimit(hasFrom: boolean, hasTo: boolean, count: number, t: Strings, fmt: NumberFormatter): string {
  if (!hasFrom) return hasTo ? t.limitHelpUntil(count, fmt) : t.limitHelpNewest(count, fmt);
  return hasTo ? t.limitHelpWindow(count, fmt) : t.limitHelpFrom(count, fmt);
}
