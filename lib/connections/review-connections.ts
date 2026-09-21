/**
 * Which connections look unused enough to be worth revoking.
 *
 * `listConnections` answers "what can act as this account"; this answers the
 * question a reader actually arrives with — "which of these can I turn off?".
 * It is pure arithmetic over the shape the API already returns, so the same
 * judgement can be made on the server, in the browser, or by a client that
 * only ever sees the JSON.
 *
 * Conservative in one direction on purpose. Suggesting that a live credential
 * be revoked breaks whatever depends on it; staying quiet about an idle one
 * costs nothing. So two whole categories are never suggested:
 *
 * - **Kinds that do not record usage.** `MCPToken` has no `lastUsedAt` column,
 *   so every access token reports "never used" — the one that ran a minute ago
 *   as loudly as the one nobody has touched since it was made.
 * - **Rows that cannot be revoked.** Advice with no button behind it is noise.
 */

import type { V1Connection, V1ConnectionKind } from '@/lib/api-contracts/v1-ios-shapes'

/** Used once and then forgotten: no use in this long reads as abandoned. */
export const IDLE_AFTER_DAYS = 90

/** Created and never used. Longer than a holiday, shorter than a quarter. */
export const NEVER_USED_AFTER_DAYS = 30

/**
 * Kinds whose `lastUsedAt` is a real observation rather than a placeholder.
 * `accessToken` is the one that is absent — see the note above.
 */
const USAGE_TRACKED_KINDS: ReadonlySet<V1ConnectionKind> = new Set([
  'oauthClient',
  'authorizedApp',
  'customAgent',
  'webhook',
])

export type ConnectionReviewReason = 'idle' | 'neverUsed'

export interface ConnectionReview {
  kind: V1ConnectionKind
  id: string
  reason: ConnectionReviewReason
  /** Whole days since the last use, or since creation when there has been none. */
  days: number
}

/** The identity of a row: `kind` and `id` together, since ids repeat across kinds. */
export function connectionKey(connection: Pick<V1Connection, 'kind' | 'id'>): string {
  return `${connection.kind}:${connection.id}`
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function wholeDaysSince(value: string | null, now: Date): number | null {
  if (!value) return null
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / MS_PER_DAY)
}

/** The unused-looking connections, stalest first. */
export function reviewConnections(
  connections: V1Connection[],
  now: Date = new Date()
): ConnectionReview[] {
  const reviews: ConnectionReview[] = []

  for (const connection of connections) {
    if (!connection.revocable) continue
    if (!USAGE_TRACKED_KINDS.has(connection.kind)) continue

    const idleDays = wholeDaysSince(connection.lastUsedAt, now)
    if (idleDays !== null) {
      if (idleDays >= IDLE_AFTER_DAYS) {
        reviews.push({ kind: connection.kind, id: connection.id, reason: 'idle', days: idleDays })
      }
      continue
    }

    const age = wholeDaysSince(connection.createdAt, now)
    if (age !== null && age >= NEVER_USED_AFTER_DAYS) {
      reviews.push({ kind: connection.kind, id: connection.id, reason: 'neverUsed', days: age })
    }
  }

  return reviews.sort((a, b) => b.days - a.days)
}
