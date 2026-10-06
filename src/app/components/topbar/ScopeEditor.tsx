import { useEffect, useId, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { common, useStrings } from '@/app/i18n';
import { MAX_EXPORT_LIMIT, type ExportScope } from '@/lib/export/types';
import { Close } from '../common/Icons';
import { useNumberFormat } from './hooks';
import { useAfterPress } from './pressGate';
import { RadioGroup, type RadioOption } from './RadioGroup';
import {
  checkFields,
  DEFAULT_LIMIT,
  fieldsOf,
  LIMIT_CHIPS,
  sameFields,
  scopeFromFields,
  type LimitProblem,
  type ScopeFields,
} from './scopeFields';
import { describeLimit } from './scopeText';
import { topbarStrings } from './strings';

interface DateFieldProps {
  label: string;
  clearLabel: string;
  value: string;
  /** The user typed part of a date: the input's value is '' although it shows something. */
  partial: boolean;
  invalid: boolean;
  /** The popover puts the focus here when it opens. */
  focusOnOpen: boolean;
  errorId: string;
  onChange: (value: string, partial: boolean) => void;
}

// An unbounded date input accepts 5 and 6 digit years, which the export cannot use; with `max` it stops at 4.
const MIN_DATE = '0001-01-01';
const MAX_DATE = '9999-12-31';

function DateField({ label, clearLabel, value, partial, invalid, focusOnOpen, errorId, onChange }: DateFieldProps): ReactElement {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const afterPress = useAfterPress();
  // `onChange` only fires when the value changes; leaving the field is the other moment an unfinished date shows up.
  const report = (input: HTMLInputElement): void => onChange(input.value, input.validity.badInput);
  return (
    <div className="topbar-range__field">
      <label htmlFor={inputId} className="topbar-range__label">
        {label}
      </label>
      <div className="topbar-range__control">
        <input
          ref={inputRef}
          id={inputId}
          type="date"
          min={MIN_DATE}
          max={MAX_DATE}
          className="topbar-range__input"
          value={value}
          data-autofocus={focusOnOpen ? '' : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => report(event.currentTarget)}
          // The error this can bring up must not move the control that the press which took the focus is aimed at: it waits for the click.
          onBlur={(event) => {
            const input = event.currentTarget;
            afterPress(() => report(input));
          }}
        />
        {value === '' && !partial ? (
          <span className="topbar-range__slot" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="topbar-range__clear"
            aria-label={clearLabel}
            onClick={() => {
              // A half-typed date has no value to reset through React: empty the control itself.
              if (inputRef.current !== null) inputRef.current.value = '';
              onChange('', false);
              inputRef.current?.focus();
            }}
          >
            <Close />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The message under a field. The popover it sits in scrolls, so it can lie below the fold while the field itself is in view:
 * it brings itself into view when it appears or changes.
 */
function InlineError({ id, message }: { id: string; message: string }): ReactElement {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // jsdom has no layout and no such method.
    if (typeof ref.current?.scrollIntoView === 'function') ref.current.scrollIntoView({ block: 'nearest' });
  }, [message]);
  return (
    <p ref={ref} id={id} role="alert" className="topbar-options__error">
      {message}
    </p>
  );
}

function limitMessage(problem: LimitProblem, t: (typeof topbarStrings)['en'], fmt: (value: number) => string): string {
  if (problem === 'empty') return t.limitEmpty;
  return problem === 'whole' ? t.limitWhole : t.limitRange(MAX_EXPORT_LIMIT, fmt);
}

export interface ScopeEditorProps {
  /**
   * The scope the inputs show while `draft` is null: what the store holds (always one that can be exported). For a channel that has
   * no settings of its own that is the common settings, so the editor follows them until `onScopeChange` gives the channel its own.
   */
  scope: ExportScope;
  /** The inputs while they hold something that cannot be exported (null = they show `scope`). Lives above this editor so it outlives it. */
  draft: ScopeFields | null;
  onDraftChange: (draft: ScopeFields | null) => void;
  /** Called with every valid scope that differs from `scope`. */
  onScopeChange: (scope: ExportScope) => void;
  /** Level of the two section headings, so the editor fits under whatever heading its host has. */
  headingLevel: 3 | 4;
  /** The default settings editor also says that the number counts per channel; a channel's own editor needs no such reminder. */
  global: boolean;
  /** Extra notes at the end of the "number of messages" section. */
  children?: ReactNode;
}

/**
 * The date range and the message count of ONE scope: the default settings (export options popover) and what a channel is
 * exported with (selection list) are edited by this same component. It only ever hands a valid scope to `onScopeChange`; anything
 * else (a start after the end, an unfinished date, an empty / decimal / too large count) stays in `draft`, is flagged here,
 * and is what the Download button refuses on, so the inputs and the file that Download produces can never disagree.
 */
export function ScopeEditor({ scope, draft, onDraftChange, onScopeChange, headingLevel, global, children }: ScopeEditorProps): ReactElement {
  const t = useStrings(topbarStrings);
  const c = useStrings(common);
  const fmt = useNumberFormat();
  const rangeErrorId = useId();
  const limitErrorId = useId();
  const limitHelpId = useId();
  const limitNoteId = useId();
  const fields = draft ?? fieldsOf(scope);
  const problem = checkFields(fields);
  const Heading = headingLevel === 3 ? 'h3' : 'h4';

  // Where "Limit to N" starts when the user switches back to it: the number it had before "All" was chosen.
  const lastLimit = useRef<number | null>(null);
  useEffect(() => {
    if (scope.limit !== null) lastLimit.current = scope.limit;
  }, [scope.limit]);

  const commit = (next: ScopeFields): void => {
    if (sameFields(next, fields)) return;
    if (checkFields(next) !== null) {
      onDraftChange(next);
      return;
    }
    onDraftChange(null);
    // Everything that was held back becomes valid together, so every field that changed is written.
    const nextScope = scopeFromFields(next, scope);
    if (nextScope.after !== scope.after || nextScope.before !== scope.before || nextScope.limit !== scope.limit) onScopeChange(nextScope);
  };

  const modeOptions = useMemo<RadioOption<ScopeFields['limitMode']>[]>(
    () => [
      { value: 'all', label: t.countAll },
      { value: 'limit', label: t.countLimit },
    ],
    [t],
  );
  const chooseMode = (mode: ScopeFields['limitMode']): void => {
    // Choosing what is already chosen must not reset the number the user is typing.
    if (mode === fields.limitMode) return;
    if (mode === 'all') commit({ ...fields, limitMode: 'all', limitText: '', limitBad: false });
    else commit({ ...fields, limitMode: 'limit', limitText: String(lastLimit.current ?? DEFAULT_LIMIT), limitBad: false });
  };

  const rangeProblem = problem?.range ?? null;
  const limitProblem = problem?.limit ?? null;
  const focusFrom = rangeProblem?.from === true;
  const focusTo = !focusFrom && rangeProblem?.to === true;
  const focusLimit = !focusFrom && !focusTo && limitProblem !== null;
  const limitNumber = fields.limitMode === 'limit' && limitProblem === null ? Number(fields.limitText.trim()) : null;
  const describedBy = [limitProblem === null ? limitHelpId : limitErrorId, ...(global ? [limitNoteId] : [])].join(' ');

  return (
    <>
      <section className="topbar-options__section">
        <Heading className="topbar-options__heading">{t.rangeLabel}</Heading>
        <div className="topbar-range">
          <DateField
            label={t.fromLabel}
            clearLabel={t.clearFrom}
            value={fields.from}
            partial={fields.fromPartial}
            invalid={rangeProblem?.from === true}
            focusOnOpen={focusFrom}
            errorId={rangeErrorId}
            onChange={(from, fromPartial) => commit({ ...fields, from, fromPartial })}
          />
          <DateField
            label={t.toLabel}
            clearLabel={t.clearTo}
            value={fields.to}
            partial={fields.toPartial}
            invalid={rangeProblem?.to === true}
            focusOnOpen={focusTo}
            errorId={rangeErrorId}
            onChange={(to, toPartial) => commit({ ...fields, to, toPartial })}
          />
        </div>
        {rangeProblem === null ? null : <InlineError id={rangeErrorId} message={rangeProblem.kind === 'inverted' ? c.invalidRange : t.invalidDate} />}
        <p className="topbar-options__help">{t.rangeHelp}</p>
      </section>

      <section className="topbar-options__section">
        <Heading className="topbar-options__heading">{t.countLabel}</Heading>
        <RadioGroup variant="segmented" label={t.countLabel} value={fields.limitMode} options={modeOptions} onChange={chooseMode} />
        {fields.limitMode === 'limit' ? (
          <div className="topbar-count">
            <div className="topbar-count__field">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_EXPORT_LIMIT}
                step={1}
                className="topbar-count__input"
                aria-label={t.limitInputLabel}
                aria-invalid={limitProblem === null ? undefined : true}
                aria-describedby={describedBy}
                data-autofocus={focusLimit ? '' : undefined}
                value={fields.limitText}
                onChange={(event) =>
                  commit({ ...fields, limitMode: 'limit', limitText: event.currentTarget.value, limitBad: event.currentTarget.validity.badInput })
                }
                // Text the input cannot read ('e', '1e') keeps its value at '' while it is typed or deleted, so no change event comes:
                // this one still tells whether something unreadable is left in the field.
                onInput={(event) => {
                  const { value, validity } = event.currentTarget;
                  if (value === fields.limitText && validity.badInput !== fields.limitBad) commit({ ...fields, limitMode: 'limit', limitBad: validity.badInput });
                }}
                // A focused number input steps its value on the mouse wheel: leave it, so scrolling the popover over the field keeps the number.
                onWheel={(event) => event.currentTarget.blur()}
              />
              <span className="topbar-count__unit" aria-hidden="true">
                {t.limitUnit}
              </span>
            </div>
            <div role="group" aria-label={t.quickPicks} className="topbar-count__chips">
              {LIMIT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="topbar-count__chip"
                  aria-pressed={limitNumber === chip}
                  onClick={() => commit({ ...fields, limitMode: 'limit', limitText: String(chip), limitBad: false })}
                >
                  {fmt(chip)}
                </button>
              ))}
            </div>
            {limitProblem !== null ? (
              <InlineError id={limitErrorId} message={limitMessage(limitProblem, t, fmt)} />
            ) : limitNumber === null ? null : (
              <p id={limitHelpId} className="topbar-options__help">
                {describeLimit(fields.from !== '' && !fields.fromPartial, fields.to !== '' && !fields.toPartial, limitNumber, t, fmt)}
              </p>
            )}
            {global ? (
              <p id={limitNoteId} className="topbar-options__help">
                {t.countPerChannel}
              </p>
            ) : null}
          </div>
        ) : null}
        {children}
      </section>
    </>
  );
}
