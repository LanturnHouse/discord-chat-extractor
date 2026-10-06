import { formatDayLabel } from '@/lib/message';
import type { MessageRenderContext } from './types';

export interface DayDividerProps {
  /** ISO timestamp of the first message of the day. */
  timestamp: string;
  ctx: MessageRenderContext;
}

/** Centered date label over a hairline. Renders nothing when the timestamp cannot be read. */
export function DayDivider({ timestamp, ctx }: DayDividerProps) {
  const label = formatDayLabel(timestamp, ctx.timeZone, ctx.locale);
  if (label === '') return null;
  return (
    <div className="msg-day-divider" role="separator" aria-label={label}>
      <span className="msg-day-divider__label">{label}</span>
    </div>
  );
}
