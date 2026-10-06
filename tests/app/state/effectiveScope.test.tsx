// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffectiveScope, useScopeOverride } from '@/app/state';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportScope } from '@/lib/export/types';
import { bootTopBar, select } from '../topbar/helpers';

afterEach(cleanup);

const scope = (patch: Partial<ExportScope> = {}): ExportScope => ({ after: null, before: null, limit: null, ...patch });
const GENERAL = MOCK_IDS.generalChannel;
const EDGE = MOCK_IDS.edge199Channel;

describe('useEffectiveScope', () => {
  it('is the common settings, live, until the channel gets a scope of its own', async () => {
    await bootTopBar();
    select(GENERAL, EDGE);
    const { result } = renderHook(() => useEffectiveScope(EDGE));
    expect(result.current).toBe(appStore.getState().exportSettings);
    expect(result.current).toEqual(scope());

    act(() => appStore.getState().setExportLimit(50));
    expect(result.current).toEqual(scope({ limit: 50 }));
    act(() => appStore.getState().setExportAfter('2026-01-01T00:00:00.000Z'));
    expect(result.current).toEqual(scope({ after: '2026-01-01T00:00:00.000Z', limit: 50 }));
    expect(result.current).toBe(appStore.getState().exportSettings);
  });

  it('is the channel\'s own scope from the moment it has one - even one equal to the common settings - and the common ones go back after a reset', async () => {
    await bootTopBar();
    select(GENERAL, EDGE);
    act(() => appStore.getState().setExportLimit(50));
    const { result } = renderHook(() => ({ effective: useEffectiveScope(EDGE), own: useScopeOverride(EDGE) }));
    expect(result.current.own).toBeUndefined();

    act(() => appStore.getState().setChannelScope(EDGE, scope({ limit: 50 })));
    expect(result.current.own).toEqual(scope({ limit: 50 }));
    expect(result.current.effective).toBe(result.current.own);
    act(() => appStore.getState().setExportLimit(9));
    expect(result.current.effective).toEqual(scope({ limit: 50 }));

    act(() => appStore.getState().setChannelScope(EDGE, null));
    expect(result.current.own).toBeUndefined();
    expect(result.current.effective).toEqual(scope({ limit: 9 }));
  });

  it('does not wake up for another channel\'s scope, and follows its channel out of the selection', async () => {
    await bootTopBar();
    select(GENERAL, EDGE);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useEffectiveScope(EDGE);
    });
    const before = renders;
    act(() => appStore.getState().setChannelScope(GENERAL, scope({ limit: 3 })));
    expect(renders).toBe(before);

    act(() => appStore.getState().setChannelScope(EDGE, scope({ limit: 4 })));
    expect(result.current).toEqual(scope({ limit: 4 }));
    act(() => appStore.getState().toggleChannel(EDGE));
    // Deselected: the scope of its own went with it, the common settings are what is left.
    expect(result.current).toBe(appStore.getState().exportSettings);
  });
});
