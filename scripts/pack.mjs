// Zips dist/ into discord-chat-extractor-v<version>.zip at the repo root (zip root = the CONTENTS of dist/,
// which is what the Chrome Web Store expects: manifest.json at the top level).
//   node scripts/pack.mjs      (npm run pack builds first)
import { readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { verifyDist } from './verify-dist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = posix.join(prefix, entry.name); // forward slashes in zip entry names on every OS
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

try {
  statSync(DIST);
} catch {
  console.error('dist/ does not exist - run "npm run build" first');
  process.exit(1);
}

const { problems } = verifyDist({ distDir: DIST, rootDir: ROOT });
if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  console.error('\ndist/ failed verification; not packing');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const files = {};
for (const rel of listFiles(DIST).sort()) files[rel] = new Uint8Array(readFileSync(join(DIST, rel)));

const zipPath = join(ROOT, `discord-chat-extractor-v${version}.zip`);
rmSync(zipPath, { force: true });
writeFileSync(zipPath, zipSync(files, { level: 9 }));
console.log(`packed ${Object.keys(files).length} files -> ${zipPath} (${(statSync(zipPath).size / 1024).toFixed(1)} KiB)`);
