/**
 * Copying a task into a list — the whole flow, with no route around it.
 *
 * Shared by `POST /api/tasks/:id/copy` and its v1 twin, which were two
 * independent copies of the same steps: validate the target list, copy,
 * invalidate the original creator's stats, refetch with relations. The live
 * event comes from the create path itself since AWTD-1124.
 *
 * Verified equivalent before extraction (task e0613ae5) — the audit of all 28
 * duplicated pairs found no behavioural difference in this one, which is what
 * makes collapsing it mechanical rather than risky.
 *
 * Each route keeps its own auth and its own response shape; only the flow moves.
 */

import { prisma } from '@/lib/prisma'
import { copyTask } from '@/lib/copy-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('task-copy-flow')

export type CopyTaskFlowResult =
  | { ok: true; task: Record<string, unknown> }
  | { ok: false; status: 400 | 403; error: string }

export async function copyTaskForUser(args: {
  taskId: string
  userId: string
  targetListId?: string
  preserveDueDate?: boolean
  preserveAssignee?: boolean
  includeComments?: boolean
}): Promise<CopyTaskFlowResult> {
  const {
    taskId,
    userId,
    targetListId,
    preserveDueDate = false,
    preserveAssignee = false,
    includeComments = false,
  } = args

  // SECURITY: the caller must be able to write to the destination. A
  // collaborative public list qualifies; a copy-only public one does not,
  // because only members may add tasks there.
  if (targetListId) {
    const targetList = await prisma.taskList.findFirst({
      where: {
        id: targetListId,
        OR: [
          { ownerId: userId },
          { listMembers: { some: { userId } } },
          { privacy: 'PUBLIC', publicListType: 'collaborative' },
        ],
      },
    })

    if (!targetList) {
      return {
        ok: false,
        status: 403,
        error: "You don't have permission to copy tasks to this list",
      }
    }
  }

  const result = await copyTask(taskId, {
    newOwnerId: userId,
    targetListId,
    preserveDueDate,
    preserveAssignee,
    includeComments,
  })

  if (!result.success) {
    return { ok: false, status: 400, error: result.error || 'Failed to copy task' }
  }

  // The original creator's "inspired tasks" count just changed. Best-effort:
  // the copy already happened, and failing here would report an error for work
  // that succeeded.
  if (result.copiedTask?.originalTaskId) {
    try {
      const originalTask = await prisma.task.findUnique({
        where: { id: result.copiedTask.originalTaskId },
        select: { creatorId: true },
      })
      if (originalTask?.creatorId) {
        const { invalidateUserStats } = await import('@/lib/user-stats')
        await invalidateUserStats(originalTask.creatorId)
      }
    } catch (statsError) {
      log.error({ err: statsError }, "Failed to invalidate original creator's stats")
    }
  }

  // Refetch with relations for the response and the broadcast. Falls back to
  // the bare copied task rather than failing — the caller asked for a copy and
  // got one.
  let copiedTaskWithRelations: Record<string, unknown> | null = null
  if (result.copiedTask) {
    try {
      copiedTaskWithRelations = await prisma.task.findUnique({
        where: { id: result.copiedTask.id },
        include: {
          assignee: true,
          creator: true,
          lists: true,
          comments: { include: { author: true } },
          attachments: true,
        },
      }) as Record<string, unknown> | null
    } catch (fetchError) {
      log.error({ err: fetchError }, 'Failed to fetch complete task data')
    }
    if (!copiedTaskWithRelations) {
      copiedTaskWithRelations = result.copiedTask as unknown as Record<string, unknown>
    }
  }

  // No broadcast here: copyTask creates through services/task-bulk-create,
  // which sends task_created to the target list's members (AWTD-1124). A send
  // here as well would deliver every copy twice.

  return { ok: true, task: copiedTaskWithRelations ?? {} }
}
