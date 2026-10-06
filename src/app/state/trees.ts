import type { DiscordClient, MyMember } from '@/lib/discord/client';
import { resolveChannelAccess } from '@/lib/discord/permissions';
import { buildGuildTree } from '@/lib/discord/tree';
import { ChannelType, type Channel, type Role, type Snowflake } from '@/lib/discord/types';
import { describeError } from '../i18n/common';
import { isAbortError, isAuthError, type StoreContext } from './context';
import { handleAuthFailure } from './session';
import type { AppActions, GuildNames } from './types';

export type TreeActions = Pick<AppActions, 'ensureGuildTree'>;

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

function buildNames(channels: readonly Channel[], threads: readonly Channel[], roles: readonly Role[] | null): GuildNames {
  const names: GuildNames = { channels: {}, roles: {} };
  for (const channel of [...channels, ...threads]) {
    if (typeof channel.name === 'string' && channel.name !== '') names.channels[channel.id] = channel.name;
  }
  for (const role of roles ?? []) names.roles[role.id] = role.name;
  return names;
}

export function createTreeActions(ctx: StoreContext): TreeActions {
  const { get, set, runtime } = ctx;

  async function load(guildId: Snowflake, client: DiscordClient): Promise<void> {
    const session = runtime.currentSession();
    set((state) => ({ trees: { ...state.trees, [guildId]: { status: 'loading', tree: null } } }));
    try {
      // Required: the channel list. Everything after it only refines the result.
      const channels = await client.getGuildChannels(guildId, session.signal);
      const [roles, member] = await Promise.all([
        bestEffort<Role[]>(client.getGuildRoles(guildId, session.signal)),
        bestEffort<MyMember>(client.getMyMember(guildId, session.signal)),
      ]);
      // Forum / media channels hold nothing but threads, so only they make the thread lookup worthwhile.
      const threads = hasForumLikeChannel(channels) ? ((await bestEffort(client.getActiveThreads(guildId, session.signal))) ?? []) : [];
      if (!session.isCurrent()) return;

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

      const tree = buildGuildTree(guildId, channels, threads, access);
      const names = buildNames(channels, threads, roles);
      set((state) => ({
        trees: { ...state.trees, [guildId]: { status: 'loaded', tree } },
        guildNames: { ...state.guildNames, [guildId]: names },
      }));
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
      set((state) => ({ trees: { ...state.trees, [guildId]: { status: 'error', tree: null, error: message } } }));
    }
  }

  return {
    ensureGuildTree(guildId) {
      const inFlight = runtime.treeLoads.get(guildId);
      if (inFlight) return inFlight;
      if (get().trees[guildId]?.status === 'loaded') return Promise.resolve();
      const { client } = get();
      if (client === null) return Promise.resolve();

      const promise = load(guildId, client).finally(() => {
        if (runtime.treeLoads.get(guildId) === promise) runtime.treeLoads.delete(guildId);
      });
      runtime.treeLoads.set(guildId, promise);
      return promise;
    },
  };
}
