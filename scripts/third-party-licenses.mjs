// Checks the licenses of everything that ships inside the extension and (re)generates THIRD_PARTY_LICENSES.md.
//   node scripts/third-party-licenses.mjs              check + write THIRD_PARTY_LICENSES.md
//   node scripts/third-party-licenses.mjs --check      check only; also fails when THIRD_PARTY_LICENSES.md is out of date
//   node scripts/third-party-licenses.mjs --out <file> write somewhere else (default: THIRD_PARTY_LICENSES.md in the repo root)
//
// "Ships" = the production dependency tree of package.json: `dependencies` and, recursively, the `dependencies` /
// `optionalDependencies` / required `peerDependencies` of every package found. devDependencies are build and test tools that
// never end up in dist/, so they are not listed (and not checked). The tree is read from package-lock.json (what npm installs),
// the license data from the installed copy in node_modules, so run `npm ci` first.
//
// Exit code 1 (with a list of problems) when a package in that tree is not under an allow-listed permissive license,
// has no license file to reproduce, or when node_modules / package-lock.json do not match package.json.
// Only Node built-ins are used, so the script runs on a fresh checkout.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** SPDX identifiers that may appear in the shipped dependency tree. Anything else needs a human decision first. */
export const ALLOWED_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];

// ---------------------------------------------------------------------------------------------------------------------
// SPDX license expressions: `MIT`, `(MIT OR Apache-2.0)`, `MIT AND Zlib`, ...
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Parses an SPDX license expression into a tree: { id } | { op: 'AND' | 'OR', terms } | { id, exception }.
 * Throws on anything that is not well-formed, so a malformed `license` field is reported instead of being guessed at.
 */
export function parseSpdx(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (token, op) => typeof token === 'string' && token.toUpperCase() === op;

  function parseOr() {
    const terms = [parseAnd()];
    while (isOp(peek(), 'OR')) {
      pos++;
      terms.push(parseAnd());
    }
    return terms.length === 1 ? terms[0] : { op: 'OR', terms };
  }

  function parseAnd() {
    const terms = [parseAtom()];
    while (isOp(peek(), 'AND')) {
      pos++;
      terms.push(parseAtom());
    }
    return terms.length === 1 ? terms[0] : { op: 'AND', terms };
  }

  function parseAtom() {
    const token = tokens[pos++];
    if (token === undefined) throw new Error(`unexpected end of license expression "${expression}"`);
    if (token === '(') {
      const inner = parseOr();
      if (tokens[pos++] !== ')') throw new Error(`missing ")" in license expression "${expression}"`);
      return inner;
    }
    if (token === ')' || isOp(token, 'AND') || isOp(token, 'OR') || isOp(token, 'WITH')) {
      throw new Error(`unexpected "${token}" in license expression "${expression}"`);
    }
    if (isOp(peek(), 'WITH')) {
      pos++;
      const exception = tokens[pos++];
      if (exception === undefined || exception === '(' || exception === ')') throw new Error(`missing exception after WITH in "${expression}"`);
      return { id: token, exception };
    }
    return { id: token };
  }

  const tree = parseOr();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos]}" in license expression "${expression}"`);
  return tree;
}

/**
 * True when the expression can be satisfied with allow-listed licenses only: `OR` needs one allowed alternative
 * (the user may pick it), `AND` needs all of them. `X WITH exception` and `X+` are never accepted automatically.
 */
export function isAllowedExpression(expression, allowed = ALLOWED_LICENSES) {
  const allow = new Set(allowed.map((id) => id.toLowerCase()));
  const check = (node) => {
    if (node.op === 'OR') return node.terms.some(check);
    if (node.op === 'AND') return node.terms.every(check);
    return node.exception === undefined && allow.has(node.id.toLowerCase());
  };
  try {
    return check(parseSpdx(expression));
  } catch {
    return false;
  }
}

/** The package's declared license as an SPDX-ish string, from `license` (string or legacy `{ type }`) or legacy `licenses`. */
export function declaredLicense(pkg) {
  const one = (value) => (typeof value === 'string' ? value : typeof value?.type === 'string' ? value.type : null);
  const single = one(pkg.license);
  if (single !== null && single.trim() !== '') return single.trim();
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map(one).filter((type) => type !== null && type.trim() !== '');
    if (types.length > 0) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// the production dependency tree
// ---------------------------------------------------------------------------------------------------------------------

/** Lock-file key of the package `name` as seen from the package at `fromKey` ('' = the project): Node's nested node_modules lookup. */
export function resolveLockKey(packages, fromKey, name) {
  let base = fromKey;
  for (;;) {
    const candidate = `${base === '' ? '' : `${base}/`}node_modules/${name}`;
    if (packages[candidate] !== undefined) return candidate;
    if (base === '') return null;
    const cut = base.lastIndexOf('node_modules/');
    base = cut <= 0 ? '' : base.slice(0, cut - 1);
  }
}

function requiredEdges(manifest) {
  const optionalPeers = manifest.peerDependenciesMeta ?? {};
  const edges = [];
  for (const name of Object.keys(manifest.dependencies ?? {})) edges.push({ name, optional: false });
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) edges.push({ name, optional: true });
  // A peer dependency is installed by npm 7+; one that is marked optional is only used when somebody else brings it.
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (optionalPeers[name]?.optional !== true) edges.push({ name, optional: false });
  }
  return edges;
}

/**
 * Production tree of the project as [{ key, name, version }] sorted by name. Problems are pushed to `problems`.
 * `lock` is the parsed package-lock.json, `rootManifest` the parsed package.json, `readInstalled(key)` the parsed
 * package.json of the installed copy of a lock entry (or null when it is not installed).
 */
export function productionTree({ lock, rootManifest, readInstalled, problems }) {
  const packages = lock.packages ?? {};
  const root = packages[''] ?? {};
  if (JSON.stringify(sortedEntries(root.dependencies)) !== JSON.stringify(sortedEntries(rootManifest.dependencies))) {
    problems.push('package-lock.json does not match the "dependencies" of package.json - run "npm install" and commit the lock file');
  }

  const found = new Map();
  const queue = [{ key: '', manifest: rootManifest }];
  while (queue.length > 0) {
    const { key: fromKey, manifest } = queue.shift();
    for (const { name, optional } of requiredEdges(manifest)) {
      const key = resolveLockKey(packages, fromKey, name);
      if (key === null) {
        if (!optional) problems.push(`${name} (needed by ${fromKey === '' ? 'package.json' : fromKey}) is not in package-lock.json - run "npm install"`);
        continue;
      }
      if (found.has(key)) continue;
      const entry = packages[key];
      if (entry.link === true) {
        problems.push(`${key} is a linked (local) package; its license cannot be checked here`);
        continue;
      }
      const installed = readInstalled(key);
      if (installed === null) {
        if (!optional) problems.push(`${key} is not installed - run "npm ci"`);
        continue;
      }
      if (installed.version !== entry.version) {
        problems.push(`${key}: installed version ${installed.version} differs from package-lock.json (${entry.version}) - run "npm ci"`);
      }
      found.set(key, { key, name: installed.name ?? name, version: installed.version, manifest: installed });
      queue.push({ key, manifest: installed });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function sortedEntries(object) {
  return Object.entries(object ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------------------------------------------------
// license texts
// ---------------------------------------------------------------------------------------------------------------------

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[-_.].*)?$/i;
const NOTICE_FILE = /^notice(?:[-_.].*)?$/i;

const cleanText = (text) =>
  text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');

/** License files (LICENSE*, COPYING*) and NOTICE files of an installed package directory, texts normalised to LF. */
export function readLegalFiles(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return { licenses: [], notices: [] };
  }
  const read = (name) => ({ name, text: cleanText(readFileSync(join(dir, name), 'utf8')) });
  const byName = (a, b) => a.localeCompare(b);
  return {
    licenses: names.filter((name) => LICENSE_FILE.test(name)).sort(byName).map(read).filter((file) => file.text !== ''),
    notices: names.filter((name) => NOTICE_FILE.test(name)).sort(byName).map(read).filter((file) => file.text !== ''),
  };
}

/** The "Copyright (c) ..." lines of a license text, in order, without duplicates. */
export function copyrightLines(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:copyright\b|\(c\)|[©])/i.test(line));
  return [...new Set(lines)];
}

/** `git+https://github.com/x/y.git` / `github:x/y` / `{ url }` -> a plain https URL, or null when nothing usable is declared. */
export function repositoryUrl(manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  let url = typeof raw === 'string' ? raw.trim() : '';
  if (url === '' && typeof manifest.homepage === 'string') url = manifest.homepage.trim();
  if (url === '') return null;
  const shorthand = /^(github|gitlab|bitbucket):(.+)$/i.exec(url);
  if (shorthand) url = `https://${shorthand[1].toLowerCase()}.${shorthand[1].toLowerCase() === 'bitbucket' ? 'org' : 'com'}/${shorthand[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '').replace(/^http:\/\//, 'https://');
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// the Markdown file
// ---------------------------------------------------------------------------------------------------------------------

/** A code fence longer than any run of backticks inside `text`. */
function fenceFor(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(longest + 1);
}

const cell = (text) => text.replace(/\|/g, '\\|');

export function renderMarkdown(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);
  const summary = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([license, count]) => `${license} (${count})`).join(', ');

  const out = [
    '<!-- Generated by scripts/third-party-licenses.mjs from package-lock.json and node_modules. Do not edit by hand: run "npm run licenses". -->',
    '',
    '# Third-Party Licenses · 서드파티 라이선스',
    '',
    'Discord Chat Extractor itself is released under the [MIT License](LICENSE). The extension that users install bundles the open-source packages listed below: the production dependencies of `package.json` and everything they need at run time. Development and build tools (Vite, TypeScript, Vitest and so on) are not part of the extension and are not listed. Each package keeps its own license, reproduced here as required by those licenses.',
    '',
    'Discord Chat Extractor 자체는 [MIT 라이선스](LICENSE)로 배포됩니다. 사용자가 설치하는 확장 프로그램에는 아래 오픈소스 패키지(`package.json`의 런타임 의존성과 그것이 실행 중에 필요로 하는 패키지)가 포함되어 있습니다. 개발·빌드 도구(Vite, TypeScript, Vitest 등)는 확장 프로그램에 포함되지 않으므로 이 목록에 없습니다. 각 패키지는 자신의 라이선스를 따르며, 해당 라이선스의 요구에 따라 전문을 아래에 싣습니다.',
    '',
    `**${entries.length} packages · ${summary}**`,
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...entries.map((entry) => `| ${cell(entry.name)} | ${cell(entry.version)} | ${cell(entry.license)} |`),
  ];

  for (const entry of entries) {
    out.push('', '---', '', `## ${entry.name} ${entry.version}`, '', `- License: ${entry.license}`);
    if (entry.repository !== null) out.push(`- Source: ${entry.repository}`);
    if (entry.copyright.length > 0) out.push(...entry.copyright.map((line) => `- Copyright: ${line}`));
    for (const file of entry.licenseFiles) {
      const fence = fenceFor(file.text);
      out.push('', `${fence}text`, file.text, fence);
    }
    for (const file of entry.notices) {
      const fence = fenceFor(file.text);
      out.push('', `NOTICE (${file.name}):`, '', `${fence}text`, file.text, fence);
    }
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// putting it together
// ---------------------------------------------------------------------------------------------------------------------

function readJson(path, problems, label) {
  if (!existsSync(path)) {
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

/**
 * @returns {{ problems: string[], warnings: string[], entries: object[], markdown: string | null }}
 * `markdown` is null when any problem was found: a file listing a rejected license must not be produced.
 */
export function collectThirdPartyLicenses({ rootDir = ROOT } = {}) {
  const problems = [];
  const warnings = [];
  const rootManifest = readJson(join(rootDir, 'package.json'), problems, 'package.json');
  const lock = readJson(join(rootDir, 'package-lock.json'), problems, 'package-lock.json');
  if (!rootManifest || !lock) return { problems, warnings, entries: [], markdown: null };

  const readInstalled = (key) => {
    const path = join(rootDir, key, 'package.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      problems.push(`${key}/package.json is not valid JSON`);
      return null;
    }
  };

  const packages = productionTree({ lock, rootManifest, readInstalled, problems });
  const entries = [];
  for (const pkg of packages) {
    const label = `${pkg.name}@${pkg.version}`;
    const license = declaredLicense(pkg.manifest);
    if (license === null) {
      problems.push(`${label}: no license declared in its package.json`);
      continue;
    }
    if (!isAllowedExpression(license)) {
      problems.push(`${label}: license "${license}" is not on the allow-list (${ALLOWED_LICENSES.join(', ')})`);
      continue;
    }
    const { licenses, notices } = readLegalFiles(join(rootDir, pkg.key));
    if (licenses.length === 0) {
      problems.push(`${label}: declares ${license} but ships no LICENSE/COPYING file to reproduce`);
      continue;
    }
    const copyright = [...new Set(licenses.flatMap((file) => copyrightLines(file.text)))];
    if (copyright.length === 0) warnings.push(`${label}: its license file has no "Copyright" line`);
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license,
      repository: repositoryUrl(pkg.manifest),
      copyright,
      licenseFiles: licenses,
      notices,
    });
  }

  return { problems, warnings, entries, markdown: problems.length === 0 ? renderMarkdown(entries) : null };
}

function main(argv) {
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  if (outIndex !== -1 && argv[outIndex + 1] === undefined) {
    console.error('--out needs a file path');
    return 1;
  }
  const outPath = resolve(outIndex === -1 ? join(ROOT, 'THIRD_PARTY_LICENSES.md') : argv[outIndex + 1]);

  const { problems, warnings, entries, markdown } = collectThirdPartyLicenses();
  for (const warning of warnings) console.warn(`warn ${warning}`);
  if (problems.length > 0 || markdown === null) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error(`\n${problems.length} problem(s) found; nothing was written`);
    return 1;
  }

  const licenses = [...new Set(entries.map((entry) => entry.license))].sort().join(', ');
  console.log(`ok   ${entries.length} production package(s), licenses: ${licenses}`);
  for (const entry of entries) console.log(`     ${entry.name}@${entry.version}  ${entry.license}`);

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== markdown) {
      console.error(`FAIL ${outPath} is ${current === null ? 'missing' : 'out of date'} - run "npm run licenses"`);
      return 1;
    }
    console.log(`ok   ${outPath} is up to date`);
    return 0;
  }

  writeFileSync(outPath, markdown, 'utf8');
  console.log(`wrote ${outPath}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
