/**
 * Bounded-parallelism map (task f9ba26b3).
 *
 * The cron and sync loops in this codebase were written as `for … await`, which
 * is the safest thing to write and the slowest thing to run: 300 items each
 * costing two round trips is 600 sequential waits inside a route with
 * `maxDuration = 60`. Unbounded `Promise.all` is the usual over-correction and
 * is worse — it opens as many database connections as there are items, and
 * `connectionPoolConfig` caps production at ten.
 *
 * WHY NOT JUST Promise.all WITH A CHUNK LOOP. Chunking runs in lockstep: a
 * chunk of ten waits for its slowest member before the next ten start, so one
 * slow row idles nine workers. This keeps `limit` workers saturated by having
 * each pull the next index as it finishes.
 *
 * ERROR SEMANTICS ARE THE POINT, NOT AN ASIDE. The GitHub sync driver commits
 * its `since` watermark only when apply returns without throwing, so an error
 * that gets lost here becomes an issue that is never offered again — silent,
 * permanent data loss. So:
 *
 *   - the FIRST error is rethrown, and rethrown as itself, because callers
 *     match on it (`code === 'P2002'` decides concurrent-create vs real failure)
 *   - every in-flight call is awaited before that throw, so nothing lands after
 *     the caller has moved on and no rejection escapes unhandled
 *   - no further items start once one has failed: the caller is going to
 *     discard the pass and retry it, so the extra work is waste
 */

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order
 * in the results. Rejects with the first error encountered.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results

  // A limit wider than the work just idles workers; a limit below 1 would hang.
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))

  let nextIndex = 0
  let failure: unknown
  let failed = false

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex++
      if (index >= items.length) return

      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        // First error wins. Later ones are consequences of the same bad pass
        // and would only obscure it.
        if (!failed) {
          failed = true
          failure = error
        }
        return
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))

  if (failed) throw failure
  return results
}
