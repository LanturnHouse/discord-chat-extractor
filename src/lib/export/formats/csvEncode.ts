/** CSV serialisation (RFC 4180) with spreadsheet formula neutralising. Kept apart from csv.ts, which exports only its format. */

const CSV_ROW_END = '\r\n';

/**
 * Formula injection: Excel, LibreOffice and Google Sheets evaluate a cell that starts with = + - @ (and with a tab
 * or carriage return, which some versions skip before looking at the first character). A single quote in front makes
 * every one of them show the cell as text, the quote itself being the (visible) price of that.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function neutraliseFormula(cell: string): string {
  return FORMULA_TRIGGER.test(cell) ? `'${cell}` : cell;
}

/** A field containing a quote, comma or line break is quoted and its quotes are doubled. */
export function csvField(cell: string): string {
  const safe = neutraliseFormula(cell);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One record including its CRLF terminator. */
export function csvRow(cells: readonly string[]): string {
  let row = '';
  for (let i = 0; i < cells.length; i += 1) row += i === 0 ? csvField(cells[i]) : `,${csvField(cells[i])}`;
  return row + CSV_ROW_END;
}
