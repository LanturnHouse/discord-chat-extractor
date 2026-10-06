import type { ActiveChannel } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';

export function channelIdOf(channel: ActiveChannel): Snowflake {
  return channel.kind === 'guild' ? channel.node.id : channel.dm.id;
}

export function guildIdOf(channel: ActiveChannel): Snowflake | null {
  return channel.kind === 'guild' ? channel.guild.id : null;
}

/** Forums and media channels only contain posts; the store never opens them, but a stale state must not look like an empty chat. */
export function isForumLike(channel: ActiveChannel): boolean {
  return channel.kind === 'guild' && (channel.node.kind === 'forum' || channel.node.kind === 'media');
}
