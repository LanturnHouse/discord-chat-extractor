import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { API_BASE } from '@/shared/constants';
import { cspProblems, parseCsp, verifyDist } from '../../scripts/verify-dist.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');

interface Manifest {
  version: string;
  content_security_policy: { extension_pages: string };
  [key: string]: unknown;
}

const manifest = JSON.parse(read('public/manifest.json')) as Manifest;
const shippedCsp = manifest.content_security_policy.extension_pages;

/** The policy the manifest had before the hardening: script-src only, everything else fell back to "allow anything". */
const LEGACY_CSP =
  "script-src 'self'; object-src 'self'; base-uri 'none'; img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net https://*.discordapp.com; media-src 'self' blob: https://cdn.discordapp.com https://media.discordapp.net https://*.discordapp.net";

/** The shipped policy with one directive replaced (or, with `undefined`, removed). */
function withDirective(name: string, sources: string | undefined): string {
  const kept = shippedCsp
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/)[0] !== name);
  return (sources === undefined ? kept : [...kept, `${name} ${sources}`]).join('; ');
}

describe('the extension-page CSP of public/manifest.json', () => {
  it('has default-src none, so every directive it does not list allows nothing', () => {
    expect(parseCsp(shippedCsp).get('default-src')).toEqual(["'none'"]);
  });

  it("limits network access (connect-src) to the extension itself and the Discord API host - nothing else may carry the token", () => {
    expect(parseCsp(shippedCsp).get('connect-src')).toEqual(["'self'", new URL(API_BASE).origin]);
  });

  it("loads script only from the extension and needs no eval ('unsafe-eval'), inline script or remote code", () => {
    const directives = parseCsp(shippedCsp);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    for (const [name, sources] of directives) expect(sources, name).not.toContain("'unsafe-eval'");
    for (const [name, sources] of directives) if (name !== 'style-src') expect(sources, name).not.toContain("'unsafe-inline'");
  });

  it('blocks frames, forms, fonts and <base> outright; styles come from the extension (inline style attributes are the only inline allowance)', () => {
    const directives = parseCsp(shippedCsp);
    for (const name of ['font-src', 'frame-src', 'form-action', 'base-uri']) expect(directives.get(name), name).toEqual(["'none'"]);
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('only lets images and media in from the extension, data:/blob: and the Discord CDN hosts', () => {
    const directives = parseCsp(shippedCsp);
    for (const name of ['img-src', 'media-src']) {
      for (const source of directives.get(name) ?? []) {
        expect(source, `${name} ${source}`).toMatch(/^('self'|data:|blob:|https:\/\/(?:[\w-]+\.|\*\.)*discord(?:app)?\.(?:com|net))$/);
      }
    }
  });

  it('passes the checks verify-dist.mjs runs on the built manifest', () => {
    expect(cspProblems(shippedCsp)).toEqual([]);
  });
});

describe('cspProblems (what `npm run verify` rejects)', () => {
  it('accepts the shipped policy', () => {
    expect(cspProblems(shippedCsp)).toEqual([]);
  });

  it('rejects a manifest without any CSP, and the policy the manifest used to have', () => {
    expect(cspProblems(undefined)).toHaveLength(1);
    expect(cspProblems('')).toHaveLength(1);
    const legacy = cspProblems(LEGACY_CSP);
    expect(legacy.some((problem) => problem.includes('default-src'))).toBe(true);
    expect(legacy.some((problem) => problem.includes('connect-src'))).toBe(true);
  });

  it('requires default-src to be exactly none', () => {
    expect(cspProblems(withDirective('default-src', undefined)).join('\n')).toContain('no default-src');
    expect(cspProblems(withDirective('default-src', "'self'")).join('\n')).toContain("default-src must be limited to 'none'");
    expect(cspProblems(withDirective('default-src', "'none' https:")).join('\n')).toContain('default-src');
  });

  it('requires a connect-src that allows the Discord API and nothing else besides the extension', () => {
    expect(cspProblems(withDirective('connect-src', undefined)).join('\n')).toContain('no connect-src');
    expect(cspProblems(withDirective('connect-src', "'self'")).join('\n')).toContain('must allow https://discord.com');
    for (const extra of ['https://attacker.example', 'https:', '*', 'wss://gateway.discord.gg', 'data:', "'unsafe-eval'"]) {
      const problems = cspProblems(withDirective('connect-src', `'self' https://discord.com ${extra}`));
      expect(problems.length, extra).toBeGreaterThan(0);
    }
  });

  it("keeps script-src at 'self': no inline script, no eval, no remote host", () => {
    for (const extra of ["'unsafe-inline'", "'unsafe-eval'", 'https://cdn.example.com', "'self' https:"]) {
      expect(cspProblems(withDirective('script-src', `'self' ${extra}`)).length, extra).toBeGreaterThan(0);
    }
    expect(cspProblems(withDirective('script-src', "'self' 'wasm-unsafe-eval'"))).toEqual([]);
    expect(cspProblems(withDirective('script-src', undefined)).join('\n')).toContain('no script-src');
  });

  it('requires the directives default-src does not cover (form-action, base-uri) and a strict style-src', () => {
    expect(cspProblems(withDirective('form-action', undefined)).join('\n')).toContain('form-action');
    expect(cspProblems(withDirective('base-uri', undefined)).join('\n')).toContain('base-uri');
    expect(cspProblems(withDirective('style-src', "'self' https://fonts.googleapis.com")).join('\n')).toContain('style-src');
    expect(cspProblems(withDirective('style-src', undefined)).join('\n')).toContain('no style-src');
  });

  it('rejects wildcard hosts and data: outside img-src in any directive', () => {
    expect(cspProblems(`${shippedCsp}; worker-src https:`).join('\n')).toContain('worker-src allows every host');
    expect(cspProblems(`${shippedCsp}; frame-src *`).length).toBe(0); // first occurrence wins: frame-src 'none' stays in force
    expect(cspProblems(withDirective('frame-src', '*')).join('\n')).toContain('frame-src allows every host');
    expect(cspProblems(withDirective('media-src', "'self' data:")).join('\n')).toContain('media-src allows data:');
    expect(cspProblems(withDirective('img-src', "'self' data:"))).toEqual([]);
  });
});

describe('what the app needs from the network, in the sources', () => {
  /** Every .ts / .tsx file under src with comments removed (comments may mention fetch() and friends). */
  function sources(): Array<{ file: string; code: string }> {
    const found: Array<{ file: string; code: string }> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) {
          const code = readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
          found.push({ file: relative(root, path).split('\\').join('/'), code });
        }
      }
    };
    walk(join(root, 'src'));
    return found;
  }

  const files = sources();

  it('only the Discord client calls fetch(), and it talks to the origin the CSP allows', () => {
    const callers = files.filter(({ code }) => /\bfetch\s*\(/.test(code)).map(({ file }) => file);
    expect(callers).toEqual(['src/lib/discord/api.ts']);
    expect(parseCsp(shippedCsp).get('connect-src')).toContain(new URL(API_BASE).origin);
  });

  it.each([
    ['a Worker', /\bnew\s+(?:Shared)?Worker\s*\(/],
    ['importScripts()', /\bimportScripts\s*\(/],
    ['a WebSocket', /\bnew\s+WebSocket\s*\(/],
    ['an EventSource', /\bnew\s+EventSource\s*\(/],
    ['navigator.sendBeacon', /\bsendBeacon\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['eval()', /\beval\s*\(/],
    ['new Function()', /\bnew\s+Function\s*\(/],
    ['an iframe', /<iframe\b|createElement\(\s*['"]iframe['"]/],
    ['a form', /<form\b|createElement\(\s*['"]form['"]/],
  ])('nothing in src uses %s, which the CSP does not allow', (_what, pattern) => {
    expect(files.filter(({ code }) => pattern.test(code)).map(({ file }) => file)).toEqual([]);
  });
});

describe('verifyDist on a built extension', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function png(size: number): Buffer {
    const bytes = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'latin1');
    bytes.writeUInt32BE(size, 16);
    bytes.writeUInt32BE(size, 20);
    return bytes;
  }

  /** A minimal but complete dist/: manifest, icons, app.html with a script and a stylesheet, and the service worker. */
  function buildFakeDist(options: { csp?: string; css?: string; js?: string } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'dce-verify-'));
    created.push(dir);
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'icons'));
    const built: Manifest = JSON.parse(JSON.stringify(manifest)) as Manifest;
    built.content_security_policy.extension_pages = options.csp ?? shippedCsp;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(built));
    for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, 'icons', `icon${size}.png`), png(size));
    writeFileSync(join(dir, 'background.js'), 'chrome.runtime.id;');
    writeFileSync(join(dir, 'assets', 'app.js'), options.js ?? 'export const ok = 1;');
    writeFileSync(join(dir, 'assets', 'app.css'), options.css ?? '.msg { color: red; }\n.md-root { color: blue; }');
    writeFileSync(
      join(dir, 'app.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css" /></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
    );
    return dir;
  }

  it('accepts a build with the hardened CSP and the message / markdown styles', () => {
    const { problems } = verifyDist({ distDir: buildFakeDist(), rootDir: root });
    expect(problems).toEqual([]);
  });

  it('fails when the manifest CSP is the old, permissive one', () => {
    const { problems } = verifyDist({ distDir: buildFakeDist({ csp: LEGACY_CSP }), rootDir: root });
    expect(problems.join('\n')).toContain('default-src');
    expect(problems.join('\n')).toContain('connect-src');
  });

  it('fails when the built stylesheet lacks the message selectors (a stylesheet that was never imported)', () => {
    const { problems } = verifyDist({ distDir: buildFakeDist({ css: '.md-root { color: blue; } .msg-extra { color: red; }' }), rootDir: root });
    expect(problems.join('\n')).toContain('no rule for .msg');
  });

  it('fails when the built stylesheet lacks the markdown selectors', () => {
    const { problems } = verifyDist({ distDir: buildFakeDist({ css: '.msg { color: red; }' }), rootDir: root });
    expect(problems.join('\n')).toContain('no rule for .md-root');
  });

  it('accepts minified selectors in a list', () => {
    const { problems } = verifyDist({ distDir: buildFakeDist({ css: '.a,.msg,.b{color:red}.md-root>p{margin:0}' }), rootDir: root });
    expect(problems).toEqual([]);
  });

  it.each([
    ['a worker', 'new Worker(url)'],
    ['importScripts', 'importScripts("x.js")'],
    ['a websocket', 'new WebSocket("wss://example.com")'],
    ['eval', 'eval("1")'],
    ['new Function', 'new Function("return 1")'],
  ])('fails when the built code uses %s', (_what, js) => {
    const { problems } = verifyDist({ distDir: buildFakeDist({ js }), rootDir: root });
    expect(problems.some((problem) => problem.startsWith('assets/app.js: uses'))).toBe(true);
  });

  it('fails when the built CSS needs a remote font or image', () => {
    const css = '.msg{color:red}.md-root{color:blue}@font-face{font-family:x;src:url(https://fonts.example/x.woff2)}';
    const { problems } = verifyDist({ distDir: buildFakeDist({ css }), rootDir: root });
    expect(problems.some((problem) => problem.includes('@font-face'))).toBe(true);
    expect(problems.some((problem) => problem.includes('remote url()'))).toBe(true);
  });

  it('does not mistake a local data: url() or an identifier that merely contains "eval" for a problem', () => {
    const css = ".msg{background:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>\")}.md-root{color:blue}";
    const { problems } = verifyDist({ distDir: buildFakeDist({ css, js: 'const retrieval = 1; retrieval(2); medieval(3);' }), rootDir: root });
    expect(problems).toEqual([]);
  });
});
