import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type RefObject } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useOverrideCount, useSelectedTargets, useSelectionCount } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';
import type { ExportTarget } from '@/lib/export/types';
import { Check } from '../common/Icons';
import { useNumberFormat } from './hooks';
import { Popover } from './Popover';
import { useScopeEditing, type ChannelFocusRequest } from './scopeEditing';
import { SelectionRow } from './SelectionRow';
import { topbarStrings } from './strings';

interface TargetGroup {
  /** Guild id, or 'dm' for the direct messages. */
  key: string;
  /** Server name; null for the direct messages (the strings supply their title). */
  title: string | null;
  targets: ExportTarget[];
}

/** Groups the (already ordered) targets by server, direct messages together; groups keep the order of their first target. */
function groupTargets(targets: readonly ExportTarget[]): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  for (const target of targets) {
    const key = target.guildId ?? 'dm';
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, title: target.guildId === null ? null : target.guildName, targets: [target] });
    else group.targets.push(target);
  }
  return [...groups.values()];
}

interface SelectionListProps {
  anchorRef: RefObject<HTMLElement | null>;
  id: string;
  onClose: () => void;
  /** The row whose settings are unfolded when the list opens (a refused Download points at the channel to fix). */
  initialOpenId: Snowflake | null;
}

/** The popover under the chip: everything that is ticked, grouped by server, with a gear (own export settings) and a remove button per row. */
function SelectionList({ anchorRef, id, onClose, initialOpenId }: SelectionListProps): ReactElement {
  const t = useStrings(topbarStrings);
  const targets = useSelectedTargets();
  const removeFromSelection = useAppStore((state) => state.removeFromSelection);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const groups = useMemo(() => groupTargets(targets), [targets]);
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfterRemove = useRef<number | null>(null);
  const gears = useRef(new Map<Snowflake, HTMLButtonElement>());
  // One row's settings are unfolded at a time.
  const [openId, setOpenId] = useState<Snowflake | null>(initialOpenId);

  // A removed row takes its button with it: hand the focus to the row that moved up, so keyboard users can keep removing.
  useLayoutEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.topbar-sel__remove');
    if (buttons === undefined || buttons.length === 0) return;
    buttons[Math.min(index, buttons.length - 1)]?.focus();
  }, [targets]);

  // The settings of a row that left the selection go with it.
  useEffect(() => {
    if (openId !== null && !targets.some((target) => target.channelId === openId)) setOpenId(null);
  }, [openId, targets]);

  const registerGear = useCallback((channelId: Snowflake, element: HTMLButtonElement | null) => {
    if (element === null) gears.current.delete(channelId);
    else gears.current.set(channelId, element);
  }, []);
  const toggleRow = useCallback((channelId: Snowflake) => setOpenId((current) => (current === channelId ? null : channelId)), []);
  const onRemove = (event: MouseEvent<HTMLButtonElement>, channelId: Snowflake): void => {
    const buttons = Array.from(listRef.current?.querySelectorAll('.topbar-sel__remove') ?? []);
    focusAfterRemove.current = buttons.indexOf(event.currentTarget);
    removeFromSelection(channelId);
  };

  // Esc peels one layer: an unfolded settings panel closes first (the focus goes back to its gear), only then the whole list.
  // `preventDefault` is what keeps the popover's own document-level Esc handler away.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || openId === null || event.nativeEvent.isComposing) return;
    event.preventDefault();
    gears.current.get(openId)?.focus();
    setOpenId(null);
  };

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={360} maxHeight="60vh" label={t.selectionLabel} id={id}>
      <div ref={listRef} className="topbar-sel__groups" onKeyDown={onKeyDown}>
        {groups.map((group) => (
          <section key={group.key} className="topbar-sel__group">
            <h3 className="topbar-sel__heading">{group.title ?? t.directMessages}</h3>
            <ul className="topbar-sel__list">
              {group.targets.map((target) => (
                <SelectionRow
                  key={target.channelId}
                  target={target}
                  open={openId === target.channelId}
                  onToggle={toggleRow}
                  registerGear={registerGear}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <footer className="topbar-sel__footer" onKeyDown={onKeyDown}>
        <button type="button" className="topbar-sel__clear" onClick={clearSelection}>
          {t.clearAll}
        </button>
      </footer>
    </Popover>
  );
}

/** "3 selected" pill; opens the list of what is ticked. Muted (and without a list) while nothing is selected. */
export function SelectionChip(): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const count = useSelectionCount();
  const ownCount = useOverrideCount();
  const { focusRequest } = useScopeEditing();
  const [open, setOpen] = useState(false);
  // The refused Download the open list answers: it unfolds that channel's settings (and starts over on every new refusal).
  const [asked, setAsked] = useState<ChannelFocusRequest | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const empty = count === 0;
  const expanded = open && !empty;
  const full = t.selectedCount(count, fmt);
  const label = ownCount === 0 ? full : `${full}, ${t.ownSettingsCount(ownCount, fmt)}`;
  const number = fmt(count);
  // Both languages start with the number. Only the rest is dropped when the bar is narrow; a text that does not start with it stays whole.
  const rest = full.startsWith(number) ? full.slice(number.length) : null;

  // Removing the last row (or "Clear all") leaves nothing to list: close, and keep the focus on the chip instead of losing it.
  useEffect(() => {
    if (!open || count > 0) return;
    setOpen(false);
    chipRef.current?.focus();
  }, [open, count]);

  useEffect(() => {
    if (focusRequest === null) return;
    setAsked(focusRequest);
    setOpen(true);
  }, [focusRequest]);

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className="topbar__chip"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={expanded ? popoverId : undefined}
        aria-disabled={empty ? true : undefined}
        aria-label={label}
        title={label}
        onClick={() => {
          if (empty) return;
          setAsked(null);
          setOpen((current) => !current);
        }}
      >
        <Check className="topbar__chip-icon" />
        {rest === null ? (
          full
        ) : (
          // One wrapper: the chip's flex `gap` must only separate the icon from the text, not the number from its unit.
          <span className="topbar__chip-text">
            <span className="topbar__chip-count">{number}</span>
            <span className="topbar__chip-rest">{rest}</span>
          </span>
        )}
        {ownCount === 0 ? null : <span className="topbar__chip-dot" aria-hidden="true" />}
      </button>
      {expanded ? (
        <SelectionList
          key={asked?.nonce ?? 0}
          anchorRef={chipRef}
          id={popoverId}
          initialOpenId={asked?.channelId ?? null}
          onClose={() => {
            setAsked(null);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
