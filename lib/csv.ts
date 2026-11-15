/**
 * The one CSV writer (AWTD-1670). It started as a private helper in the user
 * data export (GET /api/v1/users/me/export); the runtime-binding audit export
 * needs the same, so it lives here instead of being written twice.
 */

export interface CsvOptions {
  /**
   * Prefix a string that a spreadsheet would run as a formula (= + - @, tab,
   * carriage return) with a single quote. Use it for any export a person may
   * open in Excel or Sheets whose values a third party can influence.
   */
  neutralizeFormulas?: boolean
}

const FORMULA_LEAD = /^[=+\-@\t\r]/

/** One cell: quoted when it holds a comma, quote or line break, inner quotes doubled. */
export function escapeCsvValue(value: unknown, { neutralizeFormulas = false }: CsvOptions = {}): string {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? value.toISOString() : String(value)
  if (neutralizeFormulas && typeof value === 'string' && FORMULA_LEAD.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** A header row, then one row per record with its values in header order. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  options: CsvOptions = {},
): string {
  return [
    headers.map(h => escapeCsvValue(h, options)).join(','),
    ...rows.map(row => headers.map(h => escapeCsvValue(row[h], options)).join(',')),
  ].join('\n')
}
