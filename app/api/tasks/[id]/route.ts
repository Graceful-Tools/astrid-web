import { type NextRequest, NextResponse } from "next/server"
import { mirrorExternalDeletesForTask } from '@/lib/sync/mirror-deletes'
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { RedisCache, isRedisAvailable } from "@/lib/redis"
import { getListMemberIds, hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { broadcastToUsers } from "@/lib/sse-utils"
import { canUserEditTask } from "@/lib/list-permissions"
import { parseClosedReason } from "@/lib/closed-reason"
import { diffTaskEvents, recordTaskEvents } from "@/lib/task-events"
import { invalidateUserStats } from "@/lib/user-stats"
import {
  TASK_FULL_INCLUDE,
  TASK_PERMISSION_INCLUDE,
  type TaskWithFullRelations,
  type ListWithMembers,
  type WorkflowMetadata
} from "@/lib/task-query-utils"
import { getErrorMessage } from "@/lib/error-utils"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import { rescheduleRemindersForUpdate } from "@/lib/reminder-scheduling"
import {
  applyRepeatingTaskCompletion,
  recordStateChangeComment,
} from "@/lib/task-update-handler"
import { createLogger } from '@/lib/logger'
import { normalizeProjectStatusListIds, statusListIdsToDetachOnCompletion } from "@/lib/project-status"
import { getUnifiedSession } from "@/lib/session-utils"
import { audienceForTask, recordDeletion } from "@/lib/deletion-log"

const log = createLogger('api.tasks.id')

// AI agent workflow handling is now done by Prisma middleware (lib/prisma.ts)
// Removed: getAgentService, aiAgentWebhookService imports

// ✅ Production database migrated to unified listMembers table (2025-11-02)

// Helper function to safely check list access with list-like object
function canAccessList(list: ListWithMembers, userId: string): boolean {
  // hasListAccess covers owner/admin/member on every payload shape; the old
  // try/catch fallback was unreachable (it returns false, never throws).
  return hasListAccess(list, userId)
}

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)

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
    log.error({ err: error }, "Error fetching task:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  let session: { user: { id: string; email?: string | null; name?: string | null } } | null = null
  let taskId = ""
  try {
    session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    taskId = (await context.params).id

    log.info({
      taskId,
      userId: session.user.id,
      updateData: data
    }, `🔧 [TASK-UPDATE] PUT request received:`)

    // Validate required data
    if (!data.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    // Check if user has permission to update this task
    log.info(`[DEBUG] Before existingTask lookup: prisma exists? ${!!prisma}, prisma.task exists? ${!!prisma.task}`);
    log.info(`[DEBUG] Before existingTask lookup (DELETE): prisma exists? ${!!prisma}, prisma.task exists? ${!!prisma.task}`);
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_PERMISSION_INCLUDE,
    })
    log.info(`[DEBUG] After existingTask lookup (DELETE): existingTask exists? ${!!existingTask}`);
    log.info(`[DEBUG] After existingTask lookup: existingTask exists? ${!!existingTask}`);

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

    log.info({
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
    }, `🔐 [TASK-UPDATE] Permission check:`)

    if (!canUpdate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Validate and sanitize the data
    if (process.env.NODE_ENV === "development") {
      log.info({ data }, 'Updating task with data')
      log.info({ userId: session?.user?.id, email: session?.user?.email }, 'Session data:')
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
            log.error({ dueDateTime: data.dueDateTime }, 'Invalid dueDateTime string')
            sanitizedDueDateTime = null
          }
        } catch (e) {
          log.error({ err: e, dueDateTime: data.dueDateTime }, 'Error parsing dueDateTime')
          sanitizedDueDateTime = null
        }
      } else if (!(sanitizedDueDateTime instanceof Date)) {
        log.error({ type: typeof data.dueDateTime, value: data.dueDateTime }, 'Invalid dueDateTime type')
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
        log.error({ err: sanitizedRepeatingData }, 'Invalid JSON in repeatingData:')
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
        log.info(`📧 Task reassigned to email: ${data.assigneeEmail} (${emailAssigneeId})`)
      } catch (error) {
        log.error({ err: error }, 'Error creating placeholder user for update:')
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
        log.info(`📢 Task ${taskId} is in a PUBLIC list - preventing regular user assignment`)
        finalAssigneeId = null // Force unassigned for public lists
      } else {
        // AI agent assignment on public list - allow it
        log.info(`🤖 Task ${taskId} is in a PUBLIC list - allowing AI agent assignment`)
      }
    }

    // Log ALL updates with repeatFrom for debugging
    log.info({
      taskId,
      repeating: data.repeating,
      repeatFrom: data.repeatFrom,
      repeatFromType: typeof data.repeatFrom,
      repeatFromUndefined: data.repeatFrom === undefined,
      hasRepeatFromInData: 'repeatFrom' in data,
      repeatingData: sanitizedRepeatingData
    }, '[API Route] Update request received:')

    // Log repeating task data for debugging
    if (data.repeating && data.repeating !== 'never') {
      log.info({
        taskId,
        repeating: data.repeating,
        repeatFrom: data.repeatFrom,
        repeatingData: sanitizedRepeatingData
      }, '[API Route] Updating repeating task:')
    }

    // SECURITY: Validate user has access to all specified lists before updating
    let validatedListIds: string[] | undefined
    let completedFromStatus: boolean | undefined
    if (data.listIds !== undefined && Array.isArray(data.listIds)) {
      if (data.listIds.length > 0) {
        const lists = await prisma.taskList.findMany({
          where: { id: { in: data.listIds } },
          include: {
            owner: { select: { id: true } },
            listMembers: { select: { userId: true } },
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

        const projectIds = lists
          .map(list => list.projectId)
          .filter((id): id is string => Boolean(id))

        if (projectIds.length > 0) {
          const projectStatusLists = await prisma.taskList.findMany({
            where: {
              projectId: { in: Array.from(new Set(projectIds)) },
              listType: "status",
            },
          })
          const requestedCompletedFlag = typeof data.completed === 'boolean'
            ? data.completed
            : existingTask.completed
          const normalized = normalizeProjectStatusListIds(
            validatedListIds,
            [...lists, ...projectStatusLists] as any,
            { completed: requestedCompletedFlag }
          )
          validatedListIds = normalized.listIds
          completedFromStatus = normalized.completedFromStatus
        }
      } else {
        // Allow removing task from all lists (empty array)
        validatedListIds = []
      }
    }

    const requestedCompleted = completedFromStatus ?? data.completed

    // See the `lists:` clause below — computed here so it reads next to the
    // completion decision it depends on.
    const statusListsToDetachOnCompletion =
      requestedCompleted === true && validatedListIds === undefined
        ? statusListIdsToDetachOnCompletion(existingTask.lists)
        : []

    // Terminal state other than done (task 11042ae3). Rejected rather than
    // silently nulled when unrecognised: a typo must not quietly become
    // "completed normally".
    const parsedClosedReason = parseClosedReason(data.closedReason)
    if (!parsedClosedReason.ok) {
      return NextResponse.json({ error: parsedClosedReason.error }, { status: 400 })
    }

    // Handle repeating-task completion: if the task is part of a repeating
    // series and should roll forward / terminate, the helper applies it and
    // we short-circuit with the freshly-fetched task.
    const completionOutcome = await applyRepeatingTaskCompletion({
      taskId,
      existingCompleted: existingTask.completed,
      dataCompleted: requestedCompleted,
      localCompletionDate: data.localCompletionDate,
      closedReason: parsedClosedReason.value,
    })
    if (completionOutcome.rolledForward) {
      return NextResponse.json(completionOutcome.updatedTask)
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

    log.info({
      taskId,
      updateData,
      hasRepeatFrom: 'repeatFrom' in updateData,
      repeatFromValue: updateData.repeatFrom
    }, '[API Route] Prisma update data:')

    // Update the task (only if not a repeating task that was rolled forward)
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...updateData,
        completed: requestedCompleted,
        ...(requestedCompleted === true
          ? { completedAt: new Date(), completedSource: 'astrid' }
          : requestedCompleted === false
            // Reopening clears the reason too — a reopened task is not a
            // canceled one (task 11042ae3).
            ? { completedAt: null, completedSource: null, closedReason: null }
            : {}),
        ...(data.closedReason !== undefined && requestedCompleted !== false
          ? { closedReason: parsedClosedReason.value }
          : {}),
        // Board status as a state on the task (AWTD-562). Completing a task
        // clears it — Done carries no status, the same invariant the list
        // model needed a normalizer to hold.
        ...(requestedCompleted === true
          ? { statusRole: null }
          : data.statusRole !== undefined
            ? { statusRole: data.statusRole || null }
            : {}),
        dueDateTime: sanitizedDueDateTime,
        isAllDay: data.isAllDay ?? false,
        assigneeId: finalAssigneeId,
        lists: validatedListIds !== undefined
          ? {
              set: validatedListIds.map((id: string) => ({ id })),
            }
          // Invariant: completed = true => no status memberships (task
          // db7c6670). The listIds branch enforces it via
          // normalizeProjectStatusListIds, but only when the request carries
          // listIds. A completion-only update left the task sitting in Ready.
          : statusListsToDetachOnCompletion.length > 0
            ? { disconnect: statusListsToDetachOnCompletion.map((id: string) => ({ id })) }
            : undefined,
      },
      include: TASK_FULL_INCLUDE,
    })

    // Structured activity history (task 51a4b8ff), alongside the prose comment
    // below. Both derive from the same before/after pair; the comment is what a
    // human reads, the events are what can be queried and fanned out.
    // Best-effort by contract — recordTaskEvents never throws.
    await recordTaskEvents({
      taskId,
      actorId: session.user.id,
      // Always a human here: this route is session-authenticated web UI. Agents
      // reach tasks through /api/v1, which passes auth.isAIAgent.
      actorType: 'user',
      events: diffTaskEvents(
        {
          title: existingTask.title,
          completed: existingTask.completed,
          closedReason: existingTask.closedReason,
          priority: existingTask.priority,
          assigneeId: existingTask.assigneeId,
          dueDateTime: existingTask.dueDateTime,
          listIds: existingTask.lists.map((list) => list.id),
        },
        {
          title: updatedTask.title,
          completed: updatedTask.completed,
          closedReason: updatedTask.closedReason,
          priority: updatedTask.priority,
          assigneeId: updatedTask.assigneeId,
          dueDateTime: updatedTask.dueDateTime,
          listIds: updatedTask.lists.map((list) => list.id),
        }
      ),
    })

    // Track state changes and create system comment.
    const stateChangeComment = await recordStateChangeComment({
      existingTask,
      updatedTask,
      updaterName: session.user.name || session.user.email || 'Someone',
    })
    if (stateChangeComment) {
      updatedTask.comments = [stateChangeComment, ...updatedTask.comments]
    }

    if (data.listIds !== undefined) {
      const previousListIds = existingTask.lists.map((list) => list.id)
      const requestedListIdsForManualSort = validatedListIds ?? data.listIds
      const unifiedListIds = Array.from(new Set([...previousListIds, ...requestedListIdsForManualSort]))

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

          if (requestedListIdsForManualSort.includes(candidateId)) {
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
          await Promise.all(memberIds.map(userId => RedisCache.invalidate.userListsAllVersions(userId)))
          await broadcastToUsers(memberIds, {
            type: 'list_updated',
            data: updatedList
          })
        } catch (error) {
          log.error('Failed to synchronize manual sort order for list', candidateId, error)
        }
      }
    }

    // Handle AI agent assignment using command pattern (prevents circular dependencies)
    try {
      log.info(`🔔 [TASK-UPDATE] Starting AI agent assignment check for task ${updatedTask.id}`)
      log.info(`🔔 [TASK-UPDATE] Session user: ${session.user.id}, email: ${session.user.email}`)

      // Check if updater is an AI agent to prevent self-triggering loops
      const updaterUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { isAIAgent: true }
      })
      const isUpdaterAIAgent = updaterUser?.isAIAgent === true
      log.info(`🔔 [TASK-UPDATE] isUpdaterAIAgent: ${isUpdaterAIAgent}`)

      // AI agent workflow triggering is handled by Prisma middleware
      // The middleware posts the "starting" comment, sends webhooks, and triggers assistant workflow
      // This keeps the API route simple and avoids duplicate processing
      if (!isUpdaterAIAgent) {
        const assigneeChanged = updatedTask.assigneeId !== existingTask.assigneeId
        if (assigneeChanged && updatedTask.assigneeId) {
          log.info(`🤖 [TASK-UPDATE] Assignee changed to ${updatedTask.assigneeId} - Prisma middleware will handle AI agent processing`)
        }
      } else {
        log.info(`🤖 Task updated by AI agent itself, skipping AI agent processing`)
      }
    } catch (aiWebhookError) {
      log.error({ err: aiWebhookError }, "Failed to check AI agent assignment:")
      // Don't fail the task update if check fails
    }

    // Invalidate user statistics if completion status or assignment changed
    try {
      const completionChanged = existingTask.completed !== updatedTask.completed
      const assignmentChanged = existingTask.assigneeId !== updatedTask.assigneeId

      if (completionChanged || assignmentChanged) {
        // invalidateUserStats imported at top level
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
          log.info(`📊 Invalidated user stats for ${statsUserIds.size} users`)
        }
      }
    } catch (statsError) {
      log.error({ err: statsError }, "❌ Failed to invalidate user stats:")
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
          // getListMemberIds imported at top level
          const memberIds = getListMemberIds(list)
          memberIds.forEach(id => affectedUserIds.add(id))
        }

        // Invalidate cache for all affected users
        const invalidationPromises = Array.from(affectedUserIds).map(userId =>
          RedisCache.del(RedisCache.keys.userTasks(userId))
        )

        log.info(`🗄️ Invalidating task cache for ${affectedUserIds.size} users after task update`)
        await Promise.all(invalidationPromises)
        log.info(`✅ Task cache invalidated for all affected users`)
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, "❌ Failed to invalidate task cache:")
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
        // getListMemberIds imported at top level
        const memberIds = getListMemberIds(list)
        memberIds.forEach(id => userIds.add(id))
      }
      
      // Remove the user who made the update (they already see it)
      userIds.delete(session.user.id)
      
      log.info(`[SSE] Task update broadcast - userIds before removal: ${Array.from(userIds).length}`)
      log.info(Array.from(userIds), `[SSE] User IDs to notify:`)
      
      // Broadcast to all relevant users
      if (userIds.size > 0) {
        log.info(`[SSE] Broadcasting task update to ${userIds.size} users`)
        // broadcastToUsers imported at top level
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
      log.error({ err: sseError }, "Failed to send task update SSE notifications:")
      // Continue - task was still updated
    }


    // ✅ Cancel any active coding workflows if task is being marked as completed
    if (data.completed && !existingTask.completed) {
      try {
        const activeWorkflow = await prisma.codingTaskWorkflow.findUnique({
          where: { taskId }
        })

        if (activeWorkflow && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeWorkflow.status)) {
          log.info(`🛑 [TASK-UPDATE] Cancelling active workflow due to task completion: ${taskId}`)
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
          log.info(`✅ [TASK-UPDATE] Workflow cancelled successfully`)
        }
      } catch (workflowError) {
        log.error({ err: workflowError }, '❌ [TASK-UPDATE] Failed to cancel workflow:')
        // Continue with update even if workflow cancellation fails
      }
    }

    // Update reminders if due date, completion status, or assignee changed
    const dueDateChanged = existingTask.dueDateTime?.getTime() !== sanitizedDueDateTime?.getTime()
    const completedChanged = existingTask.completed !== data.completed
    const assigneeChanged = existingTask.assigneeId !== data.assigneeId

    if (dueDateChanged || completedChanged || assigneeChanged) {
      await rescheduleRemindersForUpdate({
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        userId: updatedTask.assigneeId || updatedTask.creatorId || session.user.id,
        dueDateTime: sanitizedDueDateTime ? new Date(sanitizedDueDateTime) : null,
        completed: !!updatedTask.completed,
      })
    }

    log.info({
      taskId: updatedTask.id,
      repeatFrom: updatedTask.repeatFrom,
      repeating: updatedTask.repeating
    }, '[API Route] Returning updated task:')

    // Track analytics events (fire-and-forget)
    if (data.completed !== undefined && data.completed !== existingTask.completed) {
      if (data.completed) {
        trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_COMPLETED, { taskId })
      }
    }
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_EDITED, { taskId })

    return NextResponse.json(updatedTask)
  } catch (error) {
    log.error({ err: error }, "Error updating task:")
    log.error({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      taskId,
      userId: session?.user?.id
    }, "Error details:")
    return NextResponse.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: taskId } = await context.params

    // Check if user has permission to delete this task. Uses the shared
    // permission include rather than an inline copy so project-derived access
    // (task 6c20d125) can't be missing here but present on the edit path.
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_PERMISSION_INCLUDE,
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
        log.info(`🛑 [TASK-DELETE] Cancelling active workflow for task ${taskId}`)
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
        log.info(`✅ [TASK-DELETE] Workflow cancelled successfully`)
      }
    } catch (workflowError) {
      log.error({ err: workflowError }, '❌ [TASK-DELETE] Failed to cancel workflow:')
      // Continue with deletion even if workflow cancellation fails
    }

    // Best-effort sync bookkeeping — must never block the delete itself.
    try { await mirrorExternalDeletesForTask(taskId) } catch { /* tombstoning is belt-and-braces */ }
    // Capture the audience before the relations go with the row. Wrapped
    // because tombstoning must never be the reason a delete fails.
    let taskAudience: string[] = []
    try {
      const taskForAudience = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          creatorId: true,
          assigneeId: true,
          lists: { select: { ownerId: true, listMembers: { select: { userId: true } } } },
        },
      })
      if (taskForAudience) taskAudience = audienceForTask(taskForAudience)
    } catch { /* best effort */ }

    await prisma.task.delete({
      where: { id: taskId },
    })
    await recordDeletion('task', taskId, taskAudience)

    // Batch-fetch the candidate lists in one query (only manual-sort ones)
    // and process updates in parallel — replaces the prior N+1 findUnique loop.
    try {
      const listIds = existingTask.lists.map(l => l.id)
      const candidateLists = listIds.length > 0
        ? await prisma.taskList.findMany({
            where: { id: { in: listIds }, sortBy: 'manual' },
            select: {
              id: true, sortBy: true, manualSortOrder: true, ownerId: true,
              owner: { select: { id: true, name: true, email: true, image: true } },
              listMembers: { select: { userId: true, role: true } },
            },
          })
        : []

      const listsNeedingUpdate = candidateLists.filter(listRecord => {
        const existingOrder = Array.isArray((listRecord as any).manualSortOrder)
          ? (listRecord.manualSortOrder as string[])
          : []
        return existingOrder.includes(taskId)
      })

      await Promise.all(
        listsNeedingUpdate.map(async listRecord => {
          try {
            const existingOrder = (listRecord.manualSortOrder as string[])
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
            await Promise.all(memberIds.map(userId => RedisCache.invalidate.userListsAllVersions(userId)))
            await broadcastToUsers(memberIds, {
              type: 'list_updated',
              data: updatedList
            })
          } catch (error) {
            log.error({ err: error }, `Failed to update manual sort order after deletion for list ${listRecord.id}:`)
          }
        })
      )
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch candidate manual-sort lists for deletion:')
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
          // getListMemberIds imported at top level
          const memberIds = getListMemberIds(list)
          memberIds.forEach(id => affectedUserIds.add(id))
        }

        // Invalidate cache for all affected users
        const invalidationPromises = Array.from(affectedUserIds).map(userId =>
          RedisCache.del(RedisCache.keys.userTasks(userId))
        )

        log.info(`🗄️ Invalidating task cache for ${affectedUserIds.size} users after task deletion`)
        await Promise.all(invalidationPromises)
        log.info(`✅ Task cache invalidated for all affected users`)
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, "❌ Failed to invalidate task cache:")
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
        // getListMemberIds imported at top level
        const memberIds = getListMemberIds(list)
        memberIds.forEach(id => userIds.add(id))
      }

      // Remove the user who made the deletion (they already see it)
      userIds.delete(session.user.id)

      log.info(`[SSE] Task deletion broadcast - userIds before removal: ${Array.from(userIds).length}`)
      log.info(Array.from(userIds), `[SSE] User IDs to notify:`)

      // Broadcast to all relevant users
      if (userIds.size > 0) {
        log.info(`[SSE] Broadcasting task deletion to ${userIds.size} users`)
        // broadcastToUsers imported at top level
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
      log.error({ err: sseError }, "Failed to send task deletion SSE notifications:")
      // Continue - task was still deleted
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_DELETED, { taskId })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error deleting task:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
