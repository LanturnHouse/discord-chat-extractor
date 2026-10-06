import { describe, expect, it } from 'vitest';
import { declarationsOf, readCss, rulesOf } from './cssTools';

/*
 * jsdom has no layout, so the two layout bugs of the full-screen shell are pinned on the stylesheet; both were measured in
 * Chrome (a 900x500 and a 683x325 window for the first, a 700x600 one for the second).
 */

const layout = rulesOf(readCss('src/app/styles/layout.css'));

describe('.app-center (boot spinner, fatal error, onboarding)', () => {
  it('centres its child with auto margins, so a child taller than the window still starts at the top and can be scrolled', () => {
    expect(declarationsOf(layout, '.app-center > *').get('margin')).toBe('auto');
    const container = declarationsOf(layout, '.app-center');
    expect(container.get('overflow')).toBe('auto');
    expect(container.get('display')).toBe('flex');
    // `align-items` / `justify-content: center` would overflow equally upwards, where no scrolling can reach.
    expect(container.has('align-items')).toBe(false);
    expect(container.has('justify-content')).toBe(false);
  });
});

describe('#root', () => {
  it('is as tall as the viewport minus the horizontal scrollbar that appears below the minimum width (no second scrollbar)', () => {
    const root = declarationsOf(layout, '#root');
    expect(root.get('height')).toBe('100%');
    expect(root.get('min-width')).toBe('var(--min-app-width)');
    expect([...root.values()].join(' ')).not.toMatch(/\d(?:d|s|l)?vh/);
  });
});

describe("the interface's own sentences wrap between Korean words, never inside them", () => {
  // Measured in Chrome: with `word-break: normal` the empty state of the DM home split "대화|를" at every window width.
  // `keep-all` stops that; where text can hold a name or URL without spaces, `overflow-wrap` keeps it from overflowing.
  const SENTENCES: ReadonlyArray<readonly [sheet: string, selector: string, breaksLongTokens: boolean]> = [
    ['src/app/components/chat/chat.css', '.chat-state__title', true],
    ['src/app/components/chat/chat.css', '.chat-state__text', true],
    ['src/app/components/chat/chat.css', '.chat-start__title', true],
    ['src/app/components/chat/chat.css', '.chat-start__text', true],
    ['src/app/components/chat/chat.css', '.chat-pill--error', false], // its detail line (.chat-pill__detail) has the fallback itself
    ['src/app/components/sidebar/sidebar.css', '.sb-empty', true],
    ['src/app/components/sidebar/sidebar.css', '.sb-error__message', true],
    ['src/app/styles/layout.css', '.app-fatal__title', false],
    ['src/app/styles/layout.css', '.app-fatal__message', true],
    ['src/app/components/Onboarding.css', '.onboarding', true],
  ];

  it.each(SENTENCES)('%s: %s', (sheet, selector, breaksLongTokens) => {
    const declarations = declarationsOf(rulesOf(readCss(sheet)), selector);
    expect(declarations.get('word-break')).toBe('keep-all');
    if (breaksLongTokens) expect(declarations.get('overflow-wrap')).toMatch(/^(anywhere|break-word)$/);
  });
});
