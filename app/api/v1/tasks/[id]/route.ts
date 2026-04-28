/**
 * Individual Task API v1
 *
 * GET /api/v1/tasks/:id - Get task details
 * PUT /api/v1/tasks/:id - Update task
 * DELETE /api/v1/tasks/:id - Delete task
 */

import { NextResponse } from 'next/server'
import { requireTaskAccess, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { hasListAccess, getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { broadcastToUsers } from '@/lib/sse-utils'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.id')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/tasks/:id
 * Get detailed task information
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.id' },
  async (_req, auth, { params }) => {
    const { id: taskId } = await params

    // requireTaskAccess throws ForbiddenError → withAuth catches → 403
    await requireTaskAccess(auth.userId, taskId)

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
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
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

    const body = await req.json()

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

    // assigneeId can be null to unassign
    if (body.assigneeId !== undefined) {
      data.assigneeId = body.assigneeId || null
    }

    if (body.timerDuration !== undefined) data.timerDuration = body.timerDuration
    if (body.lastTimerValue !== undefined) data.lastTimerValue = body.lastTimerValue

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
        const validListIds = lists
          .filter(list => !list.isVirtual)
          .map(list => list.id)

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
          select: { id: true, name: true, color: true },
        },
      },
    })

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
        body.localCompletionDate
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

        for (const list of task.lists) {
          const fullList = await prisma.taskList.findUnique({
            where: { id: list.id },
            include: { listMembers: { select: { userId: true } } },
          })
          if (fullList) {
            userIds.add(fullList.ownerId)
            fullList.listMembers.forEach(m => userIds.add(m.userId))
          }
        }
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
          for (const list of task.lists) {
            const fullList = await prisma.taskList.findUnique({
              where: { id: list.id },
              include: { listMembers: { select: { userId: true } } },
            })
            if (fullList) {
              affectedUserIds.add(fullList.ownerId)
              fullList.listMembers.forEach(m => affectedUserIds.add(m.userId))
            }
          }
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

    const task = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        lists: {
          select: {
            id: true,
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

    // System comment for state changes (assignee/priority/etc.)
    try {
      const { detectTaskStateChanges, formatStateChangesAsComment } = await import('@/lib/task-state-change-tracker')

      if (!existingTask) {
        log.warn('Cannot track state changes - existing task not found')
      } else {
        const updater = await prisma.user.findUnique({
          where: { id: auth.userId },
          select: { name: true, email: true }
        })
        const updaterName = updater?.name || updater?.email || 'Someone'

        const stateChanges = detectTaskStateChanges(existingTask, task, updaterName)

        if (stateChanges.length > 0) {
          const commentContent = formatStateChangesAsComment(stateChanges, updaterName)

          // authorId: null marks the comment as system-generated
          await prisma.comment.create({
            data: {
              taskId: task.id,
              authorId: null,
              content: commentContent,
              type: 'TEXT',
            },
          })

          log.debug({ taskId: task.id, comment: commentContent }, 'Created state change comment')
        }
      }
    } catch (stateChangeError) {
      log.error({ err: stateChangeError }, 'Failed to create state change comment')
    }

    // AI agent workflow triggering happens in Prisma middleware: it posts the
    // "starting" comment, sends webhooks, and triggers assistant workflow.

    try {
      const userIds = new Set<string>()

      for (const list of task.lists) {
        const fullList = await prisma.taskList.findUnique({
          where: { id: list.id },
          include: { listMembers: { select: { userId: true } } },
        })
        if (fullList) {
          userIds.add(fullList.ownerId)
          fullList.listMembers.forEach(m => userIds.add(m.userId))
        }
      }

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
        for (const list of task.lists) {
          const fullList = await prisma.taskList.findUnique({
            where: { id: list.id },
            include: { listMembers: { select: { userId: true } } },
          })
          if (fullList) {
            affectedUserIds.add(fullList.ownerId)
            fullList.listMembers.forEach(m => affectedUserIds.add(m.userId))
          }
        }
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
        lists: { select: { id: true, name: true } },
      },
    })

    const recipientIds = new Set<string>()
    if (task) {
      for (const list of task.lists) {
        const memberIds = await getListMemberIds(
          await prisma.taskList.findUnique({
            where: { id: list.id },
            include: {
              owner: { select: { id: true, name: true, email: true, image: true } },
              listMembers: {
                include: { user: { select: { id: true, name: true, email: true, image: true } } },
              },
            },
          }) as any
        )
        memberIds.forEach((id: string) => recipientIds.add(id))
      }
      if (task.assigneeId) recipientIds.add(task.assigneeId)
      if (task.creatorId) recipientIds.add(task.creatorId)
      recipientIds.delete(auth.userId)
    }

    await prisma.task.delete({ where: { id: taskId } })

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
