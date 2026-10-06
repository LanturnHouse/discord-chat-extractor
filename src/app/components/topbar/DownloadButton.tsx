import { useEffect, useId, useRef, useState, type FocusEvent, type ReactElement, type RefObject } from 'react';
import { useStrings } from '@/app/i18n';
import { selectSelectedTargets, useAppStore, useSelectionCount } from '@/app/state';
import { Download, DownloadCaret, SpinnerIcon } from '../common/Icons';
import { ExportOptionsPopover } from './ExportOptionsPopover';
import { ignoreKeyRepeat } from './focus';
import { FORMAT_CHIPS } from './formats';
import { useNumberFormat } from './hooks';
import { Popover } from './Popover';
import { isActiveStatus, processedCount } from './progress';
import { useScopeEditing } from './scopeEditing';
import { topbarStrings } from './strings';

type OpenPopover = 'options' | 'hint' | null;

interface DownloadButtonProps {
  /** The main segment; the progress dialog returns the focus to it. */
  mainRef: RefObject<HTMLButtonElement | null>;
  /** Makes the progress dialog visible (a job was started, or the user wants to look at the running one). */
  onShowProgress: () => void;
}

/**
 * The split DOWNLOAD button. The main segment starts the export right away with the current format and options; the caret
 * opens the options. Without a selection both are aria-disabled and a click shows a hint instead (a status message: the
 * focus stays on the button). While the scope inputs (the common ones, or one channel's own) hold something that cannot be
 * exported, the main segment opens the options - or the selection list at the channel concerned - with the problem instead of
 * starting. While a job exists the button turns into its progress readout, and a
 * click brings the dialog back.
 */
export function DownloadButton({ mainRef, onShowProgress }: DownloadButtonProps): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const selectionCount = useSelectionCount();
  const format = useAppStore((state) => state.prefs.exportFormat);
  const status = useAppStore((state) => state.exportJob.status);
  const processed = useAppStore((state) => processedCount(state.exportJob.progress));
  const total = useAppStore((state) => state.exportJob.progress?.targets.length ?? 0);
  const startExport = useAppStore((state) => state.startExport);

  const [popover, setPopover] = useState<OpenPopover>(null);
  // What the scope inputs hold while it cannot be exported lives above the popovers: it must still stop Download after they closed.
  const { globalDraft, setGlobalDraft, channelDrafts, requestChannelFocus } = useScopeEditing();
  // Remounts the options popover on every refused start, so the focus goes to the problem again and the alert is re-announced.
  const [refusals, setRefusals] = useState(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  const empty = selectionCount === 0;
  const busy = status !== 'idle';
  const running = isActiveStatus(status);
  const unavailable = empty && !busy;
  const toggle = (which: Exclude<OpenPopover, null>): void => setPopover((current) => (current === which ? null : which));

  // A hint about an empty selection is stale as soon as something gets selected; a running job has no options to change.
  useEffect(() => {
    if (!empty) setPopover((current) => (current === 'hint' ? null : current));
  }, [empty]);
  useEffect(() => {
    if (busy) setPopover(null);
  }, [busy]);

  const onMain = (): void => {
    if (unavailable) {
      toggle('hint');
      return;
    }
    if (!busy && globalDraft !== null) {
      setPopover('options');
      setRefusals((count) => count + 1);
      return;
    }
    if (!busy) {
      // The first channel in the list's order whose own settings cannot be exported.
      const refused = selectSelectedTargets(useAppStore.getState()).find((target) => Object.hasOwn(channelDrafts, target.channelId));
      if (refused !== undefined) {
        setPopover(null);
        requestChannelFocus(refused.channelId);
        return;
      }
    }
    setPopover(null);
    onShowProgress();
    if (!busy) void startExport();
  };

  const onCaret = (): void => toggle(unavailable ? 'hint' : 'options');

  // The hint is tied to the button: it goes away when the focus leaves the split button (a press outside and Esc close it in the Popover).
  const onSplitBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (popover !== 'hint') return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setPopover(null);
  };

  const label = running ? (total === 0 ? t.exportingProgress(0, selectionCount, fmt) : t.exportingProgress(processed, total, fmt)) : t.download;
  const title = unavailable ? t.selectFirstTitle : running ? t.showProgress : undefined;

  return (
    <>
      <div
        ref={splitRef}
        className="topbar__split"
        data-unavailable={unavailable ? '' : undefined}
        data-running={running ? '' : undefined}
        onBlur={onSplitBlur}
        onKeyDown={ignoreKeyRepeat}
      >
        <button
          ref={mainRef}
          type="button"
          className="topbar__split-main"
          aria-disabled={unavailable ? true : undefined}
          aria-describedby={popover === 'hint' ? hintId : undefined}
          data-skip-target="export"
          title={title}
          onClick={onMain}
        >
          {running ? <SpinnerIcon className="topbar__split-icon" /> : <Download className="topbar__split-icon" />}
          <span>{label}</span>
          {running ? null : <span className="topbar__format-chip">{FORMAT_CHIPS[format]}</span>}
        </button>
        {busy ? null : (
          <button
            ref={caretRef}
            type="button"
            className="topbar__split-caret"
            aria-label={t.downloadOptions}
            aria-haspopup="dialog"
            aria-expanded={popover === 'options'}
            aria-disabled={unavailable ? true : undefined}
            aria-describedby={popover === 'hint' ? hintId : undefined}
            title={unavailable ? t.selectFirstTitle : undefined}
            onClick={onCaret}
          >
            <DownloadCaret />
          </button>
        )}
      </div>
      {popover === 'options' ? (
        <ExportOptionsPopover
          key={refusals}
          anchorRef={splitRef}
          returnFocusRef={caretRef}
          onClose={() => setPopover(null)}
          draft={globalDraft}
          onDraftChange={setGlobalDraft}
        />
      ) : null}
      {popover === 'hint' ? (
        <Popover anchorRef={splitRef} onClose={() => setPopover(null)} width={300} role="status" id={hintId} label={t.selectFirstTitle} className="topbar-hint">
          <p className="topbar-hint__title">{t.selectFirstTitle}</p>
          <p className="topbar-hint__body">{t.selectFirstBody}</p>
        </Popover>
      ) : null}
    </>
  );
}
