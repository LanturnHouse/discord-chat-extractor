import { describe, expect, it } from 'vitest';
import type { Message, User } from '../../../src/lib/discord/types';
import { jsonFormat } from '../../../src/lib/export/formats/json';
import type { Chunk, ExportOptions, ExportTarget, WriterContext, WriterSummary } from '../../../src/lib/export/types';

const AUTHOR: User = { id: '1000', username: 'alice', global_name: 'Alice', avatar: null };

function message(n: number, content = `message ${n}`): Message {
  return {
    id: String(100000000000000000n + BigInt(n)),
    channel_id: '555',
    author: AUTHOR,
    content,
    timestamp: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000000+00:00`,
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
  };
}

const OPTIONS: ExportOptions = {
  format: 'json',
  after: null,
  before: null,
  limit: null,
  htmlTheme: 'dark',
  locale: 'en',
  timeZone: 'UTC',
};

const TARGET: ExportTarget = {
  channelId: '555',
  kind: 'text',
  channelName: 'general',
  guildId: '777',
  guildName: 'My Server',
  categoryName: 'Text Channels',
  parentChannelName: null,
  topic: 'Welcome!',
};

const EXPORTED_AT = new Date('2026-10-06T12:34:56.000Z');

function context(overrides: { target?: Partial<ExportTarget>; options?: Partial<ExportOptions> } = {}): WriterContext {
  return {
    target: { ...TARGET, ...overrides.target },
    options: { ...OPTIONS, ...overrides.options },
    exportedAt: EXPORTED_AT,
    names: { user: () => undefined, channel: () => undefined, role: () => undefined },
  };
}

function asText(chunks: Chunk[]): string {
  return chunks.map((c) => (typeof c === 'string' ? c : new TextDecoder().decode(c))).join('');
}

function render(batches: Message[][], ctx: WriterContext = context(), summary?: Partial<WriterSummary>): string {
  const writer = jsonFormat.createWriter(ctx);
  const all = batches.flat();
  const chunks: Chunk[] = [...writer.start()];
  for (const batch of batches) chunks.push(...writer.write(batch));
  chunks.push(
    ...writer.end({
      messageCount: all.length,
      firstTimestamp: all[0]?.timestamp ?? null,
      lastTimestamp: all[all.length - 1]?.timestamp ?? null,
      ...summary,
    }),
  );
  return asText(chunks);
}

describe('jsonFormat', () => {
  it('describes itself', () => {
    expect(jsonFormat.id).toBe('json');
    expect(jsonFormat.label).toBe('JSON (.json)');
    expect(jsonFormat.extension).toBe('json');
    expect(jsonFormat.mime).toBe('application/json');
  });

  it('writes valid JSON for zero messages', () => {
    const doc = JSON.parse(render([]));
    expect(doc.messages).toEqual([]);
    expect(doc.messageCount).toBe(0);
    expect(doc.firstMessageAt).toBeNull();
    expect(doc.lastMessageAt).toBeNull();
    expect(render([])).toContain('"messages": [],');
  });

  it('writes valid JSON for zero messages even when empty batches are fed', () => {
    expect(() => JSON.parse(render([[], []]))).not.toThrow();
  });

  it('writes the channel, range and generator metadata', () => {
    const doc = JSON.parse(
      render([[message(1)]], context({ options: { after: '2026-01-01T00:00:00.000Z', before: '2026-02-01T00:00:00.000Z' } })),
    );
    expect(doc.exportedAt).toBe('2026-10-06T12:34:56.000Z');
    expect(doc.generator).toBe('Discord Chat Extractor');
    expect(doc.channel).toEqual({
      id: '555',
      name: 'general',
      kind: 'text',
      guild: { id: '777', name: 'My Server' },
      category: 'Text Channels',
      topic: 'Welcome!',
    });
    expect(doc.range).toEqual({ after: '2026-01-01T00:00:00.000Z', before: '2026-02-01T00:00:00.000Z', limit: null });
  });

  it('records the message count limit of the effective scope in the range', () => {
    const doc = JSON.parse(render([[message(1)]], context({ options: { after: null, before: '2026-02-01T00:00:00.000Z', limit: 200 } })));
    expect(doc.range).toEqual({ after: null, before: '2026-02-01T00:00:00.000Z', limit: 200 });
  });

  it('uses null guild/category/topic for DMs and open ranges', () => {
    const doc = JSON.parse(
      render(
        [],
        context({
          target: { kind: 'dm', guildId: null, guildName: null, categoryName: null, topic: null, channelName: 'Alice' },
        }),
      ),
    );
    expect(doc.channel).toEqual({ id: '555', name: 'Alice', kind: 'dm', guild: null, category: null, topic: null });
    expect(doc.range).toEqual({ after: null, before: null, limit: null });
  });

  it('keeps raw API messages with full fidelity, one compact line each', () => {
    const rich: Message = {
      ...message(2, 'multi\nline "quoted" \\ backslash \t tab 😀 안녕'),
      mentions: [{ id: '2000', username: 'bob' }],
      reactions: [{ count: 3, emoji: { id: null, name: '👍' } }],
      attachments: [{ id: '9', filename: 'a b.png', size: 12, url: 'https://cdn.discordapp.com/a%20b.png' }],
      edited_timestamp: '2026-01-01T00:05:00.000000+00:00',
    };
    const batch = [message(1), rich, message(3)];
    const text = render([batch]);
    const doc = JSON.parse(text);
    expect(doc.messages).toEqual(batch);

    const lines = text.split('\n');
    const messageLines = lines.filter((l) => l.startsWith('    {'));
    expect(messageLines).toHaveLength(3);
    expect(JSON.parse(messageLines[1].replace(/,$/, ''))).toEqual(rich);
  });

  it('separates messages with commas across batch boundaries', () => {
    const batches = [[message(1), message(2)], [message(3)], [], [message(4), message(5)]];
    const doc = JSON.parse(render(batches));
    expect(doc.messages.map((m: Message) => m.content)).toEqual(batches.flat().map((m) => m.content));
    expect(doc.messageCount).toBe(5);
  });

  it('writes the counts from the summary after the array', () => {
    const doc = JSON.parse(
      render([[message(1)]], context(), {
        messageCount: 1,
        firstTimestamp: '2026-01-01T00:00:01.000000+00:00',
        lastTimestamp: '2026-01-01T00:00:01.000000+00:00',
      }),
    );
    expect(doc.messageCount).toBe(1);
    expect(doc.firstMessageAt).toBe('2026-01-01T00:00:01.000000+00:00');
    expect(doc.lastMessageAt).toBe('2026-01-01T00:00:01.000000+00:00');
  });

  it('ends with a newline and puts the counts after the messages', () => {
    const text = render([[message(1)]]);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('"messages"')).toBeLessThan(text.indexOf('"messageCount"'));
  });

  it('is valid JSON for hostile channel metadata', () => {
    const doc = JSON.parse(
      render(
        [],
        context({
          target: { channelName: 'a"b\\c\nd', topic: 'line1\nline2 </script>' },
        }),
      ),
    );
    expect(doc.channel.name).toBe('a"b\\c\nd');
    expect(doc.channel.topic).toBe('line1\nline2 </script>');
  });

  it('keeps one message per line even with U+2028 / U+2029 in the content', () => {
    const tricky = message(1, `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`);
    const text = render([[tricky]]);
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(text).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(text).messages[0].content).toBe(tricky.content);
  });

  it('survives lone surrogates in message text', () => {
    const doc = JSON.parse(render([[message(1, 'bad \uD800 surrogate')]]));
    expect(typeof doc.messages[0].content).toBe('string');
  });

  it('emits only string chunks', () => {
    const writer = jsonFormat.createWriter(context());
    const chunks = [...writer.start(), ...writer.write([message(1)]), ...writer.end({ messageCount: 1, firstTimestamp: null, lastTimestamp: null })];
    expect(chunks.every((c) => typeof c === 'string')).toBe(true);
  });

  it('handles a large number of messages', () => {
    const batch = Array.from({ length: 5000 }, (_, i) => message(i + 1));
    const doc = JSON.parse(render([batch.slice(0, 100), batch.slice(100)]));
    expect(doc.messages).toHaveLength(5000);
    expect(doc.messageCount).toBe(5000);
  });

  it('creates independent writers', () => {
    const a = jsonFormat.createWriter(context());
    const b = jsonFormat.createWriter(context());
    a.start();
    b.start();
    a.write([message(1)]);
    const tail = asText(b.end({ messageCount: 0, firstTimestamp: null, lastTimestamp: null }));
    expect(tail.startsWith('],')).toBe(true);
  });
});
