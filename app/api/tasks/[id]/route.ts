import { type NextRequest, NextResponse } from "next/server"
import { mirrorExternalDeletesForTask } from '@/lib/sync/mirror-deletes'
import { prisma } from "@/lib/prisma"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { canUserEditTask } from "@/lib/list-permissions"
import {
  TASK_FULL_INCLUDE,
  TASK_PERMISSION_INCLUDE,
  type TaskWithFullRelations,
  type ListWithMembers
} from "@/lib/task-query-utils"
import { detectPlatform } from "@/lib/analytics-events"
import { createLogger } from '@/lib/logger'
import { validateParentTask, readParentTaskIdFromBody } from "@/lib/subtasks"
import { getUnifiedSession } from "@/lib/session-utils"
import { audienceForTask, recordDeletion } from "@/lib/deletion-log"
import {
  deleteTaskWithSideEffects,
  updateTaskWithSideEffects,
  type UpdateTaskIntent,
} from '@/services/task.service'
import { createSafeErrorResponse } from '@/lib/logging/error-sanitizer'

const log = createLogger('api.tasks.id')

// AI agent workflow handling is now done by Prisma middleware (lib/prisma.ts)
// Removed: getAgentService, aiAgentWebhookService imports

// ✅ Production database migrated to unified listMembers table (2025-11-02)

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
      task.lists.some((list) => hasListAccess(list, session.user.id)) ||
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

    // Identifiers only. This used to attach the entire request body — task
    // titles, descriptions, whatever the user typed — to production logs on
    // every PUT (task 2e15b42f).
    log.debug({ taskId, userId: session.user.id }, 'PUT /api/tasks/[id]')

    if (!data.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_PERMISSION_INCLUDE,
    })

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Who may edit THIS task: assignee, creator, or an editor on one of its
    // lists. The surface's own authorisation — the service authorises the
    // lists a task is moving to, not the caller.
    const user = { id: session.user.id, email: session.user.email, name: session.user.name }
    const canUpdate =
      existingTask.assigneeId === session.user.id ||
      existingTask.creatorId === session.user.id ||
      existingTask.lists.some((list) => canUserEditTask(user, existingTask, list))

    if (!canUpdate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Reassigning by email to someone who has not signed up yet mints a
    // placeholder user. Only this route accepts it, and it writes to the User
    // table rather than the task, so it stays at the surface.
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

    // A task on a PUBLIC list takes no regular-user assignee — that would
    // publish a real person's identity on a public artifact. AI agents are
    // exempt: coding agents are expected to work on public lists.
    const assigneeProvided = emailAssigneeId !== null || data.assigneeId !== undefined
    let finalAssigneeId: string | null = emailAssigneeId ?? data.assigneeId ?? null

    if (finalAssigneeId && existingTask.lists.some((list) => list.privacy === 'PUBLIC')) {
      const assigneeUser = await prisma.user.findUnique({
        where: { id: finalAssigneeId },
        select: { isAIAgent: true },
      })
      if (!assigneeUser?.isAIAgent) {
        log.info(`📢 Task ${taskId} is in a PUBLIC list - preventing regular user assignment`)
        finalAssigneeId = null
      }
    }

    // Subtasks: re-parent, or promote to top-level with null (task b00a1f94).
    // Cycle-validation is shared with v1 rather than re-derived.
    const parentUpdate = readParentTaskIdFromBody(data)
    if (!parentUpdate.skip && parentUpdate.parentTaskId !== null) {
      const parentError = await validateParentTask(parentUpdate.parentTaskId, taskId)
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 })
      }
    }

    // PUT semantics: an absent date CLEARS the date, and an absent isAllDay is
    // false. That is this route's contract with the web client, which always
    // sends the whole task — so these two keys are always present in the
    // intent, unlike the fields below that are only forwarded when sent.
    const intent: UpdateTaskIntent = {
      title: data.title,
      dueDateTime: data.dueDateTime ?? null,
      isAllDay: data.isAllDay ?? false,
      repeatingData: data.repeatingData ?? null,
    }
    if (data.description !== undefined) intent.description = data.description
    if (data.priority !== undefined) intent.priority = data.priority
    if (data.repeating !== undefined) intent.repeating = data.repeating
    if (data.repeatFrom !== undefined) intent.repeatFrom = data.repeatFrom
    if (data.isPrivate !== undefined) intent.isPrivate = data.isPrivate
    if (data.timerDuration !== undefined) intent.timerDuration = data.timerDuration
    if (data.lastTimerValue !== undefined) intent.lastTimerValue = data.lastTimerValue
    if (data.completed !== undefined) intent.completed = data.completed
    if (data.completedAt !== undefined) intent.completedAt = data.completedAt
    if (data.completedSource !== undefined) intent.completedSource = data.completedSource
    if (data.closedReason !== undefined) intent.closedReason = data.closedReason
    if (data.localCompletionDate !== undefined) intent.localCompletionDate = data.localCompletionDate
    if (data.statusRole !== undefined) intent.statusRole = data.statusRole
    if (data.listIds !== undefined && Array.isArray(data.listIds)) intent.listIds = data.listIds
    if (assigneeProvided) intent.assigneeId = finalAssigneeId
    if (!parentUpdate.skip) intent.parentTaskId = parentUpdate.parentTaskId

    const result = await updateTaskWithSideEffects({
      taskId,
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || 'Someone',
      // Always a human here: this route is session-authenticated web UI. Agents
      // reach tasks through /api/v1, which passes auth.isAIAgent.
      actorType: 'user',
      platform: detectPlatform(request),
      intent,
      existingTask,
      cancelWorkflowReason: 'Task marked as completed by user',
      legacySsePayload: true,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Prepended so the client renders it without a refetch, as before.
    if (result.stateChangeComment && Array.isArray(result.task.comments)) {
      result.task.comments = [result.stateChangeComment, ...result.task.comments]
    }

    return NextResponse.json(result.task)
  } catch (error) {
    log.error({ err: error }, "Error updating task:")
    log.error({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      taskId,
      userId: session?.user?.id
    }, "Error details:")
    return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
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
      existingTask.lists.some((list) => hasListAccess(list, session.user.id))

    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Everything the delete implies — workflow cancel, tombstone, manual-sort
    // sync, cache invalidation, SSE fan-out — lives in one place now. Two of
    // the four delete surfaces used to skip the tombstone entirely, so a task
    // deleted over MCP stayed visible to delta-syncing clients forever
    // (epic 9dedd8aa).
    try { await mirrorExternalDeletesForTask(taskId) } catch { /* tombstoning is belt-and-braces */ }

    await deleteTaskWithSideEffects({
      taskId,
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || undefined,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error deleting task:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
