/**
 * Getting a task OUT of Doing when the session that claimed it is gone.
 *
 * A /fixall run moves a task Ready → Doing when it claims it, and every way the
 * workflow ends a task moves it on again: completed, parked in Waiting, or handed
 * back. So a claimed task still in Doing after its run is a run that died or
 * stopped mid-task — and nothing ever looked at Doing, so it sat there. On
 * 2026-09-28 three did (AWTD-1007, AWTD-1024, AWTD-1025), each with its work
 * saved on a pushed branch, while the queue reported "not in Ready" every tick.
 *
 * Two ways in, one decision:
 *   - `claims`: the runner hands over exactly the tasks its run claimed
 *     (scripts/claim-fixall-task.ts records them). No heuristic needed.
 *   - `stale`: a tick-start backstop for claims no runner is holding — an
 *     interactive session that died, or anything from before this existed.
 *     Decided by idleness, so it is deliberately much longer than the watchdog.
 *
 * Released → back to Ready, KEEPING the agent assignment, with a comment naming
 * any branch that carries the work, so the next run resumes rather than restarts.
 * Released a SECOND time → handed back to the task's human creator in Waiting:
 * docs/FIXALL_WORKFLOW.md says a task that fails twice stops being retried, and a
 * task that never fits a run would otherwise be claimed and killed forever.
 *
 * Lives here rather than in scripts/release-stuck-doing.ts because that script
 * calls main() at import — the same reason sweep-api.ts is separate.
 */

import { DOING_STATUS_ROLE, READY_STATUS_ROLE, WAITING_STATUS_ROLE } from '@/lib/task-status'
import { latestCommentWatermark, type TimestampedComment } from '@/lib/ready-queue-scope'

/** Every release comment starts with this, and counting them is how "twice" is known. */
export const RELEASE_MARKER = '🔁 Released from Doing by the scheduled /fixall loop'

/** Idle time before a Doing claim no runner holds counts as abandoned. */
export const DEFAULT_STALE_DOING_MINUTES = 180

export interface DoingTask {
  id: string
  identifier?: string | null
  title?: string | null
  completed?: boolean | null
  statusRole?: string | null
  updatedAt?: string | null
  creatorId?: string | null
  creator?: { id?: string | null; isAIAgent?: boolean | null } | null
  assignee?: { email?: string | null } | null
}

export interface ReleaseComment extends TimestampedComment {
  content?: string | null
}

export interface DoingReleaseApi {
  setStatus(task: { id: string }, statusRole: string): Promise<void>
  assign(task: { id: string }, userId: string): Promise<void>
  comment(task: { id: string }, content: string): Promise<void>
}

export type ReleaseOutcome =
  | { action: 'skip'; reason: string }
  | { action: 'ready' }
  | { action: 'handback'; to: string | null }

/** Is this task still a live claim of `agentEmail`'s that a release may touch? */
export function isReleasableClaim(task: DoingTask, agentEmail: string): boolean {
  if (task.completed) return false
  if ((task.statusRole ?? '').trim().toLowerCase() !== DOING_STATUS_ROLE) return false
  return (task.assignee?.email ?? '').toLowerCase() === agentEmail.toLowerCase()
}

/**
 * Idle long enough that no session can still be on it?
 *
 * Activity is the later of the task's own update and its newest comment: a
 * session working a task comments on it (strategy, progress), so silence is the
 * signal. An unreadable timestamp reads as ACTIVE — releasing a claim somebody
 * is still working costs a duplicate fix, holding one costs one more tick.
 */
export function isAbandonedClaim(input: {
  updatedAt?: string | null
  comments: TimestampedComment[]
  now: Date
  staleMinutes: number
}): boolean {
  const stamps = [input.updatedAt ?? null, latestCommentWatermark(input.comments)]
    .map(value => (value ? new Date(value).getTime() : NaN))
    .filter(value => !Number.isNaN(value))
  if (stamps.length === 0) return false
  const idleMinutes = (input.now.getTime() - Math.max(...stamps)) / 60_000
  return idleMinutes >= input.staleMinutes
}

export function countReleases(comments: ReleaseComment[]): number {
  return comments.filter(comment => (comment.content ?? '').startsWith(RELEASE_MARKER)).length
}

/** Branch names that carry this task's id, e.g. `fix/awtd-1025-hide-chip` for AWTD-1025. */
export function branchesForTask(identifier: string | null | undefined, branches: string[]): string[] {
  if (!identifier) return []
  const needle = identifier.toLowerCase()
  return branches.filter(branch => {
    const name = branch.toLowerCase()
    const at = name.indexOf(needle)
    // Whole id only: AWTD-12 must not match awtd-125.
    return at !== -1 && !/[0-9]/.test(name.charAt(at + needle.length))
  })
}

/** Who gets a task handed back: its creator, unless an agent filed it. */
function handbackTarget(task: DoingTask): string | null {
  if (task.creator?.isAIAgent) return null
  return task.creatorId ?? task.creator?.id ?? null
}

/**
 * Release one claim. The caller has already decided it is releasable (a claim
 * this run made, or an abandoned one); this decides WHERE it goes and says why.
 */
export async function releaseDoingClaim(input: {
  task: DoingTask
  comments: ReleaseComment[]
  branches: string[]
  why: string
  api: DoingReleaseApi
}): Promise<ReleaseOutcome> {
  const { task, comments, why, api } = input
  const branches = branchesForTask(task.identifier, input.branches)
  const where = branches.length > 0
    ? ` Its work so far is on ${branches.map(b => `\`${b}\``).join(', ')} — continue from there rather than starting over; it has not passed the gates.`
    : ' No branch carrying its id was found, so it starts fresh.'

  if (countReleases(comments) >= 1) {
    const to = handbackTarget(task)
    if (to) await api.assign(task, to)
    await api.setStatus(task, WAITING_STATUS_ROLE)
    await api.comment(
      task,
      `${RELEASE_MARKER} — for the second time. ${why} A task that fails twice is not retried ` +
        `automatically (docs/FIXALL_WORKFLOW.md), so it is handed back${to ? ' to its creator' : ''} ` +
        `in Waiting: split it, clarify it, or move it to Ready to try again.${where}`,
    )
    return { action: 'handback', to }
  }

  await api.setStatus(task, READY_STATUS_ROLE)
  await api.comment(task, `${RELEASE_MARKER}. ${why} Back to Ready so the next run picks it up.${where}`)
  return { action: 'ready' }
}
