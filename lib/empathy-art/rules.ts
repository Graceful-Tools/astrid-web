/**
 * Empathy-state art: which frame a board column shows (ADEV-142, for iOS ADEV-127).
 *
 * Every client must pick the same frame for the same list on the same day, so the rules live
 * here once, are exported as contracts/fixtures/empathy-art.json, and are written down in
 * docs/API_CONTRACT.md ("GET /api/v1/empathy-art").
 *
 * Pure and dependency-free on purpose: the contract-fixture driver imports this file directly.
 */

/** The order matters: the daily rotation indexes into it. Append only. */
export const EMPATHY_METAPHORS = ['race', 'wall', 'chef', 'garden', 'hike'] as const
export const EMPATHY_STATES = ['inbox', 'ready', 'doing', 'waiting', 'done'] as const

export type EmpathyMetaphor = (typeof EMPATHY_METAPHORS)[number]
export type EmpathyState = (typeof EMPATHY_STATES)[number]

const MS_PER_DAY = 86_400_000

/** FNV-1a, 32-bit, over the UTF-8 bytes of `text`. Returns an unsigned integer. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Whole days since 1970-01-01 in UTC: a new day starts at 00:00 UTC everywhere. */
export function daysSinceEpochUTC(at: Date): number {
  return Math.floor(at.getTime() / MS_PER_DAY)
}

/**
 * The list's metaphor for the day: metaphors[(fnv1a32(listId) + daysSinceEpochUTC) % count].
 *
 * The sum is taken without 32-bit wraparound (it fits easily in 64 bits). The list id is hashed
 * exactly as the server sends it: lowercase UUID text, no braces.
 */
export function empathyMetaphorFor(listId: string, at: Date): EmpathyMetaphor {
  const index = (fnv1a32(listId) + daysSinceEpochUTC(at)) % EMPATHY_METAPHORS.length
  return EMPATHY_METAPHORS[index]
}

/**
 * A column's state, in the wire's own terms: the Done column holds completed tasks, and every
 * other column is named by the `statusRole` its tasks carry (Inbox's is null). Custom columns,
 * whatever their role string, get no frame (null).
 */
export function empathyStateForColumn(column: { completed: boolean; statusRole: string | null }): EmpathyState | null {
  const { completed, statusRole } = column
  if (completed) return 'done'
  if (statusRole === null) return 'inbox'
  if (statusRole === 'ready' || statusRole === 'doing' || statusRole === 'waiting') return statusRole
  return null
}
