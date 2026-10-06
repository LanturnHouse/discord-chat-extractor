import { describe, expect, it, vi } from 'vitest';
import { copyScope, isValidLimit, pruneOverrides, sameScope, scopeIssue } from '@/app/state/scope';
import {
  selectEffectiveScope,
  selectHasOverride,
  selectOverrideCount,
  selectScopeOverride,
  selectScopeProblem,
  selectSelectedTargets,
} from '@/app/state/selectors';
import { UNCATEGORIZED } from '@/app/state/types';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS } from '@/lib/discord/mock';
import { MAX_EXPORT_LIMIT, type ExportScope } from '@/lib/export/types';
import { bootDemo } from '../helpers';

const BIG = MOCK_IDS.bigGuild;

const scope = (patch: Partial<ExportScope> = {}): ExportScope => ({ after: null, before: null, limit: null, ...patch });

type Booted = Awaited<ReturnType<typeof bootDemo>>;

async function bootWithSelection(channelIds: string[]): Promise<Booted> {
  const booted = await bootDemo();
  await booted.store.getState().ensureGuildTree(BIG);
  for (const id of channelIds) booted.store.getState().toggleChannel(id);
  return booted;
}

describe('scopeIssue', () => {
  it('accepts every combination of an optional start, end and count', () => {
    expect(scopeIssue(scope())).toBeNull();
    expect(scopeIssue(scope({ after: '2026-01-01T00:00:00.000Z' }))).toBeNull();
    expect(scopeIssue(scope({ before: '2026-01-01T00:00:00.000Z' }))).toBeNull();
    expect(scopeIssue(scope({ after: '2026-01-01T00:00:00.000Z', before: '2026-02-01T00:00:00.000Z', limit: 500 }))).toBeNull();
    expect(scopeIssue(scope({ limit: 1 }))).toBeNull();
    expect(scopeIssue(scope({ limit: MAX_EXPORT_LIMIT }))).toBeNull();
  });

  it('the same instant for both ends is a valid (single-instant) window, a start after the end is not', () => {
    const instant = '2026-05-05T12:00:00.000Z';
    expect(scopeIssue(scope({ after: instant, before: instant }))).toBeNull();
    expect(scopeIssue(scope({ after: '2026-05-05T12:00:00.001Z', before: instant }))).toBe('inverted');
  });

  it('compares instants, not strings: different notations of the same moment are not "inverted"', () => {
    expect(scopeIssue(scope({ after: '2026-05-05T12:00:00.000Z', before: '2026-05-05T21:00:00.000+09:00' }))).toBeNull();
    expect(scopeIssue(scope({ after: '2026-05-05T22:00:00.000+09:00', before: '2026-05-05T12:00:00.000Z' }))).toBe('inverted');
  });

  it('a bound that is not a date is a "date" issue, whichever end it is', () => {
    expect(scopeIssue(scope({ after: 'not a date' }))).toBe('date');
    expect(scopeIssue(scope({ before: '' }))).toBe('date');
    expect(scopeIssue(scope({ after: '2026-01-01T00:00:00.000Z', before: 'tomorrow-ish' }))).toBe('date');
  });

  it('only a whole number from 1 to MAX_EXPORT_LIMIT is a count', () => {
    for (const limit of [0, -1, 1.5, 0.5, MAX_EXPORT_LIMIT + 1, Number.NaN, Infinity, -Infinity]) {
      expect(scopeIssue(scope({ limit })), String(limit)).toBe('limit');
      expect(isValidLimit(limit), String(limit)).toBe(false);
    }
    expect(isValidLimit(null)).toBe(true);
    expect(isValidLimit(7)).toBe(true);
    // A value of the wrong type that slipped past the compiler is refused, never exported as "no limit".
    expect(isValidLimit(undefined as unknown as number)).toBe(false);
    expect(isValidLimit('200' as unknown as number)).toBe(false);
  });

  it('reports the date problem before the order and the order before the count', () => {
    expect(scopeIssue(scope({ after: 'x', before: '2020-01-01T00:00:00.000Z', limit: 0 }))).toBe('date');
    expect(scopeIssue(scope({ after: '2026-02-01T00:00:00.000Z', before: '2026-01-01T00:00:00.000Z', limit: 0 }))).toBe('inverted');
  });
});

describe('scope helpers', () => {
  it('sameScope compares all three fields', () => {
    expect(sameScope(scope(), scope())).toBe(true);
    expect(sameScope(scope({ limit: 5 }), scope({ limit: 5 }))).toBe(true);
    expect(sameScope(scope({ limit: 5 }), scope({ limit: 6 }))).toBe(false);
    expect(sameScope(scope({ after: 'a' }), scope({ after: 'b' }))).toBe(false);
    expect(sameScope(scope({ before: 'a' }), scope())).toBe(false);
  });

  it('copyScope keeps exactly the three fields and never the caller\'s object', () => {
    const source = { ...scope({ limit: 3 }), extra: 'x' } as ExportScope;
    const copy = copyScope(source);
    expect(copy).toEqual({ after: null, before: null, limit: 3 });
    expect(Object.keys(copy)).toEqual(['after', 'before', 'limit']);
    expect(copy).not.toBe(source);
  });

  it('pruneOverrides keeps what is still selected and returns the same object when nothing goes', () => {
    const overrides = { a: scope({ limit: 1 }), b: scope({ limit: 2 }) };
    expect(pruneOverrides(overrides, { a: true, b: true, c: true })).toBe(overrides);
    expect(pruneOverrides(overrides, { b: true })).toEqual({ b: scope({ limit: 2 }) });
    expect(pruneOverrides(overrides, {})).toEqual({});
    const empty = {};
    expect(pruneOverrides(empty, { a: true })).toBe(empty);
  });
});

describe('setExportLimit / setChannelScope', () => {
  it('the default settings carry the count next to the dates, and nothing is persisted', async () => {
    const { store, platform } = await bootDemo();
    store.getState().setExportLimit(250);
    expect(store.getState().exportSettings).toEqual({ after: null, before: null, limit: 250 });
    store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    expect(store.getState().exportSettings).toEqual({ after: '2026-01-01T00:00:00.000Z', before: null, limit: 250 });
    store.getState().setExportLimit(null);
    expect(store.getState().exportSettings.limit).toBeNull();
    expect(platform.spies.savePrefs).not.toHaveBeenCalled();
    expect(store.getState().exportOverrides).toEqual({});
  });

  it('gives a SELECTED channel its own scope; the others keep following the defaults', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    store.getState().setExportLimit(100);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 7 }));

    const state = store.getState();
    expect(state.exportOverrides).toEqual({ [MOCK_IDS.edge199Channel]: scope({ limit: 7 }) });
    expect(selectScopeOverride(state, MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 7 }));
    expect(selectScopeOverride(state, MOCK_IDS.edge200Channel)).toBeUndefined();
    expect(selectHasOverride(state, MOCK_IDS.edge199Channel)).toBe(true);
    expect(selectHasOverride(state, MOCK_IDS.edge200Channel)).toBe(false);
    expect(selectEffectiveScope(state, MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 7 }));
    // The default settings are the very same object (a stable reference for React selectors).
    expect(selectEffectiveScope(state, MOCK_IDS.edge200Channel)).toBe(state.exportSettings);
    expect(selectOverrideCount(state)).toBe(1);
  });

  it('an override replaces ALL three fields: it does not merge with the defaults', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    store.getState().setExportBefore('2026-03-01T00:00:00.000Z');
    store.getState().setExportLimit(50);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope());
    expect(selectEffectiveScope(store.getState(), MOCK_IDS.edge199Channel)).toEqual(scope());
    // ... and later changes of the defaults do not leak into it.
    store.getState().setExportLimit(99);
    expect(selectEffectiveScope(store.getState(), MOCK_IDS.edge199Channel)).toEqual(scope());
  });

  it('stores a copy: changing the caller\'s object afterwards changes nothing', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const mine = scope({ limit: 5 });
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, mine);
    mine.limit = 6;
    expect(store.getState().exportOverrides[MOCK_IDS.edge199Channel]).toEqual(scope({ limit: 5 }));
    expect(store.getState().exportOverrides[MOCK_IDS.edge199Channel]).not.toBe(mine);
  });

  it('null puts the channel back on the defaults', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 }));
    store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 6 }));
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, null);
    expect(Object.keys(store.getState().exportOverrides)).toEqual([MOCK_IDS.edge200Channel]);
    expect(selectHasOverride(store.getState(), MOCK_IDS.edge199Channel)).toBe(false);
  });

  it('ignores a channel that is not selected: overrides never outlive (or precede) a selection', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 5 }));
    store.getState().setChannelScope('no-such-channel', scope({ limit: 5 }));
    expect(store.getState().exportOverrides).toEqual({});
  });

  it('writing the same scope again (or clearing a channel that has none) notifies nobody', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 }));
    const listener = vi.fn();
    store.subscribe(listener);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 }));
    store.getState().setChannelScope(MOCK_IDS.edge200Channel, null);
    expect(listener).not.toHaveBeenCalled();
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 6 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is not persisted', async () => {
    const { store, platform } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 }));
    expect(platform.spies.savePrefs).not.toHaveBeenCalled();
  });
});

describe('an override goes away with its channel\'s selection', () => {
  const OWN = scope({ limit: 3 });

  async function bootWithOverrides(channelIds: string[]): Promise<Booted> {
    const booted = await bootWithSelection(channelIds);
    for (const id of channelIds) booted.store.getState().setChannelScope(id, OWN);
    expect(Object.keys(booted.store.getState().exportOverrides).sort()).toEqual([...channelIds].sort());
    return booted;
  }

  it('removeFromSelection drops that channel\'s override only', async () => {
    const { store } = await bootWithOverrides([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    store.getState().removeFromSelection(MOCK_IDS.edge199Channel);
    expect(Object.keys(store.getState().exportOverrides)).toEqual([MOCK_IDS.edge200Channel]);
  });

  it('clearSelection drops every override', async () => {
    const { store } = await bootWithOverrides([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    store.getState().clearSelection();
    expect(store.getState().exportOverrides).toEqual({});
  });

  it('deselecting through the checkbox (toggleChannel) drops it, and selecting again starts on the defaults', async () => {
    const { store } = await bootWithOverrides([MOCK_IDS.edge199Channel]);
    store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    expect(store.getState().exportOverrides).toEqual({});
    store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    expect(selectHasOverride(store.getState(), MOCK_IDS.edge199Channel)).toBe(false);
    expect(selectEffectiveScope(store.getState(), MOCK_IDS.edge199Channel)).toBe(store.getState().exportSettings);
  });

  it('selecting more channels never touches existing overrides', async () => {
    const { store } = await bootWithOverrides([MOCK_IDS.edge199Channel]);
    const before = store.getState().exportOverrides;
    store.getState().toggleChannel(MOCK_IDS.edge200Channel);
    expect(store.getState().exportOverrides).toBe(before);
  });

  it('deselecting a category or a whole server drops the overrides of its channels, and only those', async () => {
    const booted = await bootWithOverrides([MOCK_IDS.edge199Channel, MOCK_IDS.generalChannel, MOCK_IDS.dmFriend]);
    const { store } = booted;
    const tree = store.getState().trees[BIG].tree;
    const generalCategory = tree?.categories.find((category) => category.channels.some((channel) => channel.id === MOCK_IDS.generalChannel));
    expect(generalCategory).toBeDefined();
    // The category is only partly selected: toggling it selects the rest (nothing is removed yet) ...
    store.getState().toggleCategory(BIG, generalCategory?.id ?? UNCATEGORIZED);
    expect(Object.keys(store.getState().exportOverrides)).toHaveLength(3);
    // ... and a second toggle deselects all of it.
    store.getState().toggleCategory(BIG, generalCategory?.id ?? UNCATEGORIZED);
    expect(Object.keys(store.getState().exportOverrides)).not.toContain(MOCK_IDS.generalChannel);
    expect(Object.keys(store.getState().exportOverrides)).toContain(MOCK_IDS.dmFriend);

    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    store.getState().setChannelScope(MOCK_IDS.generalChannel, OWN);
    await store.getState().toggleGuild(BIG); // selects the rest of the server ...
    expect(selectHasOverride(store.getState(), MOCK_IDS.generalChannel)).toBe(true);
    await store.getState().toggleGuild(BIG); // ... and deselects all of it
    expect(Object.keys(store.getState().exportOverrides)).toEqual([MOCK_IDS.dmFriend]);
  });

  it('"select all DMs" deselecting them drops their overrides', async () => {
    const booted = await bootDemo();
    const dmIds = booted.store.getState().dms.map((dm) => dm.id).filter((id) => booted.store.getState().forbiddenChannels[id] !== true);
    booted.store.getState().toggleAllDms();
    expect(Object.keys(booted.store.getState().selection).sort()).toEqual([...dmIds].sort());
    booted.store.getState().setChannelScope(MOCK_IDS.dmFriend, OWN);
    expect(selectOverrideCount(booted.store.getState())).toBe(1);
    booted.store.getState().toggleAllDms();
    expect(booted.store.getState().exportOverrides).toEqual({});
  });

  it('a channel that turns out to be forbidden is deselected, and its override with it', async () => {
    const { store } = await bootWithOverrides([MOCK_IDS.forbiddenChannel, MOCK_IDS.edge199Channel]);
    await store.getState().openChannel(MOCK_IDS.forbiddenChannel, BIG);
    expect(Object.keys(store.getState().selection)).toEqual([MOCK_IDS.edge199Channel]);
    expect(Object.keys(store.getState().exportOverrides)).toEqual([MOCK_IDS.edge199Channel]);
  });

  it('a session that ends (rejected login) forgets the overrides and the default settings', async () => {
    const booted = await bootWithOverrides([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportLimit(10);
    booted.spies.getMessages.mockRejectedValue(new DiscordApiError('auth', 'Unauthorized', { status: 401 }));
    await booted.store.getState().openChannel(MOCK_IDS.edge200Channel, BIG);
    expect(booted.store.getState().status).toBe('needs-token');
    expect(booted.store.getState().exportOverrides).toEqual({});
    expect(booted.store.getState().exportSettings).toEqual({ after: null, before: null, limit: null });
  });
});

describe('selectScopeProblem', () => {
  it('is null for a valid configuration, also with overrides', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    expect(selectScopeProblem(store.getState())).toBeNull();
    store.getState().setExportLimit(5);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 9 }));
    expect(selectScopeProblem(store.getState())).toBeNull();
  });

  it('names the default settings first (channelId null) with the reason', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setExportLimit(0);
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: null, issue: 'limit' });
    store.getState().setExportLimit(null);
    store.getState().setExportAfter('nope');
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: null, issue: 'date' });
    store.getState().setExportAfter('2026-02-01T00:00:00.000Z');
    store.getState().setExportBefore('2026-01-01T00:00:00.000Z');
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: null, issue: 'inverted' });
  });

  it('finds an invalid override, the first one in display order, and says which channel', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge200Channel, MOCK_IDS.edge199Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 1.5 }));
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 0 }));
    // edge-199 comes before edge-200 in the sidebar, although it was ticked second.
    expect(selectSelectedTargets(store.getState()).map((target) => target.channelId)).toEqual([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: MOCK_IDS.edge199Channel, issue: 'limit' });
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope());
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: MOCK_IDS.edge200Channel, issue: 'limit' });
  });

  it('a valid default does not hide an invalid override; fixing the override clears the problem', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ after: 'x' }));
    expect(selectScopeProblem(store.getState())).toEqual({ channelId: MOCK_IDS.edge199Channel, issue: 'date' });
    store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope());
    expect(selectScopeProblem(store.getState())).toBeNull();
  });

  it('keeps its object while nothing relevant changes (safe for useAppStore)', async () => {
    const { store } = await bootWithSelection([MOCK_IDS.edge199Channel]);
    store.getState().setExportLimit(0);
    const first = selectScopeProblem(store.getState());
    store.getState().setDmFilter('anything');
    expect(selectScopeProblem(store.getState())).toBe(first);
    // Writing the value that is already there is not a change either.
    store.getState().setExportAfter(null);
    expect(selectScopeProblem(store.getState())).toBe(first);
    store.getState().setExportLimit(5);
    expect(selectScopeProblem(store.getState())).toBeNull();
  });
});
