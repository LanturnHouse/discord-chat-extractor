import { useMemo } from 'react';
import type { MessageRenderContext } from '@/app/components/message';
import { useLocale } from '@/app/i18n';
import type { GuildNames } from '@/app/state';
import type { Message } from '@/lib/discord/types';
import { buildNameResolver, type MessageNameResolver } from '@/lib/message';
import { prependedCount } from './scroll';

export interface NameTeacher {
  readonly names: MessageNameResolver;
  /** Teaches the resolver the authors / mentions of messages it has not seen yet. Idempotent. */
  teach(items: readonly Message[]): void;
}

/**
 * One name resolver for one (channel, guild names) pair, plus the bookkeeping to feed it incrementally: a prepended page
 * teaches only its own messages (the rest was taught before), anything else is taught in full (learning is idempotent).
 */
export function createNameTeacher(guildNames: GuildNames | undefined): NameTeacher {
  const names = buildNameResolver({ channels: guildNames?.channels, roles: guildNames?.roles });
  let taught: readonly Message[] = [];
  return {
    names,
    teach(items) {
      if (items === taught) return;
      const added = prependedCount(taught, items);
      names.addMessages(added > 0 ? items.slice(0, added) : items);
      taught = items;
    },
  };
}

/** The viewer's time zone (IANA name); UTC when the platform cannot tell. */
export function resolveTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The context every message row renders with. Its identity is the memo key of thousands of rows, so it only changes when
 * the locale, the time zone or the guild's channel / role names change - never when a page of messages is prepended.
 * New pages teach the (mutable) resolver during render, before the rows that need the names are rendered.
 */
export function useMessageContext(guildNames: GuildNames | undefined, items: readonly Message[]): MessageRenderContext {
  const locale = useLocale();
  const timeZone = useMemo(resolveTimeZone, []);
  const teacher = useMemo(() => createNameTeacher(guildNames), [guildNames]);
  teacher.teach(items);
  return useMemo(() => ({ locale, timeZone, names: teacher.names }), [locale, timeZone, teacher]);
}
