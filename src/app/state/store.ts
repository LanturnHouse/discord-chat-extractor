import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useShallow } from 'zustand/react/shallow';
import { createBootActions } from './boot';
import { defaultDeps, Runtime, type StoreContext, type StoreDeps } from './context';
import { createExportActions } from './exportJob';
import { initialData } from './initial';
import { createMessageActions } from './messages';
import { createNavigationActions } from './navigation';
import { createSelectionActions } from './selection';
import { createTreeActions } from './trees';
import type { AppState } from './types';

/**
 * The app's single store (zustand v5).
 *
 * Reading in components:   const status = useAppStore((s) => s.status);
 *                          const dms = useFilteredDms();            // ready-made hooks live in hooks.ts
 * Calling actions:         const openChannel = useAppStore((s) => s.openChannel);   // action references never change
 * Outside React / tests:   appStore.getState(), appStore.setState(...), appStore.subscribe(...)
 *
 * Selectors passed to `useAppStore` must return a primitive or an existing reference. A selector that builds a new
 * object / array on every call loops forever: wrap it in `useAppShallow` or use a memoised selector from selectors.ts.
 *
 * Layout of the implementation (one file per concern, each exporting `createXxxActions(ctx)`):
 *   boot.ts (init, prefs) | navigation.ts | trees.ts (per-server channel tree) | messages.ts (paging)
 *   selection.ts (checkboxes) | exportJob.ts (export orchestration) | selectors.ts | hooks.ts
 */
export type AppStore = StoreApi<AppState>;

/** Builds an independent store. Production uses the `appStore` singleton; tests call this with fake dependencies. */
export function createAppStore(overrides: Partial<StoreDeps> = {}): AppStore {
  const deps: StoreDeps = { ...defaultDeps, ...overrides };
  const runtime = new Runtime();
  return createStore<AppState>()((set, get) => {
    const ctx: StoreContext = { get, set, deps, runtime };
    return {
      ...initialData(),
      ...createBootActions(ctx),
      ...createNavigationActions(ctx),
      ...createTreeActions(ctx),
      ...createMessageActions(ctx),
      ...createSelectionActions(ctx),
      ...createExportActions(ctx),
    };
  });
}

/** The vanilla store of the running app. */
export const appStore: AppStore = createAppStore();

function useAppStoreHook<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

/** React hook bound to `appStore`; also carries `getState` / `setState` / `subscribe` like zustand's own bound hooks. */
export const useAppStore = Object.assign(useAppStoreHook, appStore);

/** Like `useAppStore` for selectors that return a fresh object / array: re-renders only when a member changed (shallow compare). */
export function useAppShallow<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, useShallow(selector));
}
