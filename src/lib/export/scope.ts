import { MAX_EXPORT_LIMIT, type ExportScope } from './types';

/** A scope that passed validation, with its dates parsed to unix milliseconds. */
export interface ResolvedScope {
  afterMs: number | null;
  beforeMs: number | null;
  limit: number | null;
}

function parseBound(value: string | null, name: 'after' | 'before', where: string): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid export range in ${where}: ${name} (${JSON.stringify(value)}) is not a date.`);
  return ms;
}

/**
 * Checks `scope` (the UI validates too; this is the last line of defence before requests start) and parses its dates.
 * A bad scope is a programmer error and throws a RangeError naming `where`; `after` equal to `before` is a valid one-instant window.
 */
export function resolveScope(scope: ExportScope, where: string): ResolvedScope {
  const afterMs = parseBound(scope.after, 'after', where);
  const beforeMs = parseBound(scope.before, 'before', where);
  if (afterMs !== null && beforeMs !== null && afterMs > beforeMs) {
    throw new RangeError(`Invalid export range in ${where}: after (${scope.after}) is later than before (${scope.before}).`);
  }
  const { limit } = scope;
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_EXPORT_LIMIT)) {
    throw new RangeError(`Invalid export limit in ${where}: ${String(limit)} is not an integer from 1 to ${MAX_EXPORT_LIMIT}.`);
  }
  return { afterMs, beforeMs, limit };
}
