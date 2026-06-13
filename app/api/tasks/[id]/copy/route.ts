import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { copyTask } from "@/lib/copy-utils"
import { broadcastToUsers } from "@/lib/sse-utils"
import { getListMemberIds } from "@/lib/list-member-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.[id].copy')


export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const { id: taskId } = await context.params
    const body = await request.json()

    const {
      targetListId,
      preserveDueDate = false,
      preserveAssignee = false,
      includeComments = false
    } = body

    // SECURITY: Validate user has access to target list before copying
    if (targetListId) {
      const targetList = await prisma.taskList.findFirst({
        where: {
          id: targetListId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } },
            // Project membership grants access to project lists (sub-task #3).
            { project: { OR: [
              { ownerId: session.user.id },
              { members: { some: { userId: session.user.id } } },
            ] } },
            // Also allow collaborative public lists
            { privacy: 'PUBLIC', publicListType: 'collaborative' }
          ]
        }
      })

      if (!targetList) {
        return NextResponse.json(
          { error: "You don't have permission to copy tasks to this list" },
          { status: 403 }
        )
      }
    }

    log.info(`📝 Copying task ${taskId} for user ${session.user.id}`)

    const result = await copyTask(taskId, {
      newOwnerId: session.user.id,
      targetListId,
      preserveDueDate,
      preserveAssignee,
      includeComments
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to copy task" },
        { status: 400 }
      )
    }

    log.info(`✅ Task copied successfully: ${result.copiedTask?.id}`)

    // Invalidate original task creator's stats (inspired tasks count increased)
    if (result.copiedTask?.originalTaskId) {
      try {
        const originalTask = await prisma.task.findUnique({
          where: { id: result.copiedTask.originalTaskId },
          select: { creatorId: true }
        })

        if (originalTask?.creatorId) {
          const { invalidateUserStats } = await import("@/lib/user-stats")
          await invalidateUserStats(originalTask.creatorId)
          log.info(`📊 Invalidated user stats for original task creator ${originalTask.creatorId}`)
        }
      } catch (statsError) {
        log.error({ err: statsError }, "❌ Failed to invalidate original creator's stats:")
        // Continue - task was still copied
      }
    }

    // Fetch the full task with relations for both response and SSE broadcast
    let copiedTaskWithRelations = null
    if (result.copiedTask) {
      try {
        copiedTaskWithRelations = await prisma.task.findUnique({
          where: { id: result.copiedTask.id },
          include: {
            assignee: true,
            creator: true,
            lists: true,
            comments: {
              include: {
                author: true
              }
            },
            attachments: true
          }
        })

        log.info(`📦 Fetched complete task with ${copiedTaskWithRelations?.lists?.length || 0} list associations`)
      } catch (fetchError) {
        log.error({ err: fetchError }, "Failed to fetch complete task data:")
        // Fall back to basic task data
        copiedTaskWithRelations = result.copiedTask
      }
    }

    // Broadcast SSE event to all list members (except the user who copied it)
    if (copiedTaskWithRelations && targetListId) {
      try {
        // Get all members from the target list
        const userIds = new Set<string>()
        const list = copiedTaskWithRelations.lists?.find((l: any) => l.id === targetListId)

        if (list) {
          const memberIds = getListMemberIds(list as any)
          memberIds.forEach(id => userIds.add(id))
        }

        // Remove the user who copied the task (they already see it)
        userIds.delete(session.user.id)

        if (userIds.size > 0) {
          log.info(Array.from(userIds), `[SSE] Broadcasting task copy to ${userIds.size} users:`)
          broadcastToUsers(Array.from(userIds), {
            type: 'task_created',
            timestamp: new Date().toISOString(),
            data: {
              taskId: copiedTaskWithRelations.id,
              taskTitle: copiedTaskWithRelations.title,
              taskPriority: copiedTaskWithRelations.priority,
              taskDueDateTime: copiedTaskWithRelations.dueDateTime,
              taskIsAllDay: copiedTaskWithRelations.isAllDay,
              creatorName: copiedTaskWithRelations.creator?.name || copiedTaskWithRelations.creator?.email || "Someone",
              userId: session.user.id,
              listNames: copiedTaskWithRelations.lists?.map((list: any) => list.name) || [],
              task: {
                id: copiedTaskWithRelations.id,
                title: copiedTaskWithRelations.title,
                description: copiedTaskWithRelations.description,
                priority: copiedTaskWithRelations.priority,
                completed: copiedTaskWithRelations.completed,
                assigneeId: copiedTaskWithRelations.assigneeId,
                creatorId: copiedTaskWithRelations.creatorId,
                createdAt: copiedTaskWithRelations.createdAt,
                updatedAt: copiedTaskWithRelations.updatedAt
              }
            }
          })
        }
      } catch (sseError) {
        log.error({ err: sseError }, "Failed to send task copy SSE notifications:")
        // Continue - task was still copied successfully
      }
    }

    // Return the complete task with all relations
    return NextResponse.json({
      success: true,
      task: copiedTaskWithRelations || result.copiedTask,
      message: "Task copied successfully"
    })

  } catch (error) {
    log.error({ err: error }, "Error in copy task API:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
