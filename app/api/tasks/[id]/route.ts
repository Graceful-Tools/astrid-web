import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { RedisCache, isRedisAvailable } from "@/lib/redis"
import { getListMemberIds, hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { broadcastToUsers } from "@/lib/sse-utils"
import { canUserEditTask } from "@/lib/list-permissions"
import {
  TASK_FULL_INCLUDE,
  type TaskWithFullRelations,
  type ListWithMembers,
  type WorkflowMetadata
} from "@/lib/task-query-utils"
import { getErrorMessage } from "@/lib/error-utils"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
// AI agent workflow handling is now done by Prisma middleware (lib/prisma.ts)
// Removed: getAgentService, aiAgentWebhookService imports

// ✅ Production database migrated to unified listMembers table (2025-11-02)

// Helper function to safely check list access with list-like object
function canAccessList(list: ListWithMembers, userId: string): boolean {
  try {
    return hasListAccess(list, userId)
  } catch {
    // Fallback to manual check if type casting fails
    if (list.ownerId === userId) return true
    if (list.listMembers?.some((member) => member.userId === userId)) return true
    return false
  }
}

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: taskId } = await context.params

    // Get the task with all required relations
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_FULL_INCLUDE,
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user has permission to view this task
    const canView =
      task.assigneeId === session.user.id ||
      task.creatorId === session.user.id ||
      task.lists.some((list) => canAccessList(list, session.user.id)) ||
      // Allow viewing tasks on public lists (both copy-only and collaborative)
      // This matches the permission check in comments/route.ts POST
      task.lists.some((list) => list.privacy === 'PUBLIC')

    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error("Error fetching task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  let session: { user: { id: string; email?: string | null; name?: string | null } } | null = null
  let taskId = ""
  try {
    session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    taskId = (await context.params).id

    console.log(`🔧 [TASK-UPDATE] PUT request received:`, {
      taskId,
      userId: session.user.id,
      updateData: data
    })

    // Validate required data
    if (!data.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    // Check if user has permission to update this task
    console.log(`[DEBUG] Before existingTask lookup: prisma exists? ${!!prisma}, prisma.task exists? ${!!prisma.task}`);
    console.log(`[DEBUG] Before existingTask lookup (DELETE): prisma exists? ${!!prisma}, prisma.task exists? ${!!prisma.task}`);
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_FULL_INCLUDE,
    })
    console.log(`[DEBUG] After existingTask lookup (DELETE): existingTask exists? ${!!existingTask}`);
    console.log(`[DEBUG] After existingTask lookup: existingTask exists? ${!!existingTask}`);

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user can update this task
    // Must check: 1) task assignee, 2) task creator, 3) list permissions
    const user = { id: session.user.id, email: session.user.email, name: session.user.name }
    const canUpdate =
      existingTask.assigneeId === session.user.id ||
      existingTask.creatorId === session.user.id ||
      existingTask.lists.some((list) =>
        canUserEditTask(user, existingTask, list)
      )

    console.log(`🔐 [TASK-UPDATE] Permission check:`, {
      taskId,
      userId: session.user.id,
      canUpdate,
      isAssignee: existingTask.assigneeId === session.user.id,
      isCreator: existingTask.creatorId === session.user.id,
      lists: existingTask.lists.map((l) => ({
        id: l.id,
        name: l.name,
        privacy: l.privacy,
        publicListType: l.publicListType
      }))
    })

    if (!canUpdate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Validate and sanitize the data
    if (process.env.NODE_ENV === "development") {
      console.log('Updating task with data:', JSON.stringify(data, null, 2))
      console.log('Session data:', { userId: session?.user?.id, email: session?.user?.email })
    }
    
    // Handle date conversion for 'dueDateTime' field
    let sanitizedDueDateTime = data.dueDateTime
    if (sanitizedDueDateTime === undefined) {
      sanitizedDueDateTime = null  // Convert undefined to null for database
    } else if (sanitizedDueDateTime !== null) {
      if (typeof sanitizedDueDateTime === 'string') {
        try {
          sanitizedDueDateTime = new Date(sanitizedDueDateTime)
          if (isNaN(sanitizedDueDateTime.getTime())) {
            console.error('Invalid dueDateTime string:', data.dueDateTime)
            sanitizedDueDateTime = null
          }
        } catch (e) {
          console.error('Error parsing dueDateTime:', data.dueDateTime, e)
          sanitizedDueDateTime = null
        }
      } else if (!(sanitizedDueDateTime instanceof Date)) {
        console.error('Invalid dueDateTime type:', typeof data.dueDateTime, data.dueDateTime)
        sanitizedDueDateTime = null
      }
    }

    // Ensure repeatingData is properly formatted JSON or null
    let sanitizedRepeatingData = data.repeatingData
    if (data.repeating !== 'custom') {
      sanitizedRepeatingData = null
    } else if (sanitizedRepeatingData && typeof sanitizedRepeatingData === 'string') {
      try {
        sanitizedRepeatingData = JSON.parse(sanitizedRepeatingData)
      } catch (e) {
        console.error('Invalid JSON in repeatingData:', sanitizedRepeatingData)
        sanitizedRepeatingData = null
      }
    }

    // Handle assigneeEmail (for non-registered users)
    // If assigneeEmail is provided, find or create placeholder user
    let emailAssigneeId: string | null = null
    if (data.assigneeEmail) {
      try {
        const placeholderUser = await placeholderUserService.findOrCreatePlaceholderUser({
          email: data.assigneeEmail,
          invitedBy: session.user.id,
        })
        emailAssigneeId = placeholderUser.id
        console.log(`📧 Task reassigned to email: ${data.assigneeEmail} (${emailAssigneeId})`)
      } catch (error) {
        console.error('Error creating placeholder user for update:', error)
        return NextResponse.json(
          { error: 'Failed to create placeholder user' },
          { status: 500 }
        )
      }
    }

    // Check if task is in a PUBLIC list - if so, prevent REGULAR USER assignee changes
    // BUT allow AI agent assignments (coding agents should work on public lists)
    const hasPublicList = existingTask.lists.some((list) => list.privacy === 'PUBLIC')
    let finalAssigneeId = emailAssigneeId || data.assigneeId

    if (hasPublicList && finalAssigneeId) {
      // Check if assignee is an AI agent
      const assigneeUser = await prisma.user.findUnique({
        where: { id: finalAssigneeId },
        select: { isAIAgent: true, aiAgentType: true }
      })

      if (!assigneeUser?.isAIAgent) {
        // Regular user assignment on public list - prevent it
        console.log(`📢 Task ${taskId} is in a PUBLIC list - preventing regular user assignment`)
        finalAssigneeId = null // Force unassigned for public lists
      } else {
        // AI agent assignment on public list - allow it
        console.log(`🤖 Task ${taskId} is in a PUBLIC list - allowing AI agent assignment`)
      }
    }

    // Handle repeating task completion
    const { handleRepeatingTaskCompletion, applyRepeatingTaskRollForward } = await import('@/lib/repeating-task-handler')
    let repeatingTaskResult = null

    if (data.completed !== undefined) {
      // Pass localCompletionDate for all-day repeating tasks with COMPLETION_DATE mode
      // This allows the handler to use the client's local date instead of server UTC date
      repeatingTaskResult = await handleRepeatingTaskCompletion(
        taskId,
        existingTask.completed,
        data.completed,
        data.localCompletionDate // YYYY-MM-DD format from client
      )
    }

    // If repeating task should roll forward or terminate, apply the change and return early
    // The roll-forward logic already updates the task in the database
    if (repeatingTaskResult?.shouldRollForward || repeatingTaskResult?.shouldTerminate) {
      await applyRepeatingTaskRollForward(taskId, repeatingTaskResult)

      // Fetch the updated task to return to client
      console.log(`[DEBUG] Before fetching updatedTask: prisma exists? ${!!prisma}, prisma.task exists? ${!!prisma.task}`);
      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        include: TASK_FULL_INCLUDE,
      })
      console.log(`[DEBUG] After fetching updatedTask: updatedTask exists? ${!!updatedTask}`);

      if (!updatedTask) {
        return NextResponse.json({ error: "Task not found after update" }, { status: 404 })
      }

      console.log(`✅ Task ${taskId} ${repeatingTaskResult.shouldRollForward ? 'rolled forward to next occurrence' : 'series terminated'}`)
      return NextResponse.json(updatedTask)
    }

    // Log ALL updates with repeatFrom for debugging
    console.log('[API Route] Update request received:', {
      taskId,
      repeating: data.repeating,
      repeatFrom: data.repeatFrom,
      repeatFromType: typeof data.repeatFrom,
      repeatFromUndefined: data.repeatFrom === undefined,
      hasRepeatFromInData: 'repeatFrom' in data,
      repeatingData: sanitizedRepeatingData
    })

    // Log repeating task data for debugging
    if (data.repeating && data.repeating !== 'never') {
      console.log('[API Route] Updating repeating task:', {
        taskId,
        repeating: data.repeating,
        repeatFrom: data.repeatFrom,
        repeatingData: sanitizedRepeatingData
      })
    }

    // SECURITY: Validate user has access to all specified lists before updating
    let validatedListIds: string[] | undefined
    if (data.listIds !== undefined && Array.isArray(data.listIds)) {
      if (data.listIds.length > 0) {
        const lists = await prisma.taskList.findMany({
          where: { id: { in: data.listIds } },
          include: {
            owner: { select: { id: true } },
            listMembers: { select: { userId: true } }
          }
        })

        // Check if all requested lists exist
        const foundListIds = new Set(lists.map(l => l.id))
        const missingListIds = data.listIds.filter((id: string) => !foundListIds.has(id))
        if (missingListIds.length > 0) {
          return NextResponse.json(
            { error: `Invalid list IDs: ${missingListIds.join(', ')}` },
            { status: 400 }
          )
        }

        // Validate user has permission to add tasks to each list
        for (const list of lists) {
          const userHasAccess = hasListAccess(list as any, session.user.id)
          const isCollaborativePublic = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'

          if (!userHasAccess && !isCollaborativePublic) {
            return NextResponse.json(
              { error: `You don't have permission to add tasks to list: ${list.name}` },
              { status: 403 }
            )
          }
        }

        // Filter out virtual lists
        validatedListIds = lists
          .filter(list => !list.isVirtual)
          .map(list => list.id)
      } else {
        // Allow removing task from all lists (empty array)
        validatedListIds = []
      }
    }

    // Log exactly what will be sent to Prisma
    const updateData = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      repeating: data.repeating,
      repeatingData: sanitizedRepeatingData,
      ...(data.repeatFrom !== undefined && { repeatFrom: data.repeatFrom }),
      isPrivate: data.isPrivate,
      ...(data.timerDuration !== undefined && { timerDuration: data.timerDuration }),
      ...(data.lastTimerValue !== undefined && { lastTimerValue: data.lastTimerValue }),
    }

    console.log('[API Route] Prisma update data:', {
      taskId,
      updateData,
      hasRepeatFrom: 'repeatFrom' in updateData,
      repeatFromValue: updateData.repeatFrom
    })

    // Update the task (only if not a repeating task that was rolled forward)
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...updateData,
        completed: data.completed,
        dueDateTime: sanitizedDueDateTime,
        isAllDay: data.isAllDay ?? false,
        assigneeId: finalAssigneeId,
        lists: validatedListIds !== undefined
          ? {
              set: validatedListIds.map((id: string) => ({ id })),
            }
          : undefined,
      },
      include: TASK_FULL_INCLUDE,
    })

    // Track state changes and create system comment
    try {
      const { detectTaskStateChanges, formatStateChangesAsComment } = await import('@/lib/task-state-change-tracker')

      const updaterName = session.user.name || session.user.email || 'Someone'
      const stateChanges = detectTaskStateChanges(existingTask, updatedTask, updaterName)

      if (stateChanges.length > 0) {
        const commentContent = formatStateChangesAsComment(stateChanges, updaterName)

        // Create system comment (authorId: null indicates system-generated)
        const stateChangeComment = await prisma.comment.create({
          data: {
            taskId: updatedTask.id,
            authorId: null, // System-generated comment
            content: commentContent,
            type: 'TEXT',
          },
          include: {
            author: true,
            secureFiles: true,
            replies: {
              include: {
                author: true,
                secureFiles: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        })

        // Add the new comment to updatedTask so it appears in the response
        // Comments are ordered by createdAt desc, so add at beginning
        updatedTask.comments = [stateChangeComment, ...updatedTask.comments]

        console.log(`📝 Created state change comment for task ${updatedTask.id}: ${commentContent}`)
      }
    } catch (stateChangeError) {
      console.error('❌ Failed to create state change comment:', stateChangeError)
      // Don't fail the task update if state change tracking fails
    }

    if (data.listIds !== undefined) {
      const previousListIds = existingTask.lists.map((list) => list.id)
      const unifiedListIds = Array.from(new Set([...previousListIds, ...data.listIds]))

      for (const candidateId of unifiedListIds) {
        try {
          const listRecord = await prisma.taskList.findUnique({
            where: { id: candidateId },
            select: {
              id: true, sortBy: true, manualSortOrder: true, ownerId: true,
              owner: { select: { id: true, name: true, email: true, image: true } },
              listMembers: { select: { userId: true, role: true } },
            },
          })

          if (!listRecord || listRecord.sortBy !== "manual") {
            continue
          }

          const existingOrder = Array.isArray((listRecord as any).manualSortOrder)
            ? (listRecord.manualSortOrder as string[])
            : []

          let nextOrder = existingOrder.filter(id => id !== taskId)

          if (data.listIds.includes(candidateId)) {
            if (!nextOrder.includes(taskId)) {
              nextOrder.push(taskId)
            }
          }

          const hasChanged = nextOrder.length !== existingOrder.length || nextOrder.some((id, index) => existingOrder[index] !== id)

          if (!hasChanged) {
            continue
          }

          const updatedList = await prisma.taskList.update({
            where: { id: candidateId },
            data: {
              manualSortOrder: nextOrder as Prisma.JsonArray
            },
            include: {
              owner: { select: { id: true, name: true, email: true, image: true } },
              listMembers: { select: { userId: true, role: true } },
            },
          })

          const memberIds = getListMemberIds(updatedList)
          await Promise.all(memberIds.map(userId => RedisCache.del(RedisCache.keys.userLists(userId))))
          await broadcastToUsers(memberIds, {
            type: 'list_updated',
            data: updatedList
          })
        } catch (error) {
          console.error('Failed to synchronize manual sort order for list', candidateId, error)
        }
      }
    }

    // Handle AI agent assignment using command pattern (prevents circular dependencies)
    try {
      console.log(`🔔 [TASK-UPDATE] Starting AI agent assignment check for task ${updatedTask.id}`)
      console.log(`🔔 [TASK-UPDATE] Session user: ${session.user.id}, email: ${session.user.email}`)

      // Check if updater is an AI agent to prevent self-triggering loops
      const updaterUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { isAIAgent: true }
      })
      const isUpdaterAIAgent = updaterUser?.isAIAgent === true
      console.log(`🔔 [TASK-UPDATE] isUpdaterAIAgent: ${isUpdaterAIAgent}`)

      // AI agent workflow triggering is handled by Prisma middleware
      // The middleware posts the "starting" comment, sends webhooks, and triggers assistant workflow
      // This keeps the API route simple and avoids duplicate processing
      if (!isUpdaterAIAgent) {
        const assigneeChanged = updatedTask.assigneeId !== existingTask.assigneeId
        if (assigneeChanged && updatedTask.assigneeId) {
          console.log(`🤖 [TASK-UPDATE] Assignee changed to ${updatedTask.assigneeId} - Prisma middleware will handle AI agent processing`)
        }
      } else {
        console.log(`🤖 Task updated by AI agent itself, skipping AI agent processing`)
      }
    } catch (aiWebhookError) {
      console.error("Failed to check AI agent assignment:", aiWebhookError)
      // Don't fail the task update if check fails
    }

    // Invalidate user statistics if completion status or assignment changed
    try {
      const completionChanged = existingTask.completed !== updatedTask.completed
      const assignmentChanged = existingTask.assigneeId !== updatedTask.assigneeId

      if (completionChanged || assignmentChanged) {
        const { invalidateUserStats } = await import("@/lib/user-stats")
        const statsUserIds = new Set<string>()

        // Invalidate assignee's stats (completed tasks count changed)
        if (updatedTask.assigneeId && completionChanged) {
          statsUserIds.add(updatedTask.assigneeId)
        }

        // Invalidate old assignee's stats if assignment changed
        if (existingTask.assigneeId && assignmentChanged && existingTask.assigneeId !== updatedTask.assigneeId) {
          statsUserIds.add(existingTask.assigneeId)
        }

        // Invalidate creator's stats (inspired tasks count might have changed)
        // This happens when someone else completes their task
        if (updatedTask.creatorId && completionChanged) {
          statsUserIds.add(updatedTask.creatorId)
        }

        if (statsUserIds.size > 0) {
          await invalidateUserStats(Array.from(statsUserIds))
          console.log(`📊 Invalidated user stats for ${statsUserIds.size} users`)
        }
      }
    } catch (statsError) {
      console.error("❌ Failed to invalidate user stats:", statsError)
      // Continue - task was still updated
    }

    // Invalidate cache for all affected users BEFORE broadcasting SSE
    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        const affectedUserIds = new Set<string>()

        // Add task assignee (both old and new if assignee changed)
        if (updatedTask.assigneeId) {
          affectedUserIds.add(updatedTask.assigneeId)
        }
        if (existingTask.assigneeId && existingTask.assigneeId !== updatedTask.assigneeId) {
          // Also invalidate cache for old assignee if assignment changed
          affectedUserIds.add(existingTask.assigneeId)
        }

        // Add task creator
        if (updatedTask.creatorId) {
          affectedUserIds.add(updatedTask.creatorId)
        }

        // Add all list members from all associated lists
        for (const list of updatedTask.lists) {
          const { getListMemberIds } = await import("@/lib/list-member-utils")
          const memberIds = getListMemberIds(list)
          memberIds.forEach(id => affectedUserIds.add(id))
        }

        // Invalidate cache for all affected users
        const invalidationPromises = Array.from(affectedUserIds).map(userId =>
          RedisCache.del(RedisCache.keys.userTasks(userId))
        )

        console.log(`🗄️ Invalidating task cache for ${affectedUserIds.size} users after task update`)
        await Promise.all(invalidationPromises)
        console.log(`✅ Task cache invalidated for all affected users`)
      }
    } catch (cacheError) {
      console.error("❌ Failed to invalidate task cache:", cacheError)
      // Continue - task was still updated
    }

    // Broadcast real-time updates to relevant users
    try {
      // Get all users who should receive updates
      const userIds = new Set<string>()
      
      // Add task assignee
      if (updatedTask.assigneeId) {
        userIds.add(updatedTask.assigneeId)
      }
      
      // Add task creator  
      if (updatedTask.creatorId) {
        userIds.add(updatedTask.creatorId)
      }
      
      // Add all list members from all associated lists using comprehensive member utils
      for (const list of updatedTask.lists) {
        const { getListMemberIds } = await import("@/lib/list-member-utils")
        const memberIds = getListMemberIds(list)
        memberIds.forEach(id => userIds.add(id))
      }
      
      // Remove the user who made the update (they already see it)
      userIds.delete(session.user.id)
      
      console.log(`[SSE] Task update broadcast - userIds before removal: ${Array.from(userIds).length}`)
      console.log(`[SSE] User IDs to notify:`, Array.from(userIds))
      
      // Broadcast to all relevant users
      if (userIds.size > 0) {
        console.log(`[SSE] Broadcasting task update to ${userIds.size} users`)
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(Array.from(userIds), {
          type: 'task_updated',
          timestamp: new Date().toISOString(),
          data: {
            taskId: updatedTask.id,
            taskTitle: updatedTask.title,
            taskPriority: updatedTask.priority,
            taskDueDateTime: updatedTask.dueDateTime,
            taskIsAllDay: updatedTask.isAllDay,
            taskCompleted: updatedTask.completed,
            updaterName: session.user.name || session.user.email || "Someone",
            userId: session.user.id, // Add userId for client-side filtering
            listNames: updatedTask.lists.map((list) => list.name),
            // Send complete task data for real-time updates
            task: {
              id: updatedTask.id,
              title: updatedTask.title,
              description: updatedTask.description,
              priority: updatedTask.priority,
              completed: updatedTask.completed,
              dueDateTime: updatedTask.dueDateTime,
              isAllDay: updatedTask.isAllDay,
              assignee: updatedTask.assignee,
              assigneeId: updatedTask.assigneeId,
              creator: updatedTask.creator,
              creatorId: updatedTask.creatorId,
              lists: updatedTask.lists,
              isPrivate: updatedTask.isPrivate,
              repeating: updatedTask.repeating,
              repeatingData: updatedTask.repeatingData,
              createdAt: updatedTask.createdAt,
              updatedAt: updatedTask.updatedAt,
              comments: updatedTask.comments,
              attachments: updatedTask.attachments
            }
          }
        })
      }
    } catch (sseError) {
      console.error("Failed to send task update SSE notifications:", sseError)
      // Continue - task was still updated
    }


    // ✅ Cancel any active coding workflows if task is being marked as completed
    if (data.completed && !existingTask.completed) {
      try {
        const activeWorkflow = await prisma.codingTaskWorkflow.findUnique({
          where: { taskId }
        })

        if (activeWorkflow && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeWorkflow.status)) {
          console.log(`🛑 [TASK-UPDATE] Cancelling active workflow due to task completion: ${taskId}`)
          await prisma.codingTaskWorkflow.update({
            where: { taskId },
            data: {
              status: 'CANCELLED',
              metadata: {
                ...((activeWorkflow.metadata as WorkflowMetadata) || {}),
                cancelledAt: new Date().toISOString(),
                cancelReason: 'Task marked as completed by user'
              }
            }
          })
          console.log(`✅ [TASK-UPDATE] Workflow cancelled successfully`)
        }
      } catch (workflowError) {
        console.error('❌ [TASK-UPDATE] Failed to cancel workflow:', workflowError)
        // Continue with update even if workflow cancellation fails
      }
    }

    // Update reminders if due date, completion status, or assignee changed
    const dueDateChanged = existingTask.dueDateTime?.getTime() !== sanitizedDueDateTime?.getTime()
    const completedChanged = existingTask.completed !== data.completed
    const assigneeChanged = existingTask.assigneeId !== data.assigneeId

    if (dueDateChanged || completedChanged || assigneeChanged) {
      try {
        // Remove existing reminders for this task
        await prisma.reminderQueue.updateMany({
          where: {
            taskId: updatedTask.id,
            status: "pending"
          },
          data: {
            status: "cancelled"
          }
        })
        console.log(`📅 Cancelled existing reminders for updated task ${updatedTask.id}`)

        // Add new reminders if task is not completed and has due date
        if (!updatedTask.completed && sanitizedDueDateTime) {
          const remindersToSchedule = []
          const dueDate = new Date(sanitizedDueDateTime)
          const now = new Date()
          
          // Only schedule for future due dates
          if (dueDate > now) {
            // Schedule reminder 15 minutes before due time
            const reminderTime = new Date(dueDate.getTime() - (15 * 60 * 1000))
            if (reminderTime > now) {
              remindersToSchedule.push({
                scheduledFor: reminderTime,
                type: "due_reminder"
              })
            } else {
              // If less than 15 minutes until due, schedule for due time
              remindersToSchedule.push({
                scheduledFor: dueDate,
                type: "due_reminder"
              })
            }
            
            // Schedule overdue reminder (1 hour after due time)
            const overdueTime = new Date(dueDate.getTime() + (60 * 60 * 1000))
            remindersToSchedule.push({
              scheduledFor: overdueTime,
              type: "overdue_reminder"
            })
          }

          // Create the new reminders
          for (const reminder of remindersToSchedule) {
            try {
              await prisma.reminderQueue.create({
                data: {
                  taskId: updatedTask.id,
                  userId: updatedTask.assigneeId || updatedTask.creatorId || session.user.id, // Send to assignee, creator, or current user
                  scheduledFor: reminder.scheduledFor,
                  type: reminder.type,
                  status: "pending",
                  data: {
                    taskTitle: updatedTask.title,
                    taskId: updatedTask.id,
                    source: "automatic_update",
                  },
                }
              })
              console.log(`📅 Added ${reminder.type} to queue for updated task ${updatedTask.id} at ${reminder.scheduledFor.toLocaleString()}`)
            } catch (reminderError) {
              console.error(`Failed to add ${reminder.type} for updated task:`, reminderError)
            }
          }
        }
      } catch (error) {
        console.error("Failed to update reminders for task:", error)
        // Don't fail the task update if reminder scheduling fails
      }
    }

    console.log('[API Route] Returning updated task:', {
      taskId: updatedTask.id,
      repeatFrom: updatedTask.repeatFrom,
      repeating: updatedTask.repeating
    })

    // Track analytics events (fire-and-forget)
    if (data.completed !== undefined && data.completed !== existingTask.completed) {
      if (data.completed) {
        trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_COMPLETED, { taskId })
      }
    }
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_EDITED, { taskId })

    return NextResponse.json(updatedTask)
  } catch (error) {
    console.error("Error updating task:", error)
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      taskId,
      userId: session?.user?.id
    })
    return NextResponse.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: taskId } = await context.params

    // Check if user has permission to delete this task
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          },
        },
      },
    })

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const canDelete =
      existingTask.creatorId === session.user.id ||
      existingTask.lists.some((list) => canAccessList(list, session.user.id))

    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // ✅ Cancel any active coding workflows before deleting task
    try {
      const activeWorkflow = await prisma.codingTaskWorkflow.findUnique({
        where: { taskId }
      })

      if (activeWorkflow && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeWorkflow.status)) {
        console.log(`🛑 [TASK-DELETE] Cancelling active workflow for task ${taskId}`)
        await prisma.codingTaskWorkflow.update({
          where: { taskId },
          data: {
            status: 'CANCELLED',
            metadata: {
              ...((activeWorkflow.metadata as WorkflowMetadata) || {}),
              cancelledAt: new Date().toISOString(),
              cancelReason: 'Task deleted by user'
            }
          }
        })
        console.log(`✅ [TASK-DELETE] Workflow cancelled successfully`)
      }
    } catch (workflowError) {
      console.error('❌ [TASK-DELETE] Failed to cancel workflow:', workflowError)
      // Continue with deletion even if workflow cancellation fails
    }

    await prisma.task.delete({
      where: { id: taskId },
    })

    for (const list of existingTask.lists) {
      try {
        const listRecord = await prisma.taskList.findUnique({
          where: { id: list.id },
          select: {
            id: true, sortBy: true, manualSortOrder: true, ownerId: true,
            owner: { select: { id: true, name: true, email: true, image: true } },
            listMembers: { select: { userId: true, role: true } },
          },
        })

        if (!listRecord || listRecord.sortBy !== "manual") {
          continue
        }

        const existingOrder = Array.isArray((listRecord as any).manualSortOrder)
          ? (listRecord.manualSortOrder as string[])
          : []

        if (!existingOrder.includes(taskId)) {
          continue
        }

        const nextOrder = existingOrder.filter(id => id !== taskId)

        const updatedList = await prisma.taskList.update({
          where: { id: listRecord.id },
          data: {
            manualSortOrder: nextOrder as Prisma.JsonArray
          },
          include: {
            owner: { select: { id: true, name: true, email: true, image: true } },
            listMembers: { select: { userId: true, role: true } },
          },
        })

        const memberIds = getListMemberIds(updatedList)
        await Promise.all(memberIds.map(userId => RedisCache.del(RedisCache.keys.userLists(userId))))
        await broadcastToUsers(memberIds, {
          type: 'list_updated',
          data: updatedList
        })
      } catch (error) {
        console.error('Failed to update manual sort order after deletion for list', list.id, error)
      }
    }

    // Invalidate cache for all affected users BEFORE broadcasting SSE
    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        const affectedUserIds = new Set<string>()

        // Add task assignee
        if (existingTask.assigneeId) {
          affectedUserIds.add(existingTask.assigneeId)
        }

        // Add task creator
        if (existingTask.creatorId) {
          affectedUserIds.add(existingTask.creatorId)
        }

        // Add all list members from all associated lists
        for (const list of existingTask.lists) {
          const { getListMemberIds } = await import("@/lib/list-member-utils")
          const memberIds = getListMemberIds(list)
          memberIds.forEach(id => affectedUserIds.add(id))
        }

        // Invalidate cache for all affected users
        const invalidationPromises = Array.from(affectedUserIds).map(userId =>
          RedisCache.del(RedisCache.keys.userTasks(userId))
        )

        console.log(`🗄️ Invalidating task cache for ${affectedUserIds.size} users after task deletion`)
        await Promise.all(invalidationPromises)
        console.log(`✅ Task cache invalidated for all affected users`)
      }
    } catch (cacheError) {
      console.error("❌ Failed to invalidate task cache:", cacheError)
      // Continue - task was still deleted
    }

    // Broadcast real-time deletion updates to relevant users
    try {
      // Get all users who should receive updates
      const userIds = new Set<string>()

      // Add task assignee
      if (existingTask.assigneeId) {
        userIds.add(existingTask.assigneeId)
      }

      // Add task creator
      if (existingTask.creatorId) {
        userIds.add(existingTask.creatorId)
      }

      // Add all list members from all associated lists using comprehensive member utils
      for (const list of existingTask.lists) {
        const { getListMemberIds } = await import("@/lib/list-member-utils")
        const memberIds = getListMemberIds(list)
        memberIds.forEach(id => userIds.add(id))
      }

      // Remove the user who made the deletion (they already see it)
      userIds.delete(session.user.id)

      console.log(`[SSE] Task deletion broadcast - userIds before removal: ${Array.from(userIds).length}`)
      console.log(`[SSE] User IDs to notify:`, Array.from(userIds))

      // Broadcast to all relevant users
      if (userIds.size > 0) {
        console.log(`[SSE] Broadcasting task deletion to ${userIds.size} users`)
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(Array.from(userIds), {
          type: 'task_deleted',
          timestamp: new Date().toISOString(),
          data: {
            id: taskId, // Use taskId for consistency with existing SSE handler
            taskId: taskId,
            taskTitle: existingTask.title,
            deleterName: session.user.name || session.user.email || "Someone",
            userId: session.user.id, // Add userId for client-side filtering
            listNames: existingTask.lists.map((list) => list.name)
          }
        })
      }
    } catch (sseError) {
      console.error("Failed to send task deletion SSE notifications:", sseError)
      // Continue - task was still deleted
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_DELETED, { taskId })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
