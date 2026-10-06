// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusInitial, tabbables, trapTab, wrapFromGuard } from '@/app/components/topbar/focus';
import { Popover } from '@/app/components/topbar/Popover';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** A container in the document; `html` is what the popover would hold. */
function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.tabIndex = -1;
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function tab(root: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
  trapTab(event, root);
  return event;
}

describe('tabbables', () => {
  it('lists what Tab reaches, in DOM order, and skips tabindex=-1, disabled, hidden and guard elements', () => {
    const root = mount(`
      <button id="a">a</button>
      <button id="roving" tabindex="-1">roving</button>
      <button id="off" disabled>off</button>
      <span id="guard" tabindex="0" data-focus-guard=""></span>
      <input id="hiddenInput" type="hidden" />
      <div hidden><button id="inHidden">x</button></div>
      <div inert><button id="inInert">x</button></div>
      <button id="hiddenAttr" hidden>x</button>
      <a id="link" href="#x">link</a>
      <span id="custom" tabindex="0">custom</span>
      <button id="z">z</button>`);
    expect(tabbables(root).map((element) => element.id)).toEqual(['a', 'link', 'custom', 'z']);
  });

  it('a date input is ONE stop: its month / day / year segments are not elements of the document', () => {
    const root = mount('<button id="a">a</button><input id="date" type="date" /><input id="to" type="date" />');
    expect(tabbables(root).map((element) => element.id)).toEqual(['a', 'date', 'to']);
  });

  it('is computed from the DOM every time it is asked', () => {
    const root = mount('<button id="a">a</button>');
    expect(tabbables(root)).toHaveLength(1);
    root.insertAdjacentHTML('beforeend', '<button id="b">b</button>');
    root.querySelector('#a')?.setAttribute('tabindex', '-1');
    expect(tabbables(root).map((element) => element.id)).toEqual(['b']);
  });

  it('focusInitial prefers [data-autofocus], then the first tabbable, then the container', () => {
    const root = mount('<button id="a">a</button><button id="b" data-autofocus>b</button>');
    focusInitial(root);
    expect(document.activeElement?.id).toBe('b');
    const plain = mount('<span>nothing to focus</span>');
    focusInitial(plain);
    expect(document.activeElement).toBe(plain);
  });
});

describe('trapTab', () => {
  it('wraps from the last button to the first and back', () => {
    const root = mount('<button id="a">a</button><button id="b">b</button>');
    root.querySelector<HTMLElement>('#b')?.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(tab(root, true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('does nothing in the middle', () => {
    const root = mount('<button id="a">a</button><button id="b">b</button><button id="c">c</button>');
    root.querySelector<HTMLElement>('#b')?.focus();
    expect(tab(root).defaultPrevented).toBe(false);
    expect(tab(root, true).defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('b');
  });

  it('does not hijack Tab inside a date input that is the last stop (its segments need the Tab)', () => {
    const root = mount('<button id="a">a</button><input id="to" type="date" />');
    root.querySelector<HTMLElement>('#to')?.focus();
    const event = tab(root);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('to');
  });

  it('does not hijack Shift+Tab inside a date input that is the first stop', () => {
    const root = mount('<input id="from" type="date" /><button id="z">z</button>');
    root.querySelector<HTMLElement>('#from')?.focus();
    expect(tab(root, true).defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('from');
  });

  it.each(['time', 'datetime-local', 'month', 'week'])('the same goes for type=%s', (type) => {
    const root = mount(`<button id="a">a</button><input id="x" type="${type}" />`);
    root.querySelector<HTMLElement>('#x')?.focus();
    expect(tab(root).defaultPrevented).toBe(false);
  });

  it('a text input at the end is a normal stop: Tab wraps', () => {
    const root = mount('<button id="a">a</button><input id="t" type="text" />');
    root.querySelector<HTMLElement>('#t')?.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('the end is the last REAL stop: a trailing tabindex=-1, disabled or hidden element does not count', () => {
    const root = mount(`
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="roving" tabindex="-1">roving</button>
      <button id="off" disabled>off</button>
      <div hidden><button id="hid">hid</button></div>`);
    root.querySelector<HTMLElement>('#b')?.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('reads the ends from the DOM at the time of the key press', () => {
    const root = mount('<button id="a">a</button><input id="to" type="date" />');
    root.querySelector<HTMLElement>('#to')?.focus();
    expect(tab(root).defaultPrevented).toBe(false);
    // A control appears after the date input: now the date input is in the middle, and the new button is the end.
    root.insertAdjacentHTML('beforeend', '<button id="done">done</button>');
    expect(tab(root).defaultPrevented).toBe(false);
    root.querySelector<HTMLElement>('#done')?.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('pulls focus that wandered out back in, also when it sits in a date input outside', () => {
    const root = mount('<button id="a">a</button><button id="b">b</button>');
    const outside = document.createElement('input');
    outside.type = 'date';
    document.body.append(outside);
    outside.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    outside.focus();
    expect(tab(root, true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('keeps the focus on the container when there is nothing to tab to', () => {
    const root = mount('<span>text</span>');
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root);
  });

  it('ignores other keys', () => {
    const root = mount('<button id="a">a</button>');
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    trapTab(event, root);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('wrapFromGuard', () => {
  const root = (): HTMLElement => mount('<button id="a">a</button><input id="to" type="date" />');

  it('focus that moved past the end (out of the last date segment) wraps to the first stop', () => {
    const container = root();
    wrapFromGuard(container, 'end', container.querySelector('#to'));
    expect(document.activeElement?.id).toBe('a');
  });

  it('focus that moved before the start (Shift+Tab from the first stop) wraps to the last stop', () => {
    const container = root();
    wrapFromGuard(container, 'start', container.querySelector('#a'));
    expect(document.activeElement?.id).toBe('to');
  });

  it('focus that arrives from outside enters at the near end', () => {
    const container = root();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    wrapFromGuard(container, 'start', elsewhere);
    expect(document.activeElement?.id).toBe('a');
    wrapFromGuard(container, 'end', null);
    expect(document.activeElement?.id).toBe('to');
  });
});

function Harness({ role }: { role?: 'dialog' | 'status' }): ReactElement {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">
        anchor
      </button>
      <Popover anchorRef={anchorRef} onClose={vi.fn()} width={300} label="Panel" role={role}>
        <button type="button">first</button>
        <input type="date" aria-label="date" />
      </Popover>
    </>
  );
}

describe('Popover focus guards', () => {
  const guards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-focus-guard]'));

  it('a dialog popover has a guard before and after its content, and they are no stops of the trap', () => {
    render(<Harness />);
    const panel = screen.getByRole('dialog', { name: 'Panel' });
    const found = guards();
    expect(found).toHaveLength(2);
    expect(panel.firstElementChild).toBe(found[0]);
    expect(panel.lastElementChild).toBe(found[1]);
    expect(tabbables(panel).map((element) => element.tagName)).toEqual(['BUTTON', 'INPUT']);
    // It took the focus when it opened: the first real stop, never a guard.
    expect(document.activeElement?.textContent).toBe('first');
  });

  it('focus that the browser moved past the date input lands on the end guard and wraps to the first stop', () => {
    render(<Harness />);
    screen.getByLabelText('date').focus();
    act(() => guards()[1].focus());
    expect(document.activeElement?.textContent).toBe('first');
  });

  it('Shift+Tab from the first stop lands on the start guard and wraps to the last stop', () => {
    render(<Harness />);
    act(() => guards()[0].focus());
    // The focus came from the first button (inside): wrap to the last stop.
    expect(document.activeElement).toBe(screen.getByLabelText('date'));
  });

  it('a status popover has no guards and takes no focus', () => {
    render(<Harness role="status" />);
    expect(guards()).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Panel' }).hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('Tab in the date input at the end of a real popover is left to the browser', () => {
    render(<Harness />);
    const date = screen.getByLabelText('date');
    date.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    date.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(date);
  });
});
