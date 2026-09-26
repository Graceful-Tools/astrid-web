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

export function formatIdentifier(key: string, sequence: number): string {
  return `${key.toUpperCase()}-${sequence}`
}
