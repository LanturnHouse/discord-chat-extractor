import type { Snowflake } from './types';

/** Discord epoch: 2015-01-01T00:00:00.000Z */
export const DISCORD_EPOCH = 1420070400000n;

/** Creation time (unix ms) encoded in a snowflake. */
export function snowflakeToTimestamp(id: Snowflake): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/**
 * Largest id `timestampToSnowflake` hands out: 2^63 - 1, what a signed 64-bit integer holds (the year 2084). The API refuses
 * longer ids, so a date beyond that must not become a cursor that fails the request. No message can be that new anyway, which
 * makes this cursor "past the newest message" for `before` and "past everything" for `after`.
 */
export const MAX_SNOWFLAKE: Snowflake = ((1n << 63n) - 1n).toString();

const DISCORD_EPOCH_MS = Number(DISCORD_EPOCH);
const MAX_SNOWFLAKE_MS = snowflakeToTimestamp(MAX_SNOWFLAKE) + 1;

/**
 * Smallest snowflake for a given unix-ms time (useful as an `after` / `before` cursor for date ranges). Total: a time at or
 * before the Discord epoch gives '0' (from the beginning of any channel), one the id space cannot hold gives MAX_SNOWFLAKE.
 */
export function timestampToSnowflake(ms: number): Snowflake {
  if (!(ms > DISCORD_EPOCH_MS)) return '0';
  if (ms >= MAX_SNOWFLAKE_MS) return MAX_SNOWFLAKE;
  return ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();
}

/** Numeric comparison of decimal-string snowflakes without BigInt: shorter is smaller, otherwise lexicographic. */
export function compareSnowflakes(a: Snowflake, b: Snowflake): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

/** Sort ascending (oldest first) by id. Returns a new array. */
export function sortByIdAsc<T extends { id: Snowflake }>(items: readonly T[]): T[] {
  return [...items].sort((x, y) => compareSnowflakes(x.id, y.id));
}
