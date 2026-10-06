import { displayName, getStrings, type ReferenceView } from '@/lib/message';
import { Avatar } from './Avatar';
import { MsgIcon } from './Icon';
import { getMessageLabels } from './labels';
import type { MessageRenderContext } from './types';

export interface ReplyPreviewProps {
  reference: ReferenceView;
  ctx: MessageRenderContext;
}

/**
 * Header of a reply (connector line, mini avatar, `@name`, faded one-line text) or the "Forwarded" label of a
 * forwarded message. The preview text is already a single plain line (`referenceView`), so it is rendered as text.
 */
export function ReplyPreview({ reference, ctx }: ReplyPreviewProps) {
  const labels = getMessageLabels(ctx.locale);

  if (reference.kind === 'forward') {
    return (
      <div className="msg-forward-label">
        <MsgIcon name="forward" className="msg-forward-label__icon" size={14} />
        <span>{labels.forwarded}</span>
      </div>
    );
  }

  const { author, preview, deleted } = reference;
  const name = author === null ? null : displayName(author) || getStrings(ctx.locale).unknownUser;
  return (
    <div className={deleted ? 'msg-reply msg-reply--deleted' : 'msg-reply'}>
      {author !== null && <Avatar user={author} size={16} className="msg-reply__avatar" />}
      {name !== null && (
        <span className="msg-reply__name" dir="auto">
          <span className="msg-sr-only">{labels.replyingTo} </span>@{name}
        </span>
      )}
      {preview !== '' && (
        <span className="msg-reply__text" dir="auto">
          {preview}
        </span>
      )}
    </div>
  );
}
