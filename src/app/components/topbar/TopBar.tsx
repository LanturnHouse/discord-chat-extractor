import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useAppStore } from '@/app/state';
import { AccountLabel } from './AccountLabel';
import { ChannelTitle } from './ChannelTitle';
import { DownloadButton } from './DownloadButton';
import { ExportProgressDialog } from './ExportProgressDialog';
import { isActiveStatus } from './progress';
import { ScopeEditingProvider } from './scopeEditing';
import { SelectionChip } from './SelectionChip';
import './topbar.css';

/**
 * The 48px bar above the chat: the open channel on the left; on the right the connected account, the "N selected" chip and
 * the DOWNLOAD split button (which share the scope inputs' state through `ScopeEditingProvider`). It also hosts the export dialog, which opens when a job starts. This component itself only
 * follows the job's status (a handful of changes per export); the parts that need more subscribe on their own.
 */
export function TopBar(): ReactElement {
  const status = useAppStore((state) => state.exportJob.status);
  const [hidden, setHidden] = useState(false);
  const mainButtonRef = useRef<HTMLButtonElement>(null);
  const showDialog = useCallback(() => setHidden(false), []);
  const hideDialog = useCallback(() => setHidden(true), []);

  // "Hide" only applies to a job that is still working. When it ends the user must see the result (saved file, skipped
  // channels), and the next job starts with its dialog open.
  useEffect(() => {
    if (!isActiveStatus(status)) setHidden(false);
  }, [status]);

  return (
    <header className="app-topbar topbar">
      <ChannelTitle />
      <ScopeEditingProvider>
        <div className="topbar__actions">
          <AccountLabel />
          <SelectionChip />
          <DownloadButton mainRef={mainButtonRef} onShowProgress={showDialog} />
        </div>
      </ScopeEditingProvider>
      {status !== 'idle' && !hidden ? <ExportProgressDialog onHide={hideDialog} returnFocusRef={mainButtonRef} /> : null}
    </header>
  );
}
