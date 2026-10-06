// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { common, defineStrings, useLocale, useStrings } from '@/app/i18n';
import {
  useActiveChannel,
  useCategoryCheck,
  useChannelCheck,
  useChannelMessages,
  useConnectedAs,
  useDmCheck,
  useFilteredDms,
  useGuildCheck,
  useGuildNames,
  useGuildTree,
  useGuildTreeEntry,
  useIsForbidden,
  useSelectedTargets,
  useSelectionCount,
  useSelectionCountForGuild,
} from '@/app/state/hooks';
import { appStore, useAppShallow, useAppStore } from '@/app/state/store';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { createSpiedClient } from '../helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

/** Counts how often the wrapped hook's component rendered. */
function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}

async function boot(): Promise<void> {
  appStore.setState(appStore.getInitialState(), true);
  await appStore.getState().initWithClient(createSpiedClient().client, MOCK_ME);
  await appStore.getState().ensureGuildTree(MOCK_IDS.bigGuild);
}

beforeEach(async () => {
  await boot();
});

afterEach(cleanup);

describe('selector hooks', () => {
  it('do not loop and reflect the store', () => {
    function Probe(): ReactElement {
      const dms = useFilteredDms();
      const targets = useSelectedTargets();
      const active = useActiveChannel();
      const tree = useGuildTree(MOCK_IDS.bigGuild);
      const entry = useGuildTreeEntry(MOCK_IDS.bigGuild);
      const names = useGuildNames(MOCK_IDS.bigGuild);
      const messages = useChannelMessages(null);
      const connectedAs = useConnectedAs();
      return (
        <p data-testid="probe">
          {[dms.length > 0, targets.length, active === null, tree?.guildId === MOCK_IDS.bigGuild, entry.status, names !== undefined, messages.status, connectedAs].join('|')}
        </p>
      );
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe(`true|0|true|true|loaded|true|idle|${MOCK_ME.global_name}`);
  });

  it('unknown ids give stable placeholders instead of new objects', () => {
    const seen: unknown[] = [];
    function Probe(): ReactElement {
      seen.push(useChannelMessages(MOCK_IDS.edge400Channel), useGuildTreeEntry(MOCK_IDS.unknownGuild), useGuildTree(null), useGuildNames(null));
      return <span />;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    expect(seen[0]).toBe(seen[4]);
    expect(seen[1]).toBe(seen[5]);
    expect(seen[0]).toMatchObject({ status: 'idle', items: [], hasMore: true });
    expect(seen[1]).toMatchObject({ status: 'idle', tree: null });
    expect(seen[2]).toBeNull();
    expect(seen[3]).toBeUndefined();
  });

  it('a row re-renders only when its own checkbox state changes', () => {
    const renders: Record<string, number> = {};
    function Row({ id }: { id: string }): ReactElement {
      const check = useChannelCheck(id);
      renders[id] = useRenderCount();
      return <span data-testid={id}>{check}</span>;
    }
    render(
      <>
        <Row id={MOCK_IDS.generalChannel} />
        <Row id={MOCK_IDS.edge400Channel} />
      </>,
    );
    expect(screen.getByTestId(MOCK_IDS.generalChannel).textContent).toBe('none');
    const otherRenders = renders[MOCK_IDS.edge400Channel];

    act(() => appStore.getState().toggleChannel(MOCK_IDS.generalChannel));
    expect(screen.getByTestId(MOCK_IDS.generalChannel).textContent).toBe('all');
    expect(renders[MOCK_IDS.edge400Channel]).toBe(otherRenders);

    act(() => appStore.getState().toggleChannel(MOCK_IDS.generalChannel));
    expect(screen.getByTestId(MOCK_IDS.generalChannel).textContent).toBe('none');
  });

  it('category, server, DM and count hooks follow the selection', async () => {
    function Probe(): ReactElement {
      const category = useCategoryCheck(MOCK_IDS.bigGuild, MOCK_IDS.generalCategory);
      const guild = useGuildCheck(MOCK_IDS.bigGuild);
      const dm = useDmCheck();
      const count = useSelectionCount();
      const guildCount = useSelectionCountForGuild(MOCK_IDS.bigGuild);
      return <p data-testid="probe">{[category, guild, dm, count, guildCount].join('|')}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('none|none|none|0|0');

    act(() => appStore.getState().toggleChannel(MOCK_IDS.generalChannel));
    expect(screen.getByTestId('probe').textContent).toBe('some|some|none|1|1');

    act(() => appStore.getState().toggleCategory(MOCK_IDS.bigGuild, MOCK_IDS.generalCategory));
    expect(screen.getByTestId('probe').textContent?.startsWith('all|some|none|')).toBe(true);

    await act(async () => {
      await appStore.getState().toggleGuild(MOCK_IDS.bigGuild);
    });
    expect(screen.getByTestId('probe').textContent?.startsWith('all|all|none|')).toBe(true);

    act(() => appStore.getState().toggleAllDms());
    expect(screen.getByTestId('probe').textContent?.split('|')[2]).toBe('all');
  });

  it('the filtered DM list keeps its identity when unrelated state changes', () => {
    const lists: unknown[] = [];
    function Probe(): ReactElement {
      lists.push(useFilteredDms());
      return <span>{useRenderCount()}</span>;
    }
    render(<Probe />);
    const rendersBefore = lists.length;

    act(() => appStore.getState().setExportAfter('2026-01-01T00:00:00.000Z'));
    act(() => appStore.getState().toggleChannel(MOCK_IDS.generalChannel));
    expect(lists.length).toBe(rendersBefore);

    act(() => appStore.getState().setDmFilter('alex'));
    expect(lists.length).toBeGreaterThan(rendersBefore);
    expect((lists[lists.length - 1] as unknown[]).length).toBeLessThan(appStore.getState().dms.length);
  });

  it('the active channel resolves against the open server', async () => {
    function Probe(): ReactElement {
      const active = useActiveChannel();
      return <p data-testid="probe">{active === null ? 'none' : active.kind === 'guild' ? `${active.guild.name}#${active.node.name}` : `dm:${active.dm.name}`}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('none');

    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.edge199Channel, MOCK_IDS.bigGuild);
    });
    expect(screen.getByTestId('probe').textContent).toBe(`${appStore.getState().guilds[0].name}#edge-199`);

    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.dmFriend, null);
    });
    expect(screen.getByTestId('probe').textContent).toMatch(/^dm:/);
  });

  it('forbidden flag', async () => {
    function Probe(): ReactElement {
      return <p data-testid="probe">{String(useIsForbidden(MOCK_IDS.forbiddenChannel))}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.forbiddenChannel, MOCK_IDS.bigGuild);
    });
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });

  it('messages of the open channel update as pages arrive', async () => {
    function Probe(): ReactElement {
      const messages = useChannelMessages(MOCK_IDS.edge400Channel);
      return <p data-testid="probe">{`${messages.status}|${messages.items.length}|${messages.hasMore}|${messages.loadingOlder}`}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('idle|0|true|false');
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.edge400Channel, MOCK_IDS.bigGuild);
    });
    expect(screen.getByTestId('probe').textContent).toBe('loaded|200|true|false');
    await act(async () => {
      await appStore.getState().loadOlderMessages(MOCK_IDS.edge400Channel);
    });
    expect(screen.getByTestId('probe').textContent).toBe('loaded|400|true|false');
  });
});

describe('useAppShallow', () => {
  it('accepts selectors that build a new object each time without looping, and re-renders only on real changes', () => {
    let renders = 0;
    function Probe(): ReactElement {
      const picked = useAppShallow((state) => ({ view: state.view, active: state.activeChannelId, count: Object.keys(state.selection).length }));
      renders += 1;
      return <p data-testid="probe">{`${picked.view.kind}|${picked.active}|${picked.count}`}</p>;
    }
    render(<Probe />);
    const initial = renders;
    expect(screen.getByTestId('probe').textContent).toBe('dms|null|0');

    act(() => appStore.getState().setExportAfter('2026-01-01T00:00:00.000Z'));
    expect(renders).toBe(initial);

    act(() => appStore.getState().toggleChannel(MOCK_IDS.dmFriend));
    expect(screen.getByTestId('probe').textContent).toBe('dms|null|1');
  });
});

describe('useAppStore', () => {
  it('also exposes the vanilla api like a zustand bound hook', () => {
    expect(useAppStore.getState()).toBe(appStore.getState());
    expect(typeof useAppStore.subscribe).toBe('function');
    useAppStore.setState({ dmFilter: 'x' });
    expect(appStore.getState().dmFilter).toBe('x');
  });
});

describe('i18n hooks', () => {
  const strings = defineStrings({
    ko: { hello: '안녕하세요', items: (n: number) => `${n}개` },
    en: { hello: 'Hello', items: (n) => `${n} items` },
  });

  function Probe(): ReactElement {
    const t = useStrings(strings);
    const c = useStrings(common);
    const locale = useLocale();
    return <p data-testid="probe">{`${locale}|${t.hello}|${t.items(2)}|${c.cancel}`}</p>;
  }

  it('give the strings of the current locale and follow locale changes', () => {
    act(() => appStore.setState({ locale: 'ko' }));
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('ko|안녕하세요|2개|취소');

    act(() => appStore.setState({ locale: 'en' }));
    expect(screen.getByTestId('probe').textContent).toBe('en|Hello|2 items|Cancel');
  });

  it('follow setPrefs', () => {
    act(() => appStore.getState().setPrefs({ locale: 'ko' }));
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent?.startsWith('ko|')).toBe(true);
    act(() => appStore.getState().setPrefs({ locale: 'en' }));
    expect(screen.getByTestId('probe').textContent?.startsWith('en|')).toBe(true);
  });
});
