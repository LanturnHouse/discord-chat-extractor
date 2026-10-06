import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { TooltipPlacement } from './useRailTooltip';

/** The name of the hovered / focused server, drawn on `document.body` so the rail's overflow cannot clip it. */
export function RailTooltip({ placement }: { placement: TooltipPlacement | null }): ReactElement | null {
  if (placement === null) return null;
  return createPortal(
    <div className="rail-tooltip" role="tooltip" style={{ top: placement.top, left: placement.left }}>
      {placement.label}
    </div>,
    document.body,
  );
}
