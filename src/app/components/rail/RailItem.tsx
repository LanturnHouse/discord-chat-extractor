import type { ReactElement, ReactNode } from 'react';
import type { TooltipControls } from './useRailTooltip';

export interface RailItemProps {
  /** Tooltip text (the server name / "Direct Messages"). */
  label: string;
  /** The server / the DM list is the open one: white pill at full height, rounded-square icon. */
  active: boolean;
  tooltip: TooltipControls;
  children: ReactNode;
}

/**
 * The 48px slot of one rail entry: the white pill on the rail's left edge, the icon button and the selection controls
 * (passed as children) and the tooltip triggers. `dce-reveal-host` makes the corner checkbox appear on hover.
 */
export function RailItem({ label, active, tooltip, children }: RailItemProps): ReactElement {
  return (
    <div
      className={active ? 'rail__item rail__item--active dce-reveal-host' : 'rail__item dce-reveal-host'}
      onMouseEnter={(event) => tooltip.show(label, event.currentTarget)}
      onMouseLeave={tooltip.hide}
      onMouseDown={tooltip.pointerDown}
      onFocus={(event) => tooltip.showForFocus(label, event.currentTarget)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) tooltip.hide();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') tooltip.hide();
      }}
    >
      <span className="rail__pill" aria-hidden="true" />
      {children}
    </div>
  );
}
