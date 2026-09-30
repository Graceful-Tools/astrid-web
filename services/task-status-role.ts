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
 * - **The task leaves its last board (AWTD-1007).** A `listIds` write used to
 *   leave the role alone, so a task dragged off its board kept `waiting` and
 *   showed the board-state and "Waiting on" rows on a plain list. Clients trust
 *   a role even with no visible project list — it may be from a board the
 *   viewer cannot see — so the fix is here, where every list is visible.
 *   Narrow on purpose: only a task that WAS on a project list loses it. A role
 *   given directly to a task that never had a board is the caller's to keep.
 */

import { prisma } from '@/lib/prisma'

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
  if (setsRole) return requestedCompleted === true ? {} : { statusRole: intent.statusRole || null }
  if (listIds === undefined || !existingTask.statusRole) return {}

  const previousIds = (existingTask.lists ?? []).map(list => list.id)
  const known = await prisma.taskList.findMany({
    where: { id: { in: [...new Set([...previousIds, ...listIds])] } },
    select: { id: true, projectId: true },
  })
  const onBoard = (ids: string[]) => known.some(list => list.projectId && ids.includes(list.id))
  return onBoard(previousIds) && !onBoard(listIds) ? { statusRole: null } : {}
}
