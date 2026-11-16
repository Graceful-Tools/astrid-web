/**
 * Claim the first Ready task nobody else has (ADEV-26).
 *
 * N cloud workers start from the same preflight snapshot, and local sessions read the
 * same board, so every one of them sees the same top task. Claims are atomic: exactly one
 * wins, and the others get a 409 (`claim-fixall-task.ts` exit 2). A worker that stopped
 * there would end SKIPPED with work still on the board, so a conflict moves it on to the
 * next candidate, in the queue's own priority order. Rotating the starting point per slot
 * would cut the 409s, but a lone worker would then take a lower-priority task while the
 * top one sat unclaimed; a 409 costs one request, a priority inversion costs a day.
 *
 * When the snapshot runs out, the LIVE queue is read again before giving up: a task that
 * entered Ready after the preflight, or one a peer released, is still this worker's to
 * take. Only when a fresh read holds nothing untried is the answer "no Ready task left".
 */

export interface ClaimCandidate {
  id: string
  identifier?: string | null
  title?: string | null
}

/** Same test as agent-run.yml's "Does the queue hold an astrid-core task" step. */
export function isCoreCandidate(task: ClaimCandidate): boolean {
  const title = task.title ?? ''
  return /^\s*\[core\]/i.test(title) || /\bastrid-core\b/i.test(title)
}

export interface ClaimNextResult {
  claimed: ClaimCandidate | null
  /** Ids that answered 409, in the order tried. */
  conflicts: string[]
  /** Candidates passed over by `skip` (e.g. a core task on a run that cannot push there). */
  skipped: string[]
}

export async function claimNextReady(input: {
  /** The preflight snapshot's queue, in the server's priority order. */
  initial: ClaimCandidate[]
  claim: (task: ClaimCandidate) => Promise<'claimed' | 'conflict'>
  /** A fresh read of the live queue. */
  refresh: () => Promise<ClaimCandidate[]>
  skip?: (task: ClaimCandidate) => boolean
  /** Fresh reads after the snapshot is exhausted. Bounded, so a flapping board cannot spin. */
  maxRefreshes?: number
  log?: (line: string) => void
}): Promise<ClaimNextResult> {
  const log = input.log ?? (() => {})
  const maxRefreshes = input.maxRefreshes ?? 2
  const tried = new Set<string>()
  const conflicts: string[] = []
  const skipped = new Set<string>()

  let candidates = input.initial
  for (let read = 0; ; read++) {
    for (const task of candidates) {
      if (!task?.id || tried.has(task.id) || skipped.has(task.id)) continue
      if (input.skip?.(task)) {
        skipped.add(task.id)
        log(`SKIP ${task.identifier ?? task.id}`)
        continue
      }
      tried.add(task.id)
      if ((await input.claim(task)) === 'claimed') {
        return { claimed: task, conflicts, skipped: [...skipped] }
      }
      conflicts.push(task.id)
      log(`CLAIM_CONFLICT ${task.identifier ?? task.id}: a peer has it — trying the next Ready task`)
    }
    if (read >= maxRefreshes) break
    const fresh = await input.refresh()
    if (!fresh.some(task => task?.id && !tried.has(task.id) && !skipped.has(task.id))) break
    candidates = fresh
  }
  return { claimed: null, conflicts, skipped: [...skipped] }
}
