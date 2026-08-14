/**
 * Turning a caller-supplied `limit` into something safe to hand a database.
 *
 * Three routes had grown their own version of this and each got it slightly
 * wrong in a different way (task e0613ae5):
 *
 *   chat messages     Math.min(parseInt(x || '50'), 100)   NaN survives
 *   v1 public lists   Math.min(parseInt(x || '50'), 100)   NaN survives
 *   legacy public     parseInt(x || '10')                  no cap at all
 *
 * The NaN case is the one a cap does not rescue: `Math.min(NaN, 100)` is NaN,
 * so `?limit=abc` reached Prisma's `take` and failed the request as a 500
 * rather than a 400. And a missing cap means `?limit=1000000` is an unbounded
 * query on a public listing endpoint.
 *
 * Neither is exotic input. Both are what you get from a hand-written URL or a
 * client bug, which is exactly when an endpoint should degrade rather than
 * fall over.
 */

export interface LimitOptions {
  /** Used when the parameter is absent, unparseable, or not positive. */
  fallback: number
  /** Hard ceiling. A caller asking for more gets this. */
  max: number
}

/**
 * Parse a `limit` query parameter into a positive integer within bounds.
 *
 * Every failure mode collapses to `fallback` rather than propagating: absent,
 * empty, non-numeric, NaN, negative, zero, or fractional. The alternative is
 * passing something Prisma will reject, which turns a caller's typo into a
 * server error.
 */
export function parseLimit(raw: string | number | null | undefined, options: LimitOptions): number {
  const { fallback, max } = options

  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)

  if (!Number.isFinite(parsed) || parsed < 1) return Math.min(fallback, max)

  return Math.min(Math.floor(parsed), max)
}
