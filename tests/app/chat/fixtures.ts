import type { ActiveChannel } from '@/app/state';
import type { ChannelKind, ChannelNode, DmNode } from '@/lib/discord/model';
import type { Message, User } from '@/lib/discord/types';

const MINUTE = 60 * 1000;
/**
 * 09:00 local time: with up to 10 hours of minute-spaced messages after it everything stays on one calendar day in the
 * zone the code under test resolves (the machine's), so no test depends on the zone and the day dividers are predictable:
 * exactly one, above the first message.
 */
export const BASE_TIME = new Date(2026, 9, 5, 9, 0, 0).getTime();

export const ALICE: User = { id: '1001', username: 'alice_a', global_name: 'Alice', avatar: null, discriminator: '0' };
export const BOB: User = { id: '1002', username: 'bob_b', global_name: 'Bob', avatar: null, discriminator: '0' };

/** Message number `index` of an imaginary channel: ids ascend with the index, one minute apart, authors alternate (so rows never group). */
export function messageAt(index: number, overrides: Partial<Message> = {}): Message {
  return {
    id: String(5_000_000 + index),
    channel_id: '7',
    author: index % 2 === 0 ? ALICE : BOB,
    content: `message ${index}`,
    timestamp: new Date(BASE_TIME + index * MINUTE).toISOString(),
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...overrides,
  };
}

/** Messages `from` .. `to - 1` in ascending order. */
export function messageRange(from: number, to: number): Message[] {
  const messages: Message[] = [];
  for (let index = from; index < to; index += 1) messages.push(messageAt(index));
  return messages;
}

export function textChannel(name = 'general', kind: ChannelKind = 'text', id = '7'): ActiveChannel {
  const node: ChannelNode = { id, guildId: 'g1', kind, name, parentId: null, position: 0, topic: null, nsfw: false, canView: true };
  return { kind: 'guild', guild: { id: 'g1', name: 'Dev Lounge', iconUrl: null, owner: false }, node };
}

export function dmChannel(name = 'Minjun', kind: DmNode['kind'] = 'dm', id = '8'): ActiveChannel {
  const dm: DmNode = {
    id,
    kind,
    name,
    iconUrl: 'https://cdn.discordapp.com/embed/avatars/1.png?size=160',
    recipients: [],
    lastMessageId: null,
  };
  return { kind: 'dm', dm };
}
