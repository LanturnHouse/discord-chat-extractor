import type { ChannelNode, DmNode, GuildTree } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import type { ExportScope, ExportTarget } from '@/lib/export/types';
import { displayName } from '@/lib/message';
import { EMPTY_CHANNEL_MESSAGES, IDLE_TREE_ENTRY } from './initial';
import { scopeIssue, type ScopeIssue } from './scope';
import { allNodesInOrder, checkStateOfNodes, groupNodes, triState } from './treeNodes';
import type {
  ActiveChannel,
  AppData,
  AppState,
  CategoryKey,
  ChannelMessages,
  CheckState,
  GuildTreeEntry,
} from './types';

/*
 * Pure selectors: `(state, ...args) => value`. Every one returns either a primitive or a reference that stays identical
 * while the underlying data is unchanged, so they are safe to pass to `useAppStore` (see hooks.ts for ready-made hooks).
 */

/** Remembers the last result; recomputes only when an argument changed identity. */
function memoLast<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null;
  return (...args: A): R => {
    const previous = last;
    if (previous !== null && args.every((arg, i) => Object.is(arg, previous.args[i]))) return previous.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/* --- trees & messages ------------------------------------------------------------------------------------------- */

export function selectGuildTreeEntry(state: AppState, guildId: Snowflake | null): GuildTreeEntry {
  return (guildId === null ? undefined : own(state.trees, guildId)) ?? IDLE_TREE_ENTRY;
}

/** Loaded tree of the guild, or null while idle / loading / failed. */
export function selectGuildTree(state: AppState, guildId: Snowflake | null): GuildTree | null {
  return selectGuildTreeEntry(state, guildId).tree;
}

export function selectChannelMessages(state: AppState, channelId: Snowflake | null): ChannelMessages {
  return (channelId === null ? undefined : own(state.messages, channelId)) ?? EMPTY_CHANNEL_MESSAGES;
}

/** Channel id -> name for `<#id>` mentions of that guild; undefined for DMs or before the tree was loaded. */
export function selectChannelNames(state: AppState, guildId: Snowflake | null): Record<Snowflake, string> | undefined {
  return guildId === null ? undefined : own(state.guildNames, guildId)?.channels;
}

/** Role id -> name for `<@&id>` mentions of that guild. */
export function selectRoleNames(state: AppState, guildId: Snowflake | null): Record<Snowflake, string> | undefined {
  return guildId === null ? undefined : own(state.guildNames, guildId)?.roles;
}

/* --- navigation ------------------------------------------------------------------------------------------------- */

function matchesFilter(dm: DmNode, needle: string): boolean {
  return (
    dm.name.toLowerCase().includes(needle) ||
    dm.recipients.some((recipient) => recipient.username.toLowerCase().includes(needle) || recipient.name.toLowerCase().includes(needle))
  );
}

const filterDms = memoLast((dms: DmNode[], filter: string): DmNode[] => {
  const needle = filter.trim().toLowerCase();
  return needle === '' ? dms : dms.filter((dm) => matchesFilter(dm, needle));
});

/** DMs whose name or any recipient's username / display name contains the filter text (case-insensitive). */
export function selectFilteredDms(state: AppState): DmNode[] {
  return filterDms(state.dms, state.dmFilter);
}

const resolveActiveChannel = memoLast(
  (
    activeChannelId: Snowflake | null,
    view: AppState['view'],
    guilds: AppState['guilds'],
    trees: AppState['trees'],
    dms: AppState['dms'],
  ): ActiveChannel | null => {
    if (activeChannelId === null) return null;
    if (view.kind === 'dms') {
      const dm = dms.find((candidate) => candidate.id === activeChannelId);
      return dm ? { kind: 'dm', dm } : null;
    }
    const node = trees[view.guildId]?.tree?.byId[activeChannelId];
    const guild = guilds.find((candidate) => candidate.id === view.guildId);
    return node && guild ? { kind: 'guild', guild, node } : null;
  },
);

/** The channel being viewed with its server / DM data (name, topic...), null while nothing is open or its tree is missing. */
export function selectActiveChannel(state: AppState): ActiveChannel | null {
  return resolveActiveChannel(state.activeChannelId, state.view, state.guilds, state.trees, state.dms);
}

/* --- selection -------------------------------------------------------------------------------------------------- */

export function selectChannelCheck(state: AppState, channelId: Snowflake): CheckState {
  return Object.hasOwn(state.selection, channelId) ? 'all' : 'none';
}

/** Tri-state of a category (or `UNCATEGORIZED`): over its selectable channels and their listed threads. */
export function selectCategoryCheck(state: AppState, guildId: Snowflake, categoryId: CategoryKey): CheckState {
  const tree = selectGuildTree(state, guildId);
  return tree === null ? 'none' : checkStateOfNodes(groupNodes(tree, categoryId), state.selection, state.forbiddenChannels);
}

export function selectSelectionCountForGuild(state: AppState, guildId: Snowflake): number {
  let count = 0;
  for (const target of Object.values(state.selection)) if (target.guildId === guildId) count += 1;
  return count;
}

/** Tri-state of a server. Tree not loaded: 'none' when nothing of it is selected, otherwise 'some' (the total is unknown). */
export function selectGuildCheck(state: AppState, guildId: Snowflake): CheckState {
  const tree = selectGuildTree(state, guildId);
  if (tree === null) return selectSelectionCountForGuild(state, guildId) === 0 ? 'none' : 'some';
  return checkStateOfNodes(allNodesInOrder(tree), state.selection, state.forbiddenChannels);
}

/** Tri-state of the "all DMs" checkbox: over the DMs that pass the filter. */
export function selectDmCheck(state: AppState): CheckState {
  let total = 0;
  let selected = 0;
  for (const dm of selectFilteredDms(state)) {
    if (state.forbiddenChannels[dm.id] === true) continue;
    total += 1;
    if (Object.hasOwn(state.selection, dm.id)) selected += 1;
  }
  return triState(total, selected);
}

export function selectSelectionCount(state: AppState): number {
  return Object.keys(state.selection).length;
}

const orderSelectedTargets = memoLast(
  (
    selection: AppState['selection'],
    guilds: AppState['guilds'],
    trees: AppState['trees'],
    dms: AppState['dms'],
  ): ExportTarget[] => {
    const ordered: ExportTarget[] = [];
    const placed = new Set<Snowflake>();
    const place = (channelId: Snowflake): void => {
      const target = own(selection, channelId);
      if (target === undefined || placed.has(channelId)) return;
      placed.add(channelId);
      ordered.push(target);
    };
    for (const guild of guilds) {
      const tree = trees[guild.id]?.tree;
      if (tree) for (const node of allNodesInOrder(tree)) place(node.id);
    }
    for (const dm of dms) place(dm.id);
    // Anything the lists above no longer know about (e.g. a DM that disappeared) keeps its place at the end.
    for (const channelId of Object.keys(selection)) place(channelId);
    return ordered;
  },
);

/** Selected targets in display / export order: servers in list order -> sidebar order within a server -> DMs. */
export function selectSelectedTargets(state: AppState): ExportTarget[] {
  return orderSelectedTargets(state.selection, state.guilds, state.trees, state.dms);
}

/* --- export scope ------------------------------------------------------------------------------------------------ */

/** The channel's own scope, or undefined while it uses the default settings. */
export function selectScopeOverride(state: AppState, channelId: Snowflake): ExportScope | undefined {
  return own(state.exportOverrides, channelId);
}

export function selectHasOverride(state: AppState, channelId: Snowflake): boolean {
  return Object.hasOwn(state.exportOverrides, channelId);
}

/** What a selected channel will be exported with: its own scope, else the default settings (both stable references). */
export function selectEffectiveScope(state: AppState, channelId: Snowflake): ExportScope {
  return own(state.exportOverrides, channelId) ?? state.exportSettings;
}

/** How many selected channels export with a scope of their own. */
export function selectOverrideCount(state: AppState): number {
  let count = 0;
  for (const channelId of Object.keys(state.exportOverrides)) if (Object.hasOwn(state.selection, channelId)) count += 1;
  return count;
}

/** The first scope that cannot be exported: `channelId` null = the default settings, otherwise that channel's own scope. */
export interface ScopeProblem {
  channelId: Snowflake | null;
  issue: ScopeIssue;
}

const findScopeProblem = memoLast(
  (settings: AppState['exportSettings'], overrides: AppState['exportOverrides'], targets: ExportTarget[]): ScopeProblem | null => {
    const issue = scopeIssue(settings);
    if (issue !== null) return { channelId: null, issue };
    for (const target of targets) {
      const override = own(overrides, target.channelId);
      const overrideIssue = override === undefined ? null : scopeIssue(override);
      if (overrideIssue !== null) return { channelId: target.channelId, issue: overrideIssue };
    }
    return null;
  },
);

/**
 * "Can this selection be exported as configured?" The default settings come first, then the own scope of every selected
 * channel in display order. null = yes. (Text the user has typed but that is not a valid scope yet never reaches the store;
 * the top bar keeps it and blocks Download itself.)
 */
export function selectScopeProblem(state: AppState): ScopeProblem | null {
  return findScopeProblem(state.exportSettings, state.exportOverrides, selectSelectedTargets(state));
}

/* --- export job -------------------------------------------------------------------------------------------------- */

/**
 * Channels of a finished job whose archive still waits in memory for `saveExportOutput`: a cancelled run, or a run whose
 * automatic save failed (status `error`). 0 when there is nothing to save; "saved" and "released" jobs count as none.
 */
export function selectUnsavedFileCount(state: Pick<AppData, 'exportJob'>): number {
  const { status, output } = state.exportJob;
  return (status === 'cancelled' || status === 'error') && output !== null && !output.saved ? output.fileCount : 0;
}

/* --- misc ------------------------------------------------------------------------------------------------------- */

/** Display name of the signed-in user for the "connected as" label; null before boot finished. */
export function selectConnectedAs(state: AppState): string | null {
  if (state.me === null) return null;
  const name = displayName(state.me);
  return name === '' ? null : name;
}

export interface LocatedChannel {
  guildId: Snowflake;
  node: ChannelNode;
  tree: GuildTree;
}

/** Finds a guild channel / thread in the loaded trees (the open server's tree is checked first). */
export function locateGuildChannel(state: AppState, channelId: Snowflake): LocatedChannel | null {
  const check = (guildId: Snowflake): LocatedChannel | null => {
    const tree = own(state.trees, guildId)?.tree;
    const node = tree ? own(tree.byId, channelId) : undefined;
    return tree && node ? { guildId, node, tree } : null;
  };
  if (state.view.kind === 'guild') {
    const found = check(state.view.guildId);
    if (found) return found;
  }
  for (const guildId of Object.keys(state.trees)) {
    const found = check(guildId);
    if (found) return found;
  }
  return null;
}
