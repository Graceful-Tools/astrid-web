/**
 * Individual Task API v1
 *
 * GET /api/v1/tasks/:id - Get task details
 * PUT /api/v1/tasks/:id - Update task
 * DELETE /api/v1/tasks/:id - Delete task
 */

import { NextResponse } from 'next/server'
import { requireTaskAccess, requireTaskReadAccess, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { validateParentTask, readParentTaskIdFromBody } from '@/lib/subtasks'
import { getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType, detectPlatform } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { mirrorExternalDeletesForTask } from '@/lib/sync/mirror-deletes'
import { createLogger } from '@/lib/logger'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import {
  deleteTaskWithSideEffects,
  updateTaskWithSideEffects,
  type UpdateTaskIntent,
} from '@/services/task.service'
import { TASK_COMMENTS_RESPONSE_LIMIT } from '@/lib/task-query-utils'
import { validateV1TaskUpdate, type V1TaskUpdateRequest } from '@/lib/api-contracts/v1-request-shapes'
import { audienceForTask, recordDeletion } from "@/lib/deletion-log"

const log = createLogger('v1.tasks.id')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/tasks/:id
 * Get detailed task information
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.id' },
  async (_req, auth, { params }) => {
    const { id: rawId } = await params

    // Accept a human-readable identifier (AST-142) as well as a UUID
    // (task 12f54df4) — the whole point is that the identifier is usable
    // wherever the id is. Case-insensitive in, canonical uppercase stored.
    const taskId = await resolveTaskIdOrIdentifier(rawId)
    if (!taskId) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Read check, not the write one: it also admits any signed-in user when the
    // task sits on a PUBLIC list, matching legacy GET. PUT/DELETE below keep
    // requireTaskAccess. (Task 92e582c6.)
    // Throws ForbiddenError → withAuth catches → 403
    await requireTaskReadAccess(auth.userId, taskId)

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          select: {
            id: true,
            name: true,
            color: true,
            privacy: true,
            githubRepositoryId: true,
            aiAgentConfiguredBy: true,
            listMembers: {
              select: {
                id: true,
                listId: true,
                userId: true,
                role: true,
              }
            },
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isAIAgent: true,
            aiAgentType: true,
          },
        },
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        comments: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
                isAIAgent: true,
              },
            },
            secureFiles: true,
          },
          orderBy: { createdAt: 'desc' },
          take: TASK_COMMENTS_RESPONSE_LIMIT,
        },
        attachments: true,
        // Legacy's TASK_FULL_INCLUDE carries these; v1 did not, and web reads
        // them (taskLevelAttachments / CommentSection). A response that drops
        // them does not render fewer attachments — it renders none. (641a7615)
        secureFiles: true,
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Query is newest-first so the cap keeps recent comments; the wire order
    // stays ascending, which is what clients always received (task a86b5bed).
    task.comments?.reverse()

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // iOS expects a flat listIds array alongside the relation
    const taskWithListIds = {
      ...task,
      listIds: task.lists?.map(list => list.id) || []
    }

    return NextResponse.json(
      {
        task: taskWithListIds,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * PUT /api/v1/tasks/:id
 * Update task fields
 */
/**
 * The v1 wire shape for a task after a write.
 *
 * Passed to the shared update verb as the include for the returned row, so the
 * response is exactly what v1 has always sent. The service defaults to legacy's
 * TASK_FULL_INCLUDE, which is richer — it carries whole user records on list
 * owners and members — and handing that to v1 would newly publish member email
 * addresses to API consumers.
 *
 * The comment cap is load-bearing, not cosmetic: newest-first with a `take`,
 * reversed on the way out so the wire order stays ascending (task a86b5bed).
 */
const V1_TASK_RESPONSE_INCLUDE = {
  lists: {
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      color: true,
      githubRepositoryId: true,
      aiAgentConfiguredBy: true,
      listMembers: {
        select: {
          id: true,
          listId: true,
          userId: true,
          role: true,
        },
      },
    },
  },
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isAIAgent: true,
      aiAgentType: true,
    },
  },
  creator: {
    select: { id: true, name: true, email: true, image: true },
  },
  comments: {
    include: {
      author: {
        select: { id: true, name: true, email: true, isAIAgent: true },
      },
      secureFiles: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: TASK_COMMENTS_RESPONSE_LIMIT,
  },
  // Parity with legacy TASK_FULL_INCLUDE. This response replaces the task in
  // client state after every edit, so omitting these does not render fewer
  // attachments — it makes a title change drop a file off the task until the
  // next full reload. (641a7615)
  attachments: true,
  secureFiles: true,
} as const

export const PUT = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.id' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params

    await requireTaskAccess(auth.userId, taskId)

    const body: V1TaskUpdateRequest = await req.json()

    // Types only — membership, cycles and list access are validated by the
    // service against data this cannot see. Without it a wrong-typed scalar
    // went straight into `data` and surfaced as a 500 from the driver where the
    // caller deserved a 400. (Task 87e19910.)
    const shape = validateV1TaskUpdate(body)
    if (!shape.ok) {
      return NextResponse.json({ error: shape.error }, { status: 400 })
    }

    // Subtasks: re-parent or promote to top-level (null). Validates existence,
    // self-parenting and cycles. Parsing is shared with the web route so the
    // two cannot disagree about what "no parent" looks like (task b00a1f94).
    const parentUpdate = readParentTaskIdFromBody(body)
    if (!parentUpdate.skip && parentUpdate.parentTaskId !== null) {
      const parentError = await validateParentTask(parentUpdate.parentTaskId, taskId)
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 })
      }
    }

    // PATCH semantics: only what the caller sent is touched. Contrast the web
    // route, whose PUT clears an absent due date.
    const intent: UpdateTaskIntent = {}
    if (body.title !== undefined) intent.title = body.title
    if (body.description !== undefined) intent.description = body.description
    if (body.priority !== undefined) intent.priority = body.priority
    if (body.completed !== undefined) intent.completed = body.completed
    if (body.completedAt !== undefined) intent.completedAt = body.completedAt
    if (body.completedSource !== undefined) intent.completedSource = body.completedSource
    if (body.closedReason !== undefined) intent.closedReason = body.closedReason
    if (body.localCompletionDate !== undefined) {
      intent.localCompletionDate = body.localCompletionDate
    }
    if (body.statusRole !== undefined) intent.statusRole = body.statusRole
    if (body.isPrivate !== undefined) intent.isPrivate = body.isPrivate
    if (body.repeating !== undefined) intent.repeating = body.repeating
    if (body.repeatingData !== undefined) intent.repeatingData = body.repeatingData
    if (body.repeatFrom !== undefined) intent.repeatFrom = body.repeatFrom
    if (body.assigneeId !== undefined) intent.assigneeId = body.assigneeId || null
    if (body.timerDuration !== undefined) intent.timerDuration = body.timerDuration
    if (body.lastTimerValue !== undefined) intent.lastTimerValue = body.lastTimerValue
    if (body.listIds !== undefined && Array.isArray(body.listIds)) intent.listIds = body.listIds
    if (!parentUpdate.skip) intent.parentTaskId = parentUpdate.parentTaskId

    // An empty string clears the date, and clearing a date clears all-day with
    // it — an all-day flag on no date means nothing.
    if (body.dueDateTime !== undefined) {
      if (body.dueDateTime === '' || body.dueDateTime === null) {
        intent.dueDateTime = null
        intent.isAllDay = false
      } else {
        const dueDateTime = new Date(body.dueDateTime)
        const isAllDay = body.isAllDay ?? false
        if (isAllDay) dueDateTime.setUTCHours(0, 0, 0, 0)
        intent.dueDateTime = dueDateTime
        intent.isAllDay = isAllDay
      }
    } else if (body.isAllDay !== undefined) {
      intent.isAllDay = body.isAllDay
    }

    const ifUnmodifiedSinceHeader = req.headers.get('If-Unmodified-Since')
    const ifUnmodifiedSince = ifUnmodifiedSinceHeader ? new Date(ifUnmodifiedSinceHeader) : null

    const result = await updateTaskWithSideEffects({
      taskId,
      actorId: auth.userId,
      actorName: auth.user?.name || auth.user?.email || 'Someone',
      actorType: auth.isAIAgent ? 'agent' : 'user',
      platform: detectPlatform(req),
      intent,
      include: V1_TASK_RESPONSE_INCLUDE as never,
      requireAssigneeListMembership: true,
      ifUnmodifiedSince:
        ifUnmodifiedSince && !isNaN(ifUnmodifiedSince.getTime()) ? ifUnmodifiedSince : null,
      cancelWorkflowReason: 'Task marked as completed by user',
    })

    if (!result.ok) {
      if (result.status === 412) {
        return NextResponse.json(
          { error: result.error, code: result.code, task: result.conflict },
          { status: 412 }
        )
      }
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const task = result.task
    // Wire order stays ascending under the newest-first cap (task a86b5bed).
    task.comments?.reverse()

    // Prepended AFTER the reverse, so the client renders it without a refetch
    // in the position v1 has always put it.
    if (result.stateChangeComment && Array.isArray(task.comments)) {
      task.comments = [result.stateChangeComment, ...task.comments]
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        task: { ...task, listIds: task.lists?.map((list: { id: string }) => list.id) || [] },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * DELETE /api/v1/tasks/:id
 * Delete a task
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['tasks:delete'], tag: 'v1.tasks.id' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params

    await requireTaskAccess(auth.userId, taskId)

    // Best-effort sync bookkeeping — must never block the delete itself.
    try { await mirrorExternalDeletesForTask(taskId) } catch { /* tombstoning is belt-and-braces */ }

    // One implementation of the delete verb (epic 9dedd8aa): audience captured
    // before the relations go, tombstone, manual-sort sync, cache
    // invalidation, SSE. Two of the four surfaces skipped the tombstone, so a
    // task deleted over MCP stayed on delta-syncing clients forever.
    await deleteTaskWithSideEffects({
      taskId,
      actorId: auth.userId,
      actorName: auth.user?.name || auth.user?.email || undefined,
    })

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_DELETED, { taskId })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Task deleted successfully',
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)
