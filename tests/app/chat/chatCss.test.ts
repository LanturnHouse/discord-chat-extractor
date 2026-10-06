import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const chatDir = join(root, 'src/app/components/chat');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(read('src/app/components/chat/chat.css'));
const theme = stripComments(read('src/app/styles/theme.css'));
const message = stripComments(read('src/app/styles/message.css'));

/** The declarations of every rule whose selector list contains exactly this selector, joined. */
function rule(selector: string, source: string = css): string {
  const blocks: string[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) blocks.push(match[2]);
  }
  if (blocks.length === 0) throw new Error(`no rule for ${selector}`);
  return blocks.join('\n');
}

describe('chat.css uses the design tokens', () => {
  const declared = (source: string): Set<string> => new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const themeTokens = declared(theme);
  const localTokens = declared(css);

  it('every custom property it reads exists in theme.css or is declared in chat.css', () => {
    const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((match) => match[1]));
    expect([...used].filter((name) => !themeTokens.has(name) && !localTokens.has(name))).toEqual([]);
  });

  it('hard-codes only the one colour that is not a token (the channel icon circle of the welcome header)', () => {
    const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)].map((match) => match[0].toLowerCase());
    expect(literals).toEqual(['#41434a']);
    expect(rule('.chat-start')).toContain('--chat-start-icon-bg: #41434a');
  });

  it('prefixes every class with chat-', () => {
    const classes = [...css.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((match) => match[1]);
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.filter((name) => !name.startsWith('chat-'))).toEqual([]);
  });

  it('every chat- class in the stylesheet is used by a component, and every one a component uses is styled', () => {
    const sources = readdirSync(chatDir)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => readFileSync(join(chatDir, file), 'utf8'))
      .join('\n');
    const styled = new Set([...css.matchAll(/\.(chat-[a-z0-9_-]+)/g)].map((match) => match[1]));
    const used = new Set([...sources.matchAll(/["'` ](chat-[a-z0-9_-]+)/g)].map((match) => match[1]));
    expect([...styled].filter((name) => !used.has(name))).toEqual([]);
    expect([...used].filter((name) => !styled.has(name))).toEqual([]);
  });
});

describe('the list does not defeat content-visibility on the message rows', () => {
  it('message rows skip off-screen layout and paint (the rule the list relies on)', () => {
    expect(rule('.msg', message)).toMatch(/content-visibility:\s*auto/);
    expect(rule('.msg', message)).toMatch(/contain-intrinsic-size:\s*auto\b/);
  });

  it('nothing in chat.css sets will-change, contain or content-visibility', () => {
    expect(css).not.toMatch(/will-change\s*:/);
    expect(css).not.toMatch(/(^|[;{\s])contain\s*:/);
    expect(css).not.toMatch(/content-visibility\s*:/);
  });

  it('the scroller and its ancestors have no transform / filter / perspective', () => {
    for (const selector of ['.chat-frame', '.chat-list', '.chat-list__content']) {
      expect(rule(selector), selector).not.toMatch(/\b(transform|filter|perspective|backdrop-filter)\s*:/);
    }
  });

  it('leaves native scroll anchoring on: rows that render their real height while scrolling up are corrected by the browser', () => {
    expect(css).not.toMatch(/overflow-anchor\s*:\s*none/);
  });

  it('is one scroll container with the thin global scrollbar (no scrollbar-width override that would disable it)', () => {
    const list = rule('.chat-list');
    expect(list).toMatch(/overflow-y:\s*auto/);
    expect(list).toMatch(/min-height:\s*0/);
    expect(css).not.toMatch(/scrollbar-(width|color)\s*:/);
  });

  it('short channels sit at the bottom (flex column + margin-top: auto on the content, not justify-content, which breaks scrolling)', () => {
    expect(rule('.chat-list')).toMatch(/flex-direction:\s*column/);
    expect(rule('.chat-list__content')).toMatch(/margin-top:\s*auto/);
    expect(css).not.toMatch(/justify-content:\s*flex-end/);
  });

  it('the loader / error pill is zero-height and sticky, so it never moves a row', () => {
    const host = rule('.chat-list__status');
    expect(host).toMatch(/position:\s*sticky/);
    expect(host).toMatch(/height:\s*0/);
    expect(host).toMatch(/justify-content:\s*center/);
    expect(rule('.chat-pill')).toMatch(/position:\s*absolute/);
  });

  it('the keyboard focus ring is drawn inside the scroller (the shell clips outside)', () => {
    expect(rule('.chat-list:focus-visible')).toMatch(/outline-offset:\s*-2px/);
  });
});

describe('visual spec', () => {
  it('welcome header: 68px circle, 80px DM avatar, 32px / 700 title, 16px muted text', () => {
    expect(rule('.chat-start__icon')).toMatch(/width:\s*68px/);
    expect(rule('.chat-start__icon')).toMatch(/height:\s*68px/);
    expect(rule('.chat-start__avatar')).toMatch(/width:\s*80px/);
    expect(rule('.chat-start__title')).toMatch(/font-size:\s*32px/);
    expect(rule('.chat-start__title')).toMatch(/font-weight:\s*700/);
    expect(rule('.chat-start__text')).toMatch(/font-size:\s*16px/);
    expect(rule('.chat-start__text')).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it('jump button: floating at the bottom right in the brand colour', () => {
    const jump = rule('.chat-jump');
    expect(jump).toMatch(/position:\s*absolute/);
    expect(jump).toMatch(/right:\s*\d+px/);
    expect(jump).toMatch(/bottom:\s*\d+px/);
    expect(jump).toMatch(/background:\s*var\(--brand\)/);
    expect(rule('.chat-jump:hover')).toMatch(/var\(--brand-hover\)/);
  });

  it('skeleton bars shimmer with token colours', () => {
    const bars = rule('.chat-skeleton__bar');
    expect(bars).toMatch(/animation:\s*chat-shimmer/);
    expect(bars).toMatch(/var\(--bg-modifier-hover\)/);
    expect(css).toMatch(/@keyframes chat-shimmer/);
  });
});

describe('reduced motion', () => {
  it('stops every animation of the pane', () => {
    const animated = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation\s*:\s*(?!\s)(?!none)[^;]*;[^{}]*\}/g)].flatMap((match) => match[1].split(',').map((selector) => selector.trim()));
    expect(animated.sort()).toEqual(['.chat-jump', '.chat-skeleton__avatar', '.chat-skeleton__bar'].sort());

    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const selector of animated) expect(block, selector).toContain(selector);
    expect(block).toMatch(/animation:\s*none/);
  });
});
