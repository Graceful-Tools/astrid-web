/**
 * The identifier format itself — `KEY-N` (task 12f54df4, AWTD-1010).
 *
 * Client-safe: no Prisma. lib/task-identifier.ts re-exports all of this beside
 * the server-only allocation, so the pattern still lives in exactly one place
 * while components (the autolinker in lib/task-identifier-links.ts) can import
 * it without pulling a database client into the browser bundle (AWTD-1017).
 */

/** Project keys are short enough to type and long enough to disambiguate. */
export const MIN_PROJECT_KEY_LENGTH = 2
export const MAX_PROJECT_KEY_LENGTH = 5

const IDENTIFIER_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d+)$/

export interface ParsedIdentifier {
  key: string
  sequence: number
}

/**
 * Parse "AST-142" into its parts, or null when it isn't an identifier.
 *
 * Case-insensitive on input (people type `ast-142`), canonical uppercase on
 * output — the same identifier must not resolve two different ways.
 */
export function parseIdentifier(value: string | null | undefined): ParsedIdentifier | null {
  if (typeof value !== 'string') return null
  const match = IDENTIFIER_PATTERN.exec(value.trim())
  if (!match) return null

  const sequence = Number(match[2])
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null

  return { key: match[1].toUpperCase(), sequence }
}

/**
 * An owner-typed project key in canonical form, or null when the identifier
 * format cannot carry it (AWTD-1018). Judged by `parseIdentifier` itself, so
 * the key rule and the id rule cannot drift apart.
 */
export function normalizeProjectKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return null
  return parseIdentifier(`${trimmed}-1`)?.key ?? null
}

/**
 * Derive a candidate project key from its name.
 *
 * Initials of the first words when there are several ("Astrid Web To-do" →
 * "AWT"), otherwise the leading letters of the single word ("Astrid" → "AST").
 * Digits are kept when they carry meaning ("Project 42" → "P4"), because
 * stripping them produces surprising keys.
 *
 * Returns null when the name has nothing usable — the caller falls back rather
 * than minting a meaningless key. Client-safe so the "make this a board" form
 * can show the owner the key before they accept or edit it (AWTD-1018).
 */
export function deriveProjectKey(name: string): string | null {
  const cleaned = (name || '').trim()
  if (!cleaned) return null

  const words = cleaned
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return null

  const candidate = words.length > 1
    ? words.map(word => word[0]).join('')
    : words[0]

  const normalized = candidate
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, MAX_PROJECT_KEY_LENGTH)

  if (normalized.length === 0) return null
  // A key must start with a letter so it can never be confused with a bare
  // sequence number.
  if (!/^[A-Z]/.test(normalized)) return null

  // Pad a one-character key rather than rejecting it: "X" → "XX" is ugly but
  // usable, and refusing would leave the project with no identifier at all.
  return normalized.length < MIN_PROJECT_KEY_LENGTH
    ? normalized.padEnd(MIN_PROJECT_KEY_LENGTH, normalized[0])
    : normalized
}

export function formatIdentifier(key: string, sequence: number): string {
  return `${key.toUpperCase()}-${sequence}`
}
