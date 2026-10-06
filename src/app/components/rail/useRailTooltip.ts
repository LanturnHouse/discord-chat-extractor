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
  /** Call on mouse down: the focus event that follows is not keyboard focus. */
  pointerDown(): void;
}

/**
 * One tooltip for the whole rail. It cannot live inside the items: the rail clips its content (overflow), so the box is
 * rendered through a portal and positioned from the anchor's bounding rectangle.
 */
export function useRailTooltip(): { placement: TooltipPlacement | null; controls: TooltipControls } {
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const pointerFocus = useRef(false);

  const controls = useMemo<TooltipControls>(() => {
    const show = (label: string, anchor: HTMLElement): void => {
      const rect = anchor.getBoundingClientRect();
      const top = rect.top + rect.height / 2;
      const left = rect.right + TOOLTIP_GAP;
      setPlacement((current) => (current !== null && current.label === label && current.top === top && current.left === left ? current : { label, top, left }));
    };
    return {
      show,
      showForFocus(label, anchor) {
        if (pointerFocus.current) {
          pointerFocus.current = false;
          return;
        }
        show(label, anchor);
      },
      hide() {
        setPlacement(null);
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
