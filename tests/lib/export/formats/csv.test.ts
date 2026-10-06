import { describe, expect, it } from 'vitest';
import { createMockClient, MOCK_IDS } from '../../../../src/lib/discord/mock';
import type { Message, User } from '../../../../src/lib/discord/types';
import { runExport } from '../../../../src/lib/export/runner';
import { csvFormat } from '../../../../src/lib/export/formats/csv';
import { csvField, csvRow, neutraliseFormula } from '../../../../src/lib/export/formats/csvEncode';
import { createRowBuilder, ROW_COLUMNS } from '../../../../src/lib/export/formats/rows';
import type { Chunk, ExportOptions, ExportTarget, WriterContext } from '../../../../src/lib/export/types';
import { buildNameResolver } from '../../../../src/lib/message';
import { expectLinearScaling, inflateMessages } from '../scaling';

const BOM = String.fromCharCode(0xfeff);
const ALICE: User = { id: '1000', username: 'alice', global_name: 'Alice' };
const BOB: User = { id: '2000', username: 'bob' };
const BOT: User = { id: '4000', username: 'helper', bot: true };

const OPTIONS: ExportOptions = { format: 'csv', after: null, before: null, limit: null, htmlTheme: 'dark', locale: 'en', timeZone: 'UTC' };
const TARGET: ExportTarget = {
  channelId: '555',
  kind: 'text',
  channelName: 'general',
  guildId: '777',
  guildName: 'My Server',
  categoryName: 'Text Channels',
  parentChannelName: null,
  topic: null,
};
const NO_NAMES = { user: () => undefined, channel: () => undefined, role: () => undefined };

function context(overrides: { options?: Partial<ExportOptions>; names?: WriterContext['names'] } = {}): WriterContext {
  return {
    target: TARGET,
    options: { ...OPTIONS, ...overrides.options },
    exportedAt: new Date('2026-10-06T12:34:56.000Z'),
    names: overrides.names ?? NO_NAMES,
  };
}

function message(n: number, content: string, extra: Partial<Message> = {}): Message {
  return {
    id: String(100000000000000000n + BigInt(n)),
    channel_id: '555',
    author: ALICE,
    content,
    timestamp: `2026-10-05T12:00:${String(n % 60).padStart(2, '0')}.000000+00:00`,
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...extra,
  };
}

function asText(chunks: Chunk[]): string {
  return chunks.map((c) => (typeof c === 'string' ? c : new TextDecoder().decode(c))).join('');
}

function render(batches: Message[][], ctx: WriterContext = context()): string {
  const writer = csvFormat.createWriter(ctx);
  const all = batches.flat();
  const chunks: Chunk[] = [...writer.start()];
  for (const batch of batches) chunks.push(...writer.write(batch));
  chunks.push(...writer.end({ messageCount: all.length, firstTimestamp: all[0]?.timestamp ?? null, lastTimestamp: all[all.length - 1]?.timestamp ?? null }));
  return asText(chunks);
}

/** Strict RFC 4180 reader: CRLF records, doubled quotes, line breaks only inside quotes; anything else throws. */
function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') {
      if (field !== '') throw new Error('quote inside an unquoted field');
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      wasQuoted = false;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      wasQuoted = false;
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      throw new Error('bare line break outside quotes');
    } else {
      if (wasQuoted) throw new Error('text after a closing quote');
      field += ch;
    }
  }
  if (quoted) throw new Error('unterminated quote');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe('csvFormat', () => {
  it('describes itself', () => {
    expect(csvFormat.id).toBe('csv');
    expect(csvFormat.label).toBe('CSV (.csv)');
    expect(csvFormat.extension).toBe('csv');
    expect(csvFormat.mime).toBe('text/csv;charset=utf-8');
  });

  it('starts with a UTF-8 byte order mark so Excel shows Korean correctly', () => {
    const text = render([[message(1, '안녕')]]);
    expect(text.startsWith(BOM)).toBe(true);
    const bytes = new TextEncoder().encode(text);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.indexOf(BOM, 1)).toBe(-1);
  });

  it('writes the localised header row', () => {
    const header = (locale: 'en' | 'ko') => render([], context({ options: { locale } }));
    expect(header('en')).toBe(`${BOM}Message ID,Timestamp,Edited,Author ID,Author,Bot,Content,Attachments,Embeds,Stickers,Reactions,Reply To,Type\r\n`);
    expect(header('ko')).toBe(`${BOM}메시지 ID,시각,수정 시각,작성자 ID,작성자,봇,내용,첨부 파일,임베드,스티커,리액션,답장 대상,유형\r\n`);
  });

  it('writes a header-only file for an empty channel', () => {
    const text = render([[], []]);
    expect(parseCsv(text)).toHaveLength(1);
    expect(parseCsv(text)[0]).toHaveLength(ROW_COLUMNS.length);
  });

  describe('exact output', () => {
    const original = message(1, 'hello');
    const reply = message(2, 'hi **Alice**', {
      author: BOB,
      type: 19,
      edited_timestamp: '2026-10-05T12:05:00.000000+00:00',
      message_reference: { message_id: original.id },
      referenced_message: original,
      reactions: [
        { count: 3, emoji: { id: null, name: '👍' } },
        { count: 2, emoji: { id: '123456789012345678', name: 'party' } },
      ],
    });
    const files = message(3, '', {
      attachments: [
        { id: '9', filename: 'report.pdf', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/2/report.pdf' },
        { id: '10', filename: 'photo.png', size: 10, url: 'https://cdn.discordapp.com/attachments/1/3/photo.png' },
      ],
    });
    const join = message(4, '', { author: BOT, type: 7 });
    const quotes = message(5, 'say "hi", ok\nsecond line');
    const formula = message(6, "=cmd|' /C calc'!A0", { author: { id: '3000', username: 'x', global_name: '-evil' } });

    it('matches RFC 4180 byte for byte', () => {
      const expected = [
        'Message ID,Timestamp,Edited,Author ID,Author,Bot,Content,Attachments,Embeds,Stickers,Reactions,Reply To,Type',
        '100000000000000001,2026-10-05 12:00:01,,1000,Alice,,hello,,,,,,message',
        '100000000000000002,2026-10-05 12:00:02,2026-10-05 12:05:00,2000,bob,,hi Alice,,,,👍 3; :party: 2,100000000000000001,reply',
        '100000000000000003,2026-10-05 12:00:03,,1000,Alice,,,"https://cdn.discordapp.com/attachments/1/2/report.pdf\nhttps://cdn.discordapp.com/attachments/1/3/photo.png",,,,,message',
        '100000000000000004,2026-10-05 12:00:04,,4000,helper,Y,helper joined the server.,,,,,,system',
        '100000000000000005,2026-10-05 12:00:05,,1000,Alice,,"say ""hi"", ok\nsecond line",,,,,,message',
        "100000000000000006,2026-10-05 12:00:06,,3000,'-evil,,'=cmd|' /C calc'!A0,,,,,,message",
        '',
      ].join('\r\n');
      expect(render([[original, reply, files, join, quotes, formula]])).toBe(`${BOM}${expected}`);
    });

    it('keeps one record per message even though cells contain line breaks', () => {
      const rows = parseCsv(render([[original, reply, files, join, quotes, formula]]));
      expect(rows).toHaveLength(7);
      for (const row of rows) expect(row).toHaveLength(ROW_COLUMNS.length);
      expect(rows[5][6]).toBe('say "hi", ok\nsecond line');
    });
  });

  describe('formula injection', () => {
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1'])('prefixes a quote when a cell starts with %j', (cell) => {
      expect(neutraliseFormula(cell)).toBe(`'${cell}`);
      expect(parseCsv(csvRow([cell]))[0][0]).toBe(`'${cell}`);
    });

    it.each(['a=1', '5-3', ' =1', 'x+y', 'mail@example.com', '', "'already", '안녕'])('leaves %j alone', (cell) => {
      expect(neutraliseFormula(cell)).toBe(cell);
    });

    it('neutralises message content, author names and every other text cell', () => {
      const evil: User = { id: '666', username: 'evil', global_name: '=HYPERLINK("https://evil.example","x")' };
      const hostile = [
        message(1, "=SUM(1+1)*cmd|' /C calc'!A0", { author: evil }),
        message(2, '+SUM(A1:A9)'),
        message(3, "-2+3+cmd|' /C calc'!A0"),
        message(4, '@SUM(1+1)*cmd'),
        message(5, '\t=1+1 (starts with a tab)'),
        message(6, 'x', { attachments: [{ id: '1', filename: '=evil.png', size: 1, url: 'data:image/png;base64,AA' }] }),
        message(7, '', { embeds: [{ title: '=title' }] }),
        message(8, '', { sticker_items: [{ id: '1', name: '@sticker', format_type: 3 }] }),
      ];
      const rows = parseCsv(render([hostile])).slice(1);
      for (const row of rows) {
        for (const cell of row) expect(/^[=+\-@\t\r]/.test(cell), cell).toBe(false);
      }
      expect(rows[0][4]).toBe(`'=HYPERLINK("https://evil.example","x")`);
      expect(rows[0][6]).toBe("'=SUM(1+1)*cmd|' /C calc'!A0");
      expect(rows[1][6]).toBe("'+SUM(A1:A9)");
      expect(rows[2][6]).toBe("'-2+3+cmd|' /C calc'!A0");
      expect(rows[3][6]).toBe("'@SUM(1+1)*cmd");
      expect(rows[4][6]).toBe("'=1+1 (starts with a tab)");
      expect(rows[5][7]).toBe("'=evil.png");
      expect(rows[6][8]).toBe("'=title");
      expect(rows[7][9]).toBe("'@sticker");
    });
  });

  describe('RFC 4180 round trip', () => {
    it('survives quotes, commas, line breaks, emoji, Korean and hostile text', () => {
      const bodies = [
        'plain',
        'with, comma',
        'with "quotes"',
        '"starts with a quote',
        'ends with a quote"',
        'a\nb\n\nc',
        'a\r\nb\rc',
        '안녕하세요 👋 こんにちは 🇰🇷 👨‍👩‍👧‍👦',
        '  leading and trailing spaces  ',
        ',,,',
        '""',
        '<script>alert(1)</script>',
        'back\\slash',
        'a'.repeat(100_000),
        'tab\tinside',
      ];
      const messages = bodies.map((body, i) => message(i + 1, body));
      const rows = parseCsv(render([messages]));
      expect(rows).toHaveLength(bodies.length + 1);
      const build = createRowBuilder(context());
      messages.forEach((m, i) => {
        const expected = build(m).map(neutraliseFormula);
        expect(rows[i + 1]).toEqual(expected);
      });
      expect(rows[3][6]).toBe('with "quotes"');
      expect(rows[6][6]).toBe('a\nb\n\nc');
      expect(rows[7][6]).toBe('a\nb\nc');
    });

    it('never emits a bare CR or LF outside quotes and ends every record with CRLF', () => {
      const text = render([[message(1, 'a\nb'), message(2, 'c'), message(3, '')]]);
      expect(() => parseCsv(text)).not.toThrow();
      expect(text.endsWith('\r\n')).toBe(true);
    });
  });

  it('writes identical output for one batch and for seven batches', () => {
    const messages = Array.from({ length: 50 }, (_, i) => message(i + 1, i % 3 === 0 ? `msg, "${i}"\nline` : `message ${i}`, { author: i % 2 === 0 ? ALICE : BOB }));
    const batches: Message[][] = [];
    for (let i = 0, size = 7; i < messages.length; i += size) batches.push(messages.slice(i, i + size));
    expect(batches).toHaveLength(8);
    const sevenBatches = [messages.slice(0, 5), messages.slice(5, 9), messages.slice(9, 10), messages.slice(10, 30), [], messages.slice(30, 45), messages.slice(45)];
    expect(render(sevenBatches)).toBe(render([messages]));
    expect(render(batches)).toBe(render([messages]));
  });

  it('creates independent writers', () => {
    const a = csvFormat.createWriter(context());
    const b = csvFormat.createWriter(context());
    a.start();
    b.start();
    expect(a.write([message(1, 'x')])).toHaveLength(1);
    expect(b.end({ messageCount: 0, firstTimestamp: null, lastTimestamp: null })).toEqual([]);
  });

  it('works end to end through runExport: the BOM survives the Blob and every record parses', async () => {
    const output = await runExport({
      client: createMockClient({ latencyMs: 0 }),
      targets: [{ ...TARGET, channelId: MOCK_IDS.showcaseChannel, channelName: 'showcase', guildId: MOCK_IDS.bigGuild, guildName: 'Dev Lounge', categoryName: 'General' }],
      format: csvFormat,
      options: { ...OPTIONS, timeZone: 'Asia/Seoul' },
      now: () => new Date('2026-10-06T12:00:00Z'),
    });
    expect(output).toMatchObject({ filename: 'Dev Lounge - showcase.csv', fileCount: 1, failures: [], cancelled: false });
    expect(output.blob.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
    expect(rows).toHaveLength(output.messageCount + 1);
    expect(rows[0][0]).toBe('Message ID');
    // ids ascend: the runner feeds the writer oldest to newest
    const ids = rows.slice(1).map((row) => BigInt(row[0]));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(rows.some((row) => row[6].includes('@Sam Patel'))).toBe(true);
  });

  describe('mock showcase channel', () => {
    async function showcase(): Promise<{ messages: Message[]; names: ReturnType<typeof buildNameResolver> }> {
      const client = createMockClient({ latencyMs: 0 });
      const messages: Message[] = [];
      let before: string | undefined;
      for (;;) {
        const page = await client.getMessages(MOCK_IDS.showcaseChannel, { before, limit: 100 });
        if (page.length === 0) break;
        messages.push(...page);
        before = page[page.length - 1].id;
      }
      messages.reverse();
      const names = buildNameResolver();
      names.addMessages(messages);
      return { messages, names };
    }

    it('parses back into one record per message with the row builder values', async () => {
      const { messages, names } = await showcase();
      const ctx = context({ names, options: { timeZone: 'Asia/Seoul' } });
      const rows = parseCsv(render([messages.slice(0, 40), messages.slice(40)], ctx));
      expect(rows).toHaveLength(messages.length + 1);
      const build = createRowBuilder(ctx);
      messages.forEach((m, i) => expect(rows[i + 1]).toEqual(build(m).map(neutraliseFormula)));
    });

    it('is localised in Korean', async () => {
      const { messages, names } = await showcase();
      const rows = parseCsv(render([messages], context({ names, options: { locale: 'ko' } })));
      expect(rows[0][0]).toBe('메시지 ID');
      expect(rows.some((row) => row[6].includes('님이 서버에 참여했어요.'))).toBe(true);
    });

    it('keeps snowflakes as exact digit strings', async () => {
      const { messages, names } = await showcase();
      const rows = parseCsv(render([messages], context({ names })));
      rows.slice(1).forEach((row, i) => {
        expect(row[0]).toBe(messages[i].id);
        expect(row[3]).toBe(messages[i].author.id);
      });
    });

    it('writes 20,000 messages in time proportional to their number', async () => {
      const { messages, names } = await showcase();
      const inflated = inflateMessages(messages, 20_000);
      const size = expectLinearScaling(
        (count) => {
          const writer = csvFormat.createWriter(context({ names }));
          let bytes = writer.start().join('').length;
          for (let i = 0; i < count; i += 100) bytes += writer.write(inflated.slice(i, Math.min(count, i + 100))).join('').length;
          bytes += writer.end({ messageCount: count, firstTimestamp: null, lastTimestamp: null }).reduce((sum, chunk) => sum + chunk.length, 0);
          return bytes;
        },
        { small: 2_000, large: 20_000 },
      );
      expect(size).toBeGreaterThan(20_000 * 40);
    });
  });
});

describe('csvField / csvRow', () => {
  it('quotes only when needed and doubles quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('')).toBe('');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "x"')).toBe('"say ""x"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField('안녕, 세계')).toBe('"안녕, 세계"');
  });

  it('neutralises before quoting', () => {
    expect(csvField('=a,b')).toBe(`"'=a,b"`);
    expect(csvField('@"x"')).toBe(`"'@""x"""`);
  });

  it('ends the record with CRLF and joins cells with commas', () => {
    expect(csvRow(['a', 'b,c', ''])).toBe('a,"b,c",\r\n');
    expect(csvRow([])).toBe('\r\n');
  });
});
