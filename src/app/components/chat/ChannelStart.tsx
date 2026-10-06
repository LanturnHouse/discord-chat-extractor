import type { ReactElement } from 'react';
import { Hash, Megaphone, Speaker, Stage, Thread } from '@/app/components/common/Icons';
import { SafeImg } from '@/app/components/message/SafeImg';
import { useStrings } from '@/app/i18n';
import type { ActiveChannel } from '@/app/state';
import type { ChannelKind } from '@/lib/discord/model';
import { initialOf } from '@/lib/message';
import { chatStrings } from './chatStrings';

function KindIcon({ kind }: { kind: ChannelKind }): ReactElement {
  switch (kind) {
    case 'announcement':
      return <Megaphone />;
    case 'voice':
      return <Speaker />;
    case 'stage':
      return <Stage />;
    case 'thread':
      return <Thread />;
    default:
      return <Hash />;
  }
}

/**
 * "This is the beginning of #channel": what the top of the list shows once the first message has been loaded
 * (Discord's welcome header). Names are attacker-controlled and only ever rendered as text.
 */
export function ChannelStart({ channel }: { channel: ActiveChannel }): ReactElement {
  const t = useStrings(chatStrings);

  if (channel.kind === 'dm') {
    const { dm } = channel;
    return (
      <div className="chat-start">
        <SafeImg
          className="chat-start__avatar"
          src={dm.iconUrl}
          alt=""
          width={80}
          height={80}
          fallback={
            <span className="chat-start__avatar chat-start__avatar--fallback" aria-hidden="true">
              {initialOf(dm.name)}
            </span>
          }
        />
        <h2 className="chat-start__title">{dm.name}</h2>
        <p className="chat-start__text">{dm.kind === 'group-dm' ? t.groupStart(dm.name) : t.dmStart(dm.name)}</p>
      </div>
    );
  }

  const { node } = channel;
  const isThread = node.kind === 'thread';
  return (
    <div className="chat-start">
      <span className="chat-start__icon" aria-hidden="true">
        <KindIcon kind={node.kind} />
      </span>
      <h2 className="chat-start__title">{isThread ? node.name : t.welcomeTitle(node.name)}</h2>
      <p className="chat-start__text">{isThread ? t.threadStart : t.channelStart(node.name)}</p>
    </div>
  );
}
