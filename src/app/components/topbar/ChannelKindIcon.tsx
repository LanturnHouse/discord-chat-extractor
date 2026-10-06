import type { ReactElement } from 'react';
import type { ChannelKind } from '@/lib/discord/model';
import { ChatBubble, Forum, Hash, Megaphone, Speaker, Stage, Thread, type IconProps } from '../common/Icons';

const ICONS: Record<ChannelKind, (props: IconProps) => ReactElement> = {
  text: Hash,
  announcement: Megaphone,
  voice: Speaker,
  stage: Stage,
  forum: Forum,
  media: Forum,
  thread: Thread,
  category: Hash,
  dm: ChatBubble,
  'group-dm': ChatBubble,
  other: Hash,
};

/** The glyph that goes with a channel kind (# for text, speaker for voice, thread arrow...). Decorative: the name sits next to it. */
export function ChannelKindIcon({ kind, ...props }: IconProps & { kind: ChannelKind }): ReactElement {
  const Icon = ICONS[kind];
  return <Icon {...props} />;
}
