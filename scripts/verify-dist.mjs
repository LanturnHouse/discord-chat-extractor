// Sanity-checks a built extension in dist/ before it is loaded into Chrome or zipped.
//   node scripts/verify-dist.mjs [distDir]
// Exit code 1 (with a list of problems) when anything that would break the extension at runtime is found.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const isRemote = (url) => /^(?:https?:)?\/\//i.test(url);
const isFile = (path) => existsSync(path) && statSync(path).isFile();

function readJson(path, problems, label) {
  if (!isFile(path)) {
    problems.push(`${label} is missing (${path})`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

/** Resolves a URL used inside the extension to a file path under distDir (null when it points outside). */
function resolveInDist(distDir, fromDir, ref) {
  const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
  const target = clean.startsWith('/') ? join(distDir, clean) : join(fromDir, clean);
  const rel = relative(distDir, target);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : target;
}

/** Every file path a manifest points at, with a label for error messages. */
function manifestReferences(manifest) {
  const refs = [];
  const add = (label, path) => typeof path === 'string' && refs.push({ label, path: path.replace(/^\//, '') });
  add('background.service_worker', manifest.background?.service_worker);
  add('action.default_popup', manifest.action?.default_popup);
  add('options_page', manifest.options_page);
  add('options_ui.page', manifest.options_ui?.page);
  add('side_panel.default_path', manifest.side_panel?.default_path);
  const iconMaps = [
    ['icons', manifest.icons],
    ['action.default_icon', typeof manifest.action?.default_icon === 'object' ? manifest.action.default_icon : null],
  ];
  if (typeof manifest.action?.default_icon === 'string') add('action.default_icon', manifest.action.default_icon);
  for (const [label, map] of iconMaps) {
    for (const [size, path] of Object.entries(map ?? {})) add(`${label}[${size}]`, path);
  }
  for (const [i, script] of (manifest.content_scripts ?? []).entries()) {
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) add(`content_scripts[${i}]`, path);
  }
  return refs;
}

function checkIcons(distDir, manifest, problems) {
  const maps = [manifest.icons, typeof manifest.action?.default_icon === 'object' ? manifest.action.default_icon : null];
  for (const map of maps) {
    for (const [size, path] of Object.entries(map ?? {})) {
      const file = join(distDir, String(path).replace(/^\//, ''));
      if (!isFile(file)) continue; // already reported as a missing reference
      const bytes = readFileSync(file);
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        problems.push(`icon ${path} is not a PNG`);
      } else if (bytes.readUInt32BE(16) !== Number(size) || bytes.readUInt32BE(20) !== Number(size)) {
        problems.push(`icon ${path} is ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}, manifest says ${size}x${size}`);
      }
    }
  }
}

/** CSP string -> Map(directive name -> sources). The first occurrence of a directive wins, like in browsers. */
export function parseCsp(csp) {
  const directives = new Map();
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** What the app really needs to reach: its own files and the Discord API (`API_BASE` in src/shared/constants.ts). */
const CONNECT_SOURCES = ["'self'", 'https://discord.com'];

/**
 * Problems of the `extension_pages` CSP. `default-src 'none'` + a `connect-src` limited to 'self' and Discord is what keeps
 * the "no network traffic except to Discord" rule enforceable: script that ever runs in the page (a compromised dependency)
 * could otherwise send the token anywhere. `form-action` and `base-uri` are listed because `default-src` does not cover them.
 * @returns {string[]}
 */
export function cspProblems(csp) {
  if (typeof csp !== 'string' || csp.trim() === '') {
    return ['manifest has no content_security_policy.extension_pages (Chrome would fall back to its permissive default)'];
  }
  const problems = [];
  const directives = parseCsp(csp);
  const sourcesOf = (name) => directives.get(name);
  const exactly = (name, allowed, why) => {
    const sources = sourcesOf(name);
    if (!sources) problems.push(`manifest CSP has no ${name} directive${why ? ` (${why})` : ''}`);
    else if (sources.length === 0 || sources.some((source) => !allowed.includes(source))) {
      problems.push(`manifest CSP ${name} must be limited to ${allowed.join(' ')}, found: ${sources.join(' ') || '(nothing)'}`);
    }
  };

  exactly('default-src', ["'none'"], 'every directive it does not list would allow any source');
  exactly('script-src', ["'self'", "'wasm-unsafe-eval'"]);
  exactly('object-src', ["'none'", "'self'"]);
  exactly('style-src', ["'self'", "'unsafe-inline'"], "inline style attributes need 'unsafe-inline', nothing else may load CSS");
  exactly('form-action', ["'none'"], 'default-src does not cover it');
  exactly('base-uri', ["'none'"], 'default-src does not cover it');
  exactly('connect-src', CONNECT_SOURCES, "fetch / XHR / WebSocket must reach only the extension itself and Discord");
  const connect = sourcesOf('connect-src');
  if (connect && !connect.includes('https://discord.com')) problems.push('manifest CSP connect-src must allow https://discord.com (the API host), or every request fails');

  for (const [name, sources] of directives) {
    for (const source of sources) {
      const lower = source.toLowerCase();
      if (lower === "'unsafe-eval'") problems.push(`manifest CSP ${name} allows 'unsafe-eval'`);
      else if (lower === "'unsafe-inline'" && name !== 'style-src') problems.push(`manifest CSP ${name} allows 'unsafe-inline' (only style-src may)`);
      else if (['*', 'http:', 'https:', 'ws:', 'wss:'].includes(lower)) problems.push(`manifest CSP ${name} allows every host (${source})`);
      else if (lower === 'data:' && name !== 'img-src') problems.push(`manifest CSP ${name} allows data: (only img-src may)`);
    }
  }
  return problems;
}

function checkCsp(manifest, problems) {
  problems.push(...cspProblems(manifest.content_security_policy?.extension_pages));
}

function attributesOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function checkAppHtml(distDir, problems, notes) {
  const htmlPath = join(distDir, 'app.html');
  if (!isFile(htmlPath)) {
    problems.push('app.html is missing');
    return;
  }
  const problemsBefore = problems.length;
  const html = readFileSync(htmlPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const references = [];
  for (const [tag, name] of [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)].map((m) => [m[0], m[1].toLowerCase()])) {
    const attrs = attributesOf(tag.slice(name.length + 1));
    for (const attr of Object.keys(attrs)) {
      if (/^on[a-z]+$/.test(attr)) problems.push(`app.html: inline event handler "${attr}" on <${name}> (blocked by the extension CSP)`);
    }
    if (name === 'script') {
      if (attrs.src === undefined) problems.push('app.html: inline <script> (blocked by the extension CSP)');
      else references.push({ name, url: attrs.src });
    } else if (name === 'link' && attrs.href !== undefined) {
      references.push({ name, url: attrs.href });
    } else if (['img', 'source', 'video', 'audio', 'iframe', 'embed'].includes(name) && attrs.src !== undefined) {
      references.push({ name, url: attrs.src });
    }
    if (/^\s*javascript:/i.test(attrs.href ?? '')) problems.push(`app.html: javascript: URL on <${name}>`);
  }

  let local = 0;
  for (const { name, url } of references) {
    if (/^(?:data|blob):/i.test(url)) continue;
    if (isRemote(url)) {
      problems.push(`app.html: remote <${name}> ${url}`);
      continue;
    }
    const target = resolveInDist(distDir, dirname(htmlPath), url);
    if (target === null) problems.push(`app.html: <${name}> ${url} points outside dist/`);
    else if (!isFile(target)) problems.push(`app.html: <${name}> ${url} does not exist in dist/`);
    else local++;
  }
  if (problems.length === problemsBefore) {
    notes.push(`app.html references ${local} local file(s), no inline scripts, no remote resources`);
  }
}

/** Selectors of the message list and of the markdown renderer: a stylesheet that lost them renders every message unstyled. */
export const REQUIRED_CSS_SELECTORS = ['.msg', '.md-root'];

/** The required selectors that never occur as a class selector in `css`. */
export function missingSelectors(css) {
  return REQUIRED_CSS_SELECTORS.filter((selector) => !new RegExp(`${selector.replace('.', '\\.')}(?![\\w-])`).test(css));
}

/** The stylesheets app.html links, so a build in which a source stylesheet was never imported cannot pass as verified. */
function checkBuiltStyles(distDir, problems, notes) {
  const htmlPath = join(distDir, 'app.html');
  if (!isFile(htmlPath)) return; // already reported
  const html = readFileSync(htmlPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const sheets = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributesOf(tag.slice('<link'.length));
    if (attrs.rel?.toLowerCase() === 'stylesheet' && attrs.href !== undefined && !isRemote(attrs.href)) sheets.push(attrs.href);
  }
  if (sheets.length === 0) {
    problems.push('app.html links no stylesheet');
    return;
  }
  let css = '';
  for (const href of sheets) {
    const target = resolveInDist(distDir, dirname(htmlPath), href);
    if (target !== null && isFile(target)) css += `${readFileSync(target, 'utf8')}\n`;
  }
  const missing = missingSelectors(css);
  if (missing.length > 0) {
    problems.push(`the built stylesheet has no rule for ${missing.join(', ')}: a source stylesheet is not imported (see src/app/main.tsx) or dist/ is stale - run "npm run build"`);
  } else {
    notes.push(`the built stylesheet styles ${REQUIRED_CSS_SELECTORS.join(' and ')}`);
  }
}

/**
 * What the extension-page CSP (see `cspProblems`) cannot allow. Anything found here is either a bug waiting for the first
 * run in Chrome (eval, workers, remote fonts) or network use beyond 'self' and Discord that must be a deliberate decision.
 */
const FORBIDDEN_CODE = [
  [/\bnew\s+(?:Shared)?Worker\s*\(/, 'a Worker (the CSP offers no worker-src beyond the extension itself)'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bnew\s+WebSocket\s*\(/, 'a WebSocket (connect-src allows only the extension and https://discord.com)'],
  [/\bnew\s+EventSource\s*\(/, 'an EventSource (connect-src allows only the extension and https://discord.com)'],
  [/\bsendBeacon\s*\(/, 'navigator.sendBeacon (no traffic besides the Discord API requests)'],
  [/\beval\s*\(/, "eval() (the CSP has no 'unsafe-eval')"],
  [/\bnew\s+Function\s*\(/, "new Function() (the CSP has no 'unsafe-eval')"],
];
const FORBIDDEN_CSS = [
  [/@font-face/i, '@font-face (font-src is none; the app uses system fonts)'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'a remote url() (only the extension itself and data: images are allowed)'],
  [/@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i, 'a remote @import'],
];

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function checkBuiltCode(distDir, problems, notes) {
  if (!existsSync(distDir)) return;
  const problemsBefore = problems.length;
  let scanned = 0;
  for (const file of listFiles(distDir)) {
    const isJs = /\.(?:m?js)$/i.test(file);
    if (!isJs && !/\.css$/i.test(file)) continue;
    scanned++;
    const code = readFileSync(file, 'utf8');
    const label = relative(distDir, file).split(sep).join('/');
    for (const [pattern, what] of isJs ? FORBIDDEN_CODE : FORBIDDEN_CSS) {
      if (pattern.test(code)) problems.push(`${label}: uses ${what}`);
    }
  }
  if (problems.length === problemsBefore) notes.push(`${scanned} built script/style file(s) need nothing the extension CSP forbids`);
}

/** Static + literal-dynamic import specifiers of a JS module (regex based; fine for bundler output). */
export function importSpecifiers(code) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s*(?:[\w$*\s{},]*?)\s*from\s*(["'`])([^"'`]+)\1/g,
    /\bimport\s*(["'`])([^"'`]+)\1/g,
    /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of code.matchAll(pattern)) specifiers.add(m[2]);
  return { specifiers: [...specifiers], hasDynamicNonLiteral: /\bimport\s*\(\s*(?!["'`])/.test(code) };
}

function checkBackground(distDir, manifest, problems, notes) {
  const worker = manifest.background?.service_worker;
  if (worker !== 'background.js') problems.push(`background.service_worker must be "background.js" (un-hashed), found ${JSON.stringify(worker)}`);
  if (manifest.background?.type !== 'module') problems.push('background.type must be "module"');
  const entry = join(distDir, 'background.js');
  if (!isFile(entry)) {
    problems.push('background.js is missing');
    return;
  }
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const label = relative(distDir, file).split(sep).join('/');
    const { specifiers, hasDynamicNonLiteral } = importSpecifiers(readFileSync(file, 'utf8'));
    if (hasDynamicNonLiteral) problems.push(`${label}: dynamic import() with a non-literal specifier`);
    for (const specifier of specifiers) {
      if (!/^\.\.?\//.test(specifier)) {
        problems.push(`${label}: imports "${specifier}" - only relative imports are allowed in the service worker`);
        continue;
      }
      const target = resolveInDist(distDir, dirname(file), specifier);
      if (target === null || !isFile(target)) problems.push(`${label}: imports "${specifier}" which does not exist in dist/`);
      else visit(target);
    }
  };
  visit(entry);
  if (seen.size === 1) notes.push('background.js is a single self-contained module (no imports)');
  else notes.push(`background.js imports ${seen.size - 1} relative chunk(s): ${[...seen].slice(1).map((f) => relative(distDir, f).split(sep).join('/')).join(', ')}`);
}

/** @returns {{ problems: string[], notes: string[] }} */
export function verifyDist({ distDir = join(ROOT, 'dist'), rootDir = ROOT } = {}) {
  const problems = [];
  const notes = [];
  const manifest = readJson(join(distDir, 'manifest.json'), problems, 'manifest.json');
  const pkg = readJson(join(rootDir, 'package.json'), problems, 'package.json');
  if (!manifest) return { problems, notes };

  if (manifest.manifest_version !== 3) problems.push(`manifest_version must be 3, found ${manifest.manifest_version}`);
  if (pkg && manifest.version !== pkg.version) {
    problems.push(`manifest version ${manifest.version} != package.json version ${pkg.version}`);
  } else if (pkg) {
    notes.push(`version ${manifest.version} matches package.json`);
  }

  const refs = manifestReferences(manifest);
  let missing = 0;
  for (const { label, path } of refs) {
    if (!isFile(join(distDir, path))) {
      problems.push(`manifest ${label} -> ${path} does not exist in dist/`);
      missing++;
    }
  }
  if (missing === 0) notes.push(`all ${refs.length} files referenced by manifest.json exist`);

  checkIcons(distDir, manifest, problems);
  checkCsp(manifest, problems);
  checkAppHtml(distDir, problems, notes);
  checkBuiltStyles(distDir, problems, notes);
  checkBuiltCode(distDir, problems, notes);
  checkBackground(distDir, manifest, problems, notes);
  return { problems, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const distDir = resolve(process.argv[2] ?? join(ROOT, 'dist'));
  const { problems, notes } = verifyDist({ distDir });
  for (const note of notes) console.log(`ok   ${note}`);
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) found in ${distDir}`);
    process.exit(1);
  }
  console.log(`\n${distDir} verified`);
}
