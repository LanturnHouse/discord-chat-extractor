import type { Message, User } from '@/lib/discord/types';
import { displayName, formatFullTooltip, systemMessageText } from '@/lib/message';
import { dateTimeAttr, headerTimestamp } from './format';
import { MsgIcon } from './Icon';
import type { MsgIconName } from './iconPaths';
import type { MessageRenderContext } from './types';

export interface SystemMessageProps {
  message: Message;
  ctx: MessageRenderContext;
}

interface SystemIcon {
  name: MsgIconName;
  /** CSS modifier `msg-system__icon--<tone>`. */
  tone: 'join' | 'leave' | 'pin' | 'boost' | 'neutral';
}

function iconOf(type: number): SystemIcon {
  switch (type) {
    case 1:
    case 7:
      return { name: 'join', tone: 'join' };
    case 2:
      return { name: 'leave', tone: 'leave' };
    case 3:
      return { name: 'call', tone: 'join' };
    case 4:
    case 5:
      return { name: 'edit', tone: 'neutral' };
    case 6:
      return { name: 'pin', tone: 'pin' };
    case 8:
    case 9:
    case 10:
    case 11:
      return { name: 'boost', tone: 'boost' };
    case 18:
      return { name: 'thread', tone: 'neutral' };
    default:
      return { name: 'info', tone: 'neutral' };
  }
}

/** The sentence with the actor's name emphasised. Falls back to plain text when the name is not found verbatim. */
function SystemText({ text, actor }: { text: string; actor: string }) {
  const at = actor === '' ? -1 : text.indexOf(actor);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="msg-system__actor">{actor}</span>
      {text.slice(at + actor.length)}
    </>
  );
}

/** Join / pin / boost / thread / call ... notices: a small icon in the avatar gutter and one line of text. */
export function SystemMessage({ message, ctx }: SystemMessageProps) {
  const text = systemMessageText(message, ctx.locale) ?? '';
  const author: User | undefined = message.author;
  const actor = author ? displayName(author) : '';
  const icon = iconOf(typeof message.type === 'number' ? message.type : 0);
  return (
    <article className="msg msg--system" data-message-id={message.id}>
      <span className={`msg-system__icon msg-system__icon--${icon.tone}`}>
        <MsgIcon name={icon.name} size={16} />
      </span>
      <div className="msg-system__text">
        <SystemText text={text} actor={actor} />
        <time
          className="msg-timestamp"
          dateTime={dateTimeAttr(message.timestamp)}
          title={formatFullTooltip(message.timestamp, ctx.timeZone, ctx.locale) || undefined}
        >
          {headerTimestamp(message.timestamp, ctx.timeZone, ctx.locale)}
        </time>
      </div>
    </article>
  );
}
