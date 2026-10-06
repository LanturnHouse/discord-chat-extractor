import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declarationsOf, readCss, rulesOf } from './cssTools';

/*
 * Forced colours (Windows contrast themes) replace every colour and drop shadows, so states that are told by a background
 * colour alone need a border, an outline or the Highlight pair. jsdom cannot emulate the media feature, so the stylesheet is
 * checked as text here; the real rendering was checked in Chrome with `Emulation.setEmulatedMedia` (forced-colors: active).
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SHEET = 'src/app/styles/forced-colors.css';

/** The rules inside the `@media (forced-colors: active)` block (brace-balanced; the sheet has exactly one). */
function forcedRules(): ReturnType<typeof rulesOf> {
  const css = readCss(SHEET);
  const start = css.indexOf('@media (forced-colors: active) {');
  if (start < 0) throw new Error('no forced-colors block');
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return rulesOf(css.slice(css.indexOf('{', start) + 1, index));
  }
  throw new Error('unbalanced forced-colors block');
}

const rules = forcedRules();
const style = (selector: string): Map<string, string> => declarationsOf(rules, selector);

const SYSTEM_COLOURS = new Set(['canvas', 'canvastext', 'buttontext', 'buttonface', 'highlight', 'highlighttext', 'linktext', 'graytext']);

describe('forced-colors.css', () => {
  it('only uses system colours (the browser keeps those, and replaces everything else)', () => {
    const colourProperties = ['color', 'background-color', 'border-color', 'outline-color'];
    for (const rule of rules) {
      for (const [, property, value] of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/gi)) {
        if (colourProperties.includes(property)) expect(SYSTEM_COLOURS.has(value.trim().toLowerCase()), `${rule.selectors[0]} ${property}: ${value}`).toBe(true);
        if (property === 'border' || property === 'outline') {
          const colour = value.trim().split(/\s+/).pop() ?? '';
          expect(SYSTEM_COLOURS.has(colour.toLowerCase()), `${rule.selectors[0]} ${property}: ${value}`).toBe(true);
        }
      }
    }
  });

  it('keeps the white pill of the open server and frames its icon', () => {
    expect(style('.rail__pill').get('background-color')).toBe('CanvasText');
    expect(style('.rail__item--active .rail__icon').get('border')).toBe('2px solid Highlight');
  });

  it('frames the open channel row; the focus ring (an outline on the button inside) is left alone', () => {
    expect(style('.sb-row--active').get('outline')).toBe('2px solid Highlight');
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (selector.includes('focus')) expect(rule.body, selector).not.toMatch(/outline/);
      }
    }
  });

  it('draws a ticked checkbox filled, the unticked one stays an empty frame', () => {
    const ticked = style(".dce-checkbox[data-state='all']");
    expect(ticked.get('background-color')).toBe('Highlight');
    expect(ticked.get('color')).toBe('HighlightText');
    expect(style(".dce-checkbox[data-state='some']").get('background-color')).toBe('Highlight');
    // The hover rule of the component is more specific than the plain state: the override has to match it.
    expect(style(".dce-checkbox[data-state='all']:hover:not(:disabled)").get('background-color')).toBe('Highlight');
  });

  it('gives fill-only buttons and chips a border', () => {
    for (const selector of ['.dce-button:not(.dce-button--link)', '.chat-jump', '.topbar__split', '.topbar__chip']) {
      expect(style(selector).get('border'), selector).toBe('1px solid ButtonText');
    }
    expect(style('.topbar-radio--segmented').get('border')).toBe('1px solid ButtonText');
    expect(style('.chat-pill').get('border')).toBe('1px solid CanvasText');
  });

  it('frames the export dialog and the cards that are told apart by a shadow only (a shadow is dropped, the dimmed page would swallow the edge)', () => {
    for (const selector of ['.topbar-dialog', '.app-fatal', '.onboarding__card']) expect(style(selector).get('border'), selector).toBe('1px solid CanvasText');
  });

  it('tells the chosen segment and quick pick from the others with the Highlight pair, without the text plate', () => {
    for (const selector of [".topbar-radio--segmented .topbar-radio__option[aria-checked='true']", ".topbar-count__chip[aria-pressed='true']"]) {
      const chosen = style(selector);
      expect(chosen.get('background-color'), selector).toBe('Highlight');
      expect(chosen.get('color'), selector).toBe('HighlightText');
      // Without this the browser paints a Canvas plate behind the text, which is black on black on the Highlight fill.
      expect(chosen.get('forced-color-adjust'), selector).toBe('none');
    }
  });

  it('marks the reactions of the user and hidden spoilers with a frame', () => {
    expect(style('.msg-reaction--me').get('border-width')).toBe('2px');
    expect(style('.md-spoiler:not(.md-spoiler-revealed)').get('border')).toBe('1px dashed CanvasText');
  });

  it('only names classes that exist in the stylesheets of the app (a rename would silently disable a rule)', () => {
    const others: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith('.css') && !path.endsWith('forced-colors.css')) others.push(readFileSync(path, 'utf8'));
      }
    };
    walk(join(root, 'src', 'app'));
    const defined = others.join('\n');
    for (const rule of rules) {
      for (const [, name] of rule.selectors.join(' ').matchAll(/\.([a-z][a-z0-9_-]*)/gi)) {
        expect(defined, `.${name} (${rule.selectors[0]})`).toContain(`.${name}`);
      }
    }
  });

  it('is imported by App.tsx after the component stylesheets, so it wins at equal specificity', () => {
    const app = readFileSync(join(root, 'src', 'app', 'App.tsx'), 'utf8');
    const imports = [...app.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    expect(imports[imports.length - 1]).toBe('./styles/forced-colors.css');
    expect(imports.indexOf('./components/topbar/TopBar')).toBeLessThan(imports.indexOf('./styles/forced-colors.css'));
  });
});
