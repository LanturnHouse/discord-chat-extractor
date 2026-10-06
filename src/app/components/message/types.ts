import type { MessageNameResolver } from '@/lib/message';

/**
 * Everything a message needs to know about the viewer. Structurally a `MarkdownContext`, so it is passed to
 * `<DiscordMarkdown>` as is.
 *
 * Keep the object referentially stable (useMemo): `<MessageItem>` skips re-rendering while the identity is unchanged.
 * `names` is a mutable resolver, so a caller that teaches it new names must hand out a new context object to
 * make already rendered messages pick them up.
 */
export interface MessageRenderContext {
  locale: 'ko' | 'en';
  /** IANA zone used for day boundaries, clock times and `<t:...>` markers. */
  timeZone: string;
  names: MessageNameResolver;
}
