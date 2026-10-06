import { API_MESSAGE_LIMIT } from '../../shared/constants';
import type { DiscordClient } from '../discord/client';
import { compareSnowflakes, snowflakeToTimestamp, sortByIdAsc, timestampToSnowflake } from '../discord/snowflake';
import type { Message, Snowflake } from '../discord/types';
import type { ResolvedScope } from './scope';

export interface PagingSink {
  /** The next messages in chronological order: every message arrives exactly once, at most API_MESSAGE_LIMIT per call. */
  write(batch: Message[]): void;
  /**
   * `count` messages are in hand after a page: fetched and written when walking forward, collected but not yet written when
   * looking for the newest ones. `newestId` is the newest of them.
   */
  collected(count: number, newestId: Snowflake): void;
}

export interface PagingArgs {
  client: DiscordClient;
  channelId: Snowflake;
  scope: ResolvedScope;
  signal?: AbortSignal;
  sink: PagingSink;
}

/** Snowflake creation time, or null for ids that are not plain decimal numbers (BigInt would throw on those). */
export function snowflakeTime(id: Snowflake): number | null {
  return /^\d+$/.test(id) ? snowflakeToTimestamp(id) : null;
}

function messageTime(message: Message): number | null {
  const parsed = Date.parse(message.timestamp);
  return Number.isNaN(parsed) ? snowflakeTime(message.id) : parsed;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

/** Id just below the first id of `afterMs`' millisecond, so that an `after` cursor includes messages from that very millisecond. */
function inclusiveAfterCursor(afterMs: number): Snowflake {
  const cursor = BigInt(timestampToSnowflake(afterMs));
  return (cursor > 0n ? cursor - 1n : 0n).toString();
}

/** Never asks for more than is still needed, so the last page of a counted export is not fetched in full. */
function pageSize(limit: number | null, collected: number): number {
  return limit === null ? API_MESSAGE_LIMIT : Math.min(API_MESSAGE_LIMIT, limit - collected);
}

function writeInBatches(messages: readonly Message[], sink: PagingSink): void {
  for (let from = 0; from < messages.length; from += API_MESSAGE_LIMIT) sink.write(messages.slice(from, from + API_MESSAGE_LIMIT));
}

/**
 * Oldest -> newest from `after` (or the start of the channel) through `before` (or the newest message), at most `limit`
 * messages. Each page is written as soon as it arrives, so memory stays flat however long the channel is.
 */
async function fetchForward({ client, channelId, scope, signal, sink }: PagingArgs): Promise<void> {
  const { afterMs, beforeMs, limit } = scope;
  let cursor = afterMs === null ? '0' : inclusiveAfterCursor(afterMs);
  let newestId = cursor;
  let collected = 0;

  while (limit === null || collected < limit) {
    throwIfAborted(signal);
    const want = pageSize(limit, collected);
    // Pages arrive newest-first even for `after` queries.
    const page = await client.getMessages(channelId, { after: cursor, limit: want }, signal);
    throwIfAborted(signal);
    if (page.length === 0) break;

    const fresh: Message[] = [];
    let pastBefore = false;
    for (const message of sortByIdAsc(page)) {
      // Also drops duplicates: after sorting they are adjacent and equal to the id we just accepted.
      if (compareSnowflakes(message.id, newestId) <= 0) continue;
      if (beforeMs !== null) {
        const time = messageTime(message);
        if (time !== null && time > beforeMs) {
          pastBefore = true;
          break;
        }
      }
      // A client that ignores `limit` must not push the export past the count that was asked for.
      if (limit !== null && collected + fresh.length === limit) break;
      fresh.push(message);
      newestId = message.id;
    }

    // A full page without a single new message means the client ignores `after`; stop instead of looping forever.
    if (fresh.length === 0) break;

    writeInBatches(fresh, sink);
    collected += fresh.length;
    sink.collected(collected, newestId);

    if (pastBefore || page.length < want) break;
    cursor = newestId;
  }
}

/**
 * The newest `limit` messages at/before `before` (or the present): pages are fetched backwards, so nothing can be written
 * until the walk is over and the oldest message is known. Memory is bounded by `limit` (<= MAX_EXPORT_LIMIT).
 */
async function fetchNewest({ client, channelId, scope, signal, sink }: PagingArgs, limit: number): Promise<void> {
  const { beforeMs } = scope;
  // `before` is exclusive and ids carry a sequence number, so the first id of the NEXT millisecond keeps messages posted at `before`.
  let cursor: Snowflake | undefined = beforeMs === null ? undefined : timestampToSnowflake(beforeMs + 1);
  /** Newest page first; each page is newest-first and strictly older than the one before it. */
  const pages: Message[][] = [];
  let oldestId: Snowflake | null = null;
  let collected = 0;

  while (collected < limit) {
    throwIfAborted(signal);
    const want = pageSize(limit, collected);
    const page = await client.getMessages(channelId, cursor === undefined ? { limit: want } : { before: cursor, limit: want }, signal);
    throwIfAborted(signal);
    if (page.length === 0) break;

    const fresh: Message[] = [];
    for (const message of sortByIdAsc(page).reverse()) {
      // Strictly decreasing ids keep the walk duplicate-free and ordered, the mirror image of the forward walk.
      if (oldestId !== null && compareSnowflakes(message.id, oldestId) >= 0) continue;
      if (beforeMs !== null) {
        const time = messageTime(message);
        if (time !== null && time > beforeMs) continue;
      }
      if (collected + fresh.length === limit) break;
      fresh.push(message);
      oldestId = message.id;
    }

    // A page without a single new message means the client ignores `before`; stop instead of looping forever.
    if (fresh.length === 0) break;

    pages.push(fresh);
    collected += fresh.length;
    sink.collected(collected, pages[0][0].id);

    if (page.length < want) break;
    cursor = fresh[fresh.length - 1].id;
  }

  // Oldest page first, each reversed to chronological order. Emptying `pages` as we go lets written messages be collected.
  for (let page = pages.pop(); page !== undefined; page = pages.pop()) {
    page.reverse();
    writeInBatches(page, sink);
  }
}

/** Feeds `sink` the part of the channel's history that `scope` selects, oldest message first. */
export function fetchHistory(args: PagingArgs): Promise<void> {
  const { afterMs, limit } = args.scope;
  return limit !== null && afterMs === null ? fetchNewest(args, limit) : fetchForward(args);
}
