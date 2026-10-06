import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/app/components/common/Button';
import { ChatBubble, Forum, Lock, Warning } from '@/app/components/common/Icons';
import { common, useStrings } from '@/app/i18n';
import { chatStrings } from './chatStrings';

function StateBox({ icon, title, role, children }: { icon: ReactElement; title: string; role?: 'alert'; children?: ReactNode }): ReactElement {
  return (
    <div className="chat-state" role={role}>
      <span className="chat-state__icon" aria-hidden="true">
        {icon}
      </span>
      <h2 className="chat-state__title">{title}</h2>
      {children}
    </div>
  );
}

/** Nothing is open. The DM view talks about conversations, a server view about channels. */
export function EmptyState({ dm }: { dm: boolean }): ReactElement {
  const t = useStrings(chatStrings);
  return (
    <StateBox icon={<ChatBubble />} title={dm ? t.emptyDmTitle : t.emptyTitle}>
      <p className="chat-state__text">{dm ? t.emptyDmBody : t.emptyBody}</p>
    </StateBox>
  );
}

/** The channel answered 403: it can neither be shown nor exported. */
export function ForbiddenState(): ReactElement {
  const t = useStrings(chatStrings);
  return (
    <StateBox icon={<Lock />} title={t.forbiddenTitle}>
      <p className="chat-state__text">{t.forbiddenBody}</p>
    </StateBox>
  );
}

/** Forums / media channels hold posts only. The store never opens them; this keeps a stale state from looking like an empty chat. */
export function ForumState(): ReactElement {
  const t = useStrings(chatStrings);
  return (
    <StateBox icon={<Forum />} title={t.forumTitle}>
      <p className="chat-state__text">{t.forumBody}</p>
    </StateBox>
  );
}

/** `message` is the already localised text of the store (describeError). */
export function ErrorState({ message, onRetry }: { message: string | undefined; onRetry: () => void }): ReactElement {
  const t = useStrings(chatStrings);
  const c = useStrings(common);
  return (
    <StateBox icon={<Warning />} title={t.errorTitle} role="alert">
      <p className="chat-state__text">{message ?? c.errorUnknown}</p>
      <Button onClick={onRetry}>{c.retry}</Button>
    </StateBox>
  );
}

const SKELETON_ROWS = 8;

/** Placeholder rows (avatar + two bars) while the first page is on its way. */
export function MessageSkeleton(): ReactElement {
  const t = useStrings(chatStrings);
  return (
    <div className="chat-skeleton" role="status" aria-busy="true" aria-label={t.loadingMessages}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div className="chat-skeleton__row" key={index} aria-hidden="true">
          <span className="chat-skeleton__avatar" />
          <span className="chat-skeleton__lines">
            <span className="chat-skeleton__bar chat-skeleton__bar--name" />
            <span className="chat-skeleton__bar chat-skeleton__bar--text" />
          </span>
        </div>
      ))}
    </div>
  );
}
