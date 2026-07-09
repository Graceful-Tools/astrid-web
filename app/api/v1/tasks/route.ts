/**
 * Tasks API v1
 *
 * RESTful endpoint for task operations
 * GET /api/v1/tasks - List tasks
 * POST /api/v1/tasks - Create task
 */

import { type NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getDeprecationWarning, type AuthContext } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds, hasListAccess } from '@/lib/list-member-utils'
import { validateParentTask } from '@/lib/subtasks'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { normalizeProjectStatusListIds } from '@/lib/project-status'
import { recordTaskCreationComment } from '@/lib/task-update-handler'

const log = createLogger('v1.tasks')

/**
 * GET /api/v1/tasks
 * List tasks with optional filters
 *
 * Query parameters:
 * - listId: Filter by list ID
 * - completed: true/false
 * - priority: 0-2
 * - assigneeId: Filter by assignee
 * - limit: Max results (default: 100)
 * - offset: Pagination offset (default: 0)
 * - includeComments: true/false (default: false)
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.tasks' },
  async (req, auth) => {
    const url = new URL(req.url)
    const listId = url.searchParams.get('listId')
    // Only apply completed filter if explicitly provided
    const completedParam = url.searchParams.get('completed')
    const completed = completedParam !== null ? completedParam === 'true' : undefined
    const priority = url.searchParams.get('priority')
    const assigneeId = url.searchParams.get('assigneeId')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const includeComments = url.searchParams.get('includeComments') === 'true'
    // Lean mode: omit per-task embedded listMembers (clients resolve membership
    // from the lists endpoint). Big payload win — the same members were
    // duplicated across every task sharing a list. Backward-compatible: absent
    // param → full members as before.
    const leanListMembers = url.searchParams.get('leanListMembers') === '1'

    const where: any = {}

    if (listId) {
      // Filtering by a specific list returns ONLY that list's tasks; caller
      // must have access to the list (owner, member, or public).
      where.lists = {
        some: {
          id: listId,
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
            { privacy: 'PUBLIC' },
          ],
        },
      }
    } else {
      // No listId: surface every task the caller can see
      where.OR = [
        { creatorId: auth.userId },
        { assigneeId: auth.userId },
        {
          lists: {
            some: {
              OR: [
                { ownerId: auth.userId },
                { listMembers: { some: { userId: auth.userId } } },
                { privacy: 'PUBLIC' },
              ],
            },
          },
        },
      ]
    }

    if (completed !== undefined) {
      where.completed = completed
    }
    if (priority) {
      where.priority = parseInt(priority)
    }
    if (assigneeId) {
      where.assigneeId = assigneeId
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          assigneeId: true,
          creatorId: true,
          dueDateTime: true,
          isAllDay: true,
          reminderTime: true,
          reminderSent: true,
          reminderType: true,
          repeating: true,
          repeatingData: true,
          repeatFrom: true,
          occurrenceCount: true,
          priority: true,
          isPrivate: true,
          completed: true,
          completedAt: true,
          completedSource: true,
          createdAt: true,
          updatedAt: true,
          originalTaskId: true,
          sourceListId: true,
          clientRequestId: true,
          parentTaskId: true,
          lists: {
            select: {
              id: true,
              name: true,
              color: true,
              githubRepositoryId: true,
              ...(leanListMembers ? {} : {
                listMembers: {
                  select: {
                    id: true,
                    listId: true,
                    userId: true,
                    role: true,
                  }
                },
              }),
            },
          },
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              isAIAgent: true,
            },
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              isAIAgent: true,
            },
          },
          ...(includeComments && {
            comments: {
              select: {
                id: true,
                content: true,
                createdAt: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                    isAIAgent: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
              // Bound the fetch — previously unbounded, so a task with hundreds
              // of comments bloated the collection payload × every task.
              take: 20,
            },
          }),
        },
        orderBy: [
          { completed: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.task.count({ where }),
    ])

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // iOS expects a flat listIds array alongside the relation
    const tasksWithListIds = tasks.map(task => ({
      ...task,
      listIds: task.lists?.map(list => list.id) || []
    }))

    return NextResponse.json(
      {
        tasks: tasksWithListIds,
        meta: {
          total,
          limit,
          offset,
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/tasks
 * Create a new task
 *
 * Body:
 * {
 *   title: string (required)
 *   description?: string
 *   listIds?: string[]
 *   priority?: number (0-2)
 *   assigneeId?: string
 *   dueDateTime?: ISO datetime string
 *   isAllDay?: boolean
 *   isPrivate?: boolean
 *   repeating?: string
 *   clientRequestId?: string (8-128 chars; idempotency key)
 * }
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.tasks' },
  async (req, auth) => {
    const body = await req.json()

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'title is required and must be a string' },
        { status: 400 }
      )
    }

    let dueDateTime: Date | undefined
    let isAllDay = false

    if (body.dueDateTime) {
      dueDateTime = new Date(body.dueDateTime)
      isAllDay = body.isAllDay ?? false

      if (isAllDay) {
        dueDateTime.setUTCHours(0, 0, 0, 0)
      }
    } else if (body.when) {
      // Legacy clients still send `when`; normalize to all-day midnight UTC
      dueDateTime = new Date(body.when)
      dueDateTime.setUTCHours(0, 0, 0, 0)
      isAllDay = true
    }

    // SECURITY: Validate user has access to all specified lists
    let validatedListIds: string[] = []
    if (body.listIds?.length) {
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
            { error: `You don't have permission to create tasks in list: ${list.name}` },
            { status: 403 }
          )
        }
      }

      // The assignee (if not the creator) must be a member/owner of one of the
      // task's lists — otherwise arbitrary users could be assigned tasks.
      if (body.assigneeId && body.assigneeId !== auth.userId
          && !lists.some(l => hasListAccess(l as any, body.assigneeId))) {
        return NextResponse.json(
          { error: 'Assignee must be a member of one of the task lists' },
          { status: 400 }
        )
      }

      // Virtual lists are saved-filter views, not real containers
      validatedListIds = lists
        .filter(list => !list.isVirtual)
        .map(list => list.id)

      // Enforce the project-status board invariants: at most one status
      // list per project, and never two completing statuses. Mirrors the
      // call in /api/tasks (legacy). See docs/product/project-status-board.md.
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
        const normalized = normalizeProjectStatusListIds(
          validatedListIds,
          [...lists, ...projectStatusLists] as any,
          { completed: false },
        )
        validatedListIds = normalized.listIds
      }
    }

    // Reused for idempotency hits and the actual create
    const taskInclude = {
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          ownerId: true,
          description: true,
          listMembers: {
            select: {
              id: true,
              listId: true,
              userId: true,
              role: true,
            }
          }
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
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          isAIAgent: true,
        },
      },
      comments: true,
      attachments: true,
    } as const

    // ── Subtasks: validate parentTaskId if provided ────────────────────
    const rawParentTaskId = typeof body.parentTaskId === 'string' && body.parentTaskId ? body.parentTaskId : null
    if (rawParentTaskId) {
      const parentError = await validateParentTask(rawParentTaskId)
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 })
      }
    }

    // ── Idempotency: clientRequestId-based (preferred) ─────────────────
    const rawClientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : null
    if (rawClientRequestId !== null) {
      if (rawClientRequestId.length < 8 || rawClientRequestId.length > 128) {
        return NextResponse.json(
          { error: 'clientRequestId must be between 8 and 128 characters' },
          { status: 400 }
        )
      }

      // Optimistic lookup — fast path when retried after a successful create
      const existing = await prisma.task.findUnique({
        where: { clientRequestId: rawClientRequestId },
        include: taskInclude,
      })
      if (existing) {
        log.info({ taskId: existing.id }, 'Idempotency hit (clientRequestId): returning existing task')
        const headers: Record<string, string> = {}
        const deprecationWarning = getDeprecationWarning(auth)
        if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning
        return NextResponse.json(
          { task: existing, meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true } },
          { status: 200, headers }
        )
      }

      // Unique constraint on clientRequestId catches concurrent retries
      try {
        const task = await prisma.task.create({
          data: {
            title: body.title,
            description: body.description || '',
            priority: body.priority ?? 0,
            assigneeId: body.assigneeId,
            creatorId: auth.userId,
            clientRequestId: rawClientRequestId,
            parentTaskId: rawParentTaskId,
            dueDateTime,
            isAllDay,
            isPrivate: body.isPrivate ?? true,
            repeating: body.repeating || 'never',
            completed: false,
            lists: validatedListIds.length
              ? { connect: validatedListIds.map((id: string) => ({ id })) }
              : undefined,
          },
          include: taskInclude,
        })

        return await handleTaskCreated(req, task, auth)
      } catch (err) {
        // P2002 = unique constraint hit, meaning another request won the race
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const raceExisting = await prisma.task.findUnique({
            where: { clientRequestId: rawClientRequestId },
            include: taskInclude,
          })
          if (raceExisting && raceExisting.creatorId === auth.userId) {
            log.info({ taskId: raceExisting.id }, 'Idempotency hit (P2002 fallback): returning existing task')
            const headers: Record<string, string> = {}
            const deprecationWarning = getDeprecationWarning(auth)
            if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning
            return NextResponse.json(
              { task: raceExisting, meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true } },
              { status: 200, headers }
            )
          }
          return NextResponse.json(
            { error: 'clientRequestId already used by another request' },
            { status: 409 }
          )
        }
        throw err
      }
    }

    // ── Idempotency: time-based dedup (fallback for clients without clientRequestId) ──
    const recentDuplicate = await prisma.task.findFirst({
      where: {
        title: body.title.trim(),
        creatorId: auth.userId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
        ...(validatedListIds.length > 0
          ? { lists: { some: { id: { in: validatedListIds } } } }
          : {}),
      },
      include: taskInclude,
    })

    if (recentDuplicate) {
      log.info({ taskId: recentDuplicate.id, ageMs: Date.now() - recentDuplicate.createdAt.getTime() }, 'Idempotency hit (time-based): returning existing task')
      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) {
        headers['X-Deprecation-Warning'] = deprecationWarning
      }
      return NextResponse.json(
        {
          task: recentDuplicate,
          meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true },
        },
        { status: 200, headers }
      )
    }

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description || '',
        priority: body.priority ?? 0,
        assigneeId: body.assigneeId,
        creatorId: auth.userId,
        clientRequestId: rawClientRequestId,
        parentTaskId: rawParentTaskId,
        dueDateTime,
        isAllDay,
        isPrivate: body.isPrivate ?? true,
        repeating: body.repeating || 'never',
        completed: false,
        lists: validatedListIds.length
          ? { connect: validatedListIds.map((id: string) => ({ id })) }
          : undefined,
      },
      include: taskInclude,
    })

    return await handleTaskCreated(req, task, auth)
  }
)

/**
 * Shared handler for post-creation: SSE broadcasts, AI agent notification,
 * cache invalidation, analytics, response.
 */
async function handleTaskCreated(req: NextRequest, task: any, auth: AuthContext) {
  // System comment recording the creation (authorId: null), rendered behind the
  // task-detail "Show system" toggle. Only genuine creations reach here — the
  // idempotent duplicate-return branches short-circuit before calling this.
  await recordTaskCreationComment({
    taskId: task.id,
    creatorName: task.creator?.name || task.creator?.email || "Someone",
  })

  if (task.assigneeId && task.assigneeId !== auth.userId) {
    try {
      broadcastToUsers([task.assigneeId], {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task),
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          listId: task.lists?.[0]?.id,
          listName: task.lists?.[0]?.name,
          githubRepositoryId: (task.lists?.[0] as any)?.githubRepositoryId,
          assignerName: task.creator?.name || task.creator?.email || "Someone",
          assignerId: task.creator?.id,
          userId: auth.userId,
          listNames: task.lists?.map((list: any) => list.name) || [],
          comments: task.comments?.map((c: any) => ({
            id: c.id,
            content: c.content,
            authorName: c.author?.name,
            createdAt: c.createdAt
          })) || []
        }
      })
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to send task_assigned SSE notification')
    }
  }

  // Notify all list members other than the creator and assignee
  const taskListIds = task.lists?.map((list: any) => list.id) || []
  if (taskListIds.length > 0) {
    try {
      const userIds = new Set<string>()

      for (const list of task.lists) {
        const memberIds = getListMemberIds(list as any)
        memberIds.forEach((id: string) => userIds.add(id))
      }

      userIds.delete(auth.userId)
      if (task.assigneeId) {
        userIds.delete(task.assigneeId)
      }

      if (userIds.size > 0) {
        broadcastToUsers(Array.from(userIds), {
          type: 'task_created',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            task: enrichTaskForAgent(task),
            taskTitle: task.title,
            taskPriority: task.priority,
            taskDueDateTime: task.dueDateTime,
            creatorName: task.creator?.name || task.creator?.email || "Someone",
            userId: auth.userId,
            listNames: task.lists?.map((list: any) => list.name) || [],
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to send task_created SSE notifications')
    }
  }

  if (task.assigneeId && task.assignee?.isAIAgent) {
    try {
      const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
      await aiAgentWebhookService.notifyTaskAssignment(task.id, task.assigneeId)
    } catch (aiNotificationError) {
      log.error({ err: aiNotificationError }, 'Failed to notify AI agent about task assignment')
    }
  }

  try {
    const redisAvailable = await isRedisAvailable()
    if (redisAvailable) {
      const affectedUserIds = new Set<string>()
      affectedUserIds.add(auth.userId)
      if (task.assigneeId) affectedUserIds.add(task.assigneeId)
      for (const list of (task.lists || [])) {
        const memberIds = getListMemberIds(list as any)
        memberIds.forEach((id: string) => affectedUserIds.add(id))
      }
      await Promise.all(
        Array.from(affectedUserIds).map(userId =>
          RedisCache.del(RedisCache.keys.userTasks(userId))
        )
      )
      log.debug({ users: affectedUserIds.size }, 'Invalidated task cache after creation')
    }
  } catch (cacheError) {
    log.error({ err: cacheError }, 'Failed to invalidate task cache (create)')
  }

  const headers: Record<string, string> = {}
  const deprecationWarning = getDeprecationWarning(auth)
  if (deprecationWarning) {
    headers['X-Deprecation-Warning'] = deprecationWarning
  }

  trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_CREATED, { taskId: task.id })

  return NextResponse.json(
    {
      task,
      meta: { apiVersion: 'v1', authSource: auth.source },
    },
    { status: 201, headers }
  )
}
