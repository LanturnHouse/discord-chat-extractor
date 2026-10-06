import type { ExportFormat, ExportFormatId } from '../types';

/**
 * Format registry. Each format module exports a single `<id>Format` constant. They are loaded lazily so the initial
 * app bundle does not carry the XLSX writer / HTML template until a user actually exports with that format.
 */
const loaders: Record<ExportFormatId, () => Promise<ExportFormat>> = {
  html: async () => (await import('./html')).htmlFormat,
  txt: async () => (await import('./txt')).txtFormat,
  md: async () => (await import('./md')).mdFormat,
  xlsx: async () => (await import('./xlsx')).xlsxFormat,
  csv: async () => (await import('./csv')).csvFormat,
  json: async () => (await import('./json')).jsonFormat,
};

export function loadExportFormat(id: ExportFormatId): Promise<ExportFormat> {
  return loaders[id]();
}
