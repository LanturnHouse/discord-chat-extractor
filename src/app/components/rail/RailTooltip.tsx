import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { tooltipShift } from './tooltipPosition';
import type { TooltipPlacement } from './useRailTooltip';

/**
 * The name of the hovered / focused server, drawn on `document.body` so the rail's overflow cannot clip it. Its height is only
 * known once it is rendered, so a long (multi-line) name is measured and shifted back into the window right after the commit,
 * before the first paint (`--tooltip-shift`, which the arrow compensates for).
 */
export function RailTooltip({ placement }: { placement: TooltipPlacement | null }): ReactElement | null {
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (placement === null || element === null) return undefined;
    const fit = (): void => {
      const shift = tooltipShift(placement.top, element.offsetHeight, document.documentElement.clientHeight);
      element.style.setProperty('--tooltip-shift', `${shift}px`);
    };
    fit();
    // The tooltip stays while the window changes height, and the edges it has to stay inside move with it.
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [placement]);

  if (placement === null) return null;
  return createPortal(
    <div ref={box} className="rail-tooltip" role="tooltip" style={{ top: placement.top, left: placement.left }}>
      {placement.label}
    </div>,
    document.body,
  );
}
