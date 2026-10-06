import type { Reaction } from '@/lib/discord/types';
import { safeMediaUrl } from '@/lib/markdown';
import { reactionView, type ReactionView } from '@/lib/message';
import { getMessageLabels } from './labels';
import { objectsOf } from './list';
import { SafeImg } from './SafeImg';
import type { MessageRenderContext } from './types';

export interface ReactionBarProps {
  reactions: readonly Reaction[];
  ctx: MessageRenderContext;
}

/** Custom emoji are shown as `:name:` text when their image cannot be loaded. */
function ReactionEmoji({ view }: { view: ReactionView }) {
  const textFallback = (
    <span className="msg-reaction__emoji msg-reaction__emoji--text" aria-hidden="true">
      {view.label}
    </span>
  );
  const src = safeMediaUrl(view.imageUrl);
  if (src !== null) {
    return <SafeImg className="msg-reaction__img" src={src} alt={view.label} width={16} height={16} fallback={textFallback} />;
  }
  // Unicode emoji, or a custom emoji whose id is unusable (`:name:`).
  return view.label.startsWith(':') ? textFallback : <span className="msg-reaction__emoji" aria-hidden="true">{view.label}</span>;
}

/** Read-only reaction pills; the ones the account itself added (`me`) are tinted. */
export function ReactionBar({ reactions, ctx }: ReactionBarProps) {
  const items = objectsOf(reactions);
  if (items.length === 0) return null;
  const labels = getMessageLabels(ctx.locale);
  return (
    <div className="msg-reactions" role="group" aria-label={labels.reactions}>
      {items.map((reaction, index) => {
        const view = reactionView(reaction);
        return (
          <span
            key={`${index}:${view.key}`}
            className={view.me ? 'msg-reaction msg-reaction--me' : 'msg-reaction'}
            role="img"
            aria-label={labels.reaction(view.label, view.count, view.me)}
            title={view.label === '' ? undefined : view.label}
          >
            <ReactionEmoji view={view} />
            <span className="msg-reaction__count" aria-hidden="true">
              {view.count}
            </span>
          </span>
        );
      })}
    </div>
  );
}
