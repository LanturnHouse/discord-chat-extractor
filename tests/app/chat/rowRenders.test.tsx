// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '@/app/components/chat/MessageList';
import { createNameTeacher, resolveTimeZone, useMessageContext } from '@/app/components/chat/messageContext';
import { appStore, type ChannelMessages } from '@/app/state';
import type { Message, User } from '@/lib/discord/types';
import { installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from './fakeLayout';
import { BOB, messageAt, messageRange, textChannel } from './fixtures';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const renders = vi.hoisted(() => ({ ids: [] as string[] }));

// Counts which message rows actually rendered: the observable effect of React.memo on MessageItem + a stable context.
vi.mock('@/app/components/message/MessageRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/message/MessageRow')>();
  return {
    ...actual,
    MessageRow: (props: Parameters<typeof actual.MessageRow>[0]) => {
      renders.ids.push(props.message.id);
      return actual.MessageRow(props);
    },
  };
});

let layout: FakeLayout;
let resize: InstalledResizeObserver;
const loadOlder = vi.fn();

beforeEach(() => {
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({ locale: 'en', loadOlderMessages: loadOlder });
  layout = installFakeLayout();
  resize = installFakeResizeObserver();
  renders.ids = [];
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
  loadOlder.mockReset();
});

const loaded = (items: Message[], extra: Partial<ChannelMessages> = {}): ChannelMessages => ({
  status: 'loaded',
  items,
  hasMore: true,
  loadingOlder: false,
  ...extra,
});

function mount(messages: ChannelMessages) {
  const channel = textChannel();
  const view = render(<MessageList channel={channel} messages={messages} />);
  const scroller = view.container.querySelector<HTMLElement>('.chat-list') as HTMLElement;
  return { ...view, scroller, update: (next: ChannelMessages) => view.rerender(<MessageList channel={channel} messages={next} />) };
}

describe('rows are not re-rendered when older messages are prepended', () => {
  it('only the new rows and the one whose neighbour changed render', () => {
    const { update } = mount(loaded(messageRange(200, 400)));
    expect(renders.ids).toHaveLength(200);
    renders.ids = [];

    update(loaded([...messageRange(0, 200), ...messageRange(200, 400)]));
    const rendered = new Set(renders.ids);
    // 200 new rows + the previously first row, which now has a predecessor (its day divider and grouping depend on it)
    expect(renders.ids).toHaveLength(201);
    expect(rendered.size).toBe(201);
    expect(rendered.has(messageAt(200).id)).toBe(true);
    for (let index = 201; index < 400; index += 1) expect(rendered.has(messageAt(index).id)).toBe(false);
    for (let index = 0; index < 200; index += 1) expect(rendered.has(messageAt(index).id)).toBe(true);
  });

  it('a second prepend still leaves everything below untouched', () => {
    const { update } = mount(loaded(messageRange(400, 600)));
    update(loaded(messageRange(200, 600)));
    renders.ids = [];
    update(loaded(messageRange(0, 600)));
    expect(renders.ids).toHaveLength(201);
    expect(new Set(renders.ids).has(messageAt(300).id)).toBe(false);
  });

  it('the loader, the error pill and the jump button never touch the rows', () => {
    const items = messageRange(200, 400);
    const { update, scroller } = mount(loaded(items));
    renders.ids = [];

    update(loaded(items, { loadingOlder: true }));
    update(loaded(items, { olderError: 'boom' }));
    update(loaded(items));
    layout.userScrollTo(scroller, 3000); // the jump button appears
    layout.userScrollTo(scroller, 3100);
    expect(renders.ids).toEqual([]);
  });

  it('a new array with the same messages renders nothing either', () => {
    const { update } = mount(loaded(messageRange(200, 400)));
    renders.ids = [];
    update(loaded(messageRange(200, 400)));
    expect(renders.ids).toEqual([]);
  });
});

describe('the render context changes only with locale, time zone or guild names', () => {
  it('a locale switch renders every row once, with the new language', () => {
    const { container } = mount(loaded(messageRange(0, 30)));
    renders.ids = [];
    act(() => appStore.setState({ locale: 'ko' }));
    expect(renders.ids).toHaveLength(30);
    expect(container.querySelector('.msg-day-divider')?.getAttribute('aria-label')).toMatch(/2026/);
  });

  it('new guild names render every row once', () => {
    mount(loaded(messageRange(0, 30)));
    renders.ids = [];
    act(() => appStore.setState({ guildNames: { g1: { channels: { '55': 'rules' }, roles: {} } } }));
    expect(renders.ids).toHaveLength(30);
  });

  it('unrelated store changes render nothing', () => {
    mount(loaded(messageRange(0, 30)));
    renders.ids = [];
    act(() => appStore.setState({ dmFilter: 'x', selection: {} }));
    expect(renders.ids).toEqual([]);
  });
});

describe('names are known before the rows that need them render', () => {
  const channel = textChannel();

  function withNames(content: string, extra: Partial<Message> = {}): Message {
    return messageAt(1, { content, ...extra });
  }

  it('channel and role mentions come from the guild names', () => {
    appStore.setState({ guildNames: { g1: { channels: { '55': 'rules' }, roles: { '66': 'Mods' } } } });
    const { container } = render(<MessageList channel={channel} messages={loaded([withNames('see <#55> <@&66>')])} />);
    expect(container.querySelector('.msg-content')?.textContent).toContain('#rules');
    expect(container.querySelector('.msg-content')?.textContent).toContain('@Mods');
  });

  it('a user known only from an author of the same batch resolves in a mention of that batch', () => {
    const mentioning = withNames('hi <@1002>', { id: '5000010', mentions: [] });
    const first = messageAt(0, { author: BOB, content: 'hello' });
    const { container } = render(<MessageList channel={channel} messages={loaded([first, mentioning])} />);
    expect(container.querySelectorAll('.msg-content')[1].textContent).toContain('@Bob');
  });

  it('a page prepended later teaches its names to the rows of that page', () => {
    const carol: User = { id: '1003', username: 'carol', global_name: 'Carol', avatar: null, discriminator: '0' };
    const { container, update } = mount(loaded([messageAt(300, { content: 'later' })]));
    update(
      loaded([
        messageAt(100, { author: carol, content: 'I am here' }),
        messageAt(101, { content: 'ping <@1003>', mentions: [] }),
        messageAt(300, { content: 'later' }),
      ]),
    );
    expect(container.querySelector('[data-message-id="5000101"] .msg-content')?.textContent).toContain('@Carol');
  });
});

describe('createNameTeacher', () => {
  it('teaches the authors and mentions of the first batch', () => {
    const teacher = createNameTeacher(undefined);
    teacher.teach([messageAt(0)]);
    expect(teacher.names.user('1001')).toBe('Alice');
    expect(teacher.names.user('1002')).toBeUndefined();
  });

  it('teaches only the prepended batch on a prepend, and everything again for any other change', () => {
    const teacher = createNameTeacher(undefined);
    const first = [messageAt(5)];
    const spy = vi.spyOn(teacher.names, 'addMessages');
    teacher.teach(first);
    expect(spy).toHaveBeenLastCalledWith(first);

    const prepended = [messageAt(4, { author: BOB }), ...first];
    teacher.teach(prepended);
    expect(spy).toHaveBeenLastCalledWith([prepended[0]]);
    expect(teacher.names.user('1002')).toBe('Bob');

    const calls = spy.mock.calls.length;
    teacher.teach(prepended);
    expect(spy.mock.calls.length).toBe(calls); // same array: nothing to do

    const replaced = [messageAt(9)];
    teacher.teach(replaced);
    expect(spy).toHaveBeenLastCalledWith(replaced);
  });

  it('starts from the channel and role names of the guild', () => {
    const teacher = createNameTeacher({ channels: { '1': 'general' }, roles: { '2': 'Admins' } });
    expect(teacher.names.channel('1')).toBe('general');
    expect(teacher.names.role('2')).toBe('Admins');
    expect(createNameTeacher(undefined).names.channel('1')).toBeUndefined();
  });
});

describe('useMessageContext', () => {
  it('keeps its identity across prepends and re-renders, and changes with the locale or the guild names', () => {
    const names = { channels: {}, roles: {} };
    const { result, rerender } = renderHook(({ items }: { items: readonly Message[] }) => useMessageContext(names, items), {
      initialProps: { items: [messageAt(5)] as readonly Message[] },
    });
    const first = result.current;
    expect(first.locale).toBe('en');
    expect(first.timeZone).toBe(resolveTimeZone());

    rerender({ items: [messageAt(4), messageAt(5)] });
    expect(result.current).toBe(first);
    rerender({ items: [messageAt(0), messageAt(1), messageAt(4), messageAt(5)] });
    expect(result.current).toBe(first);

    act(() => appStore.setState({ locale: 'ko' }));
    expect(result.current).not.toBe(first);
    expect(result.current.locale).toBe('ko');
    expect(result.current.names).toBe(first.names);
  });

  it('builds a new resolver when the guild names change', () => {
    const { result, rerender } = renderHook(({ names }: { names: { channels: Record<string, string>; roles: Record<string, string> } }) => useMessageContext(names, []), {
      initialProps: { names: { channels: { '1': 'a' }, roles: {} } },
    });
    const first = result.current;
    rerender({ names: { channels: { '1': 'b' }, roles: {} } });
    expect(result.current).not.toBe(first);
    expect(result.current.names.channel('1')).toBe('b');
  });

  it('resolves a usable IANA zone', () => {
    expect(resolveTimeZone()).toMatch(/^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+)*$|^UTC$/);
  });
});
