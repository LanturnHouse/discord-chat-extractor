import type { Message, User } from '@/lib/discord/types';
import { DiscordMarkdown } from '@/lib/markdown';
import {
  displayName,
  forwardView,
  formatClock,
  formatFullTooltip,
  getStrings,
  referenceView,
  shouldGroupWithPrevious,
} from '@/lib/message';
import { Attachments } from './Attachments';
import { Avatar } from './Avatar';
import { Embeds } from './EmbedView';
import { dateTimeAttr, headerTimestamp } from './format';
import { ForwardedMessage } from './ForwardedMessage';
import { getMessageLabels } from './labels';
import { PollView } from './PollView';
import { ReactionBar } from './ReactionBar';
import { ReplyPreview } from './ReplyPreview';
import { Stickers } from './StickerView';
import type { MessageRenderContext } from './types';

export interface MessageRowProps {
  message: Message;
  prev: Message | undefined;
  ctx: MessageRenderContext;
}

/** Stand-in for a message without a usable author object. */
const UNKNOWN_AUTHOR: User = { id: '0', username: '' };

/**
 * A user-authored message in Discord's cozy layout: avatar gutter, name + time header (only first in a group),
 * markdown text, then forward box, attachments, embeds, stickers, poll and reactions. System messages use
 * `SystemMessage` instead.
 */
export function MessageRow({ message, prev, ctx }: MessageRowProps) {
  const labels = getMessageLabels(ctx.locale);
  const { locale, timeZone } = ctx;
  const author = typeof message.author === 'object' && message.author !== null ? message.author : UNKNOWN_AUTHOR;
  const name = displayName(author) || getStrings(locale).unknownUser;
  const grouped = shouldGroupWithPrevious(prev, message, timeZone);
  const reference = referenceView(message, locale);
  const content = typeof message.content === 'string' ? message.content : '';
  const hasText = content.trim() !== '';
  const edited = typeof message.edited_timestamp === 'string' && message.edited_timestamp !== '';
  const isApp = author.bot === true || message.webhook_id != null;
  const full = formatFullTooltip(message.timestamp, timeZone, locale);
  const dateTime = dateTimeAttr(message.timestamp);

  let className = grouped ? 'msg msg--grouped' : 'msg msg--first';
  if (reference?.kind === 'reply') className += ' msg--reply';
  if (reference?.kind === 'forward') className += ' msg--forward';
  if (isApp) className += ' msg--app';

  const stickers = Array.isArray(message.sticker_items) ? message.sticker_items : [];
  const poll = typeof message.poll === 'object' && message.poll !== null ? message.poll : null;

  return (
    <article className={className} data-message-id={message.id} aria-label={full === '' ? name : `${name}, ${full}`}>
      {reference?.kind === 'reply' && <ReplyPreview reference={reference} ctx={ctx} />}
      {grouped ? (
        <time className="msg-gutter-time" dateTime={dateTime} title={full || undefined}>
          {formatClock(message.timestamp, timeZone, locale)}
        </time>
      ) : (
        <Avatar user={author} size={40} className="msg-avatar" />
      )}
      <div className="msg-body">
        {!grouped && (
          <div className="msg-header">
            <span className="msg-author" dir="auto">
              {name}
            </span>
            {isApp && <span className="msg-tag">{labels.appTag}</span>}
            <time className="msg-timestamp" dateTime={dateTime} title={full || undefined}>
              {headerTimestamp(message.timestamp, timeZone, locale)}
            </time>
          </div>
        )}
        {(hasText || edited) && (
          <div className="msg-content" dir="auto">
            {hasText && <DiscordMarkdown content={content} ctx={ctx} />}
            {edited && (
              <span className="msg-edited" title={formatFullTooltip(message.edited_timestamp ?? '', timeZone, locale) || undefined}>
                {labels.edited}
              </span>
            )}
          </div>
        )}
        {reference?.kind === 'forward' && <ReplyPreview reference={reference} ctx={ctx} />}
        <ForwardedMessage snapshots={forwardView(message)} ctx={ctx} />
        <Attachments attachments={message.attachments} ctx={ctx} />
        <Embeds embeds={message.embeds} ctx={ctx} />
        <Stickers stickers={stickers} ctx={ctx} />
        {poll !== null && <PollView poll={poll} ctx={ctx} />}
        <ReactionBar reactions={message.reactions ?? []} ctx={ctx} />
      </div>
    </article>
  );
}
