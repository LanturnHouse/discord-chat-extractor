import type { Snowflake } from '@/lib/discord/types';
import { MAX_EXPORT_LIMIT, type ExportScope } from '@/lib/export/types';

/**
 * Why a scope cannot be exported: a bound that is not a date, a start after the end, or a count that is not a whole number
 * from 1 to MAX_EXPORT_LIMIT. The UI keeps such input to itself; this is the check for what actually reaches the store.
 */
export type ScopeIssue = 'date' | 'inverted' | 'limit';

/** null (no limit) or a whole number from 1 to MAX_EXPORT_LIMIT. */
export function isValidLimit(limit: number | null): boolean {
  return limit === null || (typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= MAX_EXPORT_LIMIT);
}

/** The first thing wrong with a scope (dates first, then their order, then the count), or null when it can be exported. */
export function scopeIssue(scope: ExportScope): ScopeIssue | null {
  const after = scope.after === null ? null : Date.parse(scope.after);
  const before = scope.before === null ? null : Date.parse(scope.before);
  if ((after !== null && Number.isNaN(after)) || (before !== null && Number.isNaN(before))) return 'date';
  if (after !== null && before !== null && after > before) return 'inverted';
  return isValidLimit(scope.limit) ? null : 'limit';
}

export function sameScope(a: ExportScope, b: ExportScope): boolean {
  return a.after === b.after && a.before === b.before && a.limit === b.limit;
}

/** A fresh object holding exactly the three scope fields (the store never keeps a caller's object, nor extra properties). */
export function copyScope(scope: ExportScope): ExportScope {
  return { after: scope.after, before: scope.before, limit: scope.limit };
}

/** The overrides whose channel is still selected; the very same object when none has to go. */
export function pruneOverrides(
  overrides: Record<Snowflake, ExportScope>,
  selection: Readonly<Record<Snowflake, unknown>>,
): Record<Snowflake, ExportScope> {
  const kept = Object.entries(overrides).filter(([channelId]) => Object.hasOwn(selection, channelId));
  return kept.length === Object.keys(overrides).length ? overrides : Object.fromEntries(kept);
}
