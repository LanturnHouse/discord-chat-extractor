import type { Prefs, Platform } from '@/app/platform/types';
import type { DiscordClient } from '@/lib/discord/client';
import type { ChannelNode, DmNode, GuildNode, GuildTree } from '@/lib/discord/model';
import type { GuildSummary, Message, Snowflake, User } from '@/lib/discord/types';
import type { ExportOutput, ExportProgress, ExportScope, ExportTarget } from '@/lib/export/types';
import type { Locale } from '../i18n/core';

export type { Locale };

/* ----------------------------------------------------------------------------------------------------------------- */
/* Value types                                                                                                         */
/* ----------------------------------------------------------------------------------------------------------------- */

export type BootStatus = 'booting' | 'needs-token' | 'ready' | 'fatal';
/** 'live' = real Discord account, 'demo' = fictional data (`?mock=1`). */
export type AppMode = 'live' | 'demo';
export type NeedsTokenReason =
  | 'no-token' // nothing captured yet
  | 'expired' // Discord answered 401 while we were using the session
  | 'invalid'; // the captured token was rejected right at start

/** State of a tri-state checkbox. */
export type CheckState = 'none' | 'some' | 'all';

/** Key used by `toggleCategory` / `selectCategoryCheck` for channels that have no category. */
export const UNCATEGORIZED = 'uncategorized';
export type CategoryKey = Snowflake | typeof UNCATEGORIZED;

export type AppView = { kind: 'dms' } | { kind: 'guild'; guildId: Snowflake };

export type TreeStatus = 'idle' | 'loading' | 'loaded' | 'error';
export interface GuildTreeEntry {
  status: TreeStatus;
  /** Non-null only when `status === 'loaded'`. */
  tree: GuildTree | null;
  /** Localised message when `status === 'error'`. */
  error?: string;
}

/** Id -> display name maps of one guild, used to render `<#channel>` and `<@&role>` mentions. */
export interface GuildNames {
  channels: Record<Snowflake, string>;
  roles: Record<Snowflake, string>;
}

export type MessagesStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'forbidden';
export interface ChannelMessages {
  status: MessagesStatus;
  /** Ascending (oldest first). Never mutated: every change produces a new array. */
  items: readonly Message[];
  /** False once the start of the channel has been reached: show the "beginning of the channel" banner, stop loading. */
  hasMore: boolean;
  /** An older page is being fetched right now. */
  loadingOlder: boolean;
  /** Localised message when `status === 'error'` (first page failed). `loadInitialMessages` retries. */
  error?: string;
  /** Localised message when the last "older page" request failed. Show a retry button: nothing retries automatically. */
  olderError?: string;
}

/** The default scope of every selected channel (what the three fields mean together is documented on `ExportScope`). Not persisted. */
export type ExportSettings = ExportScope;

/** The scopes a job started with: editing the settings later must not change what the dialog says about a run in progress. */
export interface ExportJobScope {
  /** The default scope of the run. */
  defaults: ExportScope;
  /** Scope of every target that had its own settings, by channel id. */
  overrides: Readonly<Record<Snowflake, ExportScope>>;
}

export type ExportJobStatus = 'idle' | 'running' | 'packaging' | 'done' | 'cancelled' | 'error';

/** What a finished run produced, plus whether the file already went to the browser. */
export interface ExportJobOutput extends ExportOutput {
  /**
   * True once the file was handed to the browser: automatically after a run that was not cancelled, or by `saveExportOutput`
   * after a cancel or a failed download. False while the completed channels are still waiting (their `blob` is kept for that:
   * a cancelled run, or a run whose automatic save failed), and when there was nothing to save (`fileCount` 0).
   */
  saved: boolean;
}

export interface ExportJob {
  status: ExportJobStatus;
  /** Live per-channel progress; the last snapshot stays after the job ended. */
  progress: ExportProgress | null;
  /**
   * Result summary once the job ended (`done` / `cancelled`, also `error` when only saving failed).
   * `output.blob` is emptied after the file has been handed to the browser to avoid holding a large archive in memory;
   * use `filename`, `fileCount`, `messageCount`, `failures`, `cancelled`, `saved`. Only a job that was not saved yet (a cancelled
   * run, or one whose automatic save failed: `error` with `saved` false) still carries its archive; see `selectUnsavedFileCount`.
   */
  output: ExportJobOutput | null;
  /** Localised message when `status === 'error'`, or when saving the completed channels of a cancelled run failed (it can be retried). */
  error: string | null;
  /** `Date.now()` when the job started, null while idle. */
  startedAt: number | null;
  /** The scopes the run used (null while idle, and for a run that was refused before it started). */
  scope: ExportJobScope | null;
}

/** The channel being viewed, resolved against the loaded data. */
export type ActiveChannel =
  | { kind: 'guild'; guild: GuildNode; node: ChannelNode }
  | { kind: 'dm'; dm: DmNode };

/* ----------------------------------------------------------------------------------------------------------------- */
/* State                                                                                                               */
/* ----------------------------------------------------------------------------------------------------------------- */

/** Everything except functions; this is what `resetData` restores. Documented field by field in `AppState`. */
export interface AppData {
  // --- boot ---
  /** Set by `init`; null before. */
  platform: Platform | null;
  /** The only door to Discord data. Null until boot succeeded. Components never need it. */
  client: DiscordClient | null;
  status: BootStatus;
  mode: AppMode;
  /** Meaningful while `status === 'needs-token'`. */
  needsTokenReason: NeedsTokenReason;
  /** While `needs-token`: a token arrived and is being validated ("Token detected - loading..."). */
  tokenDetected: boolean;
  /** Localised message while `status === 'fatal'`. */
  fatalError: string | null;
  /** The signed-in user (demo: the fictional one). */
  me: User | null;
  locale: Locale;
  /** Persisted through `platform.savePrefs`. */
  prefs: Prefs;

  // --- metadata (fetched once at start; nothing else is fetched until the user opens something) ---
  /** Servers in API order. */
  guilds: GuildNode[];
  /** Raw guild entries (owner / permissions are needed to compute channel access). Keyed by guild id. */
  guildSummaries: Record<Snowflake, GuildSummary>;
  /** DMs + group DMs, most recent first. */
  dms: DmNode[];

  // --- navigation ---
  view: AppView;
  /** The open channel: a guild channel / thread of `view.guildId`, or a DM in the DM view. null = "pick a channel". */
  activeChannelId: Snowflake | null;
  /** Folded category ids and folded forum / media channel ids (local UI state; survives server switches). */
  collapsedCategories: Record<Snowflake, true>;
  /** Text typed into the DM filter box. */
  dmFilter: string;

  // --- per-guild caches ---
  trees: Record<Snowflake, GuildTreeEntry>;
  guildNames: Record<Snowflake, GuildNames>;

  // --- messages (only for channels somebody opened) ---
  messages: Record<Snowflake, ChannelMessages>;
  /** Channels that answered 403 (or that are hidden): locked in the sidebar and not selectable. */
  forbiddenChannels: Record<Snowflake, true>;

  // --- export ---
  /** Channels / DMs ticked for export, keyed by channel id. Survives navigation. */
  selection: Record<Snowflake, ExportTarget>;
  /** The default scope (dates + message count) of every selected channel. Not persisted. */
  exportSettings: ExportSettings;
  /**
   * Channels that export with their own scope instead of `exportSettings` (all three fields replace the defaults), by channel id.
   * Only selected channels have one: an entry is dropped together with its channel's selection. Not persisted.
   * A channel's first valid edit in the selection list creates its entry (a full scope: the defaults of that moment with the edited
   * field changed); the entry stays until the channel is reset, even when it happens to equal the defaults.
   */
  exportOverrides: Record<Snowflake, ExportScope>;
  exportJob: ExportJob;
}

export interface AppActions {
  // --- boot ---
  /** Boots the app (idempotent: safe to call from a StrictMode effect). Resolves when the first screen state is final. */
  init(): Promise<void>;
  /** After `fatal`: starts the boot again. */
  retry(): Promise<void>;
  /** Test seam: skips platform / token handling and boots with the given client and user. */
  initWithClient(client: DiscordClient, me: User): Promise<void>;
  /** Onboarding's "try the demo": reloads the page with `?mock=1`. */
  startDemoMode(): void;
  /** Merges into the persisted prefs (and re-resolves `locale`). */
  setPrefs(partial: Partial<Prefs>): void;

  // --- navigation ---
  openDms(): void;
  /** Shows the server (its tree is fetched on first use) and opens NO channel. */
  openGuild(guildId: Snowflake): Promise<void>;
  /** Opens a channel / thread / DM (`guildId` null for DMs) and loads its newest messages. Resolves when that load ended. */
  openChannel(channelId: Snowflake, guildId: Snowflake | null): Promise<void>;
  toggleCategoryCollapsed(categoryId: Snowflake): void;
  setDmFilter(text: string): void;

  // --- guild trees ---
  /** Loads the server's channel tree once (idempotent, concurrent calls share one load). Never rejects; see `trees[id].status`. */
  ensureGuildTree(guildId: Snowflake): Promise<void>;

  // --- messages ---
  /** First page (newest `UI_PAGE_SIZE` messages). No-op while loading / when loaded / when forbidden; retries after an error. */
  loadInitialMessages(channelId: Snowflake): Promise<void>;
  /** The next older page, prepended. No-op unless loaded && hasMore && not already loading. Retries after `olderError`. */
  loadOlderMessages(channelId: Snowflake): Promise<void>;

  // --- selection ---
  toggleChannel(channelId: Snowflake): void;
  /** Tri-state semantics: 'all' => deselect everything in it, otherwise select everything exportable in it. */
  toggleCategory(guildId: Snowflake, categoryId: CategoryKey): void;
  /** Loads the tree first when needed. */
  toggleGuild(guildId: Snowflake): Promise<void>;
  /** Applies to the DMs that pass the current `dmFilter`. */
  toggleAllDms(): void;
  clearSelection(): void;
  removeFromSelection(channelId: Snowflake): void;

  // --- export ---
  setExportAfter(iso: string | null): void;
  setExportBefore(iso: string | null): void;
  /** The default message count (a whole number 1..MAX_EXPORT_LIMIT), or null = no limit. The UI only ever passes valid values; `startExport` re-checks. */
  setExportLimit(limit: number | null): void;
  /**
   * Gives one SELECTED channel its own scope (null = back to the default settings). A channel that is not selected is ignored:
   * overrides never outlive the selection of their channel.
   */
  setChannelScope(channelId: Snowflake, scope: ExportScope | null): void;
  /**
   * Exports the current selection (one job at a time, no-op without a selection) and hands the file to the browser when
   * the run was not cancelled and at least one channel completed. A cancelled run downloads nothing by itself: it keeps the
   * channels that were done so the UI can offer `saveExportOutput`. So does a run whose automatic download failed: it ends in
   * `error` and keeps its archive. A scope that cannot be exported (the default one or any override) ends the call at once as
   * an `error` job that says which one, and nothing is fetched.
   */
  startExport(): Promise<void>;
  /**
   * Hands the completed channels of a finished job that still holds an unsaved archive (cancelled, or `error` after a failed
   * download) to the browser, once; a failure keeps the archive for another try. No-op in any other state or when nothing
   * was completed.
   */
  saveExportOutput(): void;
  cancelExport(): void;
  /** Clears a finished (done / cancelled / error) job; ignored while running. */
  dismissExportJob(): void;
}

/**
 * The whole app state. Components read it with `useAppStore(selector)` (or the typed hooks in `hooks.ts`) and call the
 * actions, which are stable function references: `const openChannel = useAppStore((s) => s.openChannel)`.
 */
export type AppState = AppData & AppActions;
