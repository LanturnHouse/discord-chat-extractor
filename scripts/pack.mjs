// Zips dist/ into discord-chat-extractor-v<version>.zip at the repo root. The zip root = the CONTENTS of dist/ (manifest.json
// at the top level, which is what the Chrome Web Store and "unzip + Load unpacked" both expect), plus the project's legal and
// reader documents from the repo root (see DOC_FILES). dist/ itself is never touched, so `npm run verify` is unaffected.
//   node scripts/pack.mjs [--strict]     (npm run pack builds first; npm run pack -- --strict)
// --strict: a missing document is an error instead of a warning (the release workflow uses it).
// The archive is reproducible: entries are sorted and carry a fixed timestamp, so the same dist/ gives the same SHA-256.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { verifyDist } from './verify-dist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files copied from the repo root into the zip root (when they exist), in the order they are reported. */
export const DOC_FILES = ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'README.md', 'TERMS.md', 'PRIVACY.md', 'DISCLAIMER.md'];

// ZIP stores local time without a zone; built from local components so the bytes do not depend on the machine's time zone.
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = posix.join(prefix, entry.name); // forward slashes in zip entry names on every OS
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const readBytes = (path) => new Uint8Array(readFileSync(path));

/**
 * What goes into the zip: every file of distDir, then each DOC_FILES entry that exists in rootDir.
 * @returns {{ files: Record<string, Uint8Array>, distCount: number, docs: string[], missingDocs: string[], skippedDocs: string[] }}
 *   `skippedDocs` are documents that dist/ already ships under the same name (the dist/ copy wins).
 */
export function collectEntries({ distDir = join(ROOT, 'dist'), rootDir = ROOT } = {}) {
  const files = {};
  for (const rel of listFiles(distDir).sort()) files[rel] = readBytes(join(distDir, rel));
  const distCount = Object.keys(files).length;

  const docs = [];
  const missingDocs = [];
  const skippedDocs = [];
  for (const name of DOC_FILES) {
    const source = join(rootDir, name);
    if (!isFile(source)) missingDocs.push(name);
    else if (Object.hasOwn(files, name)) skippedDocs.push(name);
    else {
      files[name] = readBytes(source);
      docs.push(name);
    }
  }
  return { files, distCount, docs, missingDocs, skippedDocs };
}

/** Deterministic zip of `files` (sorted keys, fixed timestamps, maximum compression). */
export function zipEntries(files) {
  const sorted = Object.fromEntries(Object.keys(files).sort().map((name) => [name, files[name]]));
  return zipSync(sorted, { level: 9, mtime: FIXED_MTIME });
}

/** Reads the zip back and compares it with what should be in it. @returns {string[]} problems (empty = the zip is good) */
export function checkZip(zipBytes, expected) {
  const problems = [];
  let actual;
  try {
    actual = unzipSync(zipBytes);
  } catch (error) {
    return [`the zip cannot be read back: ${error.message}`];
  }
  if (!Object.hasOwn(actual, 'manifest.json')) problems.push('manifest.json is not at the zip root');
  for (const name of Object.keys(expected)) {
    if (!Object.hasOwn(actual, name)) problems.push(`${name} is missing from the zip`);
    else if (Buffer.compare(Buffer.from(actual[name]), Buffer.from(expected[name])) !== 0) problems.push(`${name} differs from its source file`);
  }
  for (const name of Object.keys(actual)) {
    if (!Object.hasOwn(expected, name)) problems.push(`${name} is in the zip but was not expected`);
  }
  return problems;
}

function main() {
  const strict = process.argv.slice(2).includes('--strict');
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    console.error('dist/ does not exist - run "npm run build" first');
    process.exit(1);
  }

  const { problems } = verifyDist({ distDir, rootDir: ROOT });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error('\ndist/ failed verification; not packing');
    process.exit(1);
  }

  const { files, distCount, docs, missingDocs, skippedDocs } = collectEntries({ distDir, rootDir: ROOT });
  for (const name of skippedDocs) console.warn(`warn  ${name} already exists in dist/, the repo-root copy is not added`);
  for (const name of missingDocs) {
    if (strict) console.error(`FAIL ${name} is missing from the repo root (--strict)`);
    else console.warn(`warn  ${name} is missing from the repo root and is not in the zip`);
  }
  if (strict && missingDocs.length > 0) process.exit(1);

  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const zipName = `discord-chat-extractor-v${version}.zip`;
  const zipPath = join(ROOT, zipName);
  const zipBytes = zipEntries(files);
  rmSync(zipPath, { force: true });
  writeFileSync(zipPath, zipBytes);

  // Read the file back from disk (not the in-memory bytes) so a truncated or corrupt write cannot be released.
  const zipProblems = checkZip(readBytes(zipPath), files);
  if (zipProblems.length > 0) {
    for (const problem of zipProblems) console.error(`FAIL ${problem}`);
    rmSync(zipPath, { force: true });
    console.error('\nthe zip failed its self-check; removed');
    process.exit(1);
  }

  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  console.log(`packed ${distCount} dist file(s) + ${docs.length} document(s) [${docs.join(', ') || 'none'}] -> ${zipPath} (${(statSync(zipPath).size / 1024).toFixed(1)} KiB)`);
  console.log(`sha256 ${sha256}  ${zipName}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
