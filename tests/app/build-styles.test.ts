import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The shipped app once had no message.css: main.tsx forgot to import it, while the HTML export read the same file through
 * `?raw`, so a plain "is this stylesheet imported anywhere" check was satisfied and the message list rendered unstyled.
 * These tests therefore also look at how the stylesheets reach the BUNDLE: a plain import in the graph below app.html.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'src');
const rel = (path: string): string => relative(root, path).split('\\').join('/');

/** File contents, with optional replacements (used to prove that the checks fail when an import is removed). */
type Sources = ReadonlyMap<string, string>;
const readSource = (file: string, overrides: Sources): string => overrides.get(file) ?? readFileSync(file, 'utf8');

function walk(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Specifier {
  /** As written, without a query string. */
  path: string;
  /** `?raw` / `?inline`: the file's text, not a stylesheet of the page. */
  asText: boolean;
  /** `import type ...`: erased at build time. */
  typeOnly: boolean;
}

/** Imports of a TypeScript module, or the `@import`s of a stylesheet. */
function specifiersOf(file: string, code: string): Specifier[] {
  const specifiers: Specifier[] = [];
  const add = (spec: string, typeOnly: boolean): void => {
    const [path, query = ''] = spec.split('?');
    specifiers.push({ path, asText: /(?:^|&)(?:raw|inline)(?:&|$)/.test(query), typeOnly });
  };
  if (file.endsWith('.css')) {
    for (const match of stripComments(code).matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?/g)) add(match[1], false);
    return specifiers;
  }
  const text = stripComments(code);
  for (const match of text.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) add(match[2], match[1] !== undefined);
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(match[1], false);
  return specifiers;
}

/** The file a specifier written in `from` points at (in this repo), or null for packages and missing files. */
function resolveSpecifier(from: string, path: string): string | null {
  const base = path.startsWith('@/') ? join(src, path.slice(2)) : path.startsWith('.') ? resolve(dirname(from), path) : null;
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

const stylesheets = walk(src, ['.css']);
const sourceFiles = [...walk(src, ['.ts', '.tsx']), ...stylesheets];

interface Use {
  from: string;
  asText: boolean;
}

/** stylesheet -> every place that imports it, and whether as text (`?raw`). */
function importersOf(overrides: Sources = new Map()): Map<string, Use[]> {
  const map = new Map<string, Use[]>(stylesheets.map((sheet) => [sheet, []]));
  for (const file of sourceFiles) {
    for (const spec of specifiersOf(file, readSource(file, overrides))) {
      if (spec.typeOnly || !spec.path.endsWith('.css')) continue;
      const target = resolveSpecifier(file, spec.path);
      if (target !== null) map.get(target)?.push({ from: file, asText: spec.asText });
    }
  }
  return map;
}

/** Stylesheets the browser loads when it runs app.html's script: plain imports (dynamic ones included), transitively. */
function bundledSheets(overrides: Sources = new Map()): Set<string> {
  const html = readFileSync(join(root, 'app.html'), 'utf8');
  const entry = /<script\b[^>]*\bsrc=["']([^"']+)["']/.exec(html)?.[1] ?? '';
  const seen = new Set<string>();
  const sheets = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of specifiersOf(file, readSource(file, overrides))) {
      if (spec.typeOnly || spec.asText) continue;
      const target = resolveSpecifier(file, spec.path);
      if (target === null) continue;
      if (target.endsWith('.css')) sheets.add(target);
      visit(target);
    }
  };
  visit(join(root, entry.replace(/^\//, '')));
  return sheets;
}

const appSheets = stylesheets.filter((sheet) => rel(sheet).startsWith('src/app/'));
const orphans = (map: Map<string, Use[]>): string[] => appSheets.filter((sheet) => (map.get(sheet) ?? []).length === 0).map(rel);
const notBundled = (sheets: Set<string>): string[] => appSheets.filter((sheet) => !sheets.has(sheet)).map(rel);

const mainFile = join(src, 'app', 'main.tsx');

/** The files that have a plain import of `sheet`, with that import removed (to prove what the checks say without it). */
function withoutImportsOf(sheet: string): Sources {
  const name = basename(sheet).replace(/\./g, '\\.');
  const plainImport = new RegExp(`import\\s+['"][^'"]*${name}['"];?[ \\t]*\\r?\\n`, 'g');
  const overrides = new Map<string, string>();
  for (const { from, asText } of importersOf().get(sheet) ?? []) {
    if (!asText) overrides.set(from, readFileSync(from, 'utf8').replace(plainImport, ''));
  }
  return overrides;
}

describe('stylesheets of the app', () => {
  it('finds the stylesheets (the checks below are not vacuous)', () => {
    expect(stylesheets.length).toBeGreaterThanOrEqual(11);
    expect(appSheets.map(rel)).toEqual(expect.arrayContaining(['src/app/styles/message.css', 'src/app/styles/markdown.css', 'src/app/styles/theme.css']));
    expect(bundledSheets().size).toBeGreaterThanOrEqual(11);
  });

  it('every .css file under src/app is imported somewhere (import "./x.css" or "?raw")', () => {
    expect(orphans(importersOf())).toEqual([]);
  });

  it('every .css file under src/app reaches the page: a plain import below app.html, not just ?raw for the HTML export', () => {
    expect(notBundled(bundledSheets())).toEqual([]);
  });

  it('message.css and markdown.css are in the page bundle and also read as text by the HTML export', () => {
    const map = importersOf();
    for (const name of ['message', 'markdown']) {
      const uses = map.get(join(src, 'app', 'styles', `${name}.css`)) ?? [];
      expect(
        uses.some((use) => !use.asText && use.from === mainFile),
        `${name}.css imported by main.tsx`,
      ).toBe(true);
      expect(
        uses.some((use) => use.asText),
        `${name}.css read as text`,
      ).toBe(true);
    }
  });

  it('main.tsx imports the global sheets in cascade order, before the components (whose sheets must come after them)', () => {
    const code = readFileSync(mainFile, 'utf8');
    const order = [...stripComments(code).matchAll(/import\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(order).toEqual(['./styles/theme.css', './styles/base.css', './styles/layout.css', './styles/markdown.css', './styles/message.css']);
    expect(code.indexOf("import './styles/message.css'")).toBeLessThan(code.indexOf("from './App'"));
  });
});

describe('the checks fail on the bug they exist for', () => {
  it("dropping main.tsx's message.css import (the ?raw import of the HTML export remains) leaves the bundle without it", () => {
    const overrides = withoutImportsOf(join(src, 'app', 'styles', 'message.css'));
    expect([...overrides.keys()]).toEqual([mainFile]);
    // The "imported somewhere" check alone is satisfied by the export's ?raw import ...
    expect(orphans(importersOf(overrides))).toEqual([]);
    // ... which is why the bundle check exists.
    expect(notBundled(bundledSheets(overrides))).toEqual(['src/app/styles/message.css']);
  });

  it('a component stylesheet whose imports were all removed is reported by both checks', () => {
    const overrides = withoutImportsOf(join(src, 'app', 'components', 'rail', 'rail.css'));
    expect(overrides.size).toBeGreaterThan(0);
    expect(orphans(importersOf(overrides))).toEqual(['src/app/components/rail/rail.css']);
    expect(notBundled(bundledSheets(overrides))).toEqual(['src/app/components/rail/rail.css']);
  });

  it('reads imports like the bundler does: comments and type-only imports do not count, ?raw is text', () => {
    const code = "// import './old.css'\nimport './real.css';\nimport raw from './x.css?raw';\nimport type { T } from './t';\nconst lazy = () => import('./lazy');";
    expect(specifiersOf('a.ts', code)).toEqual([
      { path: './real.css', asText: false, typeOnly: false },
      { path: './x.css', asText: true, typeOnly: false },
      { path: './t', asText: false, typeOnly: true },
      { path: './lazy', asText: false, typeOnly: false },
    ]);
    expect(specifiersOf('a.css', "@import './b.css'; @import url('./c.css');")).toEqual([
      { path: './b.css', asText: false, typeOnly: false },
      { path: './c.css', asText: false, typeOnly: false },
    ]);
  });
});
