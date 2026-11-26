/**
 * What an update writes to a task's list memberships (`data.lists`).
 *
 * Lifted out of `updateTaskWithSideEffects` beside `task-status-role.ts`, for that module's reason:
 * `services/task.service.ts` stays under the oversized-files ratchet (task 9377bc2c).
 *
 * Invariant: completed = true => no status memberships (task db7c6670). The listIds branch enforces
 * it through the normalizer, but only when the request carries listIds. A completion-only update —
 * PUT { completed: true }, which is what the checkbox sends — skipped it and left the task in Ready.
 */
import { statusListIdsToDetachOnCompletion } from '@/lib/project-status'
import { mintTaskIdentifierBestEffort } from '@/services/task-identifier-mint'

/** The columns to merge into the write: `lists`, and `identifier`/`sequence` when a move mints one. */
export async function resolveListMembershipWrite(args: {
  validatedListIds: string[] | undefined
  requestedCompleted: boolean | undefined
  existingTask: { identifier?: string | null; lists?: { id: string; listType?: string | null }[] | null }
}): Promise<Record<string, unknown>> {
  const { validatedListIds, requestedCompleted, existingTask } = args
  if (validatedListIds !== undefined) {
    const data: Record<string, unknown> = { lists: { set: validatedListIds.map(id => ({ id })) } }
    // A move onto a project mints as a create does (AWTD-1016); `=== null` so an existingTask without the column never re-mints.
    if (existingTask.identifier === null) Object.assign(data, await mintTaskIdentifierBestEffort(validatedListIds))
    return data
  }
  if (requestedCompleted === true) {
    const detach = statusListIdsToDetachOnCompletion(existingTask.lists)
    if (detach.length > 0) return { lists: { disconnect: detach.map(id => ({ id })) } }
  }
  return {}
}
