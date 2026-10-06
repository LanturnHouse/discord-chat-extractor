import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--name: value;` declarations of a stylesheet. */
function declarations(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map.set(match[1], match[2].trim());
  return map;
}

/** `rgba(78,80,88,.3)` and `rgba(78, 80, 88, 0.3)` are the same colour; so are `#DBDEE1` and `#dbdee1`. */
const normalise = (value: string): string => value.toLowerCase().replace(/\s+/g, '').replace(/(?<![0-9])0\./g, '.').replace(/["']/g, '');

const theme = declarations(read('src/app/styles/theme.css'));

describe('theme.css', () => {
  it('defines every token of the visual spec in docs/ARCHITECTURE.md with the documented value', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    const tokenLine = architecture.split('\n').find((line) => line.startsWith('Tokens:'));
    expect(tokenLine).toBeDefined();
    const documented = [...(tokenLine ?? '').matchAll(/`(--[a-z-]+) ([^`]+)`/g)].map((m) => [m[1], m[2]] as const);
    expect(documented.length).toBeGreaterThanOrEqual(19);

    for (const [name, value] of documented) {
      expect(theme.has(name), `${name} is missing`).toBe(true);
      expect(normalise(theme.get(name) ?? ''), name).toBe(normalise(value));
    }
  });

  it('uses the documented font stacks', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    const sans = /Font: `([^`]+)`/.exec(architecture)?.[1] ?? '';
    const mono = /code: `([^`]+)`/.exec(architecture)?.[1] ?? '';
    expect(normalise(theme.get('--font-sans') ?? '')).toBe(normalise(sans));
    expect(normalise(theme.get('--font-mono') ?? '')).toBe(normalise(mono));
  });

  it('defines the layout metrics, the stacking scale and the scrollbar colours', () => {
    expect(theme.get('--rail-width')).toBe('72px');
    expect(theme.get('--sidebar-width')).toBe('240px');
    expect(theme.get('--topbar-height')).toBe('48px');
    expect(theme.get('--min-app-width')).toBe('900px');
    expect(theme.get('--scrollbar-thumb')?.toLowerCase()).toBe('#1a1b1e');
    expect(theme.get('--scrollbar-track')).toBe('transparent');

    const levels = ['--z-base', '--z-sticky', '--z-dropdown', '--z-popover', '--z-modal', '--z-toast', '--z-tooltip'].map((name) => Number(theme.get(name)));
    expect(levels.every((level) => Number.isFinite(level))).toBe(true);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    for (const name of ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--shadow-header', '--shadow-high', '--on-brand', '--bg-floating']) {
      expect(theme.has(name), name).toBe(true);
    }
  });

  it('is dark only and tells the browser so (no white native widgets)', () => {
    expect(stripComments(read('src/app/styles/theme.css'))).toMatch(/color-scheme:\s*dark/);
    expect(read('app.html')).toContain('<meta name="color-scheme" content="dark"');
  });
});

describe('base.css', () => {
  const base = stripComments(read('src/app/styles/base.css'));

  it('sets the body background, colour and 16px font from the tokens', () => {
    const body = /\nbody\s*\{([^}]*)\}/.exec(base)?.[1] ?? '';
    expect(body).toContain('background: var(--bg-primary)');
    expect(body).toContain('color: var(--text-normal)');
    expect(body).toContain('font-family: var(--font-sans)');
    expect(body).toContain('font-size: 16px');
  });

  it('draws thin scrollbars from the tokens (6px thumb on a transparent track)', () => {
    expect(base).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
    expect(base).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scrollbar-thumb\)/);
    expect(base).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*var\(--scrollbar-track\)/);
  });

  it('keeps a visible 2px brand focus ring for the keyboard', () => {
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
    expect(theme.get('--focus-ring')).toBe('var(--brand)');
  });

  it('resets buttons, styles the selection and has a visually-hidden utility', () => {
    expect(base).toMatch(/button\s*\{[^}]*border:\s*0/);
    expect(base).toMatch(/::selection\s*\{/);
    expect(base).toMatch(/\.visually-hidden\s*\{[^}]*position:\s*absolute/);
    expect(base).toMatch(/\.visually-hidden\s*\{[^}]*clip/);
  });
});

describe('layout.css', () => {
  const layout = stripComments(read('src/app/styles/layout.css'));

  it('fills the viewport', () => {
    expect(layout).toMatch(/#root\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh/);
    expect(layout).toMatch(/#root\s*\{[^}]*min-width:\s*var\(--min-app-width\)/);
  });

  it('is a 3-column grid: rail / sidebar / main', () => {
    const shell = /\.app-shell\s*\{([^}]*)\}/.exec(layout)?.[1] ?? '';
    expect(shell).toContain('display: grid');
    expect(shell).toMatch(/grid-template-columns:\s*var\(--rail-width\)\s+var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)/);
    expect(shell).toMatch(/grid-template-areas:\s*'rail sidebar main'/);
    for (const area of ['rail', 'sidebar', 'main']) expect(layout).toMatch(new RegExp(`\\.app-${area}\\s*\\{[^}]*grid-area:\\s*${area}`));
  });

  it('main is a column: top bar of fixed height, then a chat area that can shrink', () => {
    expect(layout).toMatch(/\.app-main\s*\{[^}]*flex-direction:\s*column/);
    expect(layout).toMatch(/\.app-topbar\s*\{[^}]*flex:\s*0 0 var\(--topbar-height\)/);
    expect(layout).toMatch(/\.app-chat\s*\{[^}]*flex:\s*1 1 0/);
    expect(layout).toMatch(/\.app-chat\s*\{[^}]*min-height:\s*0/);
  });
});

describe('every custom property used by the app core exists in theme.css', () => {
  const owned = [
    'src/app/styles/base.css',
    'src/app/styles/layout.css',
    'src/app/styles/markdown.css',
    'src/app/components/common/common.css',
    'src/app/components/Onboarding.css',
  ];

  it.each(owned)('%s', (file) => {
    const css = stripComments(read(file));
    const local = declarations(css);
    // Only references without a fallback must resolve: `var(--x, 20px)` is how components read values set by their parent.
    const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]));
    expect([...used].filter((name) => !theme.has(name) && !local.has(name))).toEqual([]);
  });

  it('theme.css tokens that reference other tokens resolve', () => {
    for (const [name, value] of theme) {
      for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) expect(theme.has(match[1]), `${name} -> ${match[1]}`).toBe(true);
    }
  });
});

describe('main.tsx', () => {
  it('imports the global stylesheets before the app (so component CSS wins the cascade)', () => {
    const main = read('src/app/main.tsx');
    const order = ['./styles/theme.css', './styles/base.css', './styles/layout.css', './styles/markdown.css', './App'].map((spec) => main.indexOf(`'${spec}'`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
