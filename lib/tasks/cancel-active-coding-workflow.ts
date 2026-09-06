/**
 * Cancel the CodingTaskWorkflow attached to a task, if one is still running.
 *
 * Completing or deleting a task must stop the agent that is working it —
 * otherwise the workflow keeps running, keeps commenting, and eventually
 * "finishes" work on a task nobody wants any more.
 *
 * This lived inline in the legacy route twice (completion and deletion), and
 * nowhere else, so v1 and the agent API let workflows run on past completion
 * (task fb94f2ee). Extracted so every write surface cancels identically.
 *
 * Best-effort by contract: it never throws. A failed cancellation must not be
 * the reason a task update or delete fails.
 */

import { prisma } from '@/lib/prisma'
import { type WorkflowMetadata } from '@/lib/task-query-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.cancel-active-coding-workflow')

/** Statuses that mean the workflow has already stopped. */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED']

export async function cancelActiveCodingWorkflow(args: {
  taskId: string
  /** Recorded on the workflow as `cancelReason`, e.g. 'Task marked as completed by user'. */
  reason: string
}): Promise<{ cancelled: boolean }> {
  const { taskId, reason } = args

  try {
    const activeWorkflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
    })

    if (!activeWorkflow || TERMINAL_STATUSES.includes(activeWorkflow.status)) {
      return { cancelled: false }
    }

    await prisma.codingTaskWorkflow.update({
      where: { taskId },
      data: {
        status: 'CANCELLED',
        metadata: {
          ...((activeWorkflow.metadata as WorkflowMetadata) || {}),
          cancelledAt: new Date().toISOString(),
          cancelReason: reason,
        },
      },
    })

    log.info({ taskId, reason }, 'Cancelled active coding workflow')
    return { cancelled: true }
  } catch (err) {
    log.error({ err, taskId }, 'Failed to cancel active coding workflow')
    return { cancelled: false }
  }
}
