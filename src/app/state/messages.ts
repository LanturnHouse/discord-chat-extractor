import { UI_PAGE_SIZE } from '@/shared/constants';
import { fetchMessagePage } from '@/lib/discord/pagination';
import { compareSnowflakes } from '@/lib/discord/snowflake';
import type { Snowflake } from '@/lib/discord/types';
import { describeError } from '../i18n/common';
import { isAbortError, isAuthError, isForbiddenError, type MessageLoad, type StoreContext } from './context';
import { EMPTY_CHANNEL_MESSAGES } from './initial';
import { pruneOverrides } from './scope';
import { handleAuthFailure } from './session';
import type { AppActions, ChannelMessages } from './types';

export type MessageActions = Pick<AppActions, 'loadInitialMessages' | 'loadOlderMessages'>;

function setMessages(ctx: StoreContext, channelId: Snowflake, next: ChannelMessages): void {
  ctx.set((state) => ({ messages: { ...state.messages, [channelId]: next } }));
}

function dropMessages(ctx: StoreContext, channelId: Snowflake): void {
  ctx.set((state) => {
    const messages = { ...state.messages };
    delete messages[channelId];
    return { messages };
  });
}

/** 403: remember it for the sidebar (lock icon), show the "no access" state, and make sure the channel is not exported. */
function markForbidden(ctx: StoreContext, channelId: Snowflake): void {
  ctx.set((state) => {
    const selection = { ...state.selection };
    delete selection[channelId];
    return {
      forbiddenChannels: { ...state.forbiddenChannels, [channelId]: true },
      messages: { ...state.messages, [channelId]: { status: 'forbidden', items: [], hasMore: false, loadingOlder: false } },
      selection,
      exportOverrides: pruneOverrides(state.exportOverrides, selection),
    };
  });
}

/**
 * The user moved on: requests for channels other than `keep` are cancelled (they would only delay the channel now on
 * screen, as requests are queued one after another). A cancelled first page leaves the channel "never opened"; a
 * cancelled older page leaves the loaded messages as they were.
 */
export function abortMessageLoadsExcept(ctx: StoreContext, keep: Snowflake | null): void {
  const { runtime, get } = ctx;
  for (const [channelId, load] of [...runtime.messageLoads]) {
    if (channelId === keep) continue;
    load.controller.abort();
    runtime.messageLoads.delete(channelId);
    const current = get().messages[channelId];
    if (current === undefined) continue;
    if (load.kind === 'initial') dropMessages(ctx, channelId);
    else setMessages(ctx, channelId, { ...current, loadingOlder: false });
  }
}

export function createMessageActions(ctx: StoreContext): MessageActions {
  const { get, runtime } = ctx;

  /**
   * Registers a load for the channel and runs it. `isCurrent` turns false once the load was cancelled or replaced, after
   * which its result must be ignored. The registration is removed when `run` settles.
   */
  function start(
    channelId: Snowflake,
    kind: MessageLoad['kind'],
    run: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    const load: MessageLoad = { controller, kind, done: Promise.resolve() };
    runtime.messageLoads.set(channelId, load);
    const isCurrent = (): boolean => runtime.messageLoads.get(channelId) === load;
    load.done = run(controller.signal, isCurrent).finally(() => {
      if (isCurrent()) runtime.messageLoads.delete(channelId);
    });
    return load.done;
  }

  function messagesOf(channelId: Snowflake): ChannelMessages | undefined {
    return Object.hasOwn(get().messages, channelId) ? get().messages[channelId] : undefined;
  }

  return {
    loadInitialMessages(channelId) {
      const { client } = get();
      if (client === null) return Promise.resolve();
      const inFlight = runtime.messageLoads.get(channelId);
      if (inFlight) return inFlight.done;
      const previous = messagesOf(channelId);
      if (previous !== undefined && previous.status !== 'idle' && previous.status !== 'error') return Promise.resolve();

      return start(channelId, 'initial', async (signal, isCurrent) => {
        setMessages(ctx, channelId, { ...EMPTY_CHANNEL_MESSAGES, status: 'loading' });
        try {
          const page = await fetchMessagePage(client, channelId, { size: UI_PAGE_SIZE }, signal);
          if (!isCurrent()) return;
          setMessages(ctx, channelId, { status: 'loaded', items: page.messages, hasMore: page.hasMore, loadingOlder: false });
        } catch (error) {
          if (!isCurrent()) return;
          if (isAbortError(error)) dropMessages(ctx, channelId);
          else if (isAuthError(error)) handleAuthFailure(ctx, 'expired');
          else if (isForbiddenError(error)) markForbidden(ctx, channelId);
          else {
            setMessages(ctx, channelId, {
              status: 'error',
              items: [],
              hasMore: true,
              loadingOlder: false,
              error: describeError(error, get().locale),
            });
          }
        }
      });
    },

    loadOlderMessages(channelId) {
      const { client } = get();
      if (client === null) return Promise.resolve();
      const inFlight = runtime.messageLoads.get(channelId);
      if (inFlight) return inFlight.done;
      const previous = messagesOf(channelId);
      if (previous === undefined || previous.status !== 'loaded' || !previous.hasMore || previous.items.length === 0) return Promise.resolve();

      const before = previous.items[0].id;
      return start(channelId, 'older', async (signal, isCurrent) => {
        setMessages(ctx, channelId, { status: 'loaded', items: previous.items, hasMore: true, loadingOlder: true });
        try {
          const page = await fetchMessagePage(client, channelId, { before, size: UI_PAGE_SIZE }, signal);
          if (!isCurrent()) return;
          // Pages are older than `before` by construction; the filter only guards against a server that repeats messages.
          const fresh = page.messages.filter((message) => compareSnowflakes(message.id, before) < 0);
          setMessages(ctx, channelId, {
            status: 'loaded',
            items: fresh.length === 0 ? previous.items : [...fresh, ...previous.items],
            hasMore: page.hasMore && fresh.length > 0,
            loadingOlder: false,
          });
        } catch (error) {
          if (!isCurrent()) return;
          if (isAbortError(error)) setMessages(ctx, channelId, { ...previous, loadingOlder: false });
          else if (isAuthError(error)) handleAuthFailure(ctx, 'expired');
          else if (isForbiddenError(error)) markForbidden(ctx, channelId);
          else setMessages(ctx, channelId, { ...previous, loadingOlder: false, olderError: describeError(error, get().locale) });
        }
      });
    },
  };
}
