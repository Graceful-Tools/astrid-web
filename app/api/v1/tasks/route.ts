/**
 * Tasks API v1
 *
 * RESTful endpoint for task operations
 * GET /api/v1/tasks - List tasks
 * POST /api/v1/tasks - Create task
 */

import { type NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds, hasListAccess } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { RedisCache, isRedisAvailable } from '@/lib/redis'

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
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['tasks:read'])

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

    // Build query
    const where: any = {}

    if (listId) {
      // When filtering by specific list, ONLY return tasks from that list
      // User must have access to the list (owner, member, or public)
      where.lists = {
        some: {
          id: listId,
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
            { privacy: 'PUBLIC' },  // Include tasks from PUBLIC lists
          ],
        },
      }
    } else {
      // When no listId specified, show all tasks user has access to
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

    // Apply additional filters
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
          assigneeId: true,  // Explicitly include foreign key
          creatorId: true,   // Explicitly include foreign key
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
          createdAt: true,
          updatedAt: true,
          originalTaskId: true,
          sourceListId: true,
          clientRequestId: true,
          lists: {
            select: {
              id: true,
              name: true,
              color: true,
              githubRepositoryId: true,
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
              orderBy: {
                createdAt: 'desc',
              },
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

    // Add listIds array for iOS compatibility
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
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      )
    }
    console.error('[API v1] GET /tasks error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

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
 *   dueDateTime?: ISO datetime string (primary field)
 *   dueDateTime?: ISO datetime string
 *   isPrivate?: boolean
 *   repeating?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['tasks:write'])

    const body = await req.json()

    // Validate required fields
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'title is required and must be a string' },
        { status: 400 }
      )
    }

    // Parse datetime with new isAllDay system
    let dueDateTime: Date | undefined
    let isAllDay = false

    if (body.dueDateTime) {
      dueDateTime = new Date(body.dueDateTime)
      isAllDay = body.isAllDay ?? false

      // Normalize all-day tasks to midnight UTC
      if (isAllDay) {
        dueDateTime.setUTCHours(0, 0, 0, 0)
      }
    } else if (body.when) {
      // Legacy support: old clients may still send 'when' field
      dueDateTime = new Date(body.when)
      // Assume all-day if legacy 'when' field is used without dueDateTime
      if (!body.isAllDay) {
        isAllDay = true
      }
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

      // Check if all requested lists exist
      const foundListIds = new Set(lists.map(l => l.id))
      const missingListIds = body.listIds.filter((id: string) => !foundListIds.has(id))
      if (missingListIds.length > 0) {
        return NextResponse.json(
          { error: `Invalid list IDs: ${missingListIds.join(', ')}` },
          { status: 400 }
        )
      }

      // Validate user has permission to create tasks in each list
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

      // Filter out virtual lists - tasks should not be connected to virtual lists
      validatedListIds = lists
        .filter(list => !list.isVirtual)
        .map(list => list.id)
    }

    // Task include shape (reused for idempotency and creation)
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

    // ── Idempotency: clientRequestId-based (preferred) ─────────────────
    const rawClientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : null
    if (rawClientRequestId !== null) {
      if (rawClientRequestId.length < 8 || rawClientRequestId.length > 128) {
        return NextResponse.json(
          { error: 'clientRequestId must be between 8 and 128 characters' },
          { status: 400 }
        )
      }

      // Optimistic check — fast path
      const existing = await prisma.task.findUnique({
        where: { clientRequestId: rawClientRequestId },
        include: taskInclude,
      })
      if (existing) {
        console.log(`[v1 API] Idempotency (clientRequestId): returning existing task ${existing.id}`)
        const headers: Record<string, string> = {}
        const deprecationWarning = getDeprecationWarning(auth)
        if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning
        return NextResponse.json(
          { task: existing, meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true } },
          { status: 200, headers }
        )
      }

      // Try to create with clientRequestId — unique constraint catches races
      try {
        const task = await prisma.task.create({
          data: {
            title: body.title,
            description: body.description || '',
            priority: body.priority ?? 0,
            assigneeId: body.assigneeId,
            creatorId: auth.userId,
            clientRequestId: rawClientRequestId,
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

        // Fall through to SSE broadcast + response below
        return await handleTaskCreated(req, task, auth, validatedListIds)
      } catch (err) {
        // P2002 = unique constraint violation on clientRequestId (race condition)
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const raceExisting = await prisma.task.findUnique({
            where: { clientRequestId: rawClientRequestId },
            include: taskInclude,
          })
          if (raceExisting && raceExisting.creatorId === auth.userId) {
            console.log(`[v1 API] Idempotency (P2002 fallback): returning existing task ${raceExisting.id}`)
            const headers: Record<string, string> = {}
            const deprecationWarning = getDeprecationWarning(auth)
            if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning
            return NextResponse.json(
              { task: raceExisting, meta: { apiVersion: 'v1', authSource: auth.source, idempotent: true } },
              { status: 200, headers }
            )
          }
          // Different creator — treat as a conflict
          return NextResponse.json(
            { error: 'clientRequestId already used by another request' },
            { status: 409 }
          )
        }
        throw err // re-throw other errors
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
      console.log(`[v1 API] Idempotency (time-based): returning existing task ${recentDuplicate.id} (created ${Date.now() - recentDuplicate.createdAt.getTime()}ms ago)`)
      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) {
        headers['X-Deprecation-Warning'] = deprecationWarning
      }
      return NextResponse.json(
        {
          task: recentDuplicate,
          meta: {
            apiVersion: 'v1',
            authSource: auth.source,
            idempotent: true,
          },
        },
        { status: 200, headers }
      )
    }

    // Create task (no clientRequestId, or clientRequestId was null/empty)
    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description || '',
        priority: body.priority ?? 0,
        assigneeId: body.assigneeId,
        creatorId: auth.userId,
        clientRequestId: rawClientRequestId,
        dueDateTime,
        isAllDay,
        isPrivate: body.isPrivate ?? true,
        repeating: body.repeating || 'never',
        completed: false,
        lists: validatedListIds.length
          ? {
              connect: validatedListIds.map((id: string) => ({ id })),
            }
          : undefined,
      },
      include: taskInclude,
    })

    return await handleTaskCreated(req, task, auth, validatedListIds)
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      )
    }
    console.error('[API v1] POST /tasks error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Shared handler for post-creation: SSE broadcasts, AI agent notification, analytics, response.
 */
async function handleTaskCreated(req: NextRequest, task: any, auth: any, validatedListIds: string[]) {
  // Broadcast SSE event to task assignee if different from creator
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
      console.error("[v1 API] Failed to send task_assigned SSE notification:", sseError)
    }
  }

  // Broadcast to all list members
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
      console.error("[v1 API] Failed to send task_created SSE notifications:", sseError)
    }
  }

  // Notify AI agent if task is assigned to an AI agent
  if (task.assigneeId && task.assignee?.isAIAgent) {
    try {
      const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
      await aiAgentWebhookService.notifyTaskAssignment(task.id, task.assigneeId)
    } catch (aiNotificationError) {
      console.error("[v1 API] Failed to notify AI agent about task assignment:", aiNotificationError)
    }
  }

  // Invalidate Redis cache for all affected users
  try {
    const redisAvailable = await isRedisAvailable()
    if (redisAvailable) {
      const affectedUserIds = new Set<string>()
      affectedUserIds.add(auth.userId) // creator
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
      console.log(`🗄️ [API v1] Invalidated task cache for ${affectedUserIds.size} users after creation`)
    }
  } catch (cacheError) {
    console.error('❌ [API v1] Failed to invalidate task cache (create):', cacheError)
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
      meta: {
        apiVersion: 'v1',
        authSource: auth.source,
      },
    },
    { status: 201, headers }
  )
}
