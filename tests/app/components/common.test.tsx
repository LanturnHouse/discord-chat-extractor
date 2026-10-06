// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, type ReactElement, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/app/components/common/Button';
import { Checkbox } from '@/app/components/common/Checkbox';
import { ErrorBoundary } from '@/app/components/common/ErrorBoundary';
import * as Icons from '@/app/components/common/Icons';
import { Spinner } from '@/app/components/common/Spinner';

afterEach(cleanup);

describe('Checkbox', () => {
  it('exposes the tri-state through ARIA and a data attribute', () => {
    const { rerender } = render(<Checkbox state="none" onChange={() => undefined} ariaLabel="Select general" />);
    const box = screen.getByRole('checkbox', { name: 'Select general' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.getAttribute('data-state')).toBe('none');
    expect(box.querySelector('svg')).toBeNull();

    rerender(<Checkbox state="some" onChange={() => undefined} ariaLabel="Select general" />);
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    expect(box.querySelector('svg')).not.toBeNull();

    rerender(<Checkbox state="all" onChange={() => undefined} ariaLabel="Select general" />);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('data-state')).toBe('all');
    expect(box.querySelector('svg')).not.toBeNull();
  });

  it('calls onChange on click and never lets the click reach a clickable row', () => {
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick} role="presentation">
        <Checkbox state="none" onChange={onChange} ariaLabel="x" />
      </div>,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('keeps double clicks away from the row as well', () => {
    const onRowDoubleClick = vi.fn();
    render(
      <div onDoubleClick={onRowDoubleClick} role="presentation">
        <Checkbox state="none" onChange={() => undefined} ariaLabel="x" />
      </div>,
    );
    fireEvent.doubleClick(screen.getByRole('checkbox'));
    expect(onRowDoubleClick).not.toHaveBeenCalled();
  });

  it('is a real button: Enter and Space do not reach the row, other keys still do', () => {
    const onRowKeyDown = vi.fn();
    render(
      <div onKeyDown={onRowKeyDown} role="presentation">
        <Checkbox state="none" onChange={() => undefined} ariaLabel="x" />
      </div>,
    );
    const box = screen.getByRole('checkbox');
    expect(box.tagName).toBe('BUTTON');
    expect(box.getAttribute('type')).toBe('button');
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: ' ' });
    expect(onRowKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(onRowKeyDown).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(<Checkbox state="none" onChange={onChange} ariaLabel="x" disabled />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox') as HTMLButtonElement).disabled).toBe(true);
  });

  it('supports a custom size and the reveal-on-hover class', () => {
    render(<Checkbox state="none" onChange={() => undefined} ariaLabel="x" size={16} revealOnHover className="extra" />);
    const box = screen.getByRole('checkbox');
    expect(box.style.getPropertyValue('--dce-checkbox-size')).toBe('16px');
    expect(box.classList.contains('dce-checkbox--reveal')).toBe(true);
    expect(box.classList.contains('extra')).toBe(true);
  });

  describe('focusOnRemove', () => {
    function mountWith(fallback: RefObject<HTMLButtonElement | null>): ReturnType<typeof render> {
      return render(
        <>
          <button type="button" ref={fallback}>
            row
          </button>
          <Checkbox state="none" onChange={() => undefined} ariaLabel="x" focusOnRemove={fallback} />
        </>,
      );
    }

    it('hands the keyboard focus to the given element when the focused box is removed (never to <body>)', () => {
      const fallback = createRef<HTMLButtonElement>();
      const { rerender } = mountWith(fallback);
      const box = screen.getByRole('checkbox');
      act(() => box.focus());
      expect(document.activeElement).toBe(box);

      rerender(
        <button type="button" ref={fallback}>
          row
        </button>,
      );
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'row' }));
    });

    it('leaves the focus alone when the box is not the focused element', () => {
      const fallback = createRef<HTMLButtonElement>();
      const { rerender } = mountWith(fallback);
      const other = document.createElement('input');
      document.body.append(other);
      other.focus();

      rerender(
        <button type="button" ref={fallback}>
          row
        </button>,
      );
      expect(document.activeElement).toBe(other);
      other.remove();
    });

    it('does nothing without a target', () => {
      const { unmount } = render(<Checkbox state="none" onChange={() => undefined} ariaLabel="x" />);
      act(() => screen.getByRole('checkbox').focus());
      expect(() => unmount()).not.toThrow();
    });
  });
});

describe('Icons', () => {
  type IconComponent = (props: Icons.IconProps) => ReactElement;
  const entries = Object.entries(Icons).filter((entry): entry is [string, IconComponent] => typeof entry[1] === 'function');

  it('exports the icons the other areas rely on', () => {
    const names = entries.map(([name]) => name);
    for (const required of [
      'Hash',
      'HashLocked',
      'Speaker',
      'SpeakerLocked',
      'Megaphone',
      'Forum',
      'Thread',
      'Stage',
      'Lock',
      'ChevronDown',
      'ChevronRight',
      'Check',
      'Minus',
      'Close',
      'Download',
      'DownloadCaret',
      'SpinnerIcon',
      'Warning',
      'Info',
      'ChatBubble',
      'Search',
    ]) {
      expect(names).toContain(required);
    }
  });

  it.each(entries)('%s is a decorative, currentColor, 1em SVG', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('width')).toBe('1em');
    expect(svg?.getAttribute('height')).toBe('1em');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('focusable')).toBe('false');
    const html = container.innerHTML;
    expect(html).toContain('currentColor');
    // Nothing hard-coded: icons take the colour of the text around them.
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(container.querySelectorAll('path, circle, rect').length).toBeGreaterThan(0);
  });

  it('a title makes the icon an announced image', () => {
    const { container } = render(<Icons.Lock title="No access" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('title')?.textContent).toBe('No access');
    expect(screen.getByRole('img', { name: 'No access' })).toBeTruthy();
  });

  it('passes className, style and other SVG props through', () => {
    const { container } = render(<Icons.Check className="mark" style={{ fontSize: 14 }} data-testid="check" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('mark');
    expect(svg?.style.fontSize).toBe('14px');
    expect(svg?.getAttribute('data-testid')).toBe('check');
  });

  it('SpinnerIcon spins and keeps extra classes', () => {
    const { container } = render(<Icons.SpinnerIcon className="big" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('dce-icon-spin big');
  });
});

describe('Spinner', () => {
  it('is announced only when it has a label', () => {
    const { container, rerender } = render(<Spinner />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<Spinner label="Loading" size={40} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--dce-spinner-size')).toBe('40px');
  });
});

describe('Button', () => {
  it('defaults to type=button and the primary variant', () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('dce-button--primary');
  });

  it('supports variants, sizes, extra classes and disabling', () => {
    const onClick = vi.fn();
    render(
      <Button variant="danger" size="sm" className="extra" onClick={onClick} disabled>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(button.className).toBe('dce-button dce-button--danger dce-button--sm extra');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('exploded');
  }

  it('renders the children while nothing throws', () => {
    render(
      <ErrorBoundary fallback={() => <p>fallback</p>}>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('shows the fallback with the error when a child throws while rendering', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary fallback={(error) => <p>fallback: {error.message}</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fallback: exploded')).toBeTruthy();
    consoleError.mockRestore();
  });
});
