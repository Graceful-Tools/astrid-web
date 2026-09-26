/**
 * "Waiting on tasks" — the decisions behind task-to-task blocking (AWTD-1002).
 *
 * Spec of record: docs/specs/TASK_BLOCKING_DEPENDENCIES.md.
 *
 * THE ONE THING THIS MODULE IS ABOUT. The promotion rule already exists in this
 * repo — `classifyWaitingTask` in lib/ready-queue-scope.ts implements "every
 * blocker complete AND the date has arrived" for the agent loops, and has since
 * the Waiting lane did. A second implementation here would be a third
 * description of one rule, and a board that promotes a task while the loop
 * refuses to take it looks, from the outside, like the board is broken. So this
 * module CALLS that function and adds only what the product feature needs on
 * top of it: cycle refusal, and who gets moved when.
 *
 * Everything here is pure. The database work is services/task-dependency.service.ts,
 * which is what lets the rules be stated once and tested without a Postgres.
 *
 * TWO VOCABULARIES, ON PURPOSE (Jon, 2026-09-25: *"we should not make it
 * 'blocked on' but 'waiting on' to make it more obvious that these are
 * connected (as well as due date)"*).
 *
 *   - **The product says "waiting on".** Every string a user reads is under
 *     `tasks.waitingOn.*`, and it names the same wait the due date does: the
 *     two are halves of one question, when can this start? (The row itself
 *     stays below Lists — the Who/Date/Priority/Lists order is a
 *     cross-platform contract nothing is interleaved into.)
 *   - **The data says "blocker".** `TaskDependency`, `blockedTaskId` /
 *     `blockingTaskId`, the v1 route paths, and the `BLOCKED-BY:` comment
 *     marker that parked agent tasks already depend on. Renaming those for a
 *     vocabulary change would break a convention in use for the sake of a word
 *     nobody sees.
 *
 * So a name here is a data name, and the translation to the user's word happens
 * exactly once, in the copy layer. Do not "fix" one side to match the other.
 */

import { classifyWaitingTask, type WaitingDisposition } from '@/lib/ready-queue-scope'
import { READY_STATUS_ROLE } from '@/lib/task-status'

export interface BlockerGateInput {
  /** The dependent's own date — the "when time" the ask names. */
  dueDateTime: string | Date | null | undefined
  now: Date
  /** Blockers that are still open. Empty means every blocker is done. */
  outstandingBlockerIds: string[]
}

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * What holds this task, in `classifyWaitingTask`'s own vocabulary.
 *
 * Structured rows are passed in as `blockedBy`, exactly where the agent sweep
 * passes its parsed `BLOCKED-BY:` markers, so the two paths cannot disagree
 * about what "blocked" means.
 */
export function blockerGateDisposition(input: BlockerGateInput): WaitingDisposition {
  return classifyWaitingTask({
    dueDateTime: toIsoOrNull(input.dueDateTime),
    now: input.now,
    blockedBy: input.outstandingBlockerIds,
    blockedOn: null,
  })
}

/**
 * May this task leave Waiting now?
 *
 * `promote` is the obvious yes. `review` is also a yes HERE, and the difference
 * is worth stating: the agent sweep answers `review` for an undated task with
 * no condition because nothing in the sweep would ever wake it, so a human must
 * look. This feature has the wake-up the sweep lacks — the blocker that just
 * cleared IS the event — so an undated task whose last blocker is done is
 * exactly a task that has become actionable.
 *
 * `check-blockers` and `hold` are both no, which is the spec's "either alone
 * leaves it in Waiting".
 */
export function isPromotableAfterBlockerChange(input: BlockerGateInput): boolean {
  const disposition = blockerGateDisposition(input)
  return disposition === 'promote' || disposition === 'review'
}

export interface DependencyCycleInput {
  /** The task that would be held up. */
  blockedTaskId: string
  /** The task it would wait for. */
  blockingTaskId: string
  /** The blockers of a task — the edges this walk follows. */
  blockersOf: (taskId: string) => Promise<string[]>
}

/**
 * Would adding this edge create a cycle?
 *
 * A cycle is a set of tasks none of which can EVER be promoted, so it is
 * refused at write time (409 `dependency_cycle`) rather than tolerated and
 * discovered later by a promoter that quietly does nothing. A silent deadlock
 * reads as a bug in the board.
 *
 * The walk goes up from the proposed blocker along `blockingTaskId` edges and
 * refuses if the blocked task is reachable. Self-blocking is the depth-0 case
 * of the same check, not a special case. Bounded by the visited set rather than
 * by a depth constant — *no hard coded numbers* — which also makes it terminate
 * on a graph that somehow already contains a cycle.
 */
export async function wouldCreateDependencyCycle(
  input: DependencyCycleInput,
): Promise<boolean> {
  const { blockedTaskId, blockingTaskId, blockersOf } = input
  if (blockedTaskId === blockingTaskId) return true

  const visited = new Set<string>()
  const frontier = [blockingTaskId]

  while (frontier.length > 0) {
    const current = frontier.pop() as string
    if (visited.has(current)) continue
    visited.add(current)

    const blockers = await blockersOf(current)
    for (const blocker of blockers) {
      if (blocker === blockedTaskId) return true
      if (!visited.has(blocker)) frontier.push(blocker)
    }
  }

  return false
}

function isReady(statusRole: string | null | undefined): boolean {
  return (statusRole ?? '').trim().toLowerCase() === READY_STATUS_ROLE
}

/**
 * Reopening a blocker re-blocks its dependents — but only out of `Ready`.
 *
 * A dependent in Ready was only there because the blocker was done, and that is
 * no longer true. A dependent in `Doing`, or in a project's custom state, is
 * left alone with a trail instead: yanking a card out from under someone
 * mid-work is worse than a stale lane, and they are the only one who can judge
 * whether the reopened blocker actually stops them. This mirrors
 * `resolveCompletionStatusTransition`'s instinct in lib/task-status.ts.
 */
export function shouldReblockOnBlockerReopened(statusRole: string | null | undefined): boolean {
  return isReady(statusRole)
}

/**
 * Adding a blocker to a `Ready` task moves it to `Waiting`.
 *
 * Ready means "actionable now" (Jon, 2026-08-29) and a blocked task is not, so
 * leaving it in Ready would be the column lying to whoever looks at the board —
 * the same failure the dated-task sweep exists to prevent.
 *
 * The mirror image of the reopen case above, deliberately: adding a blocker is
 * a deliberate statement about THIS task, while reopening a blocker is a
 * statement about a different one. A `Doing` task is not moved either way.
 */
export function shouldDemoteOnBlockerAdded(statusRole: string | null | undefined): boolean {
  return isReady(statusRole)
}

/** A blocker as the API renders it. See `hidden` for the permission case. */
export interface BlockerView {
  id: string
  title?: string
  identifier?: string | null
  completed?: boolean
  /**
   * The reader may not see this task. The COUNT is not a leak — they already
   * know something is holding their task — but the title would be, so a hidden
   * blocker carries an id and nothing else.
   */
  hidden?: true
}

/**
 * Render one blocker for a reader, hiding what they may not see.
 *
 * A blocker you cannot see STILL BLOCKS. Treating invisible blockers as
 * satisfied would promote work that is genuinely not ready, and do it *because*
 * of a permission boundary, which is the worst possible reason.
 */
export function toBlockerView(
  task: { id: string; title?: string | null; identifier?: string | null; completed?: boolean | null },
  visible: boolean,
): BlockerView {
  if (!visible) return { id: task.id, hidden: true }
  return {
    id: task.id,
    title: task.title ?? '',
    identifier: task.identifier ?? null,
    completed: Boolean(task.completed),
  }
}
