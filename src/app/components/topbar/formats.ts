import { EXPORT_FORMAT_IDS, type ExportFormatId } from '@/lib/export/types';

/*
 * UI facts about the export formats. They live here instead of in `@/lib/export/formats` (EXPORT_FORMAT_META) on purpose:
 * that module also holds the lazy format loaders, and the picker must not depend on them.
 */

/** Order of the cards in the picker: the recommended format first. */
export const FORMAT_ORDER: readonly ExportFormatId[] = EXPORT_FORMAT_IDS;

/** Card title (format name and file extension, the same in every language). */
export const FORMAT_NAMES: Record<ExportFormatId, string> = {
  html: 'HTML',
  txt: 'TXT',
  md: 'Markdown',
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
  json: 'JSON',
};

/** Short tag on the download button. */
export const FORMAT_CHIPS: Record<ExportFormatId, string> = {
  html: 'HTML',
  txt: 'TXT',
  md: 'MD',
  xlsx: 'XLSX',
  csv: 'CSV',
  json: 'JSON',
};
