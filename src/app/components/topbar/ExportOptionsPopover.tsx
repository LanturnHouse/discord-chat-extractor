import { useMemo, type ReactElement, type RefObject } from 'react';
import type { Prefs } from '@/app/platform/types';
import { useStrings } from '@/app/i18n';
import { useAppStore, useOverrideCount } from '@/app/state';
import type { ExportFormatId, ExportScope } from '@/lib/export/types';
import { FORMAT_NAMES, FORMAT_ORDER } from './formats';
import { useNumberFormat } from './hooks';
import { Popover } from './Popover';
import { RadioGroup, type RadioOption } from './RadioGroup';
import { ScopeEditor } from './ScopeEditor';
import type { ScopeFields } from './scopeFields';
import { topbarStrings } from './strings';

type DescriptionKey = 'descHtml' | 'descTxt' | 'descMd' | 'descXlsx' | 'descCsv' | 'descJson';

const DESCRIPTION_KEYS: Record<ExportFormatId, DescriptionKey> = {
  html: 'descHtml',
  txt: 'descTxt',
  md: 'descMd',
  xlsx: 'descXlsx',
  csv: 'descCsv',
  json: 'descJson',
};

function FormatPicker(): ReactElement {
  const t = useStrings(topbarStrings);
  const format = useAppStore((state) => state.prefs.exportFormat);
  const theme = useAppStore((state) => state.prefs.htmlTheme);
  const setPrefs = useAppStore((state) => state.setPrefs);

  const formatOptions = useMemo<RadioOption<ExportFormatId>[]>(
    () => FORMAT_ORDER.map((id) => ({ value: id, label: FORMAT_NAMES[id], description: t[DESCRIPTION_KEYS[id]] })),
    [t],
  );
  const themeOptions = useMemo<RadioOption<'dark' | 'light'>[]>(
    () => [
      { value: 'dark', label: t.themeDark },
      { value: 'light', label: t.themeLight },
    ],
    [t],
  );

  return (
    <section className="topbar-options__section">
      <h3 className="topbar-options__heading">{t.formatLabel}</h3>
      <RadioGroup variant="cards" label={t.formatLabel} value={format} options={formatOptions} onChange={(exportFormat) => setPrefs({ exportFormat })} />
      {format === 'html' ? (
        <div className="topbar-options__theme">
          <span className="topbar-options__theme-label">{t.themeLabel}</span>
          <RadioGroup variant="segmented" label={t.themeLabel} value={theme} options={themeOptions} onChange={(htmlTheme) => setPrefs({ htmlTheme })} />
        </div>
      ) : null}
    </section>
  );
}

interface GlobalScopeProps {
  /** The inputs while they hold something that cannot be exported (null = they show the stored settings). Lives in the top bar so it outlives this popover. */
  draft: ScopeFields | null;
  onDraftChange: (draft: ScopeFields | null) => void;
}

/** Date range + number of messages of the default settings: what every selected channel exports unless it has settings of its own. */
function GlobalScope({ draft, onDraftChange }: GlobalScopeProps): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const settings = useAppStore((state) => state.exportSettings);
  const overrideCount = useOverrideCount();
  const setExportAfter = useAppStore((state) => state.setExportAfter);
  const setExportBefore = useAppStore((state) => state.setExportBefore);
  const setExportLimit = useAppStore((state) => state.setExportLimit);

  const onScopeChange = (next: ExportScope): void => {
    if (next.after !== settings.after) setExportAfter(next.after);
    if (next.before !== settings.before) setExportBefore(next.before);
    if (next.limit !== settings.limit) setExportLimit(next.limit);
  };

  return (
    <ScopeEditor scope={settings} draft={draft} onDraftChange={onDraftChange} onScopeChange={onScopeChange} headingLevel={3} global>
      <p className="topbar-options__help">{t.channelSettingsHint}</p>
      {overrideCount === 0 ? null : <p className="topbar-options__help">{t.ownSettingsNote(overrideCount, fmt)}</p>}
    </ScopeEditor>
  );
}

// Endonyms: each language is named in itself, whatever the UI language is.
const LANGUAGE_NAMES = { ko: '한국어', en: 'English' } as const;

/** UI language and the language of the fixed text inside exported files are one setting: `prefs.locale`. */
function LanguagePicker(): ReactElement {
  const t = useStrings(topbarStrings);
  const locale = useAppStore((state) => state.prefs.locale);
  const setPrefs = useAppStore((state) => state.setPrefs);
  const options = useMemo<RadioOption<Prefs['locale']>[]>(
    () => [
      { value: 'auto', label: t.languageAuto },
      { value: 'ko', label: LANGUAGE_NAMES.ko },
      { value: 'en', label: LANGUAGE_NAMES.en },
    ],
    [t],
  );
  return (
    <section className="topbar-options__section">
      <h3 className="topbar-options__heading">{t.languageLabel}</h3>
      <RadioGroup variant="segmented" label={t.languageLabel} value={locale} options={options} onChange={(next) => setPrefs({ locale: next })} />
      <p className="topbar-options__help">{t.languageHelp}</p>
    </section>
  );
}

interface ExportOptionsPopoverProps extends GlobalScopeProps {
  anchorRef: RefObject<HTMLElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** Everything the caret of the download button opens: format, HTML theme, the date range, the number of messages and the language. All of it applies to the next export. */
export function ExportOptionsPopover({ anchorRef, returnFocusRef, onClose, draft, onDraftChange }: ExportOptionsPopoverProps): ReactElement {
  const t = useStrings(topbarStrings);
  return (
    <Popover anchorRef={anchorRef} returnFocusRef={returnFocusRef} onClose={onClose} width={340} label={t.downloadOptions} className="topbar-options">
      <FormatPicker />
      <GlobalScope draft={draft} onDraftChange={onDraftChange} />
      <LanguagePicker />
      <p className="topbar-options__help">{t.zipHelp}</p>
    </Popover>
  );
}
