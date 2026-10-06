import { memo } from 'react';
import type { Message } from '@/lib/discord/types';
import { isSameDay, isSystemMessage } from '@/lib/message';
import { DayDivider } from './DayDivider';
import { MessageRow } from './MessageRow';
import { SystemMessage } from './SystemMessage';
import type { MessageRenderContext } from './types';

export interface MessageItemProps {
  message: Message;
  /** The message right above this one in the list (ascending order); undefined for the first message. */
  prev: Message | undefined;
  ctx: MessageRenderContext;
}

function MessageItemView({ message, prev, ctx }: MessageItemProps) {
  const newDay = prev === undefined || !isSameDay(prev.timestamp, message.timestamp, ctx.timeZone);
  return (
    <>
      {newDay && <DayDivider timestamp={message.timestamp} ctx={ctx} />}
      {isSystemMessage(message) ? <SystemMessage message={message} ctx={ctx} /> : <MessageRow message={message} prev={prev} ctx={ctx} />}
    </>
  );
}

/**
 * Messages are immutable snapshots, so identity is decided by message id + previous message id (grouping and the day
 * divider depend on it) + the context object. Thousands of these live in one list: a re-render of the list must not
 * touch rows whose neighbours did not change.
 */
function sameItem(a: MessageItemProps, b: MessageItemProps): boolean {
  return a.message.id === b.message.id && a.prev?.id === b.prev?.id && a.ctx === b.ctx;
}

/** One entry of the message list: an optional day divider followed by the message (or system notice). */
export const MessageItem = memo(MessageItemView, sameItem);
