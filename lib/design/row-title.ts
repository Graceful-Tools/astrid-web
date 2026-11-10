/**
 * How many lines a task's title may take in a row.
 *
 * It wraps without limit by default, as on iOS, and an appearance setting on
 * every client chooses wrap, two lines or one (docs/specs/DESIGN_SYSTEM.md →
 * States; Jon, 2026-11-10). The choice belongs to the machine, like the theme:
 * a phone and a wide desktop want different answers.
 *
 * The value becomes a class on <html>; styles/components.css clamps
 * `.task-title` under it.
 */
export const ROW_TITLE_LINES = ['wrap', '2', '1'] as const

export type RowTitleLines = (typeof ROW_TITLE_LINES)[number]

export const ROW_TITLE_STORAGE_KEY = 'astrid-row-title-lines'

export const DEFAULT_ROW_TITLE_LINES: RowTitleLines = 'wrap'

/** A stored value, or the default for anything this build does not know. */
export function parseRowTitleLines(value: string | null | undefined): RowTitleLines {
  return ROW_TITLE_LINES.find((known) => known === value) ?? DEFAULT_ROW_TITLE_LINES
}

export function rowTitleClass(lines: RowTitleLines): string {
  return `row-title-${lines}`
}

export const ROW_TITLE_CLASSES = ROW_TITLE_LINES.map(rowTitleClass)
