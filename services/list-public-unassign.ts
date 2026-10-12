/**
 * A list going PUBLIC drops every assignee on it (AWTD-1109).
 *
 * This was one raw `task.updateMany` inside the list's transaction: no task
 * events, no SSE to anyone with a task open, no reminder reschedule, no cache
 * invalidation, and an agent that had been assigned kept working. Each task now
 * goes through the task service, which does all of that.
 *
 * Runs after the list change has committed, and is best-effort per task: the
 * list IS public by then, and one task failing to unassign must not be the
 * reason the caller is told the list update failed.
 */

import { prisma } from '@/lib/prisma'
import { mapWithConcurrency } from '@/lib/concurrency'
import { createLogger } from '@/lib/logger'
import { updateTaskWithSideEffects } from '@/services/task.service'

const log = createLogger('services.list-public-unassign')

/** Same width as the GitHub apply: headroom inside a ten-connection pool. */
const UNASSIGN_CONCURRENCY = 5

export async function unassignTasksOnListGoingPublic(args: {
  listId: string
  actorId: string
  actorName?: string
}): Promise<{ unassigned: number; failed: number }> {
  const { listId, actorId, actorName } = args

  const tasks = await prisma.task.findMany({
    where: { lists: { some: { id: listId } }, assigneeId: { not: null } },
    select: { id: true },
  })

  const outcomes = await mapWithConcurrency(tasks, UNASSIGN_CONCURRENCY, async ({ id }) => {
    try {
      const result = await updateTaskWithSideEffects({
        taskId: id,
        actorId,
        actorName,
        intent: { assigneeId: null },
      })
      if (!result.ok) log.warn({ taskId: id, listId, error: result.error }, 'Could not unassign task')
      return result.ok
    } catch (err) {
      log.error({ err, taskId: id, listId }, 'Failed to unassign task on list going public')
      return false
    }
  })

  const unassigned = outcomes.filter(Boolean).length
  return { unassigned, failed: outcomes.length - unassigned }
}
