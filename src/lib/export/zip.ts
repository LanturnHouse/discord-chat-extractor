import { Zip, ZipDeflate, type ZipInputFile } from 'fflate';

export interface ZipEntry {
  /** Forward-slash separated, relative path inside the archive (UTF-8). */
  path: string;
  blob: Blob;
}

export interface BuildZipOptions {
  /** Uncompressed input bytes processed so far / in total. Called at the start, regularly, and once at the end. */
  onProgress?(done: number, total: number): void;
  /** Rejects with an `AbortError` DOMException; nothing partial is returned. */
  signal?: AbortSignal;
}

const DEFLATE_LEVEL = 6;
/**
 * Already-compressed containers gain nothing from deflate, so they are written as deflate "stored" blocks (level 0).
 * They must not use method 0 (STORED): fflate's streaming `Zip` cannot know size and CRC when it writes the local
 * header, so it appends a data descriptor, and a STORED entry with a data descriptor cannot be read by sequential
 * readers (for example Java's ZipInputStream: "only DEFLATED entries can have EXT descriptor").
 */
const INCOMPRESSIBLE_EXT = /\.(?:xlsx|zip)$/i;
const STORE_LEVEL = 0;
/** Give the event loop a turn after this many input bytes so the UI stays responsive. */
const YIELD_EVERY_BYTES = 256 * 1024;
/** Blob slice size when the environment's Blob has no `stream()` (jsdom). */
const SLICE_BYTES = 1024 * 1024;
/**
 * Limits of a plain ZIP: fflate cannot write ZIP64, so sizes and offsets are 32-bit (the byte limit leaves 256 MB of
 * head room for headers and the central directory below 4 GiB) and the entry count is 16-bit. A larger export has to
 * be split over several archives; `runExport` keeps within these limits so that no finished channel is lost.
 */
export const MAX_ZIP_INPUT_BYTES = 0xf000_0000;
export const MAX_ZIP_ENTRIES = 0xffff;

export type ZipLimitKind = 'bytes' | 'entries';

/** The entries cannot be written as one plain ZIP; `limit` says which of the two limits above was hit. */
export class ZipLimitError extends RangeError {
  constructor(
    readonly limit: ZipLimitKind,
    message: string,
  ) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

/**
 * Collects output chunks into Blobs as it goes. Browsers can back a Blob with disk storage, so a very large export
 * does not have to live in the JS heap as one giant string / ArrayBuffer.
 */
export class BlobAssembler {
  private readonly parts: Blob[] = [];
  private pending: BlobPart[] = [];
  private pendingUnits = 0;

  constructor(private readonly flushAtUnits = 8 * 1024 * 1024) {}

  push(chunk: string | Uint8Array): void {
    if (chunk.length === 0) return;
    // fflate hands out ArrayBuffer-backed views; the cast only narrows the `ArrayBufferLike` in its typings.
    this.pending.push(typeof chunk === 'string' ? chunk : (chunk as Uint8Array<ArrayBuffer>));
    this.pendingUnits += chunk.length;
    if (this.pendingUnits >= this.flushAtUnits) this.flush();
  }

  toBlob(type: string): Blob {
    this.flush();
    return new Blob(this.parts, { type });
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    this.parts.push(new Blob(this.pending));
    this.pending = [];
    this.pendingUnits = 0;
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    // MessageChannel is not clamped to 4 ms like nested setTimeout, and is not throttled in background tabs.
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  if (typeof blob.stream !== 'function') {
    for (let offset = 0; offset < blob.size; offset += SLICE_BYTES) {
      yield new Uint8Array(await blob.slice(offset, offset + SLICE_BYTES).arrayBuffer());
    }
    return;
  }
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.length > 0) yield value;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function assertSafeEntryPath(path: string): void {
  const segments = path.split('/');
  const unsafe =
    path === '' ||
    path.includes('\\') ||
    path.includes('\0') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (unsafe) throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(path)}`);
}

function validateEntries(entries: readonly ZipEntry[]): number {
  if (entries.length > MAX_ZIP_ENTRIES) throw new ZipLimitError('entries', `Too many ZIP entries (${entries.length}).`);
  const seen = new Set<string>();
  let total = 0;
  for (const { path, blob } of entries) {
    assertSafeEntryPath(path);
    if (seen.has(path)) throw new Error(`Duplicate ZIP entry path: ${JSON.stringify(path)}`);
    seen.add(path);
    total += blob.size;
  }
  if (total > MAX_ZIP_INPUT_BYTES) {
    throw new ZipLimitError('bytes', 'The export is too large for a ZIP file (4 GB limit). Export fewer channels at once.');
  }
  return total;
}

function createEntryStream(path: string, mtime: number): ZipInputFile & { push(chunk: Uint8Array, final?: boolean): void } {
  const stream = new ZipDeflate(path, { level: INCOMPRESSIBLE_EXT.test(path) ? STORE_LEVEL : DEFLATE_LEVEL });
  stream.mtime = mtime;
  return stream;
}

/**
 * Streams the entries into a ZIP and returns it as a Blob. Each source Blob is read in chunks via `blob.stream()`,
 * compressed incrementally and the event loop is yielded to regularly, so large exports never need a single huge buffer.
 */
export async function buildZip(entries: readonly ZipEntry[], opts: BuildZipOptions = {}): Promise<Blob> {
  const { onProgress, signal } = opts;
  const total = validateEntries(entries);
  if (signal?.aborted) throw abortError();

  const output = new BlobAssembler();
  let zipError: unknown = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError ??= error;
      return;
    }
    output.push(chunk);
    if (final) finished = true;
  });

  const mtime = Date.now();
  let done = 0;
  let sinceYield = 0;
  onProgress?.(0, total);

  try {
    for (const { path, blob } of entries) {
      const stream = createEntryStream(path, mtime);
      zip.add(stream);
      for await (const chunk of blobChunks(blob)) {
        stream.push(chunk, false);
        done += chunk.length;
        sinceYield += chunk.length;
        if (zipError) throw zipError;
        if (signal?.aborted) throw abortError();
        if (sinceYield >= YIELD_EVERY_BYTES) {
          sinceYield = 0;
          onProgress?.(done, total);
          await yieldToEventLoop();
          if (signal?.aborted) throw abortError();
        }
      }
      // An empty final chunk closes the entry; it is also how a zero-byte entry is written.
      stream.push(new Uint8Array(0), true);
      if (zipError) throw zipError;
    }
    zip.end();
  } catch (error) {
    zip.terminate();
    throw error;
  }

  if (zipError) throw zipError;
  if (!finished) throw new Error('ZIP stream ended without a central directory.');
  onProgress?.(total, total);
  return output.toBlob('application/zip');
}
