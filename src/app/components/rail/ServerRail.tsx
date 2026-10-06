import type { ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore } from '@/app/state';
import { DmButton } from './DmButton';
import { GuildButton } from './GuildButton';
import { handleRailKeys } from './railNav';
import { RailTooltip } from './RailTooltip';
import { railStrings } from './strings';
import { useRailTooltip } from './useRailTooltip';
import './rail.css';

/** The 72px server rail: "Direct Messages" on top, then every server in the order Discord returned them. */
export function ServerRail(): ReactElement {
  const t = useStrings(railStrings);
  const guilds = useAppStore((state) => state.guilds);
  const activeGuildId = useAppStore((state) => (state.view.kind === 'guild' ? state.view.guildId : null));
  const dmsActive = useAppStore((state) => state.view.kind === 'dms');
  const { placement, controls } = useRailTooltip();

  return (
    <nav className="app-rail" aria-label={t.navLabel} onScroll={(event) => controls.scrolled(event.currentTarget)} onKeyDown={handleRailKeys}>
      <DmButton active={dmsActive} tooltip={controls} />
      {guilds.length > 0 ? (
        <>
          <div className="rail__separator" role="separator" />
          <ul className="rail__list">
            {guilds.map((guild) => (
              <li key={guild.id} className="rail__entry">
                <GuildButton guild={guild} active={guild.id === activeGuildId} tooltip={controls} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <RailTooltip placement={placement} />
    </nav>
  );
}
