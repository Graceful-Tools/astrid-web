/**
 * Individual Task API v1
 *
 * GET /api/v1/tasks/:id - Get task details
 * PUT /api/v1/tasks/:id - Update task
 * DELETE /api/v1/tasks/:id - Delete task
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, requireTaskAccess, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { hasListAccess, getListMemberIds } from '@/lib/list-member-utils'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { broadcastToUsers } from '@/lib/sse-utils'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { RedisCache, isRedisAvailable } from '@/lib/redis'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/v1/tasks/:id
 * Get detailed task information
 */
export async function GET(
  req: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['tasks:read'])

    const { id } = await context.params
    const taskId = id

    // Check access
    await requireTaskAccess(auth.userId, taskId)

    // Fetch task
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
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
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
            secureFiles: {
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
        // SecureFiles attached directly to the task (parity with /api/tasks/[id]).
        // Comment-attached files are also returned via comments.secureFiles above.
        secureFiles: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // Add listIds array for iOS compatibility
    const taskWithListIds = {
      ...task,
      listIds: task.lists?.map(list => list.id) || []
    }

    return NextResponse.json(
      {
        task: taskWithListIds,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] GET /tasks/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/v1/tasks/:id
 * Update task fields
 */
export async function PUT(
  req: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['tasks:write'])

    const { id } = await context.params
    const taskId = id

    // Check access
    await requireTaskAccess(auth.userId, taskId)

    const body = await req.json()

    // Build update data
    const data: any = {}

    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined) data.priority = body.priority
    if (body.completed !== undefined) data.completed = body.completed

    // Handle datetime with new isAllDay system
    if (body.dueDateTime !== undefined) {
      if (body.dueDateTime === '' || body.dueDateTime === null) {
        data.dueDateTime = null
        data.isAllDay = false
      } else {
        const dueDateTime = new Date(body.dueDateTime)
        const isAllDay = body.isAllDay ?? false

        // Normalize all-day tasks to midnight UTC
        if (isAllDay) {
          dueDateTime.setUTCHours(0, 0, 0, 0)
        }

        data.dueDateTime = dueDateTime
        data.isAllDay = isAllDay
      }
    }

    // Handle explicit isAllDay updates (when only changing all-day flag)
    if (body.isAllDay !== undefined && body.dueDateTime === undefined) {
      data.isAllDay = body.isAllDay
    }

    if (body.isPrivate !== undefined) data.isPrivate = body.isPrivate
    if (body.repeating !== undefined) data.repeating = body.repeating

    // Handle repeating task data
    if (body.repeatingData !== undefined) {
      data.repeatingData = body.repeatingData === null ? null : body.repeatingData
    }
    if (body.repeatFrom !== undefined) {
      data.repeatFrom = body.repeatFrom
    }

    // Handle assigneeId (can be null to unassign)
    if (body.assigneeId !== undefined) {
      data.assigneeId = body.assigneeId || null
    }

    // Handle timer fields
    if (body.timerDuration !== undefined) data.timerDuration = body.timerDuration
    if (body.lastTimerValue !== undefined) data.lastTimerValue = body.lastTimerValue

    // Handle list assignment with SECURITY validation
    if (body.listIds !== undefined && Array.isArray(body.listIds)) {
      if (body.listIds.length > 0) {
        // Fetch lists and validate access
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

        // Validate user has permission to add tasks to each list
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

        // Filter out virtual lists
        const validListIds = lists
          .filter(list => !list.isVirtual)
          .map(list => list.id)

        data.lists = {
          set: validListIds.map((id: string) => ({ id })),
        }
      } else {
        // Allow removing task from all lists (empty array)
        data.lists = { set: [] }
      }
    }

    // Fetch existing task to detect assignment changes and repeating task state
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
          select: {
            id: true,
            name: true,
            color: true,
          },
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
            task: {
              id: existingTask.id,
              updatedAt: existingTask.updatedAt,
            },
          },
          { status: 412 }
        )
      }
    }

    // Handle repeating task completion
    const { handleRepeatingTaskCompletion, applyRepeatingTaskRollForward } = await import('@/lib/repeating-task-handler')
    let repeatingTaskResult = null

    if (body.completed !== undefined && existingTask) {
      // Pass localCompletionDate for all-day repeating tasks with COMPLETION_DATE mode
      repeatingTaskResult = await handleRepeatingTaskCompletion(
        taskId,
        existingTask.completed,
        body.completed,
        body.localCompletionDate // YYYY-MM-DD format from client
      )
    }

    // If repeating task should roll forward or terminate, apply the change and return early
    // The roll-forward logic already updates the task in the database
    if (repeatingTaskResult?.shouldRollForward || repeatingTaskResult?.shouldTerminate) {
      await applyRepeatingTaskRollForward(taskId, repeatingTaskResult)

      // Fetch the updated task to return to client
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
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
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

      console.log(`✅ [API v1] Task ${taskId} ${repeatingTaskResult.shouldRollForward ? 'rolled forward to next occurrence' : 'series terminated'}`)

      // Track analytics - task was edited and completed (repeating task roll-forward)
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_COMPLETED, { taskId })
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_EDITED, { taskId })

      // Broadcast SSE event for repeating task roll-forward
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
        console.error('[API v1] Failed to broadcast repeating task SSE:', sseError)
      }

      // Invalidate Redis cache for all affected users (repeating task path)
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
          console.log(`🗄️ [API v1] Invalidated task cache for ${affectedUserIds.size} users (repeating task)`)
        }
      } catch (cacheError) {
        console.error('❌ [API v1] Failed to invalidate task cache (repeating):', cacheError)
      }

      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) {
        headers['X-Deprecation-Warning'] = deprecationWarning
      }

      // Add listIds array for iOS compatibility
      const taskWithListIds = {
        ...task,
        listIds: task.lists?.map(list => list.id) || []
      }

      return NextResponse.json(
        {
          task: taskWithListIds,
          meta: {
            apiVersion: 'v1',
            authSource: auth.source,
          },
        },
        { headers }
      )
    }

    // Update task (only if not a repeating task that was rolled forward)
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
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
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

    // Track state changes and create system comment
    try {
      const { detectTaskStateChanges, formatStateChangesAsComment } = await import('@/lib/task-state-change-tracker')

      // Only track changes if we have the old task state
      if (!existingTask) {
        console.log('⚠️ [API v1] Cannot track state changes - existing task not found')
      } else {
        // Fetch updater's name
        const updater = await prisma.user.findUnique({
          where: { id: auth.userId },
          select: { name: true, email: true }
        })
        const updaterName = updater?.name || updater?.email || 'Someone'

        const stateChanges = detectTaskStateChanges(existingTask, task, updaterName)

      if (stateChanges.length > 0) {
        const commentContent = formatStateChangesAsComment(stateChanges, updaterName)

        // Create system comment (authorId: null indicates system-generated)
        await prisma.comment.create({
          data: {
            taskId: task.id,
            authorId: null, // System-generated comment
            content: commentContent,
            type: 'TEXT',
          },
        })

        console.log(`📝 [API v1] Created state change comment for task ${task.id}: ${commentContent}`)
      }
      }
    } catch (stateChangeError) {
      console.error('❌ [API v1] Failed to create state change comment:', stateChangeError)
      // Don't fail the task update if state change tracking fails
    }

    // AI agent workflow triggering is handled by Prisma middleware
    // The middleware posts the "starting" comment, sends webhooks, and triggers assistant workflow
    // This keeps the API route simple and avoids duplicate processing

    // Broadcast SSE event for real-time updates
    try {
      const userIds = new Set<string>()

      // Add all list members
      for (const list of task.lists) {
        const fullList = await prisma.taskList.findUnique({
          where: { id: list.id },
          include: {
            listMembers: { select: { userId: true } },
          },
        })
        if (fullList) {
          userIds.add(fullList.ownerId)
          fullList.listMembers.forEach(m => userIds.add(m.userId))
        }
      }

      // Add task assignee and creator
      if (task.assigneeId) userIds.add(task.assigneeId)
      if (task.creatorId) userIds.add(task.creatorId)

      // Remove the updater
      userIds.delete(auth.userId)

      if (userIds.size > 0) {
        // Detect assignee change → send task_assigned to new assignee
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
          // Don't also send task_updated to the new assignee
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
      console.error('[API v1] Failed to broadcast task update SSE:', sseError)
    }

    // Invalidate user stats if completion status or assignment changed
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
          console.log(`📊 [API v1] Invalidated user stats for ${statsUserIds.size} users`)
        }
      }
    } catch (statsError) {
      console.error('❌ [API v1] Failed to invalidate user stats:', statsError)
    }

    // Invalidate Redis cache for all affected users
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
        console.log(`🗄️ [API v1] Invalidated task cache for ${affectedUserIds.size} users after update`)
      }
    } catch (cacheError) {
      console.error('❌ [API v1] Failed to invalidate task cache:', cacheError)
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // Track analytics - check if task was completed
    if (body.completed === true && existingTask && !existingTask.completed) {
      trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_COMPLETED, { taskId })
    }
    trackEventFromRequest(req, auth.userId, AnalyticsEventType.TASK_EDITED, { taskId })

    // Add listIds array for iOS compatibility
    const taskWithListIds = {
      ...task,
      listIds: task.lists?.map(list => list.id) || []
    }

    return NextResponse.json(
      {
        task: taskWithListIds,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] PUT /tasks/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/tasks/:id
 * Delete a task
 */
export async function DELETE(
  req: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['tasks:delete'])

    const { id } = await context.params
    const taskId = id

    // Check access
    await requireTaskAccess(auth.userId, taskId)

    // Fetch task with associations before deletion for SSE broadcast
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    // Compute recipients before deletion
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

    // Delete task
    await prisma.task.delete({
      where: { id: taskId },
    })

    // Invalidate Redis cache for all affected users
    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        const cacheUserIds = new Set(recipientIds)
        // Also invalidate for the deleting user
        cacheUserIds.add(auth.userId)
        if (task?.creatorId) cacheUserIds.add(task.creatorId)
        if (task?.assigneeId) cacheUserIds.add(task.assigneeId)

        await Promise.all(
          Array.from(cacheUserIds).map(userId =>
            RedisCache.del(RedisCache.keys.userTasks(userId))
          )
        )
        console.log(`🗄️ [API v1] Invalidated task cache for ${cacheUserIds.size} users after deletion`)
      }
    } catch (cacheError) {
      console.error('❌ [API v1] Failed to invalidate task cache (delete):', cacheError)
    }

    // Broadcast task_deleted to all relevant users
    if (recipientIds.size > 0) {
      try {
        broadcastToUsers(Array.from(recipientIds), {
          type: 'task_deleted',
          timestamp: new Date().toISOString(),
          data: {
            taskId,
          },
        })
      } catch (sseError) {
        console.error('[API v1] Failed to broadcast task_deleted SSE:', sseError)
      }
    }

    // Track analytics
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
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] DELETE /tasks/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
