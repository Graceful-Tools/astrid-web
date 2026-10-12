/**
 * When a task update must stop the agent working it.
 *
 * Completion always did. Unassigning an agent did not (AWTD-1109): taking an
 * agent off a task — by hand, or in bulk when its list went public — left it
 * working, commenting and eventually "finishing" a task nobody had given it
 * any more. Only agent → nobody: a hand-over to another assignee is the
 * assignment dispatch's call, since it owns the workflow row.
 *
 * Best-effort, like every side effect after the row is written.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { cancelActiveCodingWorkflow } from '@/lib/tasks/cancel-active-coding-workflow'

const log = createLogger('services.coding-workflow-on-update')

export async function cancelCodingWorkflowForUpdate(args: {
  taskId: string
  justCompleted: boolean
  previousAssigneeId: string | null
  assigneeId: string | null
  /** Shown on the cancelled workflow when the cause is completion. */
  completionReason: string
}): Promise<void> {
  const { taskId, justCompleted, previousAssigneeId, assigneeId, completionReason } = args
  try {
    if (justCompleted) {
      await cancelActiveCodingWorkflow({ taskId, reason: completionReason })
      return
    }
    if (!previousAssigneeId || assigneeId !== null) return

    const previous = await prisma.user.findUnique({
      where: { id: previousAssigneeId },
      select: { isAIAgent: true },
    })
    if (previous?.isAIAgent) {
      await cancelActiveCodingWorkflow({ taskId, reason: 'Agent unassigned' })
    }
  } catch (err) {
    log.error({ err, taskId }, 'Failed to cancel coding workflow after task update')
  }
}
