import { describe, expect, it } from 'vitest';
import { toneOf } from '@/lib/message';
import { contrast, declarationsOf, over, parseColor, readCss, rulesOf, tokens, type Rgba } from './cssTools';

/*
 * WCAG contrast of the text and the focus indicator, computed from the stylesheets (jsdom has no cascade): the colours come
 * from the tokens of theme.css, so changing a token or a rule in a way that breaks a ratio fails here.
 */

const TEXT = 4.5;
const INDICATOR = 3;

const theme = tokens();
const colour = (value: string): Rgba => parseColor(value, theme);
const sidebar = rulesOf(readCss('src/app/components/sidebar/sidebar.css'));
const message = rulesOf(readCss('src/app/styles/message.css'));

function colorOf(rules: ReturnType<typeof rulesOf>, selector: string): Rgba {
  const value = declarationsOf(rules, selector).get('color');
  if (value === undefined) throw new Error(`${selector} has no colour`);
  return colour(value);
}

/** What a sidebar row sits on: the plain sidebar, and the row tints of hover and of the open row. */
const surfaces = {
  rest: colour('var(--bg-secondary)'),
  hover: over(colour('var(--bg-modifier-hover)'), colour('var(--bg-secondary)')),
  selected: over(colour('var(--bg-modifier-selected)'), colour('var(--bg-secondary)')),
};

const lightness = (value: Rgba): number => value.r + value.g + value.b;

describe('sidebar text', () => {
  it('channel and thread names are at least 4.5:1 at rest, on hover and when open, and the states stay distinct', () => {
    const rest = colorOf(sidebar, '.sb-channel__name');
    const hover = colorOf(sidebar, '.sb-channel:hover .sb-channel__name');
    const active = colorOf(sidebar, '.sb-channel.sb-row--active .sb-channel__name');
    expect(contrast(rest, surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(hover, surfaces.hover)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(active, surfaces.selected)).toBeGreaterThanOrEqual(TEXT);
    // Brighter on hover, brighter again (white) for the open channel.
    expect(lightness(hover)).toBeGreaterThan(lightness(rest));
    expect(lightness(active)).toBeGreaterThan(lightness(hover));
  });

  it('the dark --channel-icon token stays for the icons (3:1), the names do not use it', () => {
    expect(colorOf(sidebar, '.sb-channel__main')).toEqual(colour('var(--channel-icon)'));
    expect(contrast(colour('var(--channel-icon)'), surfaces.rest)).toBeGreaterThanOrEqual(INDICATOR);
    expect(colorOf(sidebar, '.sb-channel__name')).not.toEqual(colour('var(--channel-icon)'));
  });

  it('direct message names and their second line are at least 4.5:1 in every state', () => {
    expect(contrast(colorOf(sidebar, '.sb-dm__name'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-dm:hover .sb-dm__name'), surfaces.hover)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-dm.sb-row--active .sb-dm__name'), surfaces.selected)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-dm__sub'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-dm:hover .sb-dm__sub'), surfaces.hover)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-dm.sb-row--active .sb-dm__sub'), surfaces.selected)).toBeGreaterThanOrEqual(TEXT);
  });

  it('category headers and section headings are at least 4.5:1 on the sidebar', () => {
    expect(contrast(colorOf(sidebar, '.sb-category__main'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-category__main:hover'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-section'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(colorOf(sidebar, '.sb-empty'), surfaces.rest)).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('focus indicator', () => {
  const ring = colour('var(--focus-ring)');
  const surfacesUnderRing: Record<string, Rgba> = {
    'chat area': colour('var(--bg-primary)'),
    'message under the pointer': colour('var(--bg-message-hover)'),
    sidebar: colour('var(--bg-secondary)'),
    'hovered sidebar row': surfaces.hover,
    'open sidebar row': surfaces.selected,
    'server rail': colour('var(--bg-tertiary)'),
    'popovers and dialogs': colour('var(--bg-floating)'),
  };

  it.each(Object.entries(surfacesUnderRing))('is at least 3:1 against the %s', (_name, surface) => {
    expect(contrast(ring, surface)).toBeGreaterThanOrEqual(INDICATOR);
  });

  it('is still a blue of the brand family, not white or grey', () => {
    expect(ring.b).toBeGreaterThan(ring.r);
    expect(ring.b).toBeGreaterThan(ring.g);
  });
});

describe('fallback avatars (the initial of a user without a picture)', () => {
  const white = colour('#ffffff');
  const nearBlack = colour('#1e1f22');
  const base = declarationsOf(message, '.msg-avatar-fallback');

  function paletteOf(tone: number): { background: Rgba; text: Rgba } {
    const own = tone === 0 ? new Map<string, string>() : declarationsOf(message, `.msg-avatar-fallback--${tone}`);
    const background = own.get('background-color') ?? base.get('background-color');
    const text = own.get('color') ?? base.get('color');
    if (background === undefined || text === undefined) throw new Error(`slot ${tone} is incomplete`);
    return { background: colour(background), text: colour(text) };
  }

  it('toneOf only returns slots the stylesheet defines, and every slot is used', () => {
    const used = new Set<number>();
    for (let id = 0; id < 400; id += 1) used.add(toneOf(String(1_000_000 + id * 7919)));
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each([0, 1, 2, 3, 4, 5])('slot %i: the initial is at least 4.5:1 on its circle (this is also the 10px reply preview)', (tone) => {
    const { background, text } = paletteOf(tone);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each([0, 1, 2, 3, 4, 5])('slot %i: the initial is the better of white and near-black for that circle', (tone) => {
    const { background, text } = paletteOf(tone);
    const better = contrast(white, background) >= contrast(nearBlack, background) ? white : nearBlack;
    expect(text).toEqual(better);
  });
});
