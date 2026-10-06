import type { ExportTarget } from './types';

/** Longest single path component we emit, in UTF-16 code units (keeps nested ZIP paths within typical OS limits). */
const MAX_COMPONENT_UNITS = 80;

const DM_FOLDER = 'Direct Messages';

/** Zero-width / bidi-control characters: invisible, and RLO-style ones could make the appended extension read backwards. */
const INVISIBLE = /[\u200B\u2060\uFEFF\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Windows-forbidden characters plus C0/C1 control characters and DEL. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Windows device names; the superscript digits are reserved too on current Windows. */
const RESERVED_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$/i;

function trimDotsAndSpaces(s: string): string {
  return s.replace(/^[. ]+|[. ]+$/g, '');
}

/** Cuts to `max` UTF-16 code units without leaving half of a surrogate pair behind. */
function capUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

function cleanComponent(name: string): string {
  let s = name.normalize('NFC');
  // Whitespace is collapsed before FORBIDDEN runs so that tabs/newlines become spaces instead of underscores.
  s = s.replace(INVISIBLE, '').replace(/\s+/g, ' ').replace(FORBIDDEN, '_').replace(LONE_SURROGATE, '_');
  s = trimDotsAndSpaces(s);
  if (s === '') return '';

  // Windows treats "CON", "con.txt" and "CON.anything" alike, so the check looks at the part before the first dot.
  const dot = s.indexOf('.');
  const base = dot === -1 ? s : s.slice(0, dot);
  if (RESERVED_DEVICE.test(base.trimEnd())) s = `${base}_${s.slice(base.length)}`;

  return trimDotsAndSpaces(capUnits(s, MAX_COMPONENT_UNITS));
}

/**
 * Turns arbitrary (attacker-controlled) text into one safe path component: no separators, no Windows-forbidden or
 * control characters, no reserved device names, no leading/trailing dots or spaces, at most 80 UTF-16 code units.
 */
export function sanitizeFileName(name: string, fallback = 'unnamed'): string {
  return cleanComponent(name) || cleanComponent(fallback) || 'unnamed';
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\.+/, '');
}

function isDirectMessage(target: ExportTarget): boolean {
  return target.kind === 'dm' || target.kind === 'group-dm';
}

/** "general", or "Parent - Thread" for threads (a thread name alone is rarely meaningful). */
function channelLabel(target: ExportTarget): string {
  const name = sanitizeFileName(target.channelName, target.channelId);
  if (target.kind === 'thread' && target.parentChannelName) {
    return `${sanitizeFileName(target.parentChannelName, target.channelId)} - ${name}`;
  }
  return name;
}

/**
 * Case-insensitive view of the entry paths handed out so far (ZIP paths that differ only by case collide when
 * extracted on Windows/macOS). Besides the files it knows every folder they sit in, because an extractor cannot
 * create a file and a folder of the same name.
 */
class PathIndex {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();

  constructor(used: ReadonlySet<string>) {
    for (const path of used) {
      const lower = path.toLowerCase();
      this.files.add(lower);
      for (let slash = lower.indexOf('/'); slash !== -1; slash = lower.indexOf('/', slash + 1)) {
        this.folders.add(lower.slice(0, slash));
      }
    }
  }

  /** `path` as a file would be the same path as another file or as a folder that already holds files. */
  fileClashes(path: string): boolean {
    const lower = path.toLowerCase();
    return this.files.has(lower) || this.folders.has(lower) || this.insideFile(lower);
  }

  /** `path` as a folder would be the same path as a file, or would sit inside one. */
  folderClashes(path: string): boolean {
    return this.insideFile(path.toLowerCase());
  }

  /** `lower` is a file, or one of its parent folders is. */
  private insideFile(lower: string): boolean {
    if (this.files.has(lower)) return true;
    for (let slash = lower.indexOf('/'); slash !== -1; slash = lower.indexOf('/', slash + 1)) {
      if (this.files.has(lower.slice(0, slash))) return true;
    }
    return false;
  }
}

/**
 * Entry path inside the export ZIP: "Server/Category/channel.ext", "Server/channel.ext" (no category),
 * "Direct Messages/name.ext", or "Server/Category/Parent - Thread.ext".
 * On a (case-insensitive) collision the channel id is appended: "channel [123].ext". The final path is added to `used`.
 *
 * A file and a folder may not share a path either. Category names are free text, so a category "general.html" next to
 * an uncategorised channel "general" would otherwise yield the file "Srv/general.html" and the folder "Srv/general.html/",
 * which no extractor can unpack. The file gets the id suffix; when the folder is the newcomer it gets " (2)" and so on
 * (the same for every channel of that category, which keeps them together).
 */
export function entryPathFor(target: ExportTarget, ext: string, used: Set<string>): string {
  const index = new PathIndex(used);
  const folders: string[] = [];
  if (isDirectMessage(target)) {
    folders.push(DM_FOLDER);
  } else {
    folders.push(sanitizeFileName(target.guildName ?? '', 'Unknown Server'));
    if (target.categoryName) folders.push(sanitizeFileName(target.categoryName, 'Category'));
  }
  for (let level = 0; level < folders.length; level += 1) {
    const parents = folders.slice(0, level).join('/');
    const name = folders[level];
    let candidate = name;
    for (let n = 2; index.folderClashes(parents === '' ? candidate : `${parents}/${candidate}`); n += 1) candidate = `${name} (${n})`;
    folders[level] = candidate;
  }

  const prefix = `${folders.join('/')}/`;
  const suffix = `.${normalizeExt(ext)}`;
  const label = channelLabel(target);

  let path = `${prefix}${label}${suffix}`;
  if (index.fileClashes(path)) {
    const withId = `${label} [${target.channelId}]`;
    path = `${prefix}${withId}${suffix}`;
    // Only reachable when the same channel is exported twice; the counter keeps the path unique regardless.
    for (let n = 2; index.fileClashes(path); n += 1) path = `${prefix}${withId} (${n})${suffix}`;
  }
  used.add(path);
  return path;
}

/** Name of a lone exported file: "Server - channel.ext" (DMs: "name.ext"). */
export function singleFileName(target: ExportTarget, ext: string): string {
  const suffix = `.${normalizeExt(ext)}`;
  if (isDirectMessage(target)) return `${channelLabel(target)}${suffix}`;
  return `${sanitizeFileName(target.guildName ?? '', 'Unknown Server')} - ${channelLabel(target)}${suffix}`;
}

/** "Discord Export 2026-10-06.zip" using the date in the user's local time zone. */
export function zipFileName(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `Discord Export ${y}-${m}-${d}.zip`;
}
