import type { Message } from '../../discord/types';
import { createXlsxBuilder } from '../xlsx';
import type { Chunk, ExportFormat, ExportWriter, WriterContext } from '../types';
import { createRowBuilder, ROW_COLUMNS, rowHeaders } from './rows';

/** ZIP stores DOS dates, which only cover 1980-2099: anything else (an invalid Date, a mocked clock) must not fail the export. */
function zipTimestamp(date: Date): Date {
  const year = date.getFullYear();
  return year >= 1980 && year <= 2099 ? date : new Date();
}

/**
 * Same columns and values as the CSV export. The builder keeps rows only as encoded XML and writes nothing but
 * string cells, so ids stay exact and a message such as "=HYPERLINK(...)" is text, never a formula; nothing has to be
 * neutralised here. The file is assembled in `end()`.
 */
function createXlsxWriter(ctx: WriterContext): ExportWriter {
  const toRow = createRowBuilder(ctx);
  const headers = rowHeaders(ctx.options.locale);
  const builder = createXlsxBuilder({
    sheetName: ctx.target.channelName,
    columns: ROW_COLUMNS.map((column, index) => ({ header: headers[index], width: column.width, wrap: column.wrap })),
    createdAt: zipTimestamp(ctx.exportedAt),
  });

  return {
    start(): Chunk[] {
      return [];
    },

    write(batch: readonly Message[]): Chunk[] {
      for (const message of batch) builder.addRow(toRow(message));
      return [];
    },

    end(): Chunk[] {
      return [builder.build()];
    },
  };
}

export const xlsxFormat: ExportFormat = {
  id: 'xlsx',
  label: 'Excel (.xlsx)',
  extension: 'xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  createWriter: createXlsxWriter,
};
