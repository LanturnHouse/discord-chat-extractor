import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { Message } from '@/lib/discord/types';
import { anchorShift, captureAnchor, prependedCount, type ScrollAnchor } from './scroll';

/** A remembered row: its DOM node (React keeps it while the message stays in the list) and where it sat in the viewport. */
export interface AnchorSnapshot {
  element: HTMLElement;
  anchor: ScrollAnchor;
}

/** The message rows of the list, in document order. Day dividers and the channel banner are siblings without the attribute. */
export function messageRows(content: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of Array.from(content.children)) {
    if (child instanceof HTMLElement && child.hasAttribute('data-message-id')) rows.push(child);
  }
  return rows;
}

/** Remembers the first message that is fully inside the viewport, or null for an empty list. */
export function snapshotAnchor(scroller: HTMLElement, content: HTMLElement): AnchorSnapshot | null {
  const rows = messageRows(content);
  const viewportTop = scroller.getBoundingClientRect().top;
  const offsetAt = (index: number): number => rows[index].getBoundingClientRect().top - viewportTop;
  const captured = captureAnchor(rows.length, offsetAt, (index) => rows[index].dataset.messageId ?? '');
  return captured === null ? null : { element: rows[captured.index], anchor: captured.anchor };
}

/** Moves the scroll position so the remembered row is back at its old pixel offset. */
export function restoreAnchor(scroller: HTMLElement, snapshot: AnchorSnapshot): void {
  if (!snapshot.element.isConnected) return;
  const current = snapshot.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const shift = anchorShift(snapshot.anchor, current);
  if (shift !== 0) scroller.scrollTop += shift;
}

/**
 * Older messages are prepended above the viewport: without a correction everything the user looks at would jump down by
 * the height of the new page. The row that was first visible is remembered right before the DOM changes and put back at
 * the same offset right after, before the browser paints. The correction is absolute (not "add the height difference"),
 * so it composes with Chrome's own scroll anchoring: whichever acts first, the second finds nothing left to fix. It also
 * covers what native anchoring cannot: a viewport at scrollTop 0, and the loader / banner above the rows changing at the
 * same time as the rows.
 *
 * The snapshot is taken while rendering on purpose: function components have no `getSnapshotBeforeUpdate`, and the DOM
 * still shows the previous list at that point. Reading layout is idempotent, so StrictMode's second render is harmless.
 */
export function useScrollAnchor(scrollerRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>, items: readonly Message[]): void {
  const committed = useRef(items);
  const pending = useRef<AnchorSnapshot | null>(null);

  if (committed.current !== items) {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    pending.current = scroller !== null && content !== null && prependedCount(committed.current, items) > 0 ? snapshotAnchor(scroller, content) : null;
  }

  useLayoutEffect(() => {
    committed.current = items;
    const snapshot = pending.current;
    pending.current = null;
    const scroller = scrollerRef.current;
    if (snapshot !== null && scroller !== null) restoreAnchor(scroller, snapshot);
  }, [items, scrollerRef]);
}
