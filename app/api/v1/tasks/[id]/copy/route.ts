/**
 * POST /api/v1/tasks/:id/copy
 *
 * Copy a single task to another list (preserving optional fields like
 * dueDate, assignee, comments). Mirrors POST /api/tasks/[id]/copy
 * including SSE broadcast to target-list members and stats invalidation
 * for the original creator.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { copyTask } from '@/lib/copy-utils'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.copy')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.copy' },
  async (req, auth, { params }) => {
    try {
      const { id: taskId } = await params
      const body = await req.json()
      const {
        targetListId,
        preserveDueDate = false,
        preserveAssignee = false,
        includeComments = false,
      } = body

      if (targetListId) {
        const targetList = await prisma.taskList.findFirst({
          where: {
            id: targetListId,
            OR: [
              { ownerId: auth.userId },
              { listMembers: { some: { userId: auth.userId } } },
              { privacy: 'PUBLIC', publicListType: 'collaborative' },
            ],
          },
        })
        if (!targetList) {
          return NextResponse.json(
            { error: "You don't have permission to copy tasks to this list" },
            { status: 403 }
          )
        }
      }

      const result = await copyTask(taskId, {
        newOwnerId: auth.userId,
        targetListId,
        preserveDueDate,
        preserveAssignee,
        includeComments,
      })
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to copy task' },
          { status: 400 }
        )
      }

      // Invalidate original creator's stats (inspired count went up)
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

      let copiedTaskWithRelations = null
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
          })
        } catch (fetchError) {
          log.error({ err: fetchError }, 'Failed to fetch complete task data')
          copiedTaskWithRelations = result.copiedTask
        }
      }

      // SSE broadcast — notify other list members
      if (copiedTaskWithRelations && targetListId) {
        try {
          const userIds = new Set<string>()
          const list = copiedTaskWithRelations.lists?.find(
            (l: { id: string }) => l.id === targetListId
          )
          if (list) {
            for (const id of getListMemberIds(list as Parameters<typeof getListMemberIds>[0])) {
              userIds.add(id)
            }
          }
          userIds.delete(auth.userId)
          if (userIds.size > 0) {
            broadcastToUsers(Array.from(userIds), {
              type: 'task_created',
              timestamp: new Date().toISOString(),
              data: {
                taskId: copiedTaskWithRelations.id,
                taskTitle: copiedTaskWithRelations.title,
                taskPriority: copiedTaskWithRelations.priority,
                taskDueDateTime: copiedTaskWithRelations.dueDateTime,
                taskIsAllDay: copiedTaskWithRelations.isAllDay,
                creatorName:
                  copiedTaskWithRelations.creator?.name ||
                  copiedTaskWithRelations.creator?.email ||
                  'Someone',
                userId: auth.userId,
                listNames:
                  copiedTaskWithRelations.lists?.map(
                    (l: { name: string }) => l.name
                  ) ?? [],
                task: {
                  id: copiedTaskWithRelations.id,
                  title: copiedTaskWithRelations.title,
                  description: copiedTaskWithRelations.description,
                  priority: copiedTaskWithRelations.priority,
                  completed: copiedTaskWithRelations.completed,
                  assigneeId: copiedTaskWithRelations.assigneeId,
                  creatorId: copiedTaskWithRelations.creatorId,
                  createdAt: copiedTaskWithRelations.createdAt,
                  updatedAt: copiedTaskWithRelations.updatedAt,
                },
              },
            })
          }
        } catch (sseError) {
          log.error({ err: sseError }, 'Failed to send task copy SSE notifications')
        }
      }

      return NextResponse.json({
        success: true as const,
        task: copiedTaskWithRelations || result.copiedTask,
        message: 'Task copied successfully',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error in v1 copy task')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
