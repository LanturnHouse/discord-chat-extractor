import { avatarUrl } from '@/lib/discord/cdn';
import type { User } from '@/lib/discord/types';
import { safeMediaUrl } from '@/lib/markdown';
import { displayName, initialOf, toneOf } from '@/lib/message';
import { SafeImg } from './SafeImg';

export interface AvatarProps {
  user: User;
  /** CSS pixel size; the image is requested at twice that for sharp rendering on 2x displays. */
  size: number;
  /** Class of the `<img>` and of the fallback circle (it carries the CSS size). */
  className: string;
}

function avatarSrc(user: User, pixels: number): string | null {
  try {
    return safeMediaUrl(avatarUrl(user, pixels));
  } catch {
    // The default avatar index is derived from the id with BigInt, which throws for ids that are not numeric.
    return null;
  }
}

/** Round avatar; a failed or missing image becomes a coloured circle with the initial of the display name. */
export function Avatar({ user, size, className }: AvatarProps) {
  const fallback = (
    <span className={`${className} msg-avatar-fallback msg-avatar-fallback--${toneOf(user?.id)}`} aria-hidden="true">
      {initialOf(displayName(user))}
    </span>
  );
  return <SafeImg className={className} src={avatarSrc(user, size * 2)} alt="" width={size} height={size} fallback={fallback} />;
}
