import { selectUnsavedFileCount } from './selectors';
import type { AppStore } from './store';
import type { AppData } from './types';

/** The part of `window` the guard needs, so tests can hand in a fake. */
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
}

/**
 * True while leaving the page would throw work away: an export that is still running, or a finished one (cancelled, or whose
 * download failed) whose completed channels were not handed to the browser yet. Everything lives in memory only, so a reload
 * or Ctrl+W loses it for good.
 */
export function hasUnsavedExportWork(state: Pick<AppData, 'exportJob'>): boolean {
  const { status } = state.exportJob;
  return status === 'running' || status === 'packaging' || selectUnsavedFileCount(state) > 0;
}

function confirmLeave(event: BeforeUnloadEvent): void {
  // Browsers ignore the text and show their own generic prompt; the two calls are what makes them show it at all.
  event.preventDefault();
  event.returnValue = '';
}

/**
 * Asks the browser to confirm before the page is closed, reloaded or navigated away while `hasUnsavedExportWork`.
 * The listener exists only for as long as it is needed (a permanent one would make every close prompt).
 * Returns a function that removes the guard.
 */
export function installUnloadGuard(store: Pick<AppStore, 'getState' | 'subscribe'>, target: UnloadTarget): () => void {
  let armed = false;
  const sync = (): void => {
    const needed = hasUnsavedExportWork(store.getState());
    if (needed === armed) return;
    armed = needed;
    if (needed) target.addEventListener('beforeunload', confirmLeave);
    else target.removeEventListener('beforeunload', confirmLeave);
  };
  sync();
  const unsubscribe = store.subscribe(sync);
  return () => {
    unsubscribe();
    if (armed) target.removeEventListener('beforeunload', confirmLeave);
    armed = false;
  };
}
