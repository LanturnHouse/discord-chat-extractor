// Documentation screenshots (docs/images/ko/*.png and docs/images/en/*.png) of the REAL built extension in demo mode.
//
//   npm run build            (this script rebuilds dist/ itself when it is missing or older than src/)
//   node e2e/screenshots.mjs [--lang=ko|en|all] [--only=01,05] [--out=<dir>]
//
// What it does, per language and per picture (every picture gets its own throw-away browser, so no state leaks between them):
//   1. starts a headless Chrome (profile in e2e/.tmp/screenshots/, never your own profile) with the built dist/ installed
//      through the DevTools `Extensions.loadUnpacked` command over a debugging pipe (same technique as e2e/real-extension.mjs;
//      branded Chrome >= 137 ignores --load-extension);
//   2. opens chrome-extension://<id>/app.html?mock=1 (demo mode: a made-up world, no Discord account, no token, no network)
//      at 1280x800, device scale 1, and drives the UI with real mouse clicks like a user would;
//   3. takes the pictures listed in SCENES (01-main, 02-selection, 03-options, 04-channel-settings, 05-progress, 06-onboarding,
//      07-export-html: a file the app exported, opened from disk) and writes them as optimised PNGs (pure Node, no npm packages).
//
// Privacy: only the built-in fictional demo data is ever on screen. The hosts cdn.discordapp.com, media.discordapp.net and
// discord.com are blocked in the browser (--host-resolver-rules), so no Discord artwork appears (initial-letter fallbacks show
// instead) and nothing can reach Discord. The language of the app AND of the exported HTML file is set through the app's own
// preference (chrome.storage.local), the date inputs follow Chrome's --lang.
// Everything the script writes outside the output folders lives in e2e/.tmp/screenshots/ (git-ignored) and is deleted at the end.
// Chrome is started with its own process tree and that tree is killed (taskkill /T on Windows) in every case.
//
// Set CHROME_PATH to use another Chrome/Chromium (>= 116).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TMP = path.join(ROOT, 'e2e', '.tmp', 'screenshots');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Matches any aria-label + text (also an empty one), for elements that are found by their selector alone. */
export const ANY = /[\s\S]*/;
/** A RegExp matching `text` literally. */
export const literal = (text, flags = '') => new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
/** A RegExp matching exactly one line of the "aria-label + newline + text" string `page.click` looks at. */
export const line = (text) => new RegExp(`(^|\\n)\\s*${literal(text).source}\\s*(\\n|$)`);

// ---------------------------------------------------------------------------------------------------------------------
// build freshness

function newestMtime(entry) {
  const stat = fs.statSync(entry, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const name of fs.readdirSync(entry)) newest = Math.max(newest, newestMtime(path.join(entry, name)));
  return newest;
}

export function ensureFreshBuild() {
  const built = newestMtime(path.join(ROOT, 'dist', 'app.html'));
  const sources = ['src', 'public', 'app.html', 'vite.config.ts', 'package.json'].map((p) => newestMtime(path.join(ROOT, p)));
  if (built > 0 && built >= Math.max(...sources)) return;
  console.log('dist/ is missing or older than src/: running "npm run build" ...');
  const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error('npm run build failed');
}

// ---------------------------------------------------------------------------------------------------------------------
// Chrome over the DevTools pipe

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

/** Browsers this process started and has not closed yet: whatever way the script ends (error, Ctrl+C), none of them is left behind. */
const LIVE_BROWSERS = new Set();
process.on('exit', () => LIVE_BROWSERS.forEach((close) => close()));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));

/** Starts Chrome; resolves to a small CDP client. `chromeLang` is Chrome's UI language (it decides how <input type=date> looks). */
export async function launchChrome({ name, chromeLang, width = 1280, height = 800 }) {
  const profile = path.join(TMP, `profile-${name}`);
  const downloads = path.join(TMP, `downloads-${name}`);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(downloads, { recursive: true, force: true });
  fs.mkdirSync(downloads, { recursive: true });

  const child = spawn(
    findChrome(),
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      `--lang=${chromeLang}`,
      `--window-size=${width},${height}`,
      '--host-resolver-rules=MAP cdn.discordapp.com ~NOTFOUND, MAP media.discordapp.net ~NOTFOUND, MAP discord.com ~NOTFOUND',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );

  let seq = 0;
  const pending = new Map();
  let buffer = '';
  const toChrome = child.stdio[3];
  child.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}`));
        else resolve(message.result);
      }
    }
  });

  let exited = false;
  child.on('exit', () => {
    exited = true;
    for (const { reject } of pending.values()) reject(new Error('Chrome exited'));
    pending.clear();
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error('Chrome exited'));
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no answer to ${method} within 60 s`));
      }, 60000);
      pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    LIVE_BROWSERS.delete(close);
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  };
  LIVE_BROWSERS.add(close);

  await sleep(1500);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  return { send, close, downloads, profile };
}

/** A page target with the helpers the scenes need. */
export async function openPage(chrome, { width = 1280, height = 800 } = {}) {
  const { send } = chrome;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const to = (method, params = {}) => send(method, params, sessionId);
  await to('Page.enable');
  await to('Runtime.enable');
  await to('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await to('Page.bringToFront');

  const page = {
    targetId,
    sessionId,
    to,
    async ev(expression) {
      const result = await to('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async waitFor(expression, ms = 15000, what = expression) {
      const started = Date.now();
      while (Date.now() - started < ms) {
        try {
          const value = await page.ev(expression);
          if (value) return value;
        } catch {
          // The page is navigating or not ready yet.
        }
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${what}`);
    },
    async goto(url) {
      await to('Page.navigate', { url });
      await sleep(300);
      await page.waitFor(`document.readyState === 'complete'`, 20000, `load of ${url}`);
    },
    /**
     * Clicks the first element of `selector` whose aria-label + text matches `pattern` (a RegExp) with a REAL mouse click, so
     * hover styles and :focus-visible behave as they do for a person; throws when there is no such element.
     */
    async click(selector, pattern) {
      const spot = await page.ev(
        `(() => { const re = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)}); ` +
          `const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => re.test((e.getAttribute('aria-label') || '') + '\\n' + (e.textContent || ''))); ` +
          `if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); ` +
          `return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      if (!spot) throw new Error(`nothing to click: ${selector} ~ ${pattern}`);
      await to('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y });
      await sleep(60);
      await to('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await to('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await sleep(80);
    },
    /** Takes the mouse out of the window, so no hover state or tooltip ends up in a screenshot. */
    async mouseAway() {
      await to('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -20, y: -20 });
      await sleep(250);
    },
    async resize(width, height) {
      await to('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
    },
    /** Sets an <input> the way a user typing would (React listens to the input event). */
    async setInput(selector, value) {
      const ok = await page.ev(
        `(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) return false; ` +
          `const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(String(value))}); ` +
          `i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      );
      if (!ok) throw new Error(`no such input: ${selector}`);
    },
    /** PNG bytes of the viewport (or of `clip`). */
    async shot(clip) {
      const { data } = await to('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      return Buffer.from(data, 'base64');
    },
    async rect(selector) {
      return page.ev(
        `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      );
    },
  };
  return page;
}

// ---------------------------------------------------------------------------------------------------------------------
// PNG optimisation (pure Node): re-filter every scanline with the best of the five PNG filters, re-deflate at level 9, and,
// only when the file is still too big, reduce the colours (keep the 256 most common ones and map every other colour to the
// nearest of them) so the result is an 8-bit palette PNG.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0 || (header.colorType !== 2 && header.colorType !== 6)) throw new Error('unsupported PNG layout');
  const bpp = header.colorType === 6 ? 4 : 3;
  const stride = header.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= bpp ? up[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  return { width: header.width, height: header.height, bpp, pixels };
}

/** Image as tightly packed RGB (the alpha channel of a screenshot is always opaque). */
function toRgb({ width, height, bpp, pixels }) {
  if (bpp === 3) return pixels;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    rgb[j] = pixels[i];
    rgb[j + 1] = pixels[i + 1];
    rgb[j + 2] = pixels[i + 2];
  }
  return rgb;
}

function filterLine(filter, line, up, bpp) {
  const out = Buffer.alloc(line.length);
  for (let x = 0; x < line.length; x += 1) {
    const a = x >= bpp ? line[x - bpp] : 0;
    const b = up ? up[x] : 0;
    const c = up && x >= bpp ? up[x - bpp] : 0;
    let predictor = 0;
    if (filter === 1) predictor = a;
    else if (filter === 2) predictor = b;
    else if (filter === 3) predictor = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = (line[x] - predictor) & 0xff;
  }
  return out;
}

function encodeFiltered(width, height, bpp, data, headerFields, extraChunks) {
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = null;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter += 1) {
      const candidate = filter === 0 ? line : filterLine(filter, line, up, bpp);
      let score = 0; // the usual heuristic: sum of absolute values of the filtered bytes read as signed
      for (const byte of candidate) score += byte < 128 ? byte : 256 - byte;
      if (score < bestScore) {
        bestScore = score;
        best = Buffer.concat([Buffer.from([filter]), candidate]);
      }
    }
    rows.push(best);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = headerFields.colorType;
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9, memLevel: 9 });
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...extraChunks, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function quantize(rgb, width, height) {
  const counts = new Map();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size <= 256) {
    const palette = [...counts.keys()];
    return { palette, indexOf: new Map(palette.map((key, index) => [key, index])) };
  }
  // Keep the 255 most used colours; every other colour maps to the closest of them (anti-aliased text edges are
  // all between two common colours anyway).
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([key]) => key);
  const cache = new Map();
  const indexOf = {
    get(key) {
      let index = cache.get(key);
      if (index === undefined) {
        const r = (key >> 16) & 255;
        const g = (key >> 8) & 255;
        const b = key & 255;
        let bestDistance = Infinity;
        index = 0;
        for (let p = 0; p < palette.length; p += 1) {
          const pr = (palette[p] >> 16) & 255;
          const pg = (palette[p] >> 8) & 255;
          const pb = palette[p] & 255;
          const distance = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            index = p;
          }
        }
        cache.set(key, index);
      }
      return index;
    },
  };
  return { palette, indexOf };
}

/** Returns a PNG that looks the same (lossless) or, when `maxBytes` still is not met, a 256-colour version of it. */
export function optimizePng(buffer, maxBytes = 350 * 1024) {
  const image = decodePng(buffer);
  const rgb = toRgb(image);
  let best = encodeFiltered(image.width, image.height, 3, rgb, { colorType: 2 }, []);
  if (best.length <= maxBytes) return { png: best, lossy: false };

  const { palette, indexOf } = quantize(rgb, image.width, image.height);
  const indices = Buffer.alloc(image.width * image.height);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 1) indices[p] = indexOf.get((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]);
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((key, index) => {
    plte[index * 3] = (key >> 16) & 255;
    plte[index * 3 + 1] = (key >> 8) & 255;
    plte[index * 3 + 2] = key & 255;
  });
  const indexed = encodeFiltered(image.width, image.height, 1, indices, { colorType: 3 }, [chunk('PLTE', plte)]);
  best = indexed.length < best.length ? indexed : best;
  return { png: best, lossy: best === indexed };
}

// ---------------------------------------------------------------------------------------------------------------------
// the scenes

/**
 * What differs between the two languages: Chrome's UI language (it decides how the date inputs look), the demo server the
 * screenshots are about, what is ticked, and the aria-labels of the checkboxes (src/app/components/sidebar/strings.ts).
 * Both sets tick channels of two servers plus one DM, so the rail badges, the "N selected" list and the progress dialog show
 * that a selection survives switching servers. `general` of the busiest demo server (2,687 messages) is in both selections so
 * that the export runs long enough to be captured half way.
 */
export const LANGS = {
  ko: {
    chromeLang: 'ko',
    timezone: 'Asia/Seoul',
    heroGuild: '개발자 라운지',
    heroChannel: 'general',
    // aria-label of a row checkbox; channel names may start with an emoji and a separator ("👋-welcome"), so the name is a suffix match
    checkLabel: (name) => new RegExp(`${literal(name).source} 내보내기 선택`),
    exportOptionsLabel: '내보내기 옵션',
    limitLabel: '개수 지정',
    ticks: [
      { guild: '개발자 라운지', channels: ['welcome', 'general', '잡담'] },
      { guild: 'Open Source Garage', channels: ['ui-kit'] },
    ],
    dms: ['김민준'],
    gearChannel: 'general',
    // candidates for the exported-file picture, best first (see 07-export-html)
    exportChannels: [{ guild: '개발자 라운지', channel: 'rules' }, { guild: '개발자 라운지', channel: 'faq' }, { guild: '개발자 라운지', channel: 'roadmap' }],
  },
  en: {
    chromeLang: 'en-US',
    timezone: 'Etc/UTC',
    heroGuild: 'Open Source Garage',
    heroChannel: 'hangout',
    checkLabel: (name) => new RegExp(`Select (?:\\S*[-｜|] ?)?${literal(name).source} for export`),
    exportOptionsLabel: 'Export options',
    limitLabel: 'Limit to N',
    ticks: [
      { guild: 'Open Source Garage', channels: ['ui-kit', 'hangout'] },
      { guild: '개발자 라운지', channels: ['welcome', 'general'] },
    ],
    dms: ['Alex Rivera'],
    gearChannel: 'hangout',
    exportChannels: [
      { guild: 'Open Source Garage', channel: 'help-wanted' },
      { guild: 'Open Source Garage', channel: 'show-and-tell' },
      { guild: 'Open Source Garage', channel: 'docs' },
      { guild: 'Open Source Garage', channel: 'ui-kit' },
    ],
  },
};

const SCENES = ['01-main', '02-selection', '03-options', '04-channel-settings', '05-progress', '06-onboarding', '07-export-html'];

export class Scenes {
  constructor(cfg, chrome, page, extId) {
    Object.assign(this, { cfg, chrome, page, extId });
  }

  /** A fresh page load of the demo app: nothing selected, default options (the language and format live in the prefs). */
  async boot() {
    const { page, extId } = this;
    await page.goto(`chrome-extension://${extId}/app.html?mock=1`);
    await page.waitFor(`!!document.querySelector('.app-shell')`, 20000, 'the app shell');
    await sleep(300);
  }

  async openGuild(name) {
    const { page } = this;
    await page.click('.app-rail button.rail__icon', line(name));
    await page.waitFor(
      `!!document.querySelector('.app-sidebar .sb-guild-header') && document.querySelectorAll('.app-sidebar .sb-channel__name').length > 2`,
      15000,
      `the channel list of ${name}`,
    );
    await sleep(350);
  }

  async openChannel(name) {
    const { page } = this;
    await page.click('.app-sidebar button[data-sb-nav]', literal(name));
    await page.waitFor(`document.querySelectorAll('article.msg').length > 3`, 15000, `messages of ${name}`);
    // The list scrolls to the newest message after it was filled.
    await sleep(900);
  }

  async openDms() {
    await this.page.click('.app-rail button.rail__icon--home', /./);
    await this.page.waitFor(`!!document.querySelector('.app-sidebar .sb-search')`, 10000, 'the DM list');
    await sleep(250);
  }

  async tick(name) {
    await this.page.click('.app-sidebar [role="checkbox"]', this.cfg.checkLabel(name));
    await sleep(150);
  }

  /** Ticks the channels and DMs of the language's selection and ends on the hero channel. */
  async tickSelection() {
    for (const { guild, channels } of this.cfg.ticks) {
      await this.openGuild(guild);
      for (const channel of channels) await this.tick(channel);
    }
    await this.openDms();
    for (const dm of this.cfg.dms) await this.tick(dm);
    await this.openGuild(this.cfg.heroGuild);
    await this.openChannel(this.cfg.heroChannel);
  }

  /** Opens the options popover (the caret of the Download button). */
  async openOptions() {
    await this.page.click('.topbar__split-caret', literal(this.cfg.exportOptionsLabel));
    await this.page.waitFor(`!!document.querySelector('.topbar-options')`, 5000, 'the options popover');
    await sleep(350);
  }

  async openSelectionList() {
    await this.page.click('button.topbar__chip', /./);
    await this.page.waitFor(`!!document.querySelector('.topbar-sel__groups')`, 5000, 'the selection list');
    await sleep(350);
  }

  // --- the screenshots ------------------------------------------------------------------------------------------------

  async '01-main'() {
    await this.boot();
    await this.openGuild(this.cfg.heroGuild);
    await this.openChannel(this.cfg.heroChannel);
    await this.page.mouseAway();
    return this.page.shot();
  }

  async '02-selection'() {
    await this.boot();
    await this.tickSelection();
    await this.page.mouseAway();
    return this.page.shot();
  }

  /**
   * The options popover is taller than an 800 px window (it scrolls inside), so for this one picture the window is made tall,
   * the popover's own height limit is lifted and the shot is cropped to the popover alone.
   */
  async '03-options'() {
    const { page, cfg } = this;
    await this.boot();
    await this.tickSelection();
    await this.openOptions();
    // "Limit to N" with 200 and a start date: the combination that needs the most explaining.
    await page.click('.topbar-options [role="radio"]', line(cfg.limitLabel));
    await sleep(200);
    await page.setInput('.topbar-count__input', 200);
    await page.setInput('.topbar-range__input', '2026-09-01');
    await sleep(300);
    await page.ev(
      `(() => { const style = document.createElement('style'); style.textContent = '.topbar-popover { max-height: none !important; }'; document.head.append(style); })()`,
    );
    await page.resize(1280, 1500);
    await page.mouseAway();
    const box = await page.rect('.topbar-options');
    if (!box) throw new Error('the options popover disappeared');
    const png = await page.shot({ x: Math.round(box.x) - 1, y: Math.round(box.y) - 1, width: Math.round(box.width) + 2, height: Math.round(box.height) + 2 });
    await page.resize(1280, 800);
    return png;
  }

  async '04-channel-settings'() {
    const { page, cfg } = this;
    await this.boot();
    await this.tickSelection();
    await this.openSelectionList();
    await page.click('.topbar-sel__gear', literal(cfg.gearChannel));
    await page.waitFor(`!!document.querySelector('.topbar-scope')`, 5000, 'the channel settings panel');
    await sleep(300);
    // The editor is already open (no "use common settings" step): choose "Limit to N" with 200 and the row says what this channel gets.
    await page.click('.topbar-scope [role="radio"]', line(cfg.limitLabel));
    await sleep(200);
    await page.setInput('.topbar-scope .topbar-count__input', 200);
    await sleep(400);
    // The panel grew while it was edited: bring all of it into view again.
    await page.ev(`document.querySelector('.topbar-scope').scrollIntoView({ block: 'nearest' })`);
    await page.mouseAway();
    return page.shot();
  }

  async '05-progress'() {
    const { page } = this;
    await this.boot();
    await this.tickSelection();
    await page.click('.topbar__split-main', ANY);
    await page.waitFor(`!!document.querySelector('.topbar-dialog')`, 5000, 'the progress dialog');
    // Half way through the long channel: some channels done, one fetching with a percentage, the rest waiting.
    await page.waitFor(
      `(() => { const rows = [...document.querySelectorAll('.topbar-targets__row')]; ` +
        `const busy = rows.find((r) => r.dataset.status === 'fetching'); ` +
        `const done = rows.filter((r) => r.dataset.status === 'done').length; ` +
        `const m = busy && /(\\d+)\\s*%/.exec(busy.querySelector('.topbar-targets__state')?.textContent ?? ''); ` +
        `return done >= 1 && m && Number(m[1]) >= 40 && Number(m[1]) <= 90; })()`,
      30000,
      'the export to be half way',
    );
    await page.mouseAway();
    const png = await page.shot();
    // Let it finish so the page can be left without the "unsaved work" prompt.
    await page.waitFor(`document.querySelector('.topbar-dialog__title') && !document.querySelector('.topbar-progress')`, 60000, 'the export to finish');
    return png;
  }

  /**
   * The "login needed" screen: no token was captured, which is the normal state of a Discord tab that was already open when the
   * extension was installed. The extension only looks at the ADDRESS of Discord tabs, so one tab at https://discord.com/app is
   * enough; discord.com cannot be resolved in this browser, so it stays an empty error page and nothing reaches Discord.
   */
  async '06-onboarding'() {
    const { page, extId, chrome } = this;
    const { targetId } = await chrome.send('Target.createTarget', { url: 'https://discord.com/app' });
    try {
      await sleep(1500);
      await page.to('Page.bringToFront');
      await page.goto(`chrome-extension://${extId}/app.html`);
      await page.waitFor(`!!document.querySelector('.onboarding__card')`, 20000, 'the onboarding screen');
      await page.waitFor(`!!document.querySelector('.onboarding__actions button')`, 15000, 'the Discord tab check');
      await sleep(400);
      await page.mouseAway();
      return await page.shot();
    } finally {
      await chrome.send('Target.closeTarget', { targetId }).catch(() => undefined);
    }
  }

  /**
   * Exports one small channel through the UI (one channel = a plain .html file, no ZIP), reads the file the browser saved and
   * opens it from disk (file://) in the same browser. Custom emoji are the one thing that needs Discord's servers (blocked here),
   * so the first candidate whose first screen has no broken picture is used.
   */
  async '07-export-html'() {
    const { page, cfg, chrome } = this;
    let last = null;
    for (const candidate of cfg.exportChannels) {
      await this.boot();
      await this.openGuild(candidate.guild);
      await this.tick(candidate.channel);
      await this.openChannel(candidate.channel);
      // unlinkSync, not rmSync: Node 24's rmSync aborts the whole process on a file name with Korean letters (the exported file is named after the server)
      for (const name of fs.readdirSync(chrome.downloads)) fs.unlinkSync(path.join(chrome.downloads, name));
      await page.click('.topbar__split-main', ANY);
      await page.waitFor(`document.querySelector('.topbar-dialog__title') && !document.querySelector('.topbar-progress')`, 60000, 'the export to finish');
      let file = null;
      for (let i = 0; i < 50 && !file; i += 1) {
        const names = fs.readdirSync(chrome.downloads);
        // Chrome may drop other files of its own into the folder; only the finished .html counts.
        if (!names.some((n) => n.endsWith('.crdownload'))) file = names.find((n) => n.endsWith('.html')) ?? null;
        if (!file) await sleep(200);
      }
      if (!file) throw new Error('the export did not produce an .html file');
      await page.goto(pathToFileURL(path.join(chrome.downloads, file)).href);
      await sleep(700);
      last = await page.shot();
      const broken = await page.ev(
        `[...document.images].filter((img) => img.getBoundingClientRect().top < innerHeight && !(img.complete && img.naturalWidth > 0)).length`,
      );
      if (broken === 0) return last;
      console.log(`  ${candidate.channel}: ${broken} picture(s) cannot load in the first screen, trying the next channel`);
    }
    return last;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// main

function parseArgs(argv) {
  const args = { lang: 'all', only: null, out: path.join(ROOT, 'docs', 'images') };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'lang') args.lang = value;
    else if (key === 'only') args.only = value.split(',').map((v) => v.trim());
    else if (key === 'out') args.out = path.resolve(value);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/**
 * One scene = one throw-away browser: no state (selection, options, a half-open popover) can leak from one picture into the
 * next, and a browser that died in the middle only costs that scene.
 */
async function runScene(lang, scene) {
  const cfg = LANGS[lang];
  const chrome = await launchChrome({ name: `${lang}-${scene.slice(0, 2)}`, chromeLang: cfg.chromeLang });
  try {
    const { id: extId } = await chrome.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'dist') });
    const page = await openPage(chrome);

    // Times in the pictures (and in the exported file) do not depend on the time zone of the machine that runs this.
    await page.to('Emulation.setTimezoneOverride', { timezoneId: cfg.timezone });

    // The language is the app's own preference (the same storage the options popover writes to).
    await page.goto(`chrome-extension://${extId}/app.html?mock=1`);
    await page.waitFor(`!!document.querySelector('.app-shell')`, 20000, 'the app shell');
    await page.ev(`chrome.storage.local.set({ 'dce.prefs': { exportFormat: 'html', htmlTheme: 'dark', locale: ${JSON.stringify(lang)} } })`);

    return await new Scenes(cfg, chrome, page, extId)[scene]();
  } finally {
    chrome.close();
  }
}

async function runLanguage(lang, args) {
  const outDir = path.join(args.out, lang);
  fs.mkdirSync(outDir, { recursive: true });
  for (const scene of SCENES) {
    if (args.only && !args.only.some((id) => scene.startsWith(id))) continue;
    let raw;
    for (let attempt = 1; ; attempt += 1) {
      try {
        raw = await runScene(lang, scene);
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
        console.log(`${lang}/${scene}: ${error.message} - trying once more`);
      }
    }
    const { png, lossy } = optimizePng(raw);
    fs.writeFileSync(path.join(outDir, `${scene}.png`), png);
    console.log(`${lang}/${scene}.png  ${(png.length / 1024).toFixed(0)} KB${lossy ? '  (256 colours)' : ''}`);
  }
}

function cleanUp() {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  const tmp = path.dirname(TMP);
  if (fs.existsSync(tmp) && fs.readdirSync(tmp).length === 0) fs.rmdirSync(tmp);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const langs = args.lang === 'all' ? ['ko', 'en'] : [args.lang];
  let failed = false;
  try {
    ensureFreshBuild();
    for (const lang of langs) await runLanguage(lang, args);
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await sleep(800); // let Windows release the profile folder
    cleanUp();
  }
  process.exitCode = failed ? 1 : 0;
}
