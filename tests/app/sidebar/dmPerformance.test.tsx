// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/app/components/sidebar/Sidebar';
import { appStore } from '@/app/state/store';
import type { DmNode } from '@/lib/discord/model';
import { bootApp } from '../rail/helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

// Every conversation row renders exactly one SafeImg, so its render count is the number of row renders.
const renders = vi.hoisted(() => ({ safeImg: 0 }));
vi.mock('@/app/components/message/SafeImg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/message/SafeImg')>();
  return {
    ...actual,
    SafeImg: (props: Parameters<typeof actual.SafeImg>[0]) => {
      renders.safeImg += 1;
      return actual.SafeImg(props);
    },
  };
});

afterEach(cleanup);

function manyDms(count: number, template: DmNode): DmNode[] {
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `9${String(index).padStart(5, '0')}`,
    name: `Person ${index}`,
    recipients: [{ ...template.recipients[0], id: `8${index}`, name: `Person ${index}`, username: `person_${index}` }],
  }));
}

describe('DM list with hundreds of conversations', () => {
  it('re-renders only the row whose own state changed', async () => {
    await bootApp();
    appStore.setState({ dms: manyDms(500, appStore.getState().dms[1]) });
    const { container } = render(<Sidebar />);
    const rows = Array.from(container.querySelectorAll('li'));
    expect(rows).toHaveLength(500);

    renders.safeImg = 0;
    fireEvent.click(within(rows[42]).getByRole('checkbox'));
    expect(within(rows[42]).getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    expect(renders.safeImg).toBe(1);

    // Opening another conversation changes the active row: the old and the new one re-render, nobody else.
    renders.safeImg = 0;
    await act(async () => {
      appStore.setState({ activeChannelId: appStore.getState().dms[3].id });
    });
    expect(renders.safeImg).toBe(1);
    renders.safeImg = 0;
    await act(async () => {
      appStore.setState({ activeChannelId: appStore.getState().dms[9].id });
    });
    expect(renders.safeImg).toBe(2);
  });

  it('typing in the filter re-renders only the rows that stay', async () => {
    await bootApp();
    appStore.setState({ dms: manyDms(500, appStore.getState().dms[1]) });
    render(<Sidebar />);
    renders.safeImg = 0;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'person 49' } });
    // Rows keep their keys, so the surviving ones are reused untouched ("Person 49", "Person 490".."Person 499").
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(renders.safeImg).toBe(0);
  });
});
