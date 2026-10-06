import type { Message } from '../../discord/types';
import type { Chunk, ExportFormat, ExportWriter, WriterContext } from '../types';
import { csvRow } from './csvEncode';
import { createRowBuilder, rowHeaders } from './rows';

/** Excel only detects UTF-8 (and so shows Korean correctly) when the file starts with a byte order mark. */
const BOM = String.fromCharCode(0xfeff);

/**
 * One CSV row per message. Rows are produced batch by batch, so nothing but the current batch is ever held.
 *
 * Known limitation, kept on purpose: Message ID, Author ID and Reply To are bare 17-19 digit numbers. Excel (and
 * LibreOffice by default) reads such a field as a number, shows it in scientific notation (1.42346E+18) and keeps only
 * 15 significant digits, so saving the file from Excel permanently rounds the ids and they can no longer be matched
 * with the JSON / XLSX export or with Discord. CSV is a text format and the digits are the exact, lossless value for
 * every other consumer (pandas, databases, scripts); a text marker (leading apostrophe, `="123"`, a prefix) would
 * corrupt those or reintroduce formulas. Excel users should pick the XLSX export, which stores ids as text cells, or
 * import the CSV through Data > From Text/CSV with the id columns set to Text.
 */
function createCsvWriter(ctx: WriterContext): ExportWriter {
  const toRow = createRowBuilder(ctx);

  return {
    start(): Chunk[] {
      return [BOM + csvRow(rowHeaders(ctx.options.locale))];
    },

    write(batch: readonly Message[]): Chunk[] {
      let out = '';
      for (const message of batch) out += csvRow(toRow(message));
      return out === '' ? [] : [out];
    },

    end(): Chunk[] {
      return [];
    },
  };
}

export const csvFormat: ExportFormat = {
  id: 'csv',
  label: 'CSV (.csv)',
  extension: 'csv',
  mime: 'text/csv;charset=utf-8',
  createWriter: createCsvWriter,
};
