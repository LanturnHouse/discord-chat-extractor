/** Everything UI code needs from the app state. Implementation details (boot, session, runtime...) stay private. */
export { appStore, createAppStore, useAppShallow, useAppStore } from './store';
export type { AppStore } from './store';
export * from './hooks';
export * from './selectors';
export { sameScope, scopeIssue } from './scope';
export type { ScopeIssue } from './scope';
export { hasUnsavedExportWork, installUnloadGuard } from './unloadGuard';
export { UNCATEGORIZED } from './types';
export type {
  ActiveChannel,
  AppActions,
  AppData,
  AppMode,
  AppState,
  AppView,
  BootStatus,
  CategoryKey,
  ChannelMessages,
  CheckState,
  ExportJob,
  ExportJobOutput,
  ExportJobScope,
  ExportJobStatus,
  ExportSettings,
  GuildNames,
  GuildTreeEntry,
  Locale,
  MessagesStatus,
  NeedsTokenReason,
  TreeStatus,
} from './types';
