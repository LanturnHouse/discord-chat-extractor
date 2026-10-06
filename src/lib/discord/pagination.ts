import { API_MESSAGE_LIMIT, UI_PAGE_SIZE } from '@/shared/constants';
import type { DiscordClient } from './client';
import { throwIfAborted } from './rateLimit';
import { compareSnowflakes, sortByIdAsc } from './snowflake';
import type { Message, Snowflake } from './types';

export interface MessagePageOptions {
  /** Load messages older than this id (the id of the oldest message already shown). */
  before?: Snowflake;
  /** How many messages to load. Default `UI_PAGE_SIZE`. */
  size?: number;
}

export interface MessagePage {
  /** Ascending: oldest first. */
  messages: Message[];
  /** False once the start of the channel was reached. May be true although nothing older exists; the next call then returns an empty page. */
  hasMore: boolean;
}

/**
 * One UI page of history: sequential requests of at most `API_MESSAGE_LIMIT` messages, walking backwards from `before`
 * (the newest messages when omitted) until `size` messages are collected or the channel start is hit.
 */
export async function fetchMessagePage(
  client: DiscordClient,
  channelId: Snowflake,
  opts: MessagePageOptions = {},
  signal?: AbortSignal,
): Promise<MessagePage> {
  const size = Math.max(1, Math.floor(opts.size ?? UI_PAGE_SIZE));
  const collected = new Map<Snowflake, Message>();
  let before = opts.before;
  let hasMore = true;

  while (collected.size < size) {
    throwIfAborted(signal);
    const limit = Math.min(API_MESSAGE_LIMIT, size - collected.size);
    const page = await client.getMessages(channelId, before === undefined ? { limit } : { before, limit }, signal);
    throwIfAborted(signal);

    let added = 0;
    let oldest: Snowflake | undefined;
    for (const message of page) {
      if (oldest === undefined || compareSnowflakes(message.id, oldest) < 0) oldest = message.id;
      if (collected.has(message.id)) continue;
      collected.set(message.id, message);
      added++;
    }

    // A short page is the channel start. A full page without a single new message would make us ask for the same page forever.
    if (page.length < limit || added === 0 || oldest === undefined) {
      hasMore = false;
      break;
    }
    before = oldest;
  }

  return { messages: sortByIdAsc([...collected.values()]), hasMore };
}
