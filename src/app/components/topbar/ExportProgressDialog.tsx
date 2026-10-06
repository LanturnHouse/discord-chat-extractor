import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { common, useStrings } from '@/app/i18n';
import { sameScope, selectUnsavedFileCount, useAppStore, type ExportJob } from '@/app/state';
import type { ExportFailure, TargetProgress } from '@/lib/export/types';
import { Button } from '../common/Button';
import { Check, Lock, Minus, Warning } from '../common/Icons';
import { Spinner } from '../common/Spinner';
import { focusInitial, ignoreKeyRepeat, useEscapeKey, useTabTrap } from './focus';
import { formatElapsed, type NumberFormatter } from './format';
import { useElapsedMs, useNumberFormat, usePercentFormat } from './hooks';
import { isActiveStatus, isFinishedStatus, overallRatio, processedCount } from './progress';
import { describeScope } from './scopeText';
import { topbarStrings } from './strings';

type Strings = (typeof topbarStrings)['en'];

/* --- live progress ---------------------------------------------------------------------------------------------- */

function StatusIcon({ status }: { status: TargetProgress['status'] }): ReactElement {
  switch (status) {
    case 'fetching':
      return <Spinner size={16} />;
    case 'done':
      return <Check />;
    case 'skipped':
      return <Lock />;
    case 'error':
      return <Warning />;
    case 'cancelled':
      return <Minus />;
    case 'queued':
      return <span className="topbar-targets__dot" />;
  }
}

interface TargetRowProps {
  target: TargetProgress;
  /** What this channel is exported with when that differs from the other channels ("Newest 200 messages"); undefined otherwise. */
  scope: string | undefined;
  t: Strings;
  fmt: NumberFormatter;
  percent: NumberFormatter;
}

/** One channel of the list. Memoised: the runner keeps the object of every target that did not change. */
const TargetRow = memo(function TargetRow({ target, scope, t, fmt, percent }: TargetRowProps): ReactElement {
  let state: string;
  switch (target.status) {
    case 'queued':
      state = t.stateQueued;
      break;
    case 'fetching':
      // Right before the end the estimate can read 100%: only "done" may say so.
      state = target.ratio === null ? t.messageCount(target.fetched, fmt) : `${t.messageCount(target.fetched, fmt)} · ${percent(Math.min(0.99, target.ratio))}`;
      break;
    case 'done':
      state = t.messageCount(target.fetched, fmt);
      break;
    case 'skipped':
      state = t.stateSkipped;
      break;
    case 'error':
      state = t.stateError;
      break;
    case 'cancelled':
      state = t.stateCancelled;
      break;
  }
  return (
    <li className="topbar-targets__row" data-status={target.status} title={target.status === 'skipped' ? target.error : undefined}>
      <span className="topbar-targets__icon" aria-hidden="true">
        <StatusIcon status={target.status} />
      </span>
      <span className="topbar-targets__body">
        <span className="topbar-targets__label" title={target.label}>
          {target.label}
        </span>
        {scope === undefined ? null : <span className="topbar-targets__scope">{scope}</span>}
        {target.status === 'error' && target.error !== undefined ? <span className="topbar-targets__reason">{target.error}</span> : null}
      </span>
      <span className="topbar-targets__state">{state}</span>
    </li>
  );
});

function RunningBody({ job }: { job: ExportJob }): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const percent = usePercentFormat();
  const elapsed = useElapsedMs(job.startedAt, true);
  const listRef = useRef<HTMLUListElement>(null);
  const { progress } = job;
  const packaging = job.status === 'packaging';
  const targets = progress?.targets ?? [];
  const valueNow = Math.round(overallRatio(progress) * 100);
  const currentIndex = progress?.currentIndex ?? -1;
  // The scopes the job started with: settings edited while it runs only apply to the next export.
  const scopes = useMemo(() => {
    const summaries = new Map<string, string>();
    const used = job.scope;
    if (used === null) return summaries;
    for (const [channelId, own] of Object.entries(used.overrides)) {
      if (!sameScope(own, used.defaults)) summaries.set(channelId, describeScope(own, t, fmt));
    }
    return summaries;
  }, [job.scope, t, fmt]);

  // Long lists: keep the channel that is being fetched in view.
  useEffect(() => {
    const row = currentIndex < 0 ? undefined : listRef.current?.children[currentIndex];
    if (row !== undefined && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [currentIndex]);

  return (
    <>
      <div className="topbar-progress">
        <div
          className="topbar-progress__bar"
          role="progressbar"
          aria-label={t.overallProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={packaging ? undefined : valueNow}
          data-indeterminate={packaging ? '' : undefined}
        >
          <div className="topbar-progress__fill" style={packaging ? undefined : { width: `${valueNow}%` }} />
        </div>
        <div className="topbar-progress__meta">
          <span>
            {packaging
              ? t.creatingZip
              : `${t.channelsProgress(processedCount(progress), targets.length, fmt)} · ${t.messageCount(progress?.totalMessages ?? 0, fmt)}`}
          </span>
          <span className="topbar-progress__elapsed">{t.elapsed(formatElapsed(elapsed))}</span>
        </div>
        <p className="topbar-progress__note">{t.keepOpen}</p>
      </div>
      {targets.length === 0 ? null : (
        <ul ref={listRef} className="topbar-targets" aria-label={t.targetsLabel}>
          {targets.map((target) => (
            <TargetRow key={target.channelId} target={target} scope={scopes.get(target.channelId)} t={t} fmt={fmt} percent={percent} />
          ))}
        </ul>
      )}
    </>
  );
}

/* --- result ----------------------------------------------------------------------------------------------------- */

function FailureList({ heading, failures }: { heading: string; failures: readonly ExportFailure[] }): ReactElement | null {
  if (failures.length === 0) return null;
  return (
    <section className="topbar-failures">
      <h3 className="topbar-failures__heading">{heading}</h3>
      <ul className="topbar-failures__list">
        {failures.map((failure) => (
          <li key={failure.channelId} className="topbar-failures__row">
            <span className="topbar-failures__label">{failure.label}</span>
            <span className="topbar-failures__reason">{failure.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `unsaved`: completed channels still wait for "Save" (a cancelled run, or a download that failed).
 * `nothing`: the run is over and not one channel made it into a file (no access everywhere, or every channel failed).
 */
function titleFor(status: ExportJob['status'], unsaved: boolean, nothing: boolean, t: Strings): string {
  switch (status) {
    case 'done':
      return nothing ? t.titleNothing : t.titleDone;
    case 'cancelled':
      return t.titleCancelled;
    case 'error':
      return unsaved ? t.titleSaveFailed : t.titleError;
    default:
      return t.titleRunning;
  }
}

/** What the run produced; never shown while it still works. */
function FinishedBody({ job, unsavedFiles }: { job: ExportJob; unsavedFiles: number }): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const { output } = job;
  const failures = output?.failures ?? [];

  let summary: ReactElement | null = null;
  if (job.status === 'done' && output !== null) {
    const saved = output.fileCount > 0;
    summary = (
      <p className="topbar-summary" data-tone={saved ? 'success' : 'warning'}>
        {saved ? <Check /> : <Warning />}
        <span>{saved ? t.summaryDone(output.fileCount, output.messageCount, output.filename, fmt) : t.summaryNothing}</span>
      </p>
    );
  } else if (job.status === 'cancelled') {
    summary =
      output === null || output.fileCount === 0 ? (
        <p className="topbar-summary" data-tone="neutral">
          <span>{t.cancelledNothing}</span>
        </p>
      ) : (
        <div className="topbar-summary" data-tone="neutral">
          <span>{output.saved ? t.cancelledSaved(output.fileCount, output.filename, fmt) : t.cancelledSummary(output.fileCount, fmt)}</span>
          {output.saved ? null : <span className="topbar-summary__sub">{t.unsavedNote(output.fileCount)}</span>}
        </div>
      );
  } else if (job.status === 'error' && unsavedFiles > 0) {
    // The export itself worked; only handing the file over failed (the alert below says why).
    summary = (
      <div className="topbar-summary" data-tone="neutral">
        <span>{t.exportedSummary(unsavedFiles, fmt)}</span>
        <span className="topbar-summary__sub">{t.unsavedNote(unsavedFiles)}</span>
      </div>
    );
  }

  // The run ended before it reached these channels (Discord asked for a long wait): they are in no list below.
  const notReached = job.status === 'done' ? (job.progress?.targets.filter((target) => target.status === 'cancelled').length ?? 0) : 0;

  return (
    <div className="topbar-result" role="status">
      {summary}
      {notReached === 0 ? null : (
        <p className="topbar-summary" data-tone="warning">
          <Warning />
          <span>{t.stoppedEarly(notReached, fmt)}</span>
        </p>
      )}
      {job.error === null ? null : (
        <p className="topbar-summary" data-tone="danger" role="alert">
          <Warning />
          <span>{job.error}</span>
        </p>
      )}
      <FailureList heading={t.skippedHeading(failures.filter((f) => f.kind === 'skipped').length, fmt)} failures={failures.filter((f) => f.kind === 'skipped')} />
      <FailureList heading={t.failedHeading(failures.filter((f) => f.kind === 'error').length, fmt)} failures={failures.filter((f) => f.kind === 'error')} />
    </div>
  );
}

/* --- dialog ----------------------------------------------------------------------------------------------------- */

export interface ExportProgressDialogProps {
  /** Hides the dialog while the job keeps running (the download button still shows the progress). */
  onHide: () => void;
  /** Gets the focus back when the dialog goes away. */
  returnFocusRef: RefObject<HTMLElement | null>;
}

/**
 * The modal around a running or finished export: live progress with Cancel / Hide (Cancel is off while the ZIP is built),
 * then the summary with Close (and "Save the completed channels" after a cancel or a failed download). It never closes by
 * itself, and only a finished one can be closed with Esc.
 * It reads `exportJob` itself, so the top bar re-renders only while this dialog is mounted.
 */
export function ExportProgressDialog({ onHide, returnFocusRef }: ExportProgressDialogProps): ReactElement | null {
  const job = useAppStore((state) => state.exportJob);
  const cancelExport = useAppStore((state) => state.cancelExport);
  const dismissExportJob = useAppStore((state) => state.dismissExportJob);
  const saveExportOutput = useAppStore((state) => state.saveExportOutput);
  const t = useStrings(topbarStrings);
  const c = useStrings(common);
  const fmt = useNumberFormat();
  const [cancelling, setCancelling] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const active = isActiveStatus(job.status);
  const finished = isFinishedStatus(job.status);
  // Packaging is local work that always runs to the end: there is nothing left to cancel.
  const packaging = job.status === 'packaging';
  // Completed channels that still wait for "Save": after a cancel, or after the automatic download failed.
  const unsavedFiles = selectUnsavedFileCount({ exportJob: job });
  const unsaved = unsavedFiles > 0;

  useEscapeKey(dismissExportJob, finished);
  useTabTrap(panelRef);

  // The dialog opens on its first button. The buttons then change with the state (running -> done...): when the one that had the
  // focus disappears, the focus goes to the dialog itself and never to the next button. A key that is still held down (or pressed
  // once more) after "Cancel" must not land on "Save", then "Close", then the Download button that gets the focus back.
  const opened = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    const first = !opened.current;
    opened.current = true;
    if (panel === null || panel.contains(document.activeElement)) return;
    if (first) focusInitial(panel);
    else panel.focus();
  }, [job.status, unsaved]);

  useEffect(
    () => () => {
      returnFocusRef.current?.focus();
    },
    [returnFocusRef],
  );

  if (job.status === 'idle') return null;

  return createPortal(
    <div className="topbar-modal">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={active} tabIndex={-1} className="topbar-dialog">
        <header className="topbar-dialog__header">
          <h2 id={titleId} className="topbar-dialog__title">
            {titleFor(job.status, unsaved, job.output !== null && job.output.fileCount === 0, t)}
          </h2>
        </header>
        <div className="topbar-dialog__body">{active ? <RunningBody job={job} /> : <FinishedBody job={job} unsavedFiles={unsavedFiles} />}</div>
        {/* Keyed: the buttons of a running job and those of a finished one are different buttons. Without keys React would turn the
            focused "Cancel" into "Save" in place, and the focus (and a key still held down) would stay on it. */}
        <footer className="topbar-dialog__footer" onKeyDown={ignoreKeyRepeat}>
          {active ? (
            <>
              <Button key="hide" variant="secondary" onClick={onHide} data-autofocus="">
                {t.hide}
              </Button>
              <Button
                key="cancel"
                variant="danger"
                aria-disabled={cancelling || packaging ? true : undefined}
                data-blocked={packaging ? '' : undefined}
                title={packaging ? t.cancelUnavailable : undefined}
                onClick={() => {
                  if (cancelling || packaging) return;
                  setCancelling(true);
                  cancelExport();
                }}
              >
                {cancelling ? t.cancelling : c.cancel}
              </Button>
            </>
          ) : (
            <>
              <Button key="close" variant={unsaved ? 'secondary' : 'primary'} onClick={dismissExportJob} data-autofocus={unsaved ? undefined : ''}>
                {c.close}
              </Button>
              {unsaved ? (
                <Button key="save" onClick={saveExportOutput} data-autofocus="">
                  {t.saveCompleted(unsavedFiles, fmt)}
                </Button>
              ) : null}
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
