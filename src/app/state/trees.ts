import type { DiscordClient, MyMember } from '@/lib/discord/client';
import type { GuildTree } from '@/lib/discord/model';
import { resolveChannelAccess } from '@/lib/discord/permissions';
import { buildGuildTree } from '@/lib/discord/tree';
import { ChannelType, type Channel, type Role, type Snowflake } from '@/lib/discord/types';
import { describeError } from '../i18n/common';
import { isAbortError, isAuthError, isIndexNotReadyError, type Session, type StoreContext } from './context';
import { handleAuthFailure } from './session';
import type { AppActions, GuildNames, GuildTreeEntry } from './types';

export type TreeActions = Pick<AppActions, 'ensureGuildTree'>;

/** How soon a tree whose forum posts could not be listed yet (Discord had not indexed them) looks for them again. */
export const THREADS_RETRY_INTERVAL_MS = 30_000;

/** A loaded tree whose forum posts could not be listed yet, and the last try for them is old enough. */
function threadsDue(entry: GuildTreeEntry): boolean {
  return entry.threadsPendingAt !== undefined && Date.now() - entry.threadsPendingAt >= THREADS_RETRY_INTERVAL_MS;
}

function hasForumLikeChannel(channels: readonly Channel[]): boolean {
  return channels.some((channel) => channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia);
}

/** Aborts propagate (the whole load is moot); any other failure of an optional request just means "unknown". */
async function bestEffort<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

/** `pending`: the list is empty only because Discord has not indexed the forums yet, so it is worth asking again later. */
async function lookUpThreads(client: DiscordClient, guildId: Snowflake, signal: AbortSignal): Promise<{ threads: Channel[]; pending: boolean }> {
  try {
    return { threads: await client.getActiveThreads(guildId, signal), pending: false };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { threads: [], pending: isIndexNotReadyError(error) };
  }
}

function buildNames(channels: readonly Channel[], threads: readonly Channel[], roles: readonly Role[] | null): GuildNames {
  const names: GuildNames = { channels: {}, roles: {} };
  for (const channel of [...channels, ...threads]) {
    if (typeof channel.name === 'string' && channel.name !== '') names.channels[channel.id] = channel.name;
  }
  for (const role of roles ?? []) names.roles[role.id] = role.name;
  return names;
}

interface FetchedTree {
  tree: GuildTree;
  names: GuildNames;
  threadsPending: boolean;
}

export function createTreeActions(ctx: StoreContext): TreeActions {
  const { get, set, runtime } = ctx;

  /** The channel list plus everything that refines it; null when the session ended meanwhile. Rejects when the channel list itself fails. */
  async function fetchTree(guildId: Snowflake, client: DiscordClient, session: Session): Promise<FetchedTree | null> {
    // Required: the channel list. Everything after it only refines the result.
    const channels = await client.getGuildChannels(guildId, session.signal);
    const [roles, member] = await Promise.all([
      bestEffort<Role[]>(client.getGuildRoles(guildId, session.signal)),
      bestEffort<MyMember>(client.getMyMember(guildId, session.signal)),
    ]);
    // Forum / media channels hold nothing but threads, so only they make the thread lookup worthwhile.
    const { threads, pending } = hasForumLikeChannel(channels) ? await lookUpThreads(client, guildId, session.signal) : { threads: [], pending: false };
    if (!session.isCurrent()) return null;

    const { me, guildSummaries } = get();
    // Access is only computed when every input is known; a partial answer would hide channels the user can read.
    const access =
      roles !== null && member !== null && me !== null
        ? resolveChannelAccess({
            guildId,
            userId: me.id,
            guild: guildSummaries[guildId] ?? {},
            roles,
            member,
            channels,
            threads,
          })
        : undefined;

    return { tree: buildGuildTree(guildId, channels, threads, access), names: buildNames(channels, threads, roles), threadsPending: pending };
  }

  function storeTree(guildId: Snowflake, { tree, names, threadsPending }: FetchedTree): void {
    set((state) => ({
      trees: { ...state.trees, [guildId]: { status: 'loaded', tree, ...(threadsPending ? { threadsPendingAt: Date.now() } : {}) } },
      guildNames: { ...state.guildNames, [guildId]: names },
    }));
  }

  async function load(guildId: Snowflake, client: DiscordClient): Promise<void> {
    const session = runtime.currentSession();
    set((state) => ({ trees: { ...state.trees, [guildId]: { status: 'loading', tree: null } } }));
    try {
      const fetched = await fetchTree(guildId, client, session);
      if (fetched !== null) storeTree(guildId, fetched);
    } catch (error) {
      if (!session.isCurrent()) return;
      if (isAbortError(error)) {
        // Cancelled for a reason that keeps the session alive: leave no half-loaded entry behind.
        set((state) => {
          const trees = { ...state.trees };
          delete trees[guildId];
          return { trees };
        });
        return;
      }
      if (isAuthError(error)) {
        handleAuthFailure(ctx, 'expired');
        return;
      }
      const message = describeError(error, get().locale);
      set((state) => ({ trees: { ...state.trees, [guildId]: { status: 'error', tree: null, error: message, errorCause: error } } }));
    }
  }

  /**
   * Looks for the forum posts of a loaded tree again. The tree stays on screen (status 'loaded') the whole time and a failed
   * attempt leaves it as it is: the previous tree is all there is to show, and the next re-open tries again.
   */
  async function retryThreads(guildId: Snowflake, entry: GuildTreeEntry, client: DiscordClient): Promise<void> {
    const session = runtime.currentSession();
    // The attempt counts from now, whether it works or not, so the 30 s hold-off also covers one that is still running.
    set((state) => ({ trees: { ...state.trees, [guildId]: { ...entry, threadsPendingAt: Date.now() } } }));
    try {
      const fetched = await fetchTree(guildId, client, session);
      if (fetched !== null) storeTree(guildId, fetched);
    } catch (error) {
      if (session.isCurrent() && isAuthError(error)) handleAuthFailure(ctx, 'expired');
    }
  }

  return {
    ensureGuildTree(guildId) {
      const inFlight = runtime.treeLoads.get(guildId);
      if (inFlight) return inFlight;
      const { client, trees } = get();
      const entry = Object.hasOwn(trees, guildId) ? trees[guildId] : undefined;
      if (entry?.status === 'loaded' && !threadsDue(entry)) return Promise.resolve();
      if (client === null) return Promise.resolve();

      const work = entry?.status === 'loaded' ? retryThreads(guildId, entry, client) : load(guildId, client);
      const promise = work.finally(() => {
        if (runtime.treeLoads.get(guildId) === promise) runtime.treeLoads.delete(guildId);
      });
      runtime.treeLoads.set(guildId, promise);
      return promise;
    },
  };
}
