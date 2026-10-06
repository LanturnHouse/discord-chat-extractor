import { useEffect, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useActiveChannel, useAppStore, useChannelMessages, useGuildTreeEntry } from '@/app/state';
import { isForumLike } from './channelInfo';
import { chatStrings } from './chatStrings';
import { EmptyState, ErrorState, ForbiddenState, ForumState, MessageSkeleton } from './ChatStates';
import { MessageList } from './MessageList';
import './chat.css';

/**
 * The chat area under the top bar: the messages of the open channel, or the state that stands in for them.
 * Everything is read from the store; the only thing it owns is which of the states to show.
 */
export function ChatPane(): ReactElement {
  const t = useStrings(chatStrings);
  const activeId = useAppStore((state) => state.activeChannelId);
  const viewGuildId = useAppStore((state) => (state.view.kind === 'guild' ? state.view.guildId : null));
  const isDmView = useAppStore((state) => state.view.kind === 'dms');
  const loadInitialMessages = useAppStore((state) => state.loadInitialMessages);
  const ensureGuildTree = useAppStore((state) => state.ensureGuildTree);
  const active = useActiveChannel();
  const messages = useChannelMessages(activeId);
  const treeEntry = useGuildTreeEntry(viewGuildId);
  const { status } = messages;
  const isForum = active !== null && isForumLike(active);

  // Safety net: a channel that is open but was never loaded (a cancelled first page leaves it that way) loads now.
  // The action ignores channels that are loading / loaded / forbidden, so this never doubles a request.
  useEffect(() => {
    if (activeId !== null && status === 'idle' && !isForum) void loadInitialMessages(activeId);
  }, [activeId, status, isForum, loadInitialMessages]);

  let body: ReactElement;
  if (activeId === null) {
    body = <EmptyState dm={isDmView} />;
  } else if (isForum) {
    body = <ForumState />;
  } else if (status === 'forbidden') {
    body = <ForbiddenState />;
  } else if (status === 'error') {
    body = <ErrorState message={messages.error} onRetry={() => void loadInitialMessages(activeId)} />;
  } else if (status === 'loaded' && active !== null) {
    body = <MessageList key={activeId} channel={active} messages={messages} />;
  } else if (status === 'loaded' && viewGuildId !== null && treeEntry.status === 'error') {
    // The messages are here but the server tree (the channel's name, the guild's names) failed to load.
    body = <ErrorState message={treeEntry.error} onRetry={() => void ensureGuildTree(viewGuildId)} />;
  } else {
    body = <MessageSkeleton />;
  }

  // Focusable by script only: where "skip to messages" lands while no message list is open (the list itself is the target otherwise).
  return (
    <section className="app-chat" aria-label={t.chatLabel} tabIndex={-1} data-skip-target="chat">
      {body}
    </section>
  );
}
