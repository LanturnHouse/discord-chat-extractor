import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * jsdom does not apply stylesheets, so the visual spec of the rail and the sidebar (docs/ARCHITECTURE.md "Visual spec" and the
 * task description) is checked on the CSS text: sizes, states and token usage.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const theme = stripComments(read('src/app/styles/theme.css'));
const railCss = stripComments(read('src/app/components/rail/rail.css'));
const sidebarCss = stripComments(read('src/app/components/sidebar/sidebar.css'));

interface Rule {
  selectors: string[];
  body: string;
}

function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
    body: match[2],
  }));
}

/** `@media` blocks (here only prefers-reduced-motion overrides) must not leak into the base style of a selector. */
const MEDIA_BLOCK = /@media\s*\(prefers-reduced-motion: reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
const withoutMedia = (css: string): string => css.replace(MEDIA_BLOCK, '');

const rail = rulesOf(withoutMedia(railCss));
const sidebar = rulesOf(withoutMedia(sidebarCss));
/** The rules inside the prefers-reduced-motion blocks of a stylesheet. */
const reducedMotion = (css: string): Rule[] => rulesOf([...css.matchAll(MEDIA_BLOCK)].map((match) => match[1]).join('\n'));

/** Declarations of every rule that lists `selector` exactly, merged in source order (later ones win). */
function style(rules: Rule[], selector: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [, property, value] of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/gi)) merged.set(property.toLowerCase(), value.trim().replace(/\s+/g, ' '));
  }
  if (merged.size === 0) throw new Error(`no rule for ${selector}`);
  return merged;
}

const themeValue = (name: string): string | undefined => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(theme)?.[1].trim();

describe('stylesheets only use tokens', () => {
  it.each([
    ['rail.css', railCss],
    ['sidebar.css', sidebarCss],
  ])('%s: every var(--x) without a fallback is defined in theme.css or in the file itself', (_name, css) => {
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
    const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((match) => match[1]));
    const missing = [...used].filter((name) => !themeValue(name) && !local.has(name));
    expect(missing).toEqual([]);
  });

  it('hard-codes no colour except the rail separator of the visual spec', () => {
    const literals = (css: string): string[] => [...css.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)].map((match) => match[0].toLowerCase());
    expect(literals(sidebarCss)).toEqual([]);
    expect(literals(railCss)).toEqual(['#35363c']);
    expect(railCss).toMatch(/--rail-separator:\s*#35363c/);
  });

  it('puts every rule of the rail and the sidebar behind a prefixed class (no element or global selectors)', () => {
    for (const rule of [...rail, ...sidebar]) {
      for (const selector of rule.selectors) {
        if (/^(from|to|[0-9.]+%)$/.test(selector)) continue; // keyframe steps
        expect(selector, selector).toMatch(/^\.(app-rail|rail|rail-tooltip|sb)[a-z_-]*/);
      }
    }
  });

  it('respects reduced motion', () => {
    const railReduced = reducedMotion(railCss);
    const sidebarReduced = reducedMotion(sidebarCss);
    expect(style(railReduced, '.rail-tooltip').get('animation')).toBe('none');
    for (const selector of ['.rail__icon', '.rail__acronym', '.rail__pill']) expect(style(railReduced, selector).get('transition'), selector).toBe('none');
    expect(style(sidebarReduced, '.sb-skeleton__bar').get('animation')).toBe('none');
    expect(style(sidebarReduced, '.sb-category__chevron').get('transition')).toBe('none');
  });
});

describe('server rail', () => {
  it('has no scrollbar and leaves the size to the shell layout', () => {
    const rootStyle = style(rail, '.app-rail');
    expect(rootStyle.get('scrollbar-width')).toBe('none');
    expect(style(rail, '.app-rail::-webkit-scrollbar').get('display')).toBe('none');
    for (const property of ['width', 'min-width', 'max-width', 'height', 'background', 'overflow', 'overflow-y', 'grid-area']) expect(rootStyle.has(property), property).toBe(false);
    expect(rootStyle.get('padding')).toBe('12px 0');
    expect(rootStyle.get('gap')).toBe('8px');
    expect(themeValue('--rail-width')).toBe('72px');
  });

  it('icons are 48px circles that become 16px-radius rounded squares on hover, focus and when open', () => {
    expect(style(rail, '.app-rail').get('--rail-item-size')).toBe('48px');
    expect(style(rail, '.rail__item').get('width')).toBe('var(--rail-item-size)');
    expect(style(rail, '.rail__item').get('height')).toBe('var(--rail-item-size)');
    const icon = style(rail, '.rail__icon');
    expect(icon.get('border-radius')).toBe('50%');
    expect(icon.get('background')).toBe('var(--bg-primary)');
    expect(icon.get('transition')).toMatch(/border-radius 0\.15s/);
    for (const selector of ['.rail__item:hover .rail__icon', '.rail__item--active .rail__icon', '.rail__icon:focus-visible']) {
      expect(style(rail, selector).get('border-radius'), selector).toBe('var(--radius-lg)');
    }
    expect(themeValue('--radius-lg')).toBe('16px');
    expect(style(rail, '.rail__img').get('object-fit')).toBe('cover');
  });

  it('acronym and home icon turn brand blue with white text on hover and when open', () => {
    const acronym = style(rail, '.rail__acronym');
    expect(acronym.get('background')).toBe('var(--bg-primary)');
    expect(acronym.get('color')).toBe('var(--text-normal)');
    for (const selector of ['.rail__item:hover .rail__acronym', '.rail__item--active .rail__acronym', '.rail__item:hover .rail__icon--home', '.rail__item--active .rail__icon--home']) {
      const rule = style(rail, selector);
      expect(rule.get('background'), selector).toBe('var(--brand)');
      expect(rule.get('color'), selector).toBe('var(--on-brand)');
    }
    expect(style(rail, ".rail__acronym[data-glyphs='3']").get('font-size')).toBe('14px');
    expect(style(rail, ".rail__acronym[data-glyphs='4']").get('font-size')).toBe('12px');
  });

  it('the white pill: 4px wide, hidden, 20px on hover, 40px when open, animated', () => {
    const pill = style(rail, '.rail__pill');
    expect(pill.get('width')).toBe('4px');
    expect(pill.get('height')).toBe('0');
    expect(pill.get('border-radius')).toBe('0 4px 4px 0');
    expect(pill.get('background')).toBe('var(--interactive-active)');
    expect(pill.get('transition')).toMatch(/height 0\.15s/);
    expect(themeValue('--interactive-active')).toBe('#ffffff');
    expect(style(rail, '.rail__item:hover .rail__pill').get('height')).toBe('20px');
    expect(style(rail, '.rail__item--active .rail__pill').get('height')).toBe('40px');
    // It sits on the rail's left edge: (72px - 48px) / 2 to the left of the centred icon.
    expect(pill.get('left')).toBe('calc((var(--rail-width) - var(--rail-item-size)) / -2)');
  });

  it('separator: 32 x 2px, 1px radius', () => {
    const separator = style(rail, '.rail__separator');
    expect(separator.get('width')).toBe('32px');
    expect(separator.get('height')).toBe('2px');
    expect(separator.get('border-radius')).toBe('1px');
    expect(separator.get('background')).toBe('var(--rail-separator)');
  });

  it('count badge: bottom right, min 16px, brand, white 12px bold, 2px ring in the rail colour', () => {
    const badge = style(rail, '.rail__badge');
    expect(badge.get('right')).toBe('-4px');
    expect(badge.get('bottom')).toBe('-4px');
    expect(badge.get('min-width')).toBe('16px');
    expect(badge.get('background')).toBe('var(--brand)');
    expect(badge.get('color')).toBe('var(--on-brand)');
    expect(badge.get('font-size')).toBe('12px');
    expect(badge.get('font-weight')).toBe('700');
    expect(badge.get('box-shadow')).toBe('0 0 0 2px var(--bg-tertiary)');
  });

  it('corner checkbox sits at the top left of the icon and is readable on any icon', () => {
    const check = style(rail, '.rail__check');
    expect(check.get('position')).toBe('absolute');
    expect(check.get('top')).toBe('-4px');
    expect(check.get('left')).toBe('-4px');
    expect(style(rail, ".rail__check[data-state='none']").get('background')).toBe('var(--bg-tertiary)');
  });

  it('tooltip: fixed, floating colours, 14px / 600, padding 8px 12px, radius 5px, left-pointing arrow', () => {
    const tooltip = style(rail, '.rail-tooltip');
    expect(tooltip.get('position')).toBe('fixed');
    expect(tooltip.get('z-index')).toBe('var(--z-tooltip)');
    expect(tooltip.get('background')).toBe('var(--bg-floating)');
    expect(themeValue('--bg-floating')).toBe('#111214');
    expect(tooltip.get('color')).toBe('var(--text-normal)');
    expect(tooltip.get('font-size')).toBe('14px');
    expect(tooltip.get('font-weight')).toBe('600');
    expect(tooltip.get('padding')).toBe('8px 12px');
    expect(tooltip.get('border-radius')).toBe('5px');
    expect(tooltip.get('pointer-events')).toBe('none');
    const arrow = style(rail, '.rail-tooltip::before');
    expect(arrow.get('border-color')).toBe('transparent var(--bg-floating) transparent transparent');
    expect(arrow.get('left')).toBe('-5px');
  });
});

describe('sidebar', () => {
  it('does not size itself (layout.css owns width, grid area and background)', () => {
    expect(sidebar.flatMap((rule) => rule.selectors).filter((selector) => selector === '.app-sidebar' || selector.startsWith('.app-sidebar '))).toEqual([]);
  });

  it('top strips are 48px high with the header shadow', () => {
    for (const selector of ['.sb-search', '.sb-guild-header']) {
      const strip = style(sidebar, selector);
      expect(strip.get('flex'), selector).toBe('0 0 48px');
      expect(strip.get('box-shadow'), selector).toBe('var(--shadow-header)');
    }
    expect(style(sidebar, '.sb-guild-header__name').get('font-size')).toBe('16px');
    expect(style(sidebar, '.sb-guild-header__name').get('font-weight')).toBe('600');
    expect(style(sidebar, '.sb-guild-header__name').get('text-overflow')).toBe('ellipsis');
  });

  it('DM filter field: 28px high, tertiary background, 4px radius', () => {
    const field = style(sidebar, '.sb-search__field');
    expect(field.get('height')).toBe('28px');
    expect(field.get('background')).toBe('var(--bg-tertiary)');
    expect(field.get('border-radius')).toBe('var(--radius-sm)');
    expect(themeValue('--radius-sm')).toBe('4px');
  });

  it('DM section heading is 12px / 600 uppercase muted', () => {
    const heading = style(sidebar, '.sb-section');
    expect(heading.get('font-size')).toBe('12px');
    expect(heading.get('font-weight')).toBe('600');
    expect(heading.get('text-transform')).toBe('uppercase');
    expect(heading.get('color')).toBe('var(--text-muted)');
  });

  it('DM rows: 42px, 32px round avatar, 16px / 500 name, 12px muted subline', () => {
    expect(style(sidebar, '.sb-dm__main').get('height')).toBe('42px');
    const avatar = style(sidebar, '.sb-dm__avatar');
    expect(avatar.get('width')).toBe('32px');
    expect(avatar.get('height')).toBe('32px');
    expect(avatar.get('border-radius')).toBe('50%');
    const name = style(sidebar, '.sb-dm__name');
    expect(name.get('font-size')).toBe('16px');
    expect(name.get('font-weight')).toBe('500');
    const sub = style(sidebar, '.sb-dm__sub');
    expect(sub.get('font-size')).toBe('12px');
    expect(sub.get('color')).toBe('var(--text-muted)');
    expect(style(sidebar, '.sb-dm').get('content-visibility')).toBe('auto');
  });

  it('rows: radius 4px, hover and selected backgrounds, white text for the open channel', () => {
    const row = style(sidebar, '.sb-row');
    expect(row.get('margin')).toBe('0 8px');
    expect(row.get('border-radius')).toBe('var(--radius-sm)');
    expect(style(sidebar, '.sb-row:hover').get('background')).toBe('var(--bg-modifier-hover)');
    expect(style(sidebar, '.sb-row--active').get('background')).toBe('var(--bg-modifier-selected)');
    expect(style(sidebar, '.sb-row--active:hover').get('background')).toBe('var(--bg-modifier-selected)');
    expect(style(sidebar, '.sb-channel.sb-row--active .sb-channel__main').get('color')).toBe('var(--interactive-active)');
    expect(style(sidebar, '.sb-dm.sb-row--active .sb-dm__name').get('color')).toBe('var(--text-header)');
  });

  it('channel rows: 32px, 1px vertical margin, 20px icon in the channel-icon colour, 16px / 500 name', () => {
    const main = style(sidebar, '.sb-channel__main');
    expect(main.get('height')).toBe('32px');
    expect(main.get('color')).toBe('var(--channel-icon)');
    expect(main.get('font-size')).toBe('16px');
    expect(main.get('font-weight')).toBe('500');
    expect(style(sidebar, '.sb-channel').get('margin-top')).toBe('1px');
    expect(style(sidebar, '.sb-channel').get('margin-bottom')).toBe('1px');
    expect(style(sidebar, '.sb-channel__icon').get('font-size')).toBe('20px');
    expect(style(sidebar, '.sb-channel:hover .sb-channel__main').get('color')).toBe('var(--text-normal)');
    expect(themeValue('--channel-icon')).toBe('#80848e');
  });

  it('locked rows are dimmed to 50%', () => {
    expect(style(sidebar, '.sb-channel--locked .sb-channel__main').get('opacity')).toBe('0.5');
    expect(style(sidebar, '.sb-dm.sb-row--locked .sb-dm__main').get('opacity')).toBe('0.5');
  });

  it('threads are indented', () => {
    expect(style(sidebar, '.sb-channel--thread').get('margin-left')).toBe('32px');
  });

  it('category header: 24px high, 16px above, 12px / 600 uppercase muted, brighter on hover, chevron turns when folded', () => {
    expect(style(sidebar, '.sb-category').get('padding')).toBe('16px 8px 0');
    const main = style(sidebar, '.sb-category__main');
    expect(main.get('height')).toBe('24px');
    expect(main.get('font-size')).toBe('12px');
    expect(main.get('font-weight')).toBe('600');
    expect(main.get('text-transform')).toBe('uppercase');
    expect(main.get('color')).toBe('var(--text-muted)');
    expect(style(sidebar, '.sb-category__main:hover').get('color')).toBe('var(--interactive-hover)');
    expect(style(sidebar, '.sb-category--collapsed .sb-category__chevron').get('transform')).toBe('rotate(-90deg)');
    expect(style(sidebar, '.sb-category__chevron').get('transition')).toMatch(/transform/);
  });

  it('the scroll area is the only scroller and the skeleton shimmers', () => {
    const scroll = style(sidebar, '.sb-scroll');
    expect(scroll.get('overflow-y')).toBe('auto');
    expect(scroll.get('flex')).toBe('1 1 0');
    expect(scroll.get('min-height')).toBe('0');
    expect(style(sidebar, '.sb-skeleton__bar').get('animation')).toMatch(/sb-shimmer/);
    expect(sidebarCss).toMatch(/@keyframes sb-shimmer/);
  });

  it('keyboard focus rings are drawn inside the rows (the list would clip them)', () => {
    expect(style(sidebar, '.sb-row__main:focus-visible').get('outline-offset')).toBe('-2px');
  });
});
