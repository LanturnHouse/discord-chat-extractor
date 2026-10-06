import { useCallback, useRef, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useDmCheck, useFilteredDms } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';
import { Checkbox } from '../common/Checkbox';
import { Close, Search } from '../common/Icons';
import { DmRow } from './DmRow';
import { focusFirstRow, handleRowKeys } from './listNav';
import { sidebarStrings } from './strings';

/** The sidebar of the "Direct Messages" view: a filter box and the (filtered) list of conversations. */
export function DmPanel(): ReactElement {
  const t = useStrings(sidebarStrings);
  const filter = useAppStore((state) => state.dmFilter);
  const setDmFilter = useAppStore((state) => state.setDmFilter);
  const openChannel = useAppStore((state) => state.openChannel);
  const toggleChannel = useAppStore((state) => state.toggleChannel);
  const toggleAllDms = useAppStore((state) => state.toggleAllDms);
  const dms = useFilteredDms();
  const check = useDmCheck();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const query = filter.trim();
  const filtering = query !== '';

  const open = useCallback(
    (dmId: Snowflake) => {
      void openChannel(dmId, null);
    },
    [openChannel],
  );

  return (
    <>
      <div className="sb-search">
        <div className="sb-search__field">
          <input
            ref={inputRef}
            className="sb-search__input"
            type="text"
            value={filter}
            placeholder={t.dmFilterPlaceholder}
            aria-label={t.dmFilterPlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDmFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filter !== '') {
                event.preventDefault();
                setDmFilter('');
              } else if (event.key === 'ArrowDown' && focusFirstRow(listRef.current)) {
                event.preventDefault();
              }
            }}
          />
          {filter === '' ? (
            <Search className="sb-search__icon" />
          ) : (
            <button
              type="button"
              className="sb-search__clear"
              aria-label={t.dmFilterClear}
              onClick={() => {
                setDmFilter('');
                inputRef.current?.focus();
              }}
            >
              <Close />
            </button>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        className="sb-scroll"
        role="group"
        aria-label={t.dmsLabel}
        // Focusable by script only: the target of the "skip to channel list" link.
        tabIndex={-1}
        data-skip-target="channels"
        onKeyDown={handleRowKeys}
      >
        <div className="sb-section">
          <h2 className="sb-section__title">{t.dmSection}</h2>
          {filtering ? <span className="sb-section__count">{dms.length}</span> : null}
          <Checkbox
            className="sb-section__check"
            size={16}
            state={check}
            ariaLabel={filtering ? t.dmSelectMatches(dms.length) : t.dmSelectAll}
            disabled={dms.length === 0}
            onChange={toggleAllDms}
          />
        </div>
        <span className="visually-hidden" aria-live="polite">
          {filtering ? t.dmMatches(dms.length) : ''}
        </span>

        {dms.length > 0 ? (
          <ul className="sb-list">
            {dms.map((dm) => (
              <DmRow key={dm.id} dm={dm} onOpen={open} onToggle={toggleChannel} />
            ))}
          </ul>
        ) : (
          <p className="sb-empty">{filtering ? t.dmNoMatch(query) : t.dmEmpty}</p>
        )}
      </div>
    </>
  );
}
