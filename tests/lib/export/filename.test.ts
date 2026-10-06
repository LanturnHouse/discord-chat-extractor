import { describe, expect, it } from 'vitest';
import { entryPathFor, sanitizeFileName, singleFileName, zipFileName } from '../../../src/lib/export/filename';
import type { ExportTarget } from '../../../src/lib/export/types';

function target(overrides: Partial<ExportTarget> = {}): ExportTarget {
  return {
    channelId: '100000000000000001',
    kind: 'text',
    channelName: 'general',
    guildId: '200000000000000001',
    guildName: 'My Server',
    categoryName: 'Text Channels',
    parentChannelName: null,
    topic: null,
    ...overrides,
  };
}

describe('sanitizeFileName', () => {
  it('keeps ordinary names, including Korean and emoji', () => {
    expect(sanitizeFileName('general')).toBe('general');
    expect(sanitizeFileName('잡담 채널')).toBe('잡담 채널');
    expect(sanitizeFileName('party 🎉')).toBe('party 🎉');
  });

  it('replaces path separators and Windows-forbidden characters', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
  });

  it('never produces a ".." path component or a separator', () => {
    for (const evil of ['..', '../..', '..\\..\\x', '/', '\\', '.', '. .', '...']) {
      const out = sanitizeFileName(evil);
      expect(out).not.toMatch(/[\\/]/);
      expect(out).not.toBe('..');
      expect(out).not.toBe('.');
    }
  });

  it('replaces control characters and turns whitespace controls into spaces', () => {
    expect(sanitizeFileName('a\u0000b\u001Fc\u007Fd\u0085e')).toBe('a_b_c_d_e');
    expect(sanitizeFileName('line1\nline2\tx\r\ny')).toBe('line1 line2 x y');
  });

  it('collapses runs of whitespace (incl. NBSP and ideographic space)', () => {
    expect(sanitizeFileName('a   b \u00A0\u3000 c')).toBe('a b c');
  });

  it('strips leading and trailing dots and spaces', () => {
    expect(sanitizeFileName('  ..name.. ')).toBe('name');
    expect(sanitizeFileName('name. . .')).toBe('name');
  });

  it('removes invisible and bidi-override characters that could disguise an extension', () => {
    expect(sanitizeFileName('foo\u202Etxt.exe')).toBe('footxt.exe');
    expect(sanitizeFileName('a\u200Bb\u2066c\uFEFFd')).toBe('abcd');
  });

  it('keeps ZWJ so emoji sequences survive', () => {
    const family = '👨\u200D👩\u200D👧';
    expect(sanitizeFileName(family)).toBe(family);
  });

  it('suffixes Windows reserved device names, with or without extension', () => {
    expect(sanitizeFileName('CON')).toBe('CON_');
    expect(sanitizeFileName('nul')).toBe('nul_');
    expect(sanitizeFileName('Com1')).toBe('Com1_');
    expect(sanitizeFileName('LPT9')).toBe('LPT9_');
    expect(sanitizeFileName('aux.txt')).toBe('aux_.txt');
    expect(sanitizeFileName('COM¹')).toBe('COM¹_');
    expect(sanitizeFileName('CON .log')).toBe('CON _.log');
  });

  it('leaves names that merely start with a reserved word alone', () => {
    expect(sanitizeFileName('console')).toBe('console');
    expect(sanitizeFileName('COM10')).toBe('COM10');
    expect(sanitizeFileName('nullable.txt')).toBe('nullable.txt');
  });

  it('caps at 80 UTF-16 code units', () => {
    const out = sanitizeFileName('x'.repeat(200));
    expect(out).toHaveLength(80);
  });

  it('does not split surrogate pairs when capping', () => {
    // 79 ASCII + one emoji (2 units) => the pair straddles the 80-unit limit.
    const input = `${'a'.repeat(79)}😀tail`;
    const out = sanitizeFileName(input);
    expect(out).toBe('a'.repeat(79));
    expect(out.length).toBeLessThanOrEqual(80);

    const allEmoji = sanitizeFileName('😀'.repeat(60));
    expect(allEmoji).toBe('😀'.repeat(40));
    expect(allEmoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('re-trims after capping and cannot expose a reserved name by truncation', () => {
    expect(sanitizeFileName(`${'a'.repeat(79)} .tail`)).toBe('a'.repeat(79));
    const out = sanitizeFileName(`CON${'.'.repeat(100)}x`);
    expect(out.toLowerCase().startsWith('con_')).toBe(true);
  });

  it('replaces lone surrogates', () => {
    expect(sanitizeFileName('a\uD800b\uDC00c')).toBe('a_b_c');
  });

  it('normalises to NFC', () => {
    const decomposed = '한'; // Hangul jamo for 한
    expect(sanitizeFileName(decomposed)).toBe('한');
    expect(sanitizeFileName('é')).toBe('é');
  });

  it('uses the fallback for empty results', () => {
    expect(sanitizeFileName('')).toBe('unnamed');
    expect(sanitizeFileName('...', 'fallback')).toBe('fallback');
    expect(sanitizeFileName(' \u200B ', 'fb')).toBe('fb');
  });

  it('sanitises the fallback too and never returns an empty string', () => {
    expect(sanitizeFileName('', 'a/b')).toBe('a_b');
    expect(sanitizeFileName('', '...')).toBe('unnamed');
    expect(sanitizeFileName('', 'CON')).toBe('CON_');
  });
});

describe('entryPathFor', () => {
  it('builds Server/Category/channel.ext', () => {
    expect(entryPathFor(target(), 'html', new Set())).toBe('My Server/Text Channels/general.html');
  });

  it('omits the category folder when there is none', () => {
    expect(entryPathFor(target({ categoryName: null }), 'txt', new Set())).toBe('My Server/general.txt');
  });

  it('puts DMs and group DMs under Direct Messages', () => {
    const dm = target({ kind: 'dm', guildId: null, guildName: null, categoryName: null, channelName: 'Alice' });
    expect(entryPathFor(dm, 'md', new Set())).toBe('Direct Messages/Alice.md');
    const group = target({ kind: 'group-dm', guildId: null, guildName: null, categoryName: null, channelName: 'A, B, C' });
    expect(entryPathFor(group, 'md', new Set())).toBe('Direct Messages/A, B, C.md');
  });

  it('names threads "Parent - Thread"', () => {
    const thread = target({ kind: 'thread', channelName: 'bug report', parentChannelName: 'support' });
    expect(entryPathFor(thread, 'html', new Set())).toBe('My Server/Text Channels/support - bug report.html');
  });

  it('uses the thread name alone when the parent is unknown', () => {
    const thread = target({ kind: 'thread', channelName: 'bug report', parentChannelName: null });
    expect(entryPathFor(thread, 'html', new Set())).toBe('My Server/Text Channels/bug report.html');
  });

  it('sanitises every component', () => {
    const t = target({ guildName: 'a/b', categoryName: 'c:d', channelName: 'e*f' });
    expect(entryPathFor(t, 'csv', new Set())).toBe('a_b/c_d/e_f.csv');
  });

  it('falls back sensibly for blank names', () => {
    const t = target({ guildName: '', categoryName: '...', channelName: '', channelId: '42' });
    expect(entryPathFor(t, 'json', new Set())).toBe('Unknown Server/Category/42.json');
  });

  it('tolerates a leading dot on the extension', () => {
    expect(entryPathFor(target(), '.xlsx', new Set())).toBe('My Server/Text Channels/general.xlsx');
  });

  it('adds the final path to the used set', () => {
    const used = new Set<string>();
    const path = entryPathFor(target(), 'html', used);
    expect(used.has(path)).toBe(true);
    expect(used.size).toBe(1);
  });

  it('appends the channel id on collisions', () => {
    const used = new Set<string>();
    const a = entryPathFor(target({ channelId: '1' }), 'html', used);
    const b = entryPathFor(target({ channelId: '2' }), 'html', used);
    expect(a).toBe('My Server/Text Channels/general.html');
    expect(b).toBe('My Server/Text Channels/general [2].html');
    expect(used).toEqual(new Set([a, b]));
  });

  it('detects collisions case-insensitively', () => {
    const used = new Set<string>();
    entryPathFor(target({ channelId: '1', channelName: 'General' }), 'html', used);
    const second = entryPathFor(target({ channelId: '2', channelName: 'general' }), 'html', used);
    expect(second).toBe('My Server/Text Channels/general [2].html');
    const third = entryPathFor(target({ channelId: '3', guildName: 'MY SERVER', channelName: 'GENERAL' }), 'html', used);
    expect(third).toBe('MY SERVER/Text Channels/GENERAL [3].html');
  });

  it('detects collisions with paths that were added to the set from outside', () => {
    const used = new Set(['My Server/Text Channels/GENERAL.html']);
    expect(entryPathFor(target({ channelId: '9' }), 'html', used)).toBe('My Server/Text Channels/general [9].html');
  });

  it('stays unique even when the same channel is added repeatedly', () => {
    const used = new Set<string>();
    const paths = [1, 2, 3, 4].map(() => entryPathFor(target({ channelId: '7' }), 'html', used));
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(4);
    expect(paths[2]).toBe('My Server/Text Channels/general [7] (2).html');
  });

  it('keeps the same name in different categories apart without a suffix', () => {
    const used = new Set<string>();
    const a = entryPathFor(target({ categoryName: 'A' }), 'html', used);
    const b = entryPathFor(target({ categoryName: 'B' }), 'html', used);
    expect([a, b]).toEqual(['My Server/A/general.html', 'My Server/B/general.html']);
  });

  it('never yields a reserved device name once the extension is appended', () => {
    const path = entryPathFor(target({ channelName: 'con', categoryName: null }), 'txt', new Set());
    expect(path).toBe('My Server/con_.txt');
  });
});

describe('entryPathFor: a path is never both a file and a folder', () => {
  /** No entry may equal, or sit inside, another entry (case-insensitively): extractors cannot make a file and a folder of one name. */
  function expectNoClash(paths: readonly string[]): void {
    const lower = paths.map((p) => p.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    for (const outer of lower) {
      for (const inner of lower) expect(inner.startsWith(`${outer}/`), `${inner} sits inside the file ${outer}`).toBe(false);
    }
  }

  const category = (name: string, channelName: string, channelId: string): ExportTarget =>
    target({ categoryName: name, channelName, channelId });
  const loose = (channelName: string, channelId: string): ExportTarget => target({ categoryName: null, channelName, channelId });

  it('renames the file when a folder of that name already exists (category first)', () => {
    const used = new Set<string>();
    const inFolder = entryPathFor(category('general.html', 'announcements', '1'), 'html', used);
    const file = entryPathFor(loose('general', '2'), 'html', used);
    expect(inFolder).toBe('My Server/general.html/announcements.html');
    expect(file).toBe('My Server/general [2].html');
    expectNoClash([inFolder, file]);
  });

  it('renames the folder when a file of that name already exists (channel first)', () => {
    const used = new Set<string>();
    const file = entryPathFor(loose('general', '2'), 'html', used);
    const inFolder = entryPathFor(category('general.html', 'announcements', '1'), 'html', used);
    expect(file).toBe('My Server/general.html');
    expect(inFolder).toBe('My Server/general.html (2)/announcements.html');
    expectNoClash([file, inFolder]);
  });

  it('keeps the channels of a renamed category together', () => {
    const used = new Set<string>();
    const file = entryPathFor(loose('general', '9'), 'html', used);
    const first = entryPathFor(category('general.html', 'rules', '1'), 'html', used);
    const second = entryPathFor(category('general.html', 'news', '2'), 'html', used);
    expect([first, second]).toEqual(['My Server/general.html (2)/rules.html', 'My Server/general.html (2)/news.html']);
    expectNoClash([file, first, second]);
  });

  it('compares case-insensitively', () => {
    const used = new Set<string>();
    const file = entryPathFor(loose('general', '2'), 'html', used);
    const inFolder = entryPathFor(category('GENERAL.HTML', 'rules', '1'), 'html', used);
    expect(inFolder).toBe('My Server/GENERAL.HTML (2)/rules.html');
    expectNoClash([file, inFolder]);

    const usedBackwards = new Set<string>();
    const folderFirst = entryPathFor(category('GENERAL.HTML', 'rules', '1'), 'html', usedBackwards);
    const fileSecond = entryPathFor(loose('general', '2'), 'html', usedBackwards);
    expect(fileSecond).toBe('My Server/general [2].html');
    expectNoClash([folderFirst, fileSecond]);
  });

  it('skips a renamed folder name that is taken as well', () => {
    const used = new Set(['My Server/general.html', 'My Server/general.html (2)']);
    expect(entryPathFor(category('general.html', 'rules', '1'), 'html', used)).toBe('My Server/general.html (3)/rules.html');
  });

  it('knows paths that were added to the set from outside', () => {
    expect(entryPathFor(category('general.html', 'rules', '1'), 'html', new Set(['My Server/general.html']))).toBe(
      'My Server/general.html (2)/rules.html',
    );
    expect(entryPathFor(loose('general', '5'), 'html', new Set(['My Server/general.html/rules.html']))).toBe('My Server/general [5].html');
  });

  it('does not touch folders and files that merely share a prefix', () => {
    const used = new Set<string>();
    const paths = [loose('general', '1'), category('general.html.bak', 'rules', '2'), category('general', 'news', '3')].map((t) => entryPathFor(t, 'html', used));
    expect(paths).toEqual(['My Server/general.html', 'My Server/general.html.bak/rules.html', 'My Server/general/news.html']);
  });

  it('holds for every order of arrival of a hostile set of names', () => {
    const targets = [
      loose('x', '1'),
      loose('X', '2'),
      category('x.html', 'a', '3'),
      category('X.HTML', 'b', '4'),
      category('x.html', 'x', '5'),
      category('y', 'x', '6'),
    ];
    const permutations = (items: ExportTarget[]): ExportTarget[][] =>
      items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
    const orders = permutations(targets);
    expect(orders).toHaveLength(720);
    for (const order of orders) {
      const used = new Set<string>();
      expectNoClash(order.map((t) => entryPathFor(t, 'html', used)));
    }
  });
});

describe('singleFileName', () => {
  it('is "Server - channel.ext"', () => {
    expect(singleFileName(target(), 'html')).toBe('My Server - general.html');
  });

  it('is "name.ext" for DMs', () => {
    const dm = target({ kind: 'dm', guildId: null, guildName: null, channelName: 'Alice' });
    expect(singleFileName(dm, 'txt')).toBe('Alice.txt');
  });

  it('includes the parent for threads', () => {
    const thread = target({ kind: 'thread', channelName: 'bug', parentChannelName: 'support' });
    expect(singleFileName(thread, 'md')).toBe('My Server - support - bug.md');
  });

  it('sanitises the parts', () => {
    const t = target({ guildName: 'a/b', channelName: 'c|d' });
    expect(singleFileName(t, 'json')).toBe('a_b - c_d.json');
  });
});

describe('zipFileName', () => {
  it('uses the local date fields, zero padded', () => {
    expect(zipFileName(new Date(2026, 9, 6, 13, 5))).toBe('Discord Export 2026-10-06.zip');
    expect(zipFileName(new Date(2026, 0, 2, 0, 0, 1))).toBe('Discord Export 2026-01-02.zip');
    expect(zipFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe('Discord Export 2026-12-31.zip');
  });
});
