import { useMemo, useRef, useState } from 'react';

/** Distance between the icon and the tooltip box (the arrow sticks out into this gap). */
const TOOLTIP_GAP = 16;

/** Where the shared rail tooltip is drawn: viewport coordinates (the tooltip is `position: fixed`). */
export interface TooltipPlacement {
  label: string;
  /** Vertical centre of the anchor. */
  top: number;
  /** Right edge of the anchor plus the gap. */
  left: number;
}

/** Callbacks never change identity, so memoised rail items do not re-render while the tooltip moves around. */
export interface TooltipControls {
  show(label: string, anchor: HTMLElement): void;
  /** Keyboard focus shows the tooltip; focus caused by a mouse press does not (the pointer is already showing it). */
  showForFocus(label: string, anchor: HTMLElement): void;
  hide(): void;
  /**
   * The rail scrolled. A tooltip that follows the pointer is hidden (the icon moved away from under it); one that belongs to
   * the keyboard focus stays and follows its icon, because focusing an icon that was out of view is exactly what scrolls the
   * rail. It goes when the icon has scrolled out of `rail`.
   */
  scrolled(rail: HTMLElement): void;
  /** Call on mouse down: the focus event that follows is not keyboard focus. */
  pointerDown(): void;
}

interface Shown {
  label: string;
  anchor: HTMLElement;
  /** Shown for the keyboard focus (and not for the pointer). */
  focus: boolean;
}

/**
 * One tooltip for the whole rail. It cannot live inside the items: the rail clips its content (overflow), so the box is
 * rendered through a portal and positioned from the anchor's bounding rectangle.
 */
export function useRailTooltip(): { placement: TooltipPlacement | null; controls: TooltipControls } {
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const pointerFocus = useRef(false);
  const shown = useRef<Shown | null>(null);

  const controls = useMemo<TooltipControls>(() => {
    const place = (label: string, anchor: HTMLElement): void => {
      const rect = anchor.getBoundingClientRect();
      const top = rect.top + rect.height / 2;
      const left = rect.right + TOOLTIP_GAP;
      setPlacement((current) => (current !== null && current.label === label && current.top === top && current.left === left ? current : { label, top, left }));
    };
    const hide = (): void => {
      shown.current = null;
      setPlacement(null);
    };
    return {
      show(label, anchor) {
        shown.current = { label, anchor, focus: false };
        place(label, anchor);
      },
      showForFocus(label, anchor) {
        if (pointerFocus.current) {
          pointerFocus.current = false;
          return;
        }
        shown.current = { label, anchor, focus: true };
        // The browser scrolls a focused icon into view right after this handler: do it first, so the tooltip is placed once, where it stays.
        if (typeof anchor.scrollIntoView === 'function') anchor.scrollIntoView({ block: 'nearest' });
        place(label, anchor);
      },
      hide,
      scrolled(rail) {
        const current = shown.current;
        if (current === null) return;
        if (!current.focus || !current.anchor.isConnected) {
          hide();
          return;
        }
        const anchor = current.anchor.getBoundingClientRect();
        const bounds = rail.getBoundingClientRect();
        const centre = anchor.top + anchor.height / 2;
        if (centre < bounds.top || centre > bounds.bottom) hide();
        else place(current.label, current.anchor);
      },
      pointerDown() {
        pointerFocus.current = true;
        // The focus caused by this press happens in the same task, right after the mouse-down handlers.
        window.setTimeout(() => {
          pointerFocus.current = false;
        }, 0);
      },
    };
  }, []);

  return { placement, controls };
}
