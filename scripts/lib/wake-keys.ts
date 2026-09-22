/**
 * The seen-file's two-phase bookkeeping (AWTD-986), pure so it is testable.
 *
 * The loop's preflight computes which inbox/lane keys are waking a run and
 * hands them to the run; the run's OUTCOME decides what the seen-file learns:
 *
 *   finished  → every preflight key is seen. One run per item, as before.
 *   failed    → the keys get another chance, but not an unbounded one. A run
 *               that keeps dying on the same item (watchdog, budget, crash)
 *               must not wake a session every tick forever — that is the bill
 *               the seen-file exists to avoid. After MAX_FAILED_ATTEMPTS the
 *               key is muted like a finished one; a new comment is a new key.
 *
 * Both paths MERGE into the existing set rather than replace it: a preflight
 * whose inbox or lanes could not be read carries no keys for that source, and
 * replacing the file with what it had would un-mute everything it did not see.
 */

/** Failed runs a key may wake before it is muted. */
export const MAX_FAILED_ATTEMPTS = 2

/** Keys as a JSON array; anything else is nothing. Shared by file and argv. */
export function parseSeenKeys(text: string | undefined): string[] | null {
  if (text === undefined) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null
  } catch {
    return null
  }
}

/** A finished run: its keys join the seen set; their attempt counts are done. */
export function recordFinishedRun(
  seen: Iterable<string>,
  keys: string[],
  attempts: Record<string, number>,
): { seen: string[]; attempts: Record<string, number> } {
  const next = new Set(seen)
  for (const key of keys) next.add(key)
  const remaining = { ...attempts }
  for (const key of keys) delete remaining[key]
  return { seen: [...next], attempts: remaining }
}

/** A failed run: one more strike per key; a key out of strikes is muted. */
export function recordFailedRun(
  seen: Iterable<string>,
  keys: string[],
  attempts: Record<string, number>,
  max: number = MAX_FAILED_ATTEMPTS,
): { seen: string[]; attempts: Record<string, number>; exhausted: string[] } {
  const next = new Set(seen)
  const counts = { ...attempts }
  const exhausted: string[] = []
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1
    if (counts[key] >= max) {
      exhausted.push(key)
      next.add(key)
      delete counts[key]
    }
  }
  return { seen: [...next], attempts: counts, exhausted }
}
