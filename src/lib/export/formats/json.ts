import type { Message } from '../../discord/types';
import type { Chunk, ExportFormat, ExportWriter, WriterContext, WriterSummary } from '../types';

/** U+2028/2029 are legal inside JSON strings but split "lines" in some tools; escaping keeps one message per line. */
function compactLine(message: Message): string {
  return JSON.stringify(message).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * One JSON document written incrementally. The counts sit after the `messages` array because they are
 * unknown when the file starts; JSON consumers do not care about key order.
 */
function createJsonWriter(ctx: WriterContext): ExportWriter {
  const { target, options, exportedAt } = ctx;
  let written = 0;

  return {
    start(): Chunk[] {
      const header = {
        exportedAt: exportedAt.toISOString(),
        generator: 'Discord Chat Extractor',
        channel: {
          id: target.channelId,
          name: target.channelName,
          kind: target.kind,
          guild: target.guildId === null ? null : { id: target.guildId, name: target.guildName },
          category: target.categoryName,
          topic: target.topic,
        },
        range: { after: options.after, before: options.before, limit: options.limit },
      };
      // Strip the closing brace of the pretty-printed header so the message array can be appended to the same object.
      const open = JSON.stringify(header, null, 2).slice(0, -2);
      return [`${open},\n  "messages": [`];
    },

    write(batch: readonly Message[]): Chunk[] {
      if (batch.length === 0) return [];
      const lines = batch.map((message) => `\n    ${compactLine(message)}`);
      const out = lines.join(',');
      const chunk = written === 0 ? out : `,${out}`;
      written += batch.length;
      return [chunk];
    },

    end(summary: WriterSummary): Chunk[] {
      const tail = {
        messageCount: summary.messageCount,
        firstMessageAt: summary.firstTimestamp,
        lastMessageAt: summary.lastTimestamp,
      };
      // Same trick as in start(): re-open the pretty-printed object to splice its members after the array.
      const members = JSON.stringify(tail, null, 2).slice(2, -2);
      return [`${written === 0 ? '' : '\n  '}],\n${members}\n}\n`];
    },
  };
}

export const jsonFormat: ExportFormat = {
  id: 'json',
  label: 'JSON (.json)',
  extension: 'json',
  mime: 'application/json',
  createWriter: createJsonWriter,
};
