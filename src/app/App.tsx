import { useEffect, type ReactElement } from 'react';
import { ChatPane } from './components/chat/ChatPane';
import { Button } from './components/common/Button';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { fatalStrings } from './components/common/fatalStrings';
import { Warning } from './components/common/Icons';
import { SkipLinks } from './components/common/SkipLinks';
import { Spinner } from './components/common/Spinner';
import { technicalDetail } from './components/common/technicalDetail';
import { Onboarding } from './components/Onboarding';
import { ServerRail } from './components/rail/ServerRail';
import { Sidebar } from './components/sidebar/Sidebar';
import { TopBar } from './components/topbar/TopBar';
import { common, useStrings } from './i18n';
import { appStrings } from './i18n/app';
import { useAppStore } from './state/store';
// After every component stylesheet (imported above): its overrides must win over theirs at equal specificity.
import './styles/forced-colors.css';

interface FatalPanelProps {
  title: string;
  /** The sentence the user reads, in their language. */
  message: string;
  /** The exception's own text (English, from the JavaScript engine): never part of the sentence, only in a collapsed block. */
  detail?: string;
  actionLabel: string;
  onAction: () => void;
}

function FatalPanel({ title, message, detail, actionLabel, onAction }: FatalPanelProps): ReactElement {
  const t = useStrings(fatalStrings);
  return (
    <main className="app-center">
      <section className="app-fatal" role="alert">
        <Warning className="app-fatal__icon" />
        <h1 className="app-fatal__title">{title}</h1>
        <p className="app-fatal__message">{message}</p>
        {detail === undefined ? null : (
          <details className="app-fatal__details">
            <summary>{t.technicalDetails}</summary>
            <pre className="app-fatal__detail" lang="en" dir="ltr">
              {detail}
            </pre>
          </details>
        )}
        <Button onClick={onAction}>{actionLabel}</Button>
      </section>
    </main>
  );
}

/** Boot failed for a reason other than a missing / rejected login (offline, Discord down...). */
function BootFailure(): ReactElement {
  const t = useStrings(appStrings);
  const c = useStrings(common);
  const message = useAppStore((state) => state.fatalError);
  const detail = useAppStore((state) => state.fatalDetail);
  const retry = useAppStore((state) => state.retry);
  return <FatalPanel title={t.fatalTitle} message={message ?? c.errorUnknown} detail={detail ?? undefined} actionLabel={c.retry} onAction={() => void retry()} />;
}

/** A component threw while rendering. The exception's English text stays out of the sentence (the UI may be Korean). */
function CrashPanel({ error }: { error: Error }): ReactElement {
  const t = useStrings(appStrings);
  const c = useStrings(common);
  return (
    <FatalPanel
      title={t.crashTitle}
      message={t.crashHint}
      detail={technicalDetail(error.message === '' ? '' : `${error.name}: ${error.message}`)}
      actionLabel={c.reload}
      onAction={() => location.reload()}
    />
  );
}

function Screen(): ReactElement {
  const status = useAppStore((state) => state.status);
  const c = useStrings(common);

  switch (status) {
    case 'booting':
      return (
        <main className="app-center">
          <Spinner size={40} label={c.loading} />
        </main>
      );
    case 'needs-token':
      return <Onboarding />;
    case 'fatal':
      return <BootFailure />;
    case 'ready':
      return (
        <>
          <SkipLinks />
          <div className="app-shell">
            <ServerRail />
            <Sidebar />
            <main className="app-main">
              <TopBar />
              <ChatPane />
            </main>
          </div>
        </>
      );
  }
}

export function App(): ReactElement {
  const init = useAppStore((state) => state.init);
  const locale = useAppStore((state) => state.locale);
  const mode = useAppStore((state) => state.mode);
  const c = useStrings(common);

  // init() is idempotent, so StrictMode's double effect run starts only one boot.
  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.title = mode === 'demo' ? `${c.appName} - ${c.demoMode}` : c.appName;
  }, [c, mode]);

  return (
    <ErrorBoundary fallback={(error) => <CrashPanel error={error} />}>
      <Screen />
    </ErrorBoundary>
  );
}
