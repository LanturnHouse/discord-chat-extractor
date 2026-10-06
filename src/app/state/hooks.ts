import type { DmNode, GuildTree } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import type { ExportScope, ExportTarget } from '@/lib/export/types';
import {
  selectActiveChannel,
  selectCategoryCheck,
  selectChannelCheck,
  selectChannelMessages,
  selectConnectedAs,
  selectDmCheck,
  selectEffectiveScope,
  selectFilteredDms,
  selectGuildCheck,
  selectGuildTree,
  selectGuildTreeEntry,
  selectOverrideCount,
  selectScopeOverride,
  selectSelectedTargets,
  selectSelectionCount,
  selectSelectionCountForGuild,
} from './selectors';
import { useAppStore } from './store';
import type { ActiveChannel, CategoryKey, ChannelMessages, CheckState, GuildNames, GuildTreeEntry } from './types';

/*
 * Ready-made hooks over the selectors. Each re-renders its component only when its own value changes.
 * Pass `null` where an id may be missing (e.g. no channel open) to keep the hook call unconditional.
 */

export function useGuildTreeEntry(guildId: Snowflake | null): GuildTreeEntry {
  return useAppStore((state) => selectGuildTreeEntry(state, guildId));
}

/** The loaded tree, or null while idle / loading / failed (check `useGuildTreeEntry` for the status). */
export function useGuildTree(guildId: Snowflake | null): GuildTree | null {
  return useAppStore((state) => selectGuildTree(state, guildId));
}

/** id -> name maps for rendering `<#channel>` / `<@&role>` mentions of a guild; undefined for DMs or before its tree loaded. */
export function useGuildNames(guildId: Snowflake | null): GuildNames | undefined {
  return useAppStore((state) => (guildId === null ? undefined : state.guildNames[guildId]));
}

export function useChannelMessages(channelId: Snowflake | null): ChannelMessages {
  return useAppStore((state) => selectChannelMessages(state, channelId));
}

/** The channel being viewed, resolved against the loaded data; null while nothing is open. */
export function useActiveChannel(): ActiveChannel | null {
  return useAppStore(selectActiveChannel);
}

/** DMs that pass the filter box. */
export function useFilteredDms(): DmNode[] {
  return useAppStore(selectFilteredDms);
}

/** Channel known to answer 403: show a lock and do not offer a checkbox. */
export function useIsForbidden(channelId: Snowflake): boolean {
  return useAppStore((state) => state.forbiddenChannels[channelId] === true);
}

export function useChannelCheck(channelId: Snowflake): CheckState {
  return useAppStore((state) => selectChannelCheck(state, channelId));
}

export function useCategoryCheck(guildId: Snowflake, categoryId: CategoryKey): CheckState {
  return useAppStore((state) => selectCategoryCheck(state, guildId, categoryId));
}

export function useGuildCheck(guildId: Snowflake): CheckState {
  return useAppStore((state) => selectGuildCheck(state, guildId));
}

/** Tri-state of "select all DMs" (over the filtered list). */
export function useDmCheck(): CheckState {
  return useAppStore(selectDmCheck);
}

export function useSelectionCount(): number {
  return useAppStore(selectSelectionCount);
}

export function useSelectionCountForGuild(guildId: Snowflake): number {
  return useAppStore((state) => selectSelectionCountForGuild(state, guildId));
}

/** Selected targets in display / export order (servers -> sidebar order -> DMs). */
export function useSelectedTargets(): ExportTarget[] {
  return useAppStore(selectSelectedTargets);
}

/** The channel's own export scope, or undefined while it follows the default settings. */
export function useScopeOverride(channelId: Snowflake): ExportScope | undefined {
  return useAppStore((state) => selectScopeOverride(state, channelId));
}

/**
 * What a selected channel will be exported with: its own scope when it has one, otherwise the default settings - live, so a
 * channel without a scope of its own follows every later change of the defaults.
 */
export function useEffectiveScope(channelId: Snowflake): ExportScope {
  return useAppStore((state) => selectEffectiveScope(state, channelId));
}

/** How many selected channels export with a scope of their own. */
export function useOverrideCount(): number {
  return useAppStore(selectOverrideCount);
}

/** Display name for the small "connected as" label; null before boot finished. */
export function useConnectedAs(): string | null {
  return useAppStore(selectConnectedAs);
}
