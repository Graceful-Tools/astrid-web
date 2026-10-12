/**
 * What an update writes to `statusRole` — the task's board column.
 *
 * Lifted out of `updateTaskWithSideEffects` beside `task-completion.ts`, for
 * that module's reason: `services/task.service.ts` stays under the
 * oversized-files ratchet (task 9377bc2c).
 *
 * Two cases:
 *
 * - **The request sets it.** It wins, unless the same request completes the
 *   task — completion owns the lane then (services/task-completion.ts).
 *   NORMALISED AND VALIDATED HERE, because this is the one place all three
 *   write paths funnel through (AWTD-1198). It used to store the caller's
 *   string verbatim, so AWTD-1177 carried the literal "Waiting" and became
 *   invisible to `GET /api/v1/tasks?statusRole=ready`, which filters the
 *   database on the raw value — a task fewer in the queue reads like a quiet
 *   day. Readers that lowercase defensively (lib/ready-queue-scope.ts,
 *   lib/task-dependencies.ts) are why it took a month to notice.
 * - **The task leaves its last board (AWTD-1007).** A `listIds` write used to
 *   leave the role alone, so a task dragged off its board kept `waiting` and
 *   showed the board-state and "Waiting on" rows on a plain list. Clients trust
 *   a role even with no visible project list — it may be from a board the
 *   viewer cannot see — so the fix is here, where every list is visible.
 *   Narrow on purpose: only a task that WAS on a project list loses it. A role
 *   given directly to a task that never had a board is the caller's to keep.
 */

import { prisma } from '@/lib/prisma'
import { isDefaultStatusRole } from '@/lib/task-status'

/**
 * A board column, as it must be spelled to be found again.
 *
 * `ready` and `Ready` are the same column to every human and to every reader
 * that lowercases defensively — but NOT to app/api/v1/tasks/route.ts, which
 * filters the database on the raw value. So the write side owns the spelling.
 *
 * Case and whitespace only; whether the role EXISTS is `isWritableStatusRole`
 * below (AWTD-1218).
 */
function normaliseStatusRole(raw: string): string | null {
  const role = raw.trim().toLowerCase()
  return role || null
}

/**
 * The `custom-<slug>` prefix `mintRole` gives a board's own columns
 * (lib/project-custom-states.ts). Stated here as the prefix plus the hyphen, so
 * `custom` and `customblocked` are not mistaken for minted roles.
 */
const CUSTOM_ROLE_PREFIX = 'custom-'

/**
 * May this role be written at all? (AWTD-1218.)
 *
 * Without this, `update_task { statusRole: 'nonsense' }` succeeded and stored
 * it, and the task then sat in no column on any board — findable only by a
 * query asking for that exact string. AWTD-1198 fixed the SPELLING of a real
 * role; this refuses one that was never real.
 *
 * **Not `DEFAULT_STATES` membership, which the original task proposed.** That
 * would break Project Mode: `mintRole` creates per-board columns as
 * `custom-<slug>`, legitimate roles deliberately absent from DEFAULT_STATES.
 * So the rule is the three defaults OR the custom prefix.
 *
 * **Deliberately not checking that the custom role exists on THAT task's
 * board.** That needs the project, and a wrong answer there refuses a
 * legitimate write — worse than storing a role no column happens to show, which
 * is the failure this is already tolerating one step further out.
 *
 * `done` is not here on purpose: it is derived from `completed`, not a role.
 */
export function isWritableStatusRole(role: string): boolean {
  return isDefaultStatusRole(role) || role.startsWith(CUSTOM_ROLE_PREFIX)
}

/**
 * The write, or a 400. The result shape matches `resolveCompletionFields`, so
 * the caller in task.service.ts reads the same three lines its neighbour does.
 */
export type StatusRoleWriteResult =
  | { ok: true; data: { statusRole?: string | null } }
  | { ok: false; status: 400; error: string }

export async function resolveStatusRoleWrite(args: {
  /** Did the request name `statusRole` at all? */
  setsRole: boolean
  intent: { statusRole?: string | null }
  requestedCompleted: boolean | undefined
  existingTask: { statusRole?: string | null; lists?: { id: string }[] | null }
  /** The validated memberships the update writes, or undefined if it writes none. */
  validatedListIds: string[] | undefined
}): Promise<StatusRoleWriteResult> {
  const { setsRole, intent, requestedCompleted, existingTask, validatedListIds: listIds } = args
  if (setsRole) {
    // Completion owns the lane, so an unknown role alongside it is not a reason
    // to refuse the completion itself.
    if (requestedCompleted === true) return { ok: true, data: {} }
    const raw = intent.statusRole
    const role = typeof raw === 'string' ? normaliseStatusRole(raw) : null
    // null is Inbox — the absence of a column, and always writable.
    if (role !== null && !isWritableStatusRole(role)) {
      return {
        ok: false,
        status: 400,
        error: `Unknown statusRole "${role}". Expected ready, doing, waiting, or a board's own custom- column.`,
      }
    }
    return { ok: true, data: { statusRole: role } }
  }
  if (listIds === undefined || !existingTask.statusRole) return { ok: true, data: {} }

  const previousIds = (existingTask.lists ?? []).map(list => list.id)
  const known = await prisma.taskList.findMany({
    where: { id: { in: [...new Set([...previousIds, ...listIds])] } },
    select: { id: true, projectId: true },
  })
  const onBoard = (ids: string[]) => known.some(list => list.projectId && ids.includes(list.id))
  return { ok: true, data: onBoard(previousIds) && !onBoard(listIds) ? { statusRole: null } : {} }
}
