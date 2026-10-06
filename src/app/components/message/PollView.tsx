import type { Poll } from '@/lib/discord/types';
import { pollView } from '@/lib/message';
import { getMessageLabels } from './labels';
import type { MessageRenderContext } from './types';

export interface PollViewProps {
  poll: Poll;
  ctx: MessageRenderContext;
}

/** Read-only poll: question, answers with vote counts and bars (when the API sent results), closed state. */
export function PollView({ poll, ctx }: PollViewProps) {
  const view = pollView(poll);
  const labels = getMessageLabels(ctx.locale);
  const total = view.totalVotes;
  const leading = view.answers.reduce((max, answer) => Math.max(max, answer.votes ?? 0), 0);

  return (
    <div className={view.finalized ? 'msg-poll msg-poll--closed' : 'msg-poll'}>
      {view.question !== '' && (
        <div className="msg-poll__question" dir="auto">
          {view.question}
        </div>
      )}
      {!view.finalized && <div className="msg-poll__hint">{view.multiselect ? labels.pollMulti : labels.pollSingle}</div>}
      <ul className="msg-poll__answers">
        {view.answers.map((answer, index) => {
          const votes = answer.votes;
          const percent = votes === null || total === null || total === 0 ? 0 : Math.round((votes / total) * 100);
          const winner = view.finalized && votes !== null && votes > 0 && votes === leading;
          return (
            <li key={index} className={winner ? 'msg-poll__answer msg-poll__answer--winner' : 'msg-poll__answer'}>
              <div className="msg-poll__answer-row">
                {answer.emoji !== null && <span className="msg-poll__emoji">{answer.emoji}</span>}
                <span className="msg-poll__text" dir="auto">
                  {answer.text}
                </span>
                {votes !== null && (
                  <span className="msg-poll__votes">
                    {labels.pollVotes(votes)} · {percent}%
                  </span>
                )}
              </div>
              {votes !== null && (
                <progress
                  className="msg-poll__bar"
                  max={total !== null && total > 0 ? total : 1}
                  value={votes}
                  aria-label={`${labels.pollVotes(votes)}, ${percent}%`}
                />
              )}
            </li>
          );
        })}
      </ul>
      {total !== null && (
        <div className="msg-poll__footer">
          {labels.pollVotes(total)}
          {view.finalized ? ` · ${labels.pollClosed}` : ''}
        </div>
      )}
    </div>
  );
}
