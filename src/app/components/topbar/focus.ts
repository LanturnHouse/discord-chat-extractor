import { useEffect, type RefObject } from 'react';
import { useLatest } from './hooks';

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** Attribute of the invisible focus guards a Popover puts around its content (see Popover.tsx). They catch a Tab that left the content; they are never a stop themselves. */
const FOCUS_GUARD = 'data-focus-guard';

/** Date and time inputs hold several tab stops (month, day, year, the picker button) in ONE element, and `document.activeElement` stays that element for all of them. */
const SEGMENTED_INPUT_TYPES: ReadonlySet<string> = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

function hasInternalTabStops(element: Element | null): boolean {
  return element instanceof HTMLInputElement && SEGMENTED_INPUT_TYPES.has(element.type);
}

function isVisible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert]') !== null) return false;
  // Browsers also know about display:none / visibility:hidden; jsdom has no layout and no such method.
  return typeof element.checkVisibility !== 'function' || element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
}

/** Elements Tab can reach inside `root`, in DOM order (roving `tabindex="-1"` items, disabled, hidden and guard elements are skipped). */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(`:disabled, input[type="hidden"], [${FOCUS_GUARD}]`) &&
      isVisible(element),
  );
}

/** Moves focus to `[data-autofocus]`, else the first tabbable element, else the container itself (give it `tabindex="-1"`). */
export function focusInitial(root: HTMLElement): void {
  const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
  (preferred ?? tabbables(root)[0] ?? root).focus();
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>;

/**
 * Keeps Tab / Shift+Tab inside `root`: wraps around at the ends and pulls stray focus back in. The ends are read from the
 * DOM at the time of the key press. A date input at an end is left alone: the browser may be moving between its segments,
 * and the focus guards of the Popover wrap the focus when it moves past the input.
 */
export function trapTab(event: KeyLike, root: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const items = tabbables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    root.focus();
    return;
  }
  const active = document.activeElement;
  const inside = active !== null && root.contains(active);
  const atEdge = event.shiftKey ? active === first || active === root : active === last;
  if (inside && !atEdge) return;
  if (inside && hasInternalTabStops(active)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

/**
 * A focus guard received focus: the browser's own Tab moved past an end of `root` (typically out of the last segment of a
 * date input). Wrap like `trapTab` does. Focus that comes from outside `root` enters at the near end instead.
 */
export function wrapFromGuard(root: HTMLElement, edge: 'start' | 'end', cameFrom: EventTarget | null): void {
  const items = tabbables(root);
  const fromInside = cameFrom instanceof Node && root.contains(cameFrom);
  const toLast = (edge === 'start') === fromInside;
  (toLast ? items[items.length - 1] : items[0] ?? root).focus();
}

/** Tab trap on the whole document while `enabled`: focus that wandered out (a click on the backdrop) is caught as well. */
export function useTabTrap(rootRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (rootRef.current !== null) trapTab(event, rootRef.current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [rootRef, enabled]);
}

/** Calls `handler` when Escape is pressed anywhere (not while an input method is composing). */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const latest = useLatest(handler);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, latest]);
}
