import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * jsdom applies no stylesheets, so colours are checked on the CSS text: the tokens of theme.css are read, `var(--x)` is
 * resolved through them, and the WCAG 2.x maths is done here. Only what the app's stylesheets actually use is supported
 * (hex, rgb()/rgba(), var(), the CSS colour keywords listed below).
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));

export const readCss = (relative: string): string => readFileSync(join(root, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

export interface Rule {
  selectors: string[];
  body: string;
}

/** Top-level rules of a stylesheet WITHOUT at-rule blocks (media queries and keyframes are skipped). */
export function rulesOf(css: string): Rule[] {
  const withoutAtRules = css.replace(/@[a-z-]+[^{;]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '');
  return [...withoutAtRules.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
    body: match[2],
  }));
}

/** Declarations of every rule that lists `selector` exactly, merged in source order (later ones win). */
export function declarationsOf(rules: readonly Rule[], selector: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [, property, value] of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/gi)) merged.set(property.toLowerCase(), value.trim().replace(/\s+/g, ' '));
  }
  if (merged.size === 0) throw new Error(`no rule for ${selector}`);
  return merged;
}

/** `--name: value;` declarations of the design tokens. */
export function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of readCss('src/app/styles/theme.css').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map.set(match[1], match[2].trim());
  return map;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const KEYWORDS: Readonly<Record<string, Rgba>> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

/** A colour value: `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, a keyword, or `var(--token)` resolved through theme.css. */
export function parseColor(value: string, theme: ReadonlyMap<string, string> = tokens()): Rgba {
  const text = value.trim().toLowerCase();
  const variable = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(text);
  if (variable !== null) {
    const resolved = theme.get(variable[1]);
    if (resolved === undefined) throw new Error(`unknown token ${variable[1]}`);
    return parseColor(resolved, theme);
  }
  const keyword = KEYWORDS[text];
  if (keyword !== undefined) return keyword;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex !== null) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (rgb !== null) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  throw new Error(`unsupported colour: ${value}`);
}

/** `top` painted over the opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (a: number, b: number): number => Math.round(a * top.a + b * (1 - top.a));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(first: Rgba, second: Rgba): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
