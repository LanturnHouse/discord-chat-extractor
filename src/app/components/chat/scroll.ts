import type { MessagesStatus } from '@/app/state';

/*
 * The scroll maths of the message list. Pure functions only (no DOM, no React): jsdom has no layout, so everything that
 * decides *when* to pin, load or correct is isolated here and tested with plain numbers (tests/app/chat/scroll.test.ts).
 */

/** Load the next older page when the viewport is this close to the top of the loaded messages. */
export const NEAR_TOP_PX = 600;
/** "At the bottom" means within this many pixels (sub-pixel rounding, scrollbars, zoom). */
export const PIN_TOLERANCE_PX = 4;
/** The "jump to latest" button appears once the bottom is further away than this many viewport heights. */
export const JUMP_DISTANCE_VIEWPORTS = 1.5;
/** Corrections smaller than this are not visible and would only be rounded away by the browser. */
export const MIN_SCROLL_CORRECTION_PX = 0.5;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** The largest valid `scrollTop`. */
export function bottomScrollTop(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, bottomScrollTop(metrics) - metrics.scrollTop);
}

export function isNearBottom(metrics: ScrollMetrics, tolerance: number = PIN_TOLERANCE_PX): boolean {
  return distanceFromBottom(metrics) <= tolerance;
}

export function isNearTop(metrics: ScrollMetrics, threshold: number = NEAR_TOP_PX): boolean {
  return metrics.scrollTop <= threshold;
}

export function contentOverflows(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight > metrics.clientHeight;
}

/** The bottom is more than `viewports` viewport heights away (never before the list has a height). */
export function shouldShowJumpToLatest(metrics: ScrollMetrics, viewports: number = JUMP_DISTANCE_VIEWPORTS): boolean {
  return metrics.clientHeight > 0 && distanceFromBottom(metrics) > viewports * metrics.clientHeight;
}

/**
 * True when a scroll event can only have come from the user (find in page, a text selection dragged past the edge, a focused
 * link scrolled into view): the list is away from the bottom, not where our last pin left it, and the layout is the one the
 * pin saw (`pinnedAt` = the metrics right after it).
 *
 * A reflow (window resize, images, fonts, rows leaving `content-visibility` skipping) changes `scrollHeight` / `clientHeight`,
 * and Chrome's scroll anchoring then moves `scrollTop` by itself and fires a scroll event that looks exactly like a user
 * scrolling away from the bottom. Such an event says nothing about the user: the size notification that follows pins the
 * list again. (A wheel, touch drag or key that moves up, a press on the scrollbar and the focus moving to something out of view
 * do not depend on this: they unpin on their own, before any scroll event.)
 */
export function userScrolledAway(metrics: ScrollMetrics, pinnedAt: ScrollMetrics): boolean {
  if (isNearBottom(metrics)) return false;
  if (metrics.scrollHeight !== pinnedAt.scrollHeight || metrics.clientHeight !== pinnedAt.clientHeight) return false;
  return Math.abs(metrics.scrollTop - pinnedAt.scrollTop) > PIN_TOLERANCE_PX;
}

/** Keys that move the list towards older messages (the others only ever move it down, which cannot end a bottom pin). */
export function keyScrollsUp(key: string, shiftKey: boolean): boolean {
  return key === 'PageUp' || key === 'Home' || key === 'ArrowUp' || (key === ' ' && shiftKey);
}

/** A box (viewport coordinates) that is not entirely inside `view`: focusing it makes the browser scroll it into view. */
export function isOutsideView(box: Pick<DOMRect, 'top' | 'bottom'>, view: Pick<DOMRect, 'top' | 'bottom'>): boolean {
  return box.top < view.top || box.bottom > view.bottom;
}

export interface OlderLoadInput extends ScrollMetrics {
  status: MessagesStatus;
  hasMore: boolean;
  loadingOlder: boolean;
  /** The last older-page request failed: nothing retries on its own, the user presses Retry. */
  olderFailed: boolean;
}

/**
 * Should the next older page be requested right now?
 * - never while the channel is not loaded, at its start, already loading, or after a failed request;
 * - never before layout exists (every metric is 0, which would read as "an empty list that needs filling");
 * - when the loaded messages do not even fill the viewport there is nothing to scroll, so keep loading;
 * - otherwise when the viewport is within `threshold` px of the top.
 */
export function shouldLoadOlder(input: OlderLoadInput, threshold: number = NEAR_TOP_PX): boolean {
  if (input.status !== 'loaded' || !input.hasMore || input.loadingOlder || input.olderFailed) return false;
  if (input.clientHeight <= 0) return false;
  return !contentOverflows(input) || isNearTop(input, threshold);
}

/* --- keeping the viewport still while older messages are prepended -------------------------------------------------- */

/**
 * How many entries `next` has in front of `previous`, or 0 when `next` is not exactly `previous` with entries prepended.
 * Checked by id at both ends: the store only ever prepends, so this is a cheap proof, not a diff.
 */
export function prependedCount(previous: readonly { id: string }[], next: readonly { id: string }[]): number {
  const added = next.length - previous.length;
  if (previous.length === 0 || added <= 0) return 0;
  const sameFirst = next[added].id === previous[0].id;
  const sameLast = next[next.length - 1].id === previous[previous.length - 1].id;
  return sameFirst && sameLast ? added : 0;
}

/** A row that is kept in place: `offset` = its top edge minus the top edge of the viewport, in px. */
export interface ScrollAnchor {
  id: string;
  offset: number;
}

/**
 * Index of the first row that starts at or below the top edge of the viewport (offset >= 0), by binary search over the
 * rows in document order (their offsets only grow). When every row starts above the viewport the last one is returned,
 * -1 for no rows at all. Anchoring on this row keeps whatever the user is looking at where it is.
 */
export function firstVisibleIndex(count: number, offsetAt: (index: number) => number): number {
  if (count <= 0) return -1;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsetAt(middle) >= 0) high = middle;
    else low = middle + 1;
  }
  return low === count ? count - 1 : low;
}

/** The row to keep in place and its position in  rows, or null for no rows. */
export function captureAnchor(
  count: number,
  offsetAt: (index: number) => number,
  idAt: (index: number) => string,
): { index: number; anchor: ScrollAnchor } | null {
  const index = firstVisibleIndex(count, offsetAt);
  return index < 0 ? null : { index, anchor: { id: idAt(index), offset: offsetAt(index) } };
}

/**
 * How far `scrollTop` has to move so the anchor row is back at its remembered offset, given where it is now
 * (`currentOffset`, same definition). Zero when something else (the browser's own scroll anchoring) already did it.
 */
export function anchorShift(anchor: ScrollAnchor, currentOffset: number): number {
  const shift = currentOffset - anchor.offset;
  return Math.abs(shift) < MIN_SCROLL_CORRECTION_PX ? 0 : shift;
}
