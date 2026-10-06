import { DiscordMarkdown } from '@/lib/markdown';
import { formatFullTooltip, type ForwardSnapshotView } from '@/lib/message';
import { Attachments } from './Attachments';
import { Embeds } from './EmbedView';
import { dateTimeAttr, headerTimestamp } from './format';
import type { MessageRenderContext } from './types';

export interface ForwardedMessageProps {
  /** `forwardView(message)`: the original messages inside a forwarded message. */
  snapshots: readonly ForwardSnapshotView[];
  ctx: MessageRenderContext;
}

/** The forwarded original(s) in a bordered box: text, attachments, embeds and the time the original was sent. */
export function ForwardedMessage({ snapshots, ctx }: ForwardedMessageProps) {
  if (snapshots.length === 0) return null;
  return (
    <>
      {snapshots.map((snapshot, index) => (
        <div key={index} className="msg-forward">
          {snapshot.content.trim() !== '' && (
            <div className="msg-content" dir="auto">
              <DiscordMarkdown content={snapshot.content} ctx={ctx} />
            </div>
          )}
          <Attachments attachments={snapshot.attachments} ctx={ctx} />
          <Embeds embeds={snapshot.embeds} ctx={ctx} />
          {snapshot.timestamp !== null && (
            <time
              className="msg-forward__time"
              dateTime={dateTimeAttr(snapshot.timestamp)}
              title={formatFullTooltip(snapshot.timestamp, ctx.timeZone, ctx.locale) || undefined}
            >
              {headerTimestamp(snapshot.timestamp, ctx.timeZone, ctx.locale)}
            </time>
          )}
        </div>
      ))}
    </>
  );
}
