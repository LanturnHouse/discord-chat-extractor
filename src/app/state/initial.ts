import { DEFAULT_PREFS } from '@/app/platform/types';
import { readBrowserLanguage, resolveLocale } from '../i18n/core';
import type { AppData, ChannelMessages, ExportJob, GuildTreeEntry } from './types';

/** Shared, never-mutated defaults so selectors can return a stable reference for "nothing loaded yet". */
export const IDLE_TREE_ENTRY: Readonly<GuildTreeEntry> = Object.freeze({ status: 'idle', tree: null });

export const EMPTY_CHANNEL_MESSAGES: Readonly<ChannelMessages> = Object.freeze({
  status: 'idle',
  items: Object.freeze([]) as readonly never[],
  hasMore: true,
  loadingOlder: false,
});

export const IDLE_EXPORT_JOB: Readonly<ExportJob> = Object.freeze({
  status: 'idle',
  progress: null,
  output: null,
  error: null,
  startedAt: null,
  scope: null,
});

/** The part of the state that belongs to one signed-in session; `resetData()` restores it when the account changes. */
export type SessionData = Pick<
  AppData,
  | 'client'
  | 'me'
  | 'guilds'
  | 'guildSummaries'
  | 'dms'
  | 'view'
  | 'activeChannelId'
  | 'collapsedCategories'
  | 'dmFilter'
  | 'trees'
  | 'guildNames'
  | 'messages'
  | 'forbiddenChannels'
  | 'selection'
  | 'exportSettings'
  | 'exportOverrides'
  | 'exportJob'
>;

export function initialSessionData(): SessionData {
  return {
    client: null,
    me: null,
    guilds: [],
    guildSummaries: {},
    dms: [],
    view: { kind: 'dms' },
    activeChannelId: null,
    collapsedCategories: {},
    dmFilter: '',
    trees: {},
    guildNames: {},
    messages: {},
    forbiddenChannels: {},
    selection: {},
    exportSettings: { after: null, before: null, limit: null },
    exportOverrides: {},
    exportJob: IDLE_EXPORT_JOB,
  };
}

export function initialData(): AppData {
  return {
    ...initialSessionData(),
    platform: null,
    status: 'booting',
    mode: 'live',
    needsTokenReason: 'no-token',
    tokenDetected: false,
    fatalError: null,
    fatalDetail: null,
    locale: resolveLocale(DEFAULT_PREFS.locale, readBrowserLanguage()),
    prefs: DEFAULT_PREFS,
  };
}
