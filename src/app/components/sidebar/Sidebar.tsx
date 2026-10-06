import type { ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore } from '@/app/state';
import { DmPanel } from './DmPanel';
import { GuildPanel } from './GuildPanel';
import { sidebarStrings } from './strings';
import './sidebar.css';

/** The 240px column next to the rail: the channel tree of the open server, or the conversation list of the DM view. */
export function Sidebar(): ReactElement {
  const t = useStrings(sidebarStrings);
  const guildId = useAppStore((state) => (state.view.kind === 'guild' ? state.view.guildId : null));

  return (
    <aside className="app-sidebar" aria-label={guildId === null ? t.dmsLabel : t.channelsLabel}>
      {guildId === null ? <DmPanel /> : <GuildPanel key={guildId} guildId={guildId} />}
    </aside>
  );
}
