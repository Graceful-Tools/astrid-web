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

/**
 * A board column, as it must be spelled to be found again.
 *
 * `ready` and `Ready` are the same column to every human and to every reader
 * that lowercases defensively — but NOT to app/api/v1/tasks/route.ts, which
 * filters the database on the raw value. So the write side owns the spelling.
 *
 * Case and whitespace only. REJECTING an unknown role belongs here too and is
 * not here yet: the single caller is services/task.service.ts, which sits on
 * the oversized-files ratchet at 1484 lines, and returning a 400 costs it two
 * more. That ratchet says to take the next piece out of the file rather than
 * raise the number, which is a real extraction and its own task (AWTD-1218) —
 * not a rider on a one-line spelling fix.
 */
function normaliseStatusRole(raw: string): string | null {
  const role = raw.trim().toLowerCase()
  return role || null
}

export async function resolveStatusRoleWrite(args: {
  /** Did the request name `statusRole` at all? */
  setsRole: boolean
  intent: { statusRole?: string | null }
  requestedCompleted: boolean | undefined
  existingTask: { statusRole?: string | null; lists?: { id: string }[] | null }
  /** The validated memberships the update writes, or undefined if it writes none. */
  validatedListIds: string[] | undefined
}): Promise<{ statusRole?: string | null }> {
  const { setsRole, intent, requestedCompleted, existingTask, validatedListIds: listIds } = args
  if (setsRole) {
    if (requestedCompleted === true) return {}
    const raw = intent.statusRole
    return { statusRole: typeof raw === 'string' ? normaliseStatusRole(raw) : null }
  }
  if (listIds === undefined || !existingTask.statusRole) return {}

  const previousIds = (existingTask.lists ?? []).map(list => list.id)
  const known = await prisma.taskList.findMany({
    where: { id: { in: [...new Set([...previousIds, ...listIds])] } },
    select: { id: true, projectId: true },
  })
  const onBoard = (ids: string[]) => known.some(list => list.projectId && ids.includes(list.id))
  return onBoard(previousIds) && !onBoard(listIds) ? { statusRole: null } : {}
}
