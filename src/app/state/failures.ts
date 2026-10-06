import { describeError } from '../i18n/common';
import type { Locale } from '../i18n/core';
import type { AppData, ChannelMessages, GuildTreeEntry } from './types';

/*
 * An error is shown as a sentence, and a sentence is in one language. The store keeps each sentence next to the error it was made
 * from (`errorCause`, `olderErrorCause`): when the language changes the sentences are made again, so the panel that is on screen
 * never mixes the old language with the new one.
 */

function messagesIn(entry: ChannelMessages, locale: Locale): ChannelMessages {
  const { errorCause, olderErrorCause } = entry;
  if (errorCause === undefined && olderErrorCause === undefined) return entry;
  return {
    ...entry,
    ...(errorCause === undefined ? {} : { error: describeError(errorCause, locale) }),
    ...(olderErrorCause === undefined ? {} : { olderError: describeError(olderErrorCause, locale) }),
  };
}

function treeIn(entry: GuildTreeEntry, locale: Locale): GuildTreeEntry {
  return entry.errorCause === undefined ? entry : { ...entry, error: describeError(entry.errorCause, locale) };
}

/** `record` with `change` applied to every value; the same object when no value changed. */
function mapValues<T>(record: Readonly<Record<string, T>>, change: (value: T) => T): Record<string, T> {
  const entries = Object.entries(record).map(([key, value]) => [key, change(value)] as const);
  return entries.every(([key, value]) => value === record[key]) ? record : Object.fromEntries(entries);
}

/** The per-channel and per-server errors of the state, said in `locale`; everything that holds no error stays the very same object. */
export function relocalizeFailures(state: Pick<AppData, 'messages' | 'trees'>, locale: Locale): Pick<AppData, 'messages' | 'trees'> {
  return {
    messages: mapValues(state.messages, (entry) => messagesIn(entry, locale)),
    trees: mapValues(state.trees, (entry) => treeIn(entry, locale)),
  };
}
