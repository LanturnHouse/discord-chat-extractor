// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageItem, type MessageRenderContext } from '@/app/components/message';
import { createMockClient, MOCK_IDS } from '@/lib/discord/mock';
import { fetchMessagePage } from '@/lib/discord/pagination';
import { buildNameResolver } from '@/lib/message';

afterEach(cleanup);

// Resolved from this file, not from the working directory (vitest may be started with another --root). `import.meta.url`
// is used as a string because jsdom's URL cannot resolve against it.
const CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/app/styles/message.css');
const cssSource = readFileSync(CSS_PATH, 'utf8');
const cssWithoutComments = cssSource.replace(/\/\*[^]*?\*\//g, '');

/** Custom properties of docs/ARCHITECTURE.md (visual spec); component-local ones use the `--msg-` prefix. */
const THEME_TOKENS = new Set([
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-message-hover',
  '--text-normal',
  '--text-header',
  '--text-muted',
  '--channel-icon',
  '--interactive-normal',
  '--interactive-hover',
  '--brand',
  '--brand-hover',
  '--link',
  '--divider',
  '--danger',
  '--bg-modifier-hover',
  '--bg-modifier-selected',
  '--code-bg',
  '--embed-bg',
]);

interface Rule {
  selector: string;
  declarations: Map<string, string>;
}

const rules: Rule[] = [];
for (const match of cssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const declarations = new Map<string, string>();
  for (const declaration of match[2]!.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim().replace(/\s+/g, ' '));
  }
  rules.push({ selector: match[1]!.trim().replace(/\s+/g, ' '), declarations });
}

/** Declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): Map<string, string> {
  const found = rules.find((r) => r.selector === selector);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found.declarations;
}

/** Specificity as one number: classes, attributes and pseudo-classes count 100 each, element names 1 (enough to compare two rules). */
function specificity(selector: string): number {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
  const types = (selector.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
  return classes * 100 + types;
}

describe('message.css', () => {
  it('scopes every selector under a .msg class so it can be embedded in an export', () => {
    expect(rules.length).toBeGreaterThan(100);
    for (const { selector } of rules) {
      if (selector.startsWith('@')) continue;
      for (const single of selector.split(',')) {
        expect(single.trim(), `selector "${single.trim()}"`).toMatch(/\.msg[\w-]*/);
      }
    }
  });

  it('only uses theme tokens of the visual spec and always gives them a literal fallback', () => {
    const usages = [...cssWithoutComments.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)];
    expect(usages.length).toBeGreaterThan(40);
    for (const [, name, next] of usages) {
      expect(THEME_TOKENS.has(name!) || name!.startsWith('--msg-'), name).toBe(true);
      // `--msg-*` are defined by `.msg` itself, so only the app's theme tokens need a fallback.
      if (THEME_TOKENS.has(name!)) expect(next, `${name} has a fallback`).toBe(',');
    }
  });

  it('keeps off-screen rows cheap without breaking scroll anchoring', () => {
    const row = rule('.msg');
    expect(row.get('content-visibility')).toBe('auto');
    expect(row.get('contain-intrinsic-size')).toBe('auto 60px');
  });

  it('follows the cozy layout metrics of the visual spec', () => {
    expect(rule('.msg').get('padding')).toBe('2px 48px 2px 72px');
    expect(rule('.msg--first').get('margin-top')).toBe('1.0625rem');
    expect(rule('.msg:hover, .msg:focus-within').get('background-color')).toBe('var(--bg-message-hover, #2e3035)');

    const avatar = rule('.msg-avatar');
    expect([avatar.get('left'), avatar.get('width'), avatar.get('height'), avatar.get('border-radius')]).toEqual(['16px', '40px', '40px', '50%']);

    const author = rule('.msg-author');
    expect([author.get('font-size'), author.get('font-weight')]).toEqual(['1rem', '500']);
    const timestamp = rule('.msg-timestamp');
    expect(timestamp.get('font-size')).toBe('0.75rem');
    expect(timestamp.get('color')).toBe('var(--text-muted, #949ba4)');
  });

  it('draws the reply connector as an L-shaped 2px line', () => {
    const connector = rule('.msg-reply::before');
    expect(connector.get('border-top')).toBe('2px solid #4e5058');
    expect(connector.get('border-left')).toBe('2px solid #4e5058');
    expect(connector.get('border-top-left-radius')).toBeDefined();
    expect(rule('.msg-reply__avatar').get('width')).toBe('16px');
  });

  it('styles embeds, reactions and the day divider like Discord', () => {
    const embed = rule('.msg-embed');
    expect(embed.get('max-width')).toBe('min(520px, 100%)');
    expect(embed.get('padding')).toBe('8px 16px 16px');
    expect(embed.get('border-left')).toMatch(/^4px solid /);
    expect(embed.get('border-radius')).toBe('4px');
    expect(embed.get('background')).toBe('var(--embed-bg, #2b2d31)');

    const grid = rule('.msg-embed__fields');
    expect(grid.get('display')).toBe('grid');
    expect(grid.get('grid-template-columns')).toBe('repeat(12, minmax(0, 1fr))');
    expect(rule('.msg-embed__field--col2').get('grid-column')).toBe('5 / 9');

    const pill = rule('.msg-reaction');
    expect(pill.get('border')).toBe('1px solid transparent');
    expect(pill.get('border-radius')).toBe('8px');
    expect(pill.get('background')).toBe('var(--bg-secondary, #2b2d31)');
    const mine = rule('.msg-reaction--me');
    expect(mine.get('background')).toBe('rgba(88, 101, 242, 0.15)');
    expect(mine.get('border-color')).toBe('var(--brand, #5865f2)');

    expect(rule('.msg-day-divider').get('border-top')).toBe('1px solid var(--divider, #3f4147)');
    expect(rule('.msg-day-divider__label').get('background')).toBe('var(--bg-primary, #313338)');
  });

  it('keeps the keyboard focus ring visible where a frame clips it', () => {
    const ring = 2 + 2; // width + offset of `.msg a:focus-visible`
    const generic = '.msg a:focus-visible, .msg button:focus-visible, .msg video:focus-visible, .msg audio:focus-visible';
    expect(rule(generic).get('outline-offset')).toBe('2px');

    // The row clips its paint at its own edge (content-visibility): without the margin a link or picture at its very top or
    // bottom (a bare image embed is the last thing in its row) loses that edge of the ring.
    expect(parseFloat(rule('.msg').get('overflow-clip-margin') ?? '0')).toBeGreaterThanOrEqual(ring);

    // The picture and video frames clip with overflow: hidden (which also keeps the blur of a hidden spoiler inside), so the
    // ring of what sits in a frame is drawn inside it.
    expect(rule('.msg-attachment--image, .msg-attachment--video').get('overflow')).toBe('hidden');
    const selectors = ['.msg .msg-image-link:focus-visible', '.msg .msg-image:focus-visible', '.msg .msg-video:focus-visible', '.msg .msg-spoiler-cover:focus-visible'];
    expect(rule(selectors.join(', ')).get('outline-offset')).toBe('-2px');
    for (const selector of selectors) expect(specificity(selector), selector).toBeGreaterThan(specificity('.msg button:focus-visible'));
  });

  it('respects reduced motion', () => {
    expect(cssWithoutComments).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('documents every class that the view renders (the DOM contract of the HTML exporter)', async () => {
    const page = await fetchMessagePage(createMockClient({ latencyMs: 0 }), MOCK_IDS.showcaseChannel, { size: 1000 });
    const names = buildNameResolver();
    names.addMessages(page.messages);

    const classes = new Set<string>();
    for (const locale of ['ko', 'en'] as const) {
      const ctx: MessageRenderContext = { locale, timeZone: 'Asia/Seoul', names };
      const { container, unmount } = render(
        <div>
          {page.messages.map((message, index) => (
            <MessageItem key={message.id} message={message} prev={page.messages[index - 1]} ctx={ctx} />
          ))}
        </div>,
      );
      for (const element of Array.from(container.querySelectorAll('[class]'))) {
        for (const name of Array.from(element.classList)) if (name.startsWith('msg')) classes.add(name);
      }
      unmount();
    }

    expect(classes.size).toBeGreaterThan(80);
    // `msg-embed--<type>` and `msg-avatar-fallback--<n>` are listed as families in the contract.
    const documented = (name: string): boolean => cssSource.includes(name) || /^msg-embed--[a-z_]+$/.test(name);
    expect([...classes].filter((name) => !documented(name))).toEqual([]);
  });
});
