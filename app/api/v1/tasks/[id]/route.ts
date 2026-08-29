/**
 * Individual Task API v1
 *
 * GET /api/v1/tasks/:id - Get task details
 * PUT /api/v1/tasks/:id - Update task
 * DELETE /api/v1/tasks/:id - Delete task
 */

import { NextResponse } from 'next/server'
import { collectListRecipientUserIds } from '@/lib/task-recipients'
import { requireTaskAccess, requireTaskReadAccess, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { assigneeCanBeAssigned } from '@/lib/task-assignee'
import { prisma } from '@/lib/prisma'
import { validateParentTask, readParentTaskIdFromBody } from '@/lib/subtasks'
import { hasListAccess, getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { broadcastToUsers } from '@/lib/sse-utils'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { mirrorExternalDeletesForTask } from '@/lib/sync/mirror-deletes'
import { createLogger } from '@/lib/logger'
import { normalizeProjectStatusListIds, statusListIdsToDetachOnCompletion } from '@/lib/project-status'
import { parseClosedReason } from '@/lib/closed-reason'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { diffTaskEvents, recordTaskEvents } from '@/lib/task-events'
import { recordStateChangeComment } from '@/lib/task-update-handler'
import { notifyTaskUpdate } from '@/lib/notification-store'
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
          orderBy: { createdAt: 'asc' },
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
export const PUT = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.id' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params

    await requireTaskAccess(auth.userId, taskId)

    const body: V1TaskUpdateRequest = await req.json()

    // Types only — membership, cycles and list access are validated further
    // down against data this cannot see. Without it a wrong-typed scalar went
    // straight into `data` and surfaced as a 500 from the driver where the
    // caller deserved a 400. (Task 87e19910.)
    const shape = validateV1TaskUpdate(body)
    if (!shape.ok) {
      return NextResponse.json({ error: shape.error }, { status: 400 })
    }

    const data: any = {}

    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined) data.priority = body.priority
    if (body.completed !== undefined) data.completed = body.completed

    if (body.dueDateTime !== undefined) {
      if (body.dueDateTime === '' || body.dueDateTime === null) {
        data.dueDateTime = null
        data.isAllDay = false
      } else {
        const dueDateTime = new Date(body.dueDateTime)
        const isAllDay = body.isAllDay ?? false

        if (isAllDay) {
          dueDateTime.setUTCHours(0, 0, 0, 0)
        }

        data.dueDateTime = dueDateTime
        data.isAllDay = isAllDay
      }
    }

    // Standalone isAllDay update (no dueDateTime change)
    if (body.isAllDay !== undefined && body.dueDateTime === undefined) {
      data.isAllDay = body.isAllDay
    }

    if (body.isPrivate !== undefined) data.isPrivate = body.isPrivate
    if (body.repeating !== undefined) data.repeating = body.repeating

    if (body.repeatingData !== undefined) {
      data.repeatingData = body.repeatingData === null ? null : body.repeatingData
    }
    if (body.repeatFrom !== undefined) {
      data.repeatFrom = body.repeatFrom
    }

    // assigneeId can be null to unassign (membership validated after the
    // existingTask fetch below, once we know the task's lists).
    if (body.assigneeId !== undefined) {
      data.assigneeId = body.assigneeId || null
    }

    if (body.timerDuration !== undefined) data.timerDuration = body.timerDuration
    if (body.lastTimerValue !== undefined) data.lastTimerValue = body.lastTimerValue

    // Subtasks: re-parent or promote to top-level (null). Validates existence,
    // self-parenting, and cycles. Parsing is shared with the web route so the
    // two cannot disagree about what "no parent" looks like (task b00a1f94).
    const parentUpdate = readParentTaskIdFromBody(body)
    if (!parentUpdate.skip) {
      if (parentUpdate.parentTaskId !== null) {
        const parentError = await validateParentTask(parentUpdate.parentTaskId, taskId)
        if (parentError) {
          return NextResponse.json({ error: parentError }, { status: 400 })
        }
      }
      data.parentTaskId = parentUpdate.parentTaskId
    }

    // SECURITY: validate caller has access to every list before connecting
    if (body.listIds !== undefined && Array.isArray(body.listIds)) {
      if (body.listIds.length > 0) {
        const lists = await prisma.taskList.findMany({
          where: { id: { in: body.listIds } },
          include: {
            owner: { select: { id: true, name: true, email: true, image: true } },
            listMembers: {
              include: {
                user: { select: { id: true, name: true, email: true, image: true } }
              }
            }
          }
        })

        const foundListIds = new Set(lists.map(l => l.id))
        const missingListIds = body.listIds.filter((id: string) => !foundListIds.has(id))
        if (missingListIds.length > 0) {
          return NextResponse.json(
            { error: `Invalid list IDs: ${missingListIds.join(', ')}` },
            { status: 400 }
          )
        }

        for (const list of lists) {
          const userHasAccess = hasListAccess(list as any, auth.userId)
          const isCollaborativePublic = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'

          if (!userHasAccess && !isCollaborativePublic) {
            return NextResponse.json(
              { error: `You don't have permission to add tasks to list: ${list.name}` },
              { status: 403 }
            )
          }
        }

        // Virtual lists are saved-filter views, not real containers
        let validListIds = lists
          .filter(list => !list.isVirtual)
          .map(list => list.id)

        // Enforce project-status-board invariants on the resulting list
        // membership: at most one status list per project; toggling to a
        // completing status flips `completed`. Mirrors /api/tasks/[id].
        const projectIds = lists
          .map(list => list.projectId)
          .filter((id): id is string => Boolean(id))

        if (projectIds.length > 0) {
          const projectStatusLists = await prisma.taskList.findMany({
            where: {
              projectId: { in: Array.from(new Set(projectIds)) },
              listType: 'status',
            },
          })
          const requestedCompleted = typeof data.completed === 'boolean'
            ? data.completed
            : false
          const normalized = normalizeProjectStatusListIds(
            validListIds,
            [...lists, ...projectStatusLists] as any,
            { completed: requestedCompleted },
          )
          validListIds = normalized.listIds
          if (normalized.completedFromStatus !== undefined) {
            data.completed = normalized.completedFromStatus
          }
        }

        data.lists = {
          set: validListIds.map((id: string) => ({ id })),
        }
      } else {
        // Empty array → detach from all lists
        data.lists = { set: [] }
      }
    }

    // Pre-update fetch: needed for assignment-change detection,
    // optimistic-concurrency check, and repeating-task state machine
    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
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
        lists: {
          select: { id: true, name: true, color: true, listType: true },
        },
      },
    })

    // Invariant: completed = true => no status memberships (task db7c6670).
    // The listIds branch above already enforces this via
    // normalizeProjectStatusListIds, but it only runs when the request carries
    // listIds. A completion-only update — PUT { completed: true }, what the
    // checkbox and the API actually send — skipped it and left the task
    // sitting in Ready, writing a new violation every time.
    if (data.completed === true && data.lists === undefined) {
      const detach = statusListIdsToDetachOnCompletion(existingTask?.lists)
      if (detach.length > 0) {
        data.lists = { disconnect: detach.map(id => ({ id })) }
      }
    }

    // SECURITY: a non-self assignee must be a member of one of the task's lists.
    if (data.assigneeId && data.assigneeId !== auth.userId) {
      const listIds = (existingTask?.lists ?? []).map(l => l.id)
      if (!(await assigneeCanBeAssigned(data.assigneeId, listIds))) {
        return NextResponse.json(
          { error: 'Assignee must be a member of one of the task lists' },
          { status: 400 }
        )
      }
    }

    // Optimistic concurrency control (opt-in via If-Unmodified-Since header)
    const ifUnmodifiedSince = req.headers.get('If-Unmodified-Since')
    if (ifUnmodifiedSince && existingTask) {
      const clientDate = new Date(ifUnmodifiedSince)
      if (!isNaN(clientDate.getTime()) && existingTask.updatedAt > clientDate) {
        return NextResponse.json(
          {
            error: 'Task has been modified since your last read',
            code: 'STALE_UPDATE',
            task: { id: existingTask.id, updatedAt: existingTask.updatedAt },
          },
          { status: 412 }
        )
      }
    }

    const { handleRepeatingTaskCompletion, applyRepeatingTaskRollForward } = await import('@/lib/repeating-task-handler')
    let repeatingTaskResult = null

    if (body.completed !== undefined && existingTask) {
      // localCompletionDate (YYYY-MM-DD) is for all-day repeating tasks with COMPLETION_DATE mode
      repeatingTaskResult = await handleRepeatingTaskCompletion(
        taskId,
        existingTask.completed,
        body.completed,
        // null and undefined mean the same thing to the helper (it guards with
        // a truthiness check); the coercion is for the type, not the behaviour.
        body.localCompletionDate ?? undefined
      )
    }

    // Repeating-task roll-forward already updates the row in the DB; we just refetch + return.
    if (repeatingTaskResult?.shouldRollForward || repeatingTaskResult?.shouldTerminate) {
      await applyRepeatingTaskRollForward(taskId, repeatingTaskResult)

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
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
                  isAIAgent: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' as const },
          },
        },
      })

      if (!task) {
        return NextResponse.json(
          { error: 'Task not found after update' },
          { status: 404 }
        )
      }

      log.info({ taskId, rolledForward: repeatingTaskResult.shouldRollForward }, 'Repeating task processed')

      // Repeating-task roll-forward counts as both completion and edit
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_COMPLETED, { taskId })
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_EDITED, { taskId })

      try {
        const userIds = new Set<string>()

        collectListRecipientUserIds(task.lists).forEach(id => userIds.add(id))
        if (task.assigneeId) userIds.add(task.assigneeId)
        if (task.creatorId) userIds.add(task.creatorId)
        userIds.delete(auth.userId)

        if (userIds.size > 0) {
          broadcastToUsers(Array.from(userIds), {
            type: 'task_updated',
            timestamp: new Date().toISOString(),
            data: {
              taskId: task.id,
              task: enrichTaskForAgent(task),
            },
          })
        }
      } catch (sseError) {
        log.error({ err: sseError }, 'Failed to broadcast repeating task SSE')
      }

      try {
        const redisAvailable = await isRedisAvailable()
        if (redisAvailable) {
          const affectedUserIds = new Set<string>()
          if (task.assigneeId) affectedUserIds.add(task.assigneeId)
          if (task.creatorId) affectedUserIds.add(task.creatorId)
          collectListRecipientUserIds(task.lists).forEach(id => affectedUserIds.add(id))
          await Promise.all(
            Array.from(affectedUserIds).map(userId =>
              RedisCache.del(RedisCache.keys.userTasks(userId))
            )
          )
          log.debug({ users: affectedUserIds.size }, 'Invalidated task cache (repeating task)')
        }
      } catch (cacheError) {
        log.error({ err: cacheError }, 'Failed to invalidate task cache (repeating)')
      }

      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) {
        headers['X-Deprecation-Warning'] = deprecationWarning
      }

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

    // Completion stamp + provenance. Sync may backdate completedAt to the
    // provider's real completion time; completedSource records where it
    // happened (astrid | google | github | apple). Uncompleting clears both.
    if (data.completed === true) {
      data.completedAt = body.completedAt ? new Date(body.completedAt) : new Date()
      data.completedSource = typeof body.completedSource === 'string' && body.completedSource
        ? body.completedSource : 'astrid'
    } else if (data.completed === false) {
      data.completedAt = null
      data.completedSource = null
      // Reopening clears the terminal reason — a reopened task is not a
      // canceled one (task 11042ae3).
      data.closedReason = null
    }

    // Board status as a state on the task (AWTD-562), mirroring the web route.
    if (body.statusRole !== undefined) {
      data.statusRole = body.statusRole || null
    }
    // Done carries no status.
    if (data.completed === true) {
      data.statusRole = null
    }

    // Terminal state other than done (task 11042ae3). Same validation as the
    // web route so the two surfaces cannot drift.
    if (body.closedReason !== undefined && data.completed !== false) {
      const parsed = parseClosedReason(body.closedReason)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      data.closedReason = parsed.value
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
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
                isAIAgent: true,
              },
            },
            secureFiles: true,
          },
          orderBy: { createdAt: 'asc' as const },
        },
        // Parity with legacy TASK_FULL_INCLUDE. This response replaces the
        // task in client state after every edit, so omitting these does not
        // render fewer attachments — it makes a title change drop a file off
        // the task until the next full reload. (641a7615)
        attachments: true,
        secureFiles: true,
      },
    })

    // Structured activity history (task 51a4b8ff). Same helper as the web
    // route, so the two surfaces cannot emit different events for the same
    // mutation — the drift that lib/projects-service.ts had to fix for
    // projects. actorType distinguishes agent traffic, which is the whole
    // point: an agent silently reassigning work must leave a trace.
    if (existingTask) {
      const taskAudience = {
        assigneeId: task.assigneeId,
        creatorId: task.creatorId,
        commenterIds: Array.from(
          new Set(
            (task.comments ?? [])
              .filter((comment: { authorId?: string | null } | null | undefined): comment is { authorId: string } =>
                Boolean(comment && comment.authorId)
              )
              .map((comment) => comment.authorId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        ),
      }

      const events = diffTaskEvents(
        {
          title: existingTask.title,
          completed: existingTask.completed,
          closedReason: existingTask.closedReason,
          priority: existingTask.priority,
          assigneeId: existingTask.assigneeId,
          dueDateTime: existingTask.dueDateTime,
          listIds: existingTask.lists.map(list => list.id),
        },
        {
          title: task.title,
          completed: task.completed,
          closedReason: task.closedReason,
          priority: task.priority,
          assigneeId: task.assigneeId,
          dueDateTime: task.dueDateTime,
          listIds: task.lists.map(list => list.id),
        }
      )

      await recordTaskEvents({
        taskId,
        actorId: auth.userId,
        actorType: auth.isAIAgent ? 'agent' : 'user',
        events,
      })

      // One persist for the whole update — per-event persists defeat the
      // row-level dedupe and wrote duplicate rows (task ceaff1c5).
      await notifyTaskUpdate({
        taskId,
        actorId: auth.userId,
        events,
        audience: taskAudience,
      })
    }

    // System comment for state changes (assignee/priority/etc.).
    //
    // Shares legacy's helper rather than re-deriving it here. v1 used to
    // hand-roll this block, and the copy dropped `systemEventType` — the typed
    // discriminator that lib/completion-streak.ts folds on. Without it the fold
    // falls back to matching English prose, which is precisely what that column
    // was added to stop: a comment written by v1 would stop folding the moment
    // the sentence was localised, on every client at once. (Task efecc4b8.)
    //
    // The name comes from `auth.user`, which the wrapper already loaded — the
    // old copy issued a second query for a row it was holding.
    // Wrapped: a system comment is a nice-to-have on top of an update that has
    // already been committed. The inline version this replaced was wrapped too,
    // and dropping that made every unrelated failure in here fail the whole PUT.
    try {
      if (!existingTask) {
        log.warn('Cannot track state changes - existing task not found')
      } else {
        const stateChangeComment = await recordStateChangeComment({
          existingTask,
          updatedTask: task,
          updaterName: auth.user?.name || auth.user?.email || 'Someone',
        })
        // Prepend so the client renders it without a refetch, as legacy does.
        if (stateChangeComment) {
          task.comments = [stateChangeComment as never, ...task.comments]
        }
      }
    } catch (stateChangeError) {
      log.error({ err: stateChangeError }, 'Failed to create state change comment')
    }

    // AI agent workflow triggering happens in Prisma middleware: it posts the
    // "starting" comment, sends webhooks, and triggers assistant workflow.

    try {
      const userIds = new Set<string>()

      collectListRecipientUserIds(task.lists).forEach(id => userIds.add(id))

      if (task.assigneeId) userIds.add(task.assigneeId)
      if (task.creatorId) userIds.add(task.creatorId)

      userIds.delete(auth.userId)

      if (userIds.size > 0) {
        // Assignee change → new assignee gets task_assigned, not task_updated
        const assigneeChanged = existingTask && body.assigneeId !== undefined &&
          body.assigneeId !== existingTask.assigneeId
        if (assigneeChanged && task.assigneeId) {
          broadcastToUsers([task.assigneeId], {
            type: 'task_assigned',
            timestamp: new Date().toISOString(),
            data: {
              taskId: task.id,
              task: enrichTaskForAgent(task),
            }
          })
          userIds.delete(task.assigneeId)
        }

        const eventType = (body.completed === true && existingTask && !existingTask.completed)
          ? 'task_completed'
          : 'task_updated'

        broadcastToUsers(Array.from(userIds), {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            task: enrichTaskForAgent(task),
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to broadcast task update SSE')
    }

    try {
      const completionChanged = existingTask && existingTask.completed !== task.completed
      const assignmentChanged = existingTask && existingTask.assigneeId !== task.assigneeId

      if (completionChanged || assignmentChanged) {
        const { invalidateUserStats } = await import('@/lib/user-stats')
        const statsUserIds = new Set<string>()

        if (task.assigneeId && completionChanged) {
          statsUserIds.add(task.assigneeId)
        }
        if (existingTask.assigneeId && assignmentChanged && existingTask.assigneeId !== task.assigneeId) {
          statsUserIds.add(existingTask.assigneeId)
        }
        if (task.creatorId && completionChanged) {
          statsUserIds.add(task.creatorId)
        }

        if (statsUserIds.size > 0) {
          await invalidateUserStats(Array.from(statsUserIds))
          log.debug({ users: statsUserIds.size }, 'Invalidated user stats')
        }
      }
    } catch (statsError) {
      log.error({ err: statsError }, 'Failed to invalidate user stats')
    }

    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        const affectedUserIds = new Set<string>()
        if (task.assigneeId) affectedUserIds.add(task.assigneeId)
        if (existingTask?.assigneeId && existingTask.assigneeId !== task.assigneeId) {
          affectedUserIds.add(existingTask.assigneeId)
        }
        if (task.creatorId) affectedUserIds.add(task.creatorId)
        collectListRecipientUserIds(task.lists).forEach(id => affectedUserIds.add(id))
        await Promise.all(
          Array.from(affectedUserIds).map(userId =>
            RedisCache.del(RedisCache.keys.userTasks(userId))
          )
        )
        log.debug({ users: affectedUserIds.size }, 'Invalidated task cache after update')
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, 'Failed to invalidate task cache')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    if (body.completed === true && existingTask && !existingTask.completed) {
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_COMPLETED, { taskId })
    }
    trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_EDITED, { taskId })

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
 * DELETE /api/v1/tasks/:id
 * Delete a task
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['tasks:delete'], tag: 'v1.tasks.id' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params

    await requireTaskAccess(auth.userId, taskId)

    // Pre-delete fetch so we can compute SSE recipients (the task is gone after delete)
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: { select: { id: true, name: true, ownerId: true, listMembers: { select: { userId: true } } } },
      },
    })

    const recipientIds = new Set<string>()
    if (task) {
      collectListRecipientUserIds(task.lists).forEach(id => recipientIds.add(id))
      if (task.assigneeId) recipientIds.add(task.assigneeId)
      if (task.creatorId) recipientIds.add(task.creatorId)
      recipientIds.delete(auth.userId)
    }

    // Best-effort sync bookkeeping — must never block the delete itself.
    try { await mirrorExternalDeletesForTask(taskId) } catch { /* tombstoning is belt-and-braces */ }
    // Audience captured from the pre-delete fetch above, and deliberately NOT
    // recipientIds: that set excludes the deleter for SSE, but this user's OTHER
    // devices still need to learn the task is gone (task: delta-sync deletions).
    const deletionAudience = task ? audienceForTask(task) : []
    await prisma.task.delete({ where: { id: taskId } })
    await recordDeletion('task', taskId, deletionAudience)

    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        const cacheUserIds = new Set(recipientIds)
        cacheUserIds.add(auth.userId)
        if (task?.creatorId) cacheUserIds.add(task.creatorId)
        if (task?.assigneeId) cacheUserIds.add(task.assigneeId)

        await Promise.all(
          Array.from(cacheUserIds).map(userId =>
            RedisCache.del(RedisCache.keys.userTasks(userId))
          )
        )
        log.debug({ users: cacheUserIds.size }, 'Invalidated task cache after deletion')
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, 'Failed to invalidate task cache (delete)')
    }

    if (recipientIds.size > 0) {
      try {
        broadcastToUsers(Array.from(recipientIds), {
          type: 'task_deleted',
          timestamp: new Date().toISOString(),
          data: { taskId },
        })
      } catch (sseError) {
        log.error({ err: sseError }, 'Failed to broadcast task_deleted SSE')
      }
    }

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
