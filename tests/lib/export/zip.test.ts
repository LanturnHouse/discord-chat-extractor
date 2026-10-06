import { strFromU8, strToU8, Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { BlobAssembler, buildZip, MAX_ZIP_ENTRIES, MAX_ZIP_INPUT_BYTES, ZipLimitError } from '../../../src/lib/export/zip';

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function unzip(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(await bytesOf(blob));
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

describe('buildZip', () => {
  it('produces a readable application/zip with the entries and their folders', async () => {
    const zip = await buildZip([
      { path: 'Server/Category/general.txt', blob: textBlob('hello world') },
      { path: 'Direct Messages/Alice.txt', blob: textBlob('hi') },
    ]);
    expect(zip.type).toBe('application/zip');
    const files = await unzip(zip);
    expect(Object.keys(files).sort()).toEqual(['Direct Messages/Alice.txt', 'Server/Category/general.txt']);
    expect(strFromU8(files['Server/Category/general.txt'])).toBe('hello world');
    expect(strFromU8(files['Direct Messages/Alice.txt'])).toBe('hi');
  });

  it('keeps entries in the given order', async () => {
    const zip = await buildZip(['c', 'a', 'b'].map((n) => ({ path: `${n}.txt`, blob: textBlob(n) })));
    expect(Object.keys(await unzip(zip))).toEqual(['c.txt', 'a.txt', 'b.txt']);
  });

  it('stores Korean and emoji names as UTF-8 (general-purpose flag bit 11)', async () => {
    const path = '서버/카테고리/잡담 🎉.txt';
    const zip = await buildZip([{ path, blob: textBlob('안녕하세요 👋') }]);
    const bytes = await bytesOf(zip);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual([path]);
    expect(strFromU8(files[path])).toBe('안녕하세요 👋');

    // local file header: signature, version(2), flags(2) ...
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it('writes an empty entry', async () => {
    const zip = await buildZip([
      { path: 'empty.txt', blob: new Blob([]) },
      { path: 'after.txt', blob: textBlob('x') },
    ]);
    const files = await unzip(zip);
    expect(files['empty.txt']).toHaveLength(0);
    expect(strFromU8(files['after.txt'])).toBe('x');
  });

  it('writes a valid archive for zero entries', async () => {
    const zip = await buildZip([]);
    expect(await unzip(zip)).toEqual({});
    expect(zip.size).toBe(22);
  });

  it('round-trips data much larger than one stream chunk and compresses text', async () => {
    const line = 'The quick brown fox jumps over the lazy dog 안녕하세요 \n';
    const big = line.repeat(60_000); // ~3.8 MB, many stream chunks
    const zip = await buildZip([{ path: 'big.txt', blob: textBlob(big) }]);
    expect(zip.size).toBeLessThan(big.length / 10);
    const files = await unzip(zip);
    expect(strFromU8(files['big.txt'])).toBe(big);
  });

  it('round-trips incompressible binary data byte for byte', async () => {
    const data = new Uint8Array(1_500_000);
    let seed = 12345;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = seed >> 16;
    }
    const zip = await buildZip([{ path: 'noise.bin', blob: new Blob([data]) }]);
    const files = await unzip(zip);
    expect(Buffer.from(files['noise.bin']).equals(Buffer.from(data))).toBe(true);
  });

  describe('entries that are already compressed (.xlsx, .zip)', () => {
    const payload = new Uint8Array(70_000).fill(7);

    const build = (): Promise<Blob> =>
      buildZip([
        { path: 'book.xlsx', blob: new Blob([payload]) },
        { path: 'inner.ZIP', blob: new Blob([payload]) },
        { path: 'notes.txt', blob: new Blob([payload]) },
      ]);

    interface Header {
      name: string;
      flags: number;
      method: number;
      compressedSize: number;
      localOffset: number;
    }

    /** Hand-written reader: the central directory entries, then the local file header each one points at. */
    function readHeaders(bytes: Uint8Array): { central: Header[]; local: Header[] } {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = bytes.length - 22;
      expect(view.getUint32(offset, true)).toBe(0x06054b50);
      const entryCount = view.getUint16(offset + 10, true);
      offset = view.getUint32(offset + 16, true);
      const central: Header[] = [];
      for (let i = 0; i < entryCount; i += 1) {
        expect(view.getUint32(offset, true)).toBe(0x02014b50);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        central.push({
          name: strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength)),
          flags: view.getUint16(offset + 8, true),
          method: view.getUint16(offset + 10, true),
          compressedSize: view.getUint32(offset + 20, true),
          localOffset: view.getUint32(offset + 42, true),
        });
        offset += 46 + nameLength + extraLength + commentLength;
      }
      const local = central.map((entry): Header => {
        const at = entry.localOffset;
        expect(view.getUint32(at, true)).toBe(0x04034b50);
        const nameLength = view.getUint16(at + 26, true);
        return {
          name: strFromU8(bytes.subarray(at + 30, at + 30 + nameLength)),
          flags: view.getUint16(at + 6, true),
          method: view.getUint16(at + 8, true),
          compressedSize: view.getUint32(at + 18, true),
          localOffset: at,
        };
      });
      return { central, local };
    }

    /** Reads the archive front to back like a streaming consumer (no central directory), in chunks of `chunk` bytes. */
    function streamUnzip(bytes: Uint8Array, chunk: number): Record<string, Uint8Array> {
      const parts: Record<string, Uint8Array[]> = {};
      const unzipper = new Unzip((file) => {
        parts[file.name] = [];
        file.ondata = (error, data) => {
          if (error) throw error;
          parts[file.name].push(data);
        };
        file.start();
      });
      unzipper.register(UnzipInflate);
      unzipper.register(UnzipPassThrough);
      for (let at = 0; at < bytes.length; at += chunk) unzipper.push(bytes.subarray(at, at + chunk), at + chunk >= bytes.length);
      return Object.fromEntries(Object.entries(parts).map(([name, list]) => [name, Buffer.concat(list)]));
    }

    it('are written as deflate "stored" blocks, not as method 0', async () => {
      const { central } = readHeaders(await bytesOf(await build()));
      const byName = Object.fromEntries(central.map((entry) => [entry.name, entry]));
      for (const name of ['book.xlsx', 'inner.ZIP']) {
        expect(byName[name].method).toBe(8);
        // Not recompressed: a few bytes of block framing on top of the payload, nothing smaller.
        expect(byName[name].compressedSize).toBeGreaterThanOrEqual(payload.length);
        expect(byName[name].compressedSize).toBeLessThan(payload.length + 64);
      }
      expect(byName['notes.txt'].method).toBe(8);
      expect(byName['notes.txt'].compressedSize).toBeLessThan(1000);
    });

    it('never combine method 0 with a data descriptor, in the central directory or the local headers', async () => {
      const { central, local } = readHeaders(await bytesOf(await build()));
      expect(local.map((entry) => entry.name)).toEqual(['book.xlsx', 'inner.ZIP', 'notes.txt']);
      for (const entry of [...central, ...local]) {
        const hasDescriptor = (entry.flags & 0x0008) !== 0;
        // Sequential readers (Java's ZipInputStream, many importers) reject exactly this combination.
        expect(!hasDescriptor || entry.method === 8, `${entry.name}: flags ${entry.flags}, method ${entry.method}`).toBe(true);
      }
      for (let i = 0; i < central.length; i += 1) {
        expect(local[i].method).toBe(central[i].method);
        expect(local[i].flags).toBe(central[i].flags);
      }
    });

    it.each([7, 1000, 65_536])('can be read by a streaming reader that never sees the central directory (%i byte chunks)', async (chunk) => {
      const files = streamUnzip(await bytesOf(await build()), chunk);
      expect(Object.keys(files)).toEqual(['book.xlsx', 'inner.ZIP', 'notes.txt']);
      for (const bytes of Object.values(files)) expect(Buffer.from(bytes).equals(Buffer.from(payload))).toBe(true);
    });

    it('can be read by a streaming reader that is fed one byte at a time', async () => {
      const small = new Uint8Array(3000).fill(5);
      const zip = await buildZip([
        { path: 'a.xlsx', blob: new Blob([small]) },
        { path: 'b.txt', blob: new Blob([small]) },
      ]);
      const files = streamUnzip(await bytesOf(zip), 1);
      expect(Object.keys(files)).toEqual(['a.xlsx', 'b.txt']);
      expect(Buffer.from(files['a.xlsx']).equals(Buffer.from(small))).toBe(true);
    });

    it('round-trip through the central-directory reader too', async () => {
      const files = unzipSync(await bytesOf(await build()));
      expect(files['book.xlsx']).toEqual(payload);
      expect(files['inner.ZIP']).toEqual(payload);
    });

    it('stay readable when the entry is empty or incompressible noise', async () => {
      const noise = new Uint8Array(150_000);
      let seed = 99;
      for (let i = 0; i < noise.length; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        noise[i] = seed >> 16;
      }
      const zip = await buildZip([
        { path: 'empty.xlsx', blob: new Blob([]) },
        { path: 'noise.xlsx', blob: new Blob([noise]) },
      ]);
      const bytes = await bytesOf(zip);
      expect(unzipSync(bytes)['noise.xlsx']).toEqual(noise);
      const streamed = streamUnzip(bytes, 4096);
      expect(streamed['empty.xlsx']).toHaveLength(0);
      expect(Buffer.from(streamed['noise.xlsx']).equals(Buffer.from(noise))).toBe(true);
    });
  });

  it('stamps entries with the current time', async () => {
    const before = Date.now();
    const zip = await buildZip([{ path: 'a.txt', blob: textBlob('a') }]);
    const bytes = await bytesOf(zip);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dosTime = view.getUint16(10, true);
    const dosDate = view.getUint16(12, true);
    const year = 1980 + (dosDate >> 9);
    const month = ((dosDate >> 5) & 15) - 1;
    const day = dosDate & 31;
    const modified = new Date(year, month, day, dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2);
    expect(Math.abs(modified.getTime() - before)).toBeLessThan(10_000);
  });

  it('reports progress in input bytes: start, monotonic, then complete', async () => {
    const a = new Uint8Array(700_000).fill(1);
    const b = new Uint8Array(300_000).fill(2);
    const calls: [number, number][] = [];
    await buildZip(
      [
        { path: 'a.bin', blob: new Blob([a]) },
        { path: 'b.bin', blob: new Blob([b]) },
      ],
      { onProgress: (done, total) => calls.push([done, total]) },
    );
    expect(calls[0]).toEqual([0, 1_000_000]);
    expect(calls[calls.length - 1]).toEqual([1_000_000, 1_000_000]);
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
      expect(calls[i][1]).toBe(1_000_000);
    }
    expect(calls.length).toBeGreaterThan(2);
  });

  it('yields to the event loop while compressing', async () => {
    const big = new Blob([new Uint8Array(8 * 1024 * 1024).fill(65)]);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 0);
    try {
      await buildZip([{ path: 'big.txt', blob: big }]);
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildZip([{ path: 'a.txt', blob: textBlob('a') }], { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('stops when aborted mid-way', async () => {
    const controller = new AbortController();
    const big = new Blob([new Uint8Array(6 * 1024 * 1024).fill(9)]);
    const promise = buildZip([{ path: 'big.bin', blob: big }], {
      signal: controller.signal,
      onProgress: (done) => {
        if (done > 0) controller.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects unsafe paths', async () => {
    for (const path of ['../evil.txt', 'a/../b.txt', '/abs.txt', 'a//b.txt', 'a\\b.txt', '', './x.txt', 'a/./b.txt', 'nul\0.txt']) {
      await expect(buildZip([{ path, blob: textBlob('x') }])).rejects.toThrow(/Unsafe ZIP entry path/);
    }
  });

  describe('plain-ZIP limits', () => {
    const sized = (size: number): Blob => Object.defineProperty(new Blob([]), 'size', { value: size });

    it('exposes the limits the runner has to respect', () => {
      expect(MAX_ZIP_INPUT_BYTES).toBeLessThan(2 ** 32);
      expect(MAX_ZIP_ENTRIES).toBe(65_535);
    });

    it('rejects more input bytes than a 32-bit ZIP can address with a ZipLimitError for "bytes"', async () => {
      const failure = await buildZip([
        { path: 'a.bin', blob: sized(MAX_ZIP_INPUT_BYTES) },
        { path: 'b.bin', blob: sized(1) },
      ]).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ZipLimitError);
      expect(failure).toBeInstanceOf(RangeError);
      expect(failure).toMatchObject({ limit: 'bytes', name: 'ZipLimitError' });
      expect((failure as Error).message).toMatch(/too large/);
    });

    it('accepts exactly the byte limit', async () => {
      // Only the validation looks at `size`; the empty blob behind the fake size is what gets read.
      await expect(buildZip([{ path: 'a.bin', blob: sized(MAX_ZIP_INPUT_BYTES) }])).resolves.toBeInstanceOf(Blob);
    });

    it('rejects more than 65,535 entries with a ZipLimitError for "entries"', async () => {
      const entries = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ path: `${i}.txt`, blob: new Blob([]) }));
      await expect(buildZip(entries)).rejects.toMatchObject({ name: 'ZipLimitError', limit: 'entries' });
    });
  });

  it('rejects duplicate paths', async () => {
    await expect(
      buildZip([
        { path: 'a.txt', blob: textBlob('1') },
        { path: 'a.txt', blob: textBlob('2') },
      ]),
    ).rejects.toThrow(/Duplicate ZIP entry path/);
  });

  it('reads blobs without stream() (as in jsdom) through slices', async () => {
    const real = new Blob(['no stream ', '블롭 ', 'x'.repeat(2_500_000)]);
    const streamless = new Proxy(real, {
      get(target, prop) {
        if (prop === 'stream') return undefined;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(typeof streamless.stream).not.toBe('function');
    const zip = await buildZip([{ path: 'dom.txt', blob: streamless }]);
    expect(strFromU8((await unzip(zip))['dom.txt'])).toBe(`no stream 블롭 ${'x'.repeat(2_500_000)}`);
  });

  it('does not read any blob when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const blob = textBlob('x');
    const streamSpy = vi.spyOn(blob, 'stream');
    await buildZip([{ path: 'a.txt', blob }], { signal: controller.signal }).catch(() => undefined);
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

describe('BlobAssembler', () => {
  it('concatenates strings and bytes in call order and sets the type', async () => {
    const assembler = new BlobAssembler(4);
    assembler.push('ab');
    assembler.push(strToU8('cd'));
    assembler.push('');
    assembler.push('ef');
    const blob = assembler.toBlob('text/x-test');
    expect(blob.type).toBe('text/x-test');
    expect(await blob.text()).toBe('abcdef');
  });

  it('is usable again after toBlob()', async () => {
    const assembler = new BlobAssembler();
    assembler.push('a');
    expect(await assembler.toBlob('text/plain').text()).toBe('a');
    assembler.push('b');
    expect(await assembler.toBlob('text/plain').text()).toBe('ab');
  });
});
