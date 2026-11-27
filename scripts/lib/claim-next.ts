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

import { EXPIRED_LEASE_MARKER } from '@/lib/agent-task-claim'
import { RELEASE_MARKER, REWORK_MARKER } from './doing-release'

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

/**
 * ADEV-338: a task that needs a Mac (astrid-ios sources, a device, a preview token) is titled
 * `[mac]` or `[needs-mac]`, the way a core task is titled `[core]`. A cloud runner has none of
 * those, so it passes the task over instead of claiming it, ending PARTIAL in two minutes and
 * counting a release against the task.
 */
export function isNeedsMacCandidate(task: ClaimCandidate): boolean {
  return /^\s*\[(?:needs-)?mac\]/i.test(task.title ?? '')
}

/**
 * ADEV-75: the task agent-run's "Take this worker's task" step already claimed for this
 * worker (slots 2..N), or undefined. A session that re-walks the queue finds that task in
 * Doing, answers NO_READY_TASK, reports SKIPPED, and the release hands the task back.
 */
export function runnerClaimedTask(env: Record<string, string | undefined>): string | undefined {
  const id = env.ASTRID_CLAIMED_TASK?.trim()
  return id && /^[A-Za-z0-9-]+$/.test(id) ? id : undefined
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
  skip?: (task: ClaimCandidate) => boolean | Promise<boolean>
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
      if (await input.skip?.(task)) {
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

/**
 * The open PR branch that already carries this task's work, or undefined (ADEV-310).
 *
 * A claim lease that lapses mid-work puts the task back in Ready while its PR is open, and
 * the next worker builds it again (#1015/#1016, #1018/#1020). Once work has a PR nobody
 * else starts it. The identifier must stand alone in the branch name: `ADEV-31` is not
 * `ADEV-310`.
 */
export function openPrBranchFor(task: ClaimCandidate, openBranches: readonly string[]): string | undefined {
  const identifier = task.identifier?.trim()
  if (!identifier || !/^[A-Za-z0-9]+-\d+$/.test(identifier)) return undefined
  const standalone = new RegExp(`(^|[^A-Za-z0-9])${identifier}($|[^0-9])`, 'i')
  return openBranches.find(branch => standalone.test(branch))
}

/**
 * The head branches of the repo's open PRs. FAIL-OPEN: a lookup that errors returns []
 * and says so, because a missed duplicate costs one PR and a blocked claim costs the run.
 */
export function openPrBranches(listOpenPrBranches: () => string[], log: (line: string) => void = () => {}): string[] {
  try {
    return listOpenPrBranches().filter(branch => typeof branch === 'string' && branch.length > 0)
  } catch (error) {
    log(`OPEN_PR_LOOKUP_FAILED: ${error instanceof Error ? error.message : error} — claiming without the open-PR guard`)
    return []
  }
}

export interface ClaimComment {
  content?: string | null
  createdAt?: string | Date | null
}

/**
 * Was this task SENT BACK to be resumed from `branch`? Then its open PR is not a reason to
 * pass it over: the ship workflow returns a PR that cannot land to Ready on purpose
 * (REWORK_MARKER, ADEV-200), and a stale-Doing release names the branch to continue from
 * (RELEASE_MARKER). The duplicate this guard stops is the other way back to Ready, an
 * expired lease (EXPIRED_LEASE_MARKER), so the newer of the two decides.
 */
export function sentBackToResume(comments: readonly ClaimComment[], branch: string): boolean {
  const at = (comment: ClaimComment) => {
    const time = comment.createdAt ? new Date(comment.createdAt).getTime() : NaN
    return Number.isNaN(time) ? 0 : time
  }
  const newest = (match: (content: string) => boolean) =>
    Math.max(0, ...comments.filter(comment => match(comment.content ?? '')).map(at))
  const sentBack = newest(content =>
    (content.startsWith(REWORK_MARKER) || content.startsWith(RELEASE_MARKER)) && content.includes(branch))
  const leaseExpired = newest(content => content.startsWith(EXPIRED_LEASE_MARKER))
  return sentBack > 0 && sentBack > leaseExpired
}

/**
 * A `skip` for claimNextReady: pass over a task whose work already has an open PR, and log
 * which PR branch, unless the task was sent back to be resumed from that branch. Reads the
 * task's comments only when an open PR matches. FAIL-OPEN: a comment read that errors
 * claims the task. Composes with another skip (e.g. isCoreCandidate) when given one.
 */
export function skipTasksWithOpenPr(input: {
  openBranches: readonly string[]
  comments: (task: ClaimCandidate) => Promise<readonly ClaimComment[]>
  log: (line: string) => void
  otherwise?: (task: ClaimCandidate) => boolean
}): (task: ClaimCandidate) => Promise<boolean> {
  return async task => {
    if (input.otherwise?.(task)) return true
    const branch = openPrBranchFor(task, input.openBranches)
    if (!branch) return false
    try {
      if (sentBackToResume(await input.comments(task), branch)) {
        input.log(`OPEN_PR_RESUME ${task.identifier}: sent back to be resumed from ${branch} — claiming it`)
        return false
      }
    } catch (error) {
      input.log(`OPEN_PR_LOOKUP_FAILED: ${task.identifier} comments: ${error instanceof Error ? error.message : error} — claiming it`)
      return false
    }
    input.log(`SKIP_OPEN_PR ${task.identifier}: open PR on ${branch} already carries this task — trying the next Ready task`)
    return true
  }
}
