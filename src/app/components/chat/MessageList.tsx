import { memo, useRef, type ReactElement } from 'react';
import { Button } from '@/app/components/common/Button';
import { ChevronDown } from '@/app/components/common/Icons';
import { Spinner } from '@/app/components/common/Spinner';
import { MessageItem, type MessageRenderContext } from '@/app/components/message';
import { common, useStrings } from '@/app/i18n';
import { useGuildNames, type ActiveChannel, type ChannelMessages } from '@/app/state';
import type { Message } from '@/lib/discord/types';
import { ChannelStart } from './ChannelStart';
import { channelIdOf, guildIdOf } from './channelInfo';
import { chatStrings } from './chatStrings';
import { useMessageContext } from './messageContext';
import { useScrollAnchor } from './scrollAnchor';
import { useMessageScroll } from './useMessageScroll';

type ChatStrings = (typeof chatStrings)['ko'];

interface MessageRowsProps {
  items: readonly Message[];
  ctx: MessageRenderContext;
}

/**
 * Every message as a direct child of the list, with no wrapper per row: `content-visibility: auto` on `.msg` (message.css)
 * is what keeps thousands of rows cheap. Memoised, so unrelated state of the list (the jump button...) never walks the rows.
 */
const MessageRows = memo(function MessageRows({ items, ctx }: MessageRowsProps): ReactElement {
  return (
    <>
      {items.map((message, index) => (
        <MessageItem key={message.id} message={message} prev={index === 0 ? undefined : items[index - 1]} ctx={ctx} />
      ))}
    </>
  );
});

function listLabel(t: ChatStrings, channel: ActiveChannel): string {
  if (channel.kind === 'dm') return t.listLabelDm(channel.dm.name);
  return channel.node.kind === 'thread' ? t.listLabelThread(channel.node.name) : t.listLabelChannel(channel.node.name);
}

export interface MessageListProps {
  channel: ActiveChannel;
  /** The loaded entry of `channel` (status 'loaded'). */
  messages: ChannelMessages;
}

/**
 * The scrollable messages of one channel. Mount it with `key={channelId}`: it starts at the bottom, stays there until the
 * user moves up (and again once they are back), and pages older messages in on its own (see useMessageScroll / useScrollAnchor).
 */
export function MessageList({ channel, messages }: MessageListProps): ReactElement {
  const t = useStrings(chatStrings);
  const c = useStrings(common);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const guildNames = useGuildNames(guildIdOf(channel));
  const { items, hasMore, loadingOlder, olderError } = messages;
  const ctx = useMessageContext(guildNames, items);

  // Declared before useMessageScroll: after a prepend the position is corrected first, then the next page is considered.
  useScrollAnchor(scrollerRef, contentRef, items);
  const scroll = useMessageScroll({ scrollerRef, contentRef, channelId: channelIdOf(channel), messages });

  // The button disappears as soon as the bottom is reached; a keyboard user who pressed it would otherwise lose their place
  // (the browser drops the focus to <body>), so the focus moves to the list it scrolled.
  const jumpToLatest = (): void => {
    scroll.jumpToLatest();
    scrollerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="chat-frame">
      <div
        ref={scrollerRef}
        className="chat-list"
        role="log"
        aria-live="off"
        aria-label={listLabel(t, channel)}
        tabIndex={0}
        data-skip-target="messages"
        {...scroll.handlers}
      >
        {/* Zero height and sticky: shows progress / errors at the top of the viewport wherever it is, without moving a single row. */}
        <div className="chat-list__status">
          {loadingOlder && (
            <div className="chat-pill" role="status">
              <Spinner size={16} />
              <span>{t.loadingOlder}</span>
            </div>
          )}
          {!loadingOlder && olderError !== undefined && (
            <div className="chat-pill chat-pill--error" role="alert">
              <span className="chat-pill__text">
                <strong>{t.olderFailed}</strong>
                <span className="chat-pill__detail">{olderError}</span>
              </span>
              <Button size="sm" onClick={scroll.retryOlder}>
                {c.retry}
              </Button>
            </div>
          )}
        </div>
        <div ref={contentRef} className="chat-list__content">
          {!hasMore && <ChannelStart channel={channel} />}
          <MessageRows items={items} ctx={ctx} />
        </div>
      </div>
      {scroll.showJump && (
        <button type="button" className="chat-jump" onClick={jumpToLatest}>
          <ChevronDown />
          <span>{t.jumpToLatest}</span>
        </button>
      )}
    </div>
  );
}
