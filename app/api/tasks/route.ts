import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { CreateTaskData } from "@/types/api"
import { broadcastToUsers } from "@/lib/sse-utils"
import { getListMemberIds, hasListAccess } from "@/lib/list-member-utils"
import { RedisCache, isRedisAvailable } from "@/lib/redis"
import { aiAgentWebhookService } from "@/lib/ai-agent-webhook-service"
import { enrichTaskForAgent } from "@/lib/agent-protocol"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { logError } from "@/lib/logging/error-sanitizer"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import {
  computeAutomaticReminders,
  scheduleReminders,
  type ReminderScheduleEntry,
} from "@/lib/reminder-scheduling"
import { createLogger } from '@/lib/logger'
import { normalizeProjectStatusListIds } from '@/lib/project-status'
import { getUnifiedSession } from "@/lib/session-utils"
import { recordTaskCreationComment } from "@/lib/task-update-handler"

const log = createLogger('api.tasks')


// Only select the user fields needed for display (excludes sensitive data like passwords, API keys)
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
} as const

export async function GET(request: NextRequest) {
  let userId: string | undefined
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    userId = session.user.id

    // Check for incremental sync parameter
    const { searchParams } = new URL(request.url)
    const updatedSince = searchParams.get('updatedSince')

    // Build base where clause
    const baseWhere: Prisma.TaskWhereInput = {
      OR: [
        { assigneeId: session.user.id },
        { creatorId: session.user.id },
        {
          lists: {
            some: {
              OR: [
                { ownerId: session.user.id },
                { listMembers: { some: { userId: session.user.id } } },
                { privacy: 'PUBLIC' } // Include tasks from public lists
              ],
            },
          },
        },
      ],
    }

    // Add incremental filter if provided
    const where: Prisma.TaskWhereInput = updatedSince
      ? { ...baseWhere, updatedAt: { gt: new Date(updatedSince) } }
      : baseWhere

    // Use Redis cache only for full syncs (not incremental)
    let tasks
    if (!updatedSince) {
      // Full sync - use cache
      const cacheKey = RedisCache.keys.userTasks(session.user.id)
      tasks = await RedisCache.getOrSet(
        cacheKey,
        async () => {
          log.info(`🔄 Cache miss for user tasks: ${session.user.id}`)
          return await prisma.task.findMany({
            where,
            include: {
              assignee: { select: safeUserSelect },
              creator: { select: safeUserSelect },
              lists: {
                include: {
                  owner: { select: safeUserSelect },
                  listMembers: {
                    include: {
                      user: { select: safeUserSelect }
                    }
                  }
                }
              },
              // Don't load comments in list view - loaded on-demand in task detail
              // This significantly reduces payload for users with many tasks
              _count: {
                select: { comments: true }
              },
              attachments: true,
            },
            orderBy: [
              { completed: "asc" },
              { priority: "desc" },
              { dueDateTime: "asc" },
            ],
          })
        },
        120 // 2 minutes TTL for frequently changing data
      )
    } else {
      // Incremental sync - skip cache, fetch directly
      log.info(`📥 Incremental sync for user ${session.user.id} since ${updatedSince}`)
      tasks = await prisma.task.findMany({
        where,
        include: {
          assignee: { select: safeUserSelect },
          creator: { select: safeUserSelect },
          lists: {
            include: {
              owner: { select: safeUserSelect },
              listMembers: {
                include: {
                  user: { select: safeUserSelect }
                }
              }
            }
          },
          // Don't load comments in list view - loaded on-demand in task detail
          _count: {
            select: { comments: true }
          },
          attachments: true,
        },
        orderBy: [
          { completed: "asc" },
          { priority: "desc" },
          { dueDateTime: "asc" },
        ],
      })
      log.info(`✅ Incremental sync returned ${tasks.length} updated tasks`)
    }

    // Return response with timestamp for next incremental sync
    const response = {
      tasks,
      timestamp: new Date().toISOString(),
      isIncremental: !!updatedSince,
      count: tasks.length
    }

    return NextResponse.json(response)
  } catch (error) {
    logError(`tasks-api/GET user=${userId || 'unknown'}`, error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Verify user exists in database
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      log.error({ userId: session.user.id }, "User not found in database")
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const data: CreateTaskData & { testUserEmail?: string } = await request.json()

    // Validate required fields
    if (!data.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    // Handle test user email for debugging (override assigneeId)
    let testUserId: string | null = null
    if (data.testUserEmail) {
      const testUser = await prisma.user.findUnique({
        where: { email: data.testUserEmail },
        select: { id: true }
      })

      if (testUser) {
        testUserId = testUser.id
        log.info(`🧪 Debug: Creating task for test user ${data.testUserEmail} (${testUserId})`)
      } else {
        return NextResponse.json({ error: `Test user not found: ${data.testUserEmail}` }, { status: 404 })
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
        log.info(`📧 Task assigned to email: ${data.assigneeEmail} (${emailAssigneeId})`)
      } catch (error) {
        log.error({ err: error }, 'Error creating placeholder user:')
        return NextResponse.json(
          { error: 'Failed to create placeholder user' },
          { status: 500 }
        )
      }
    }

    // Use the provided assigneeId (already processed by client-side defaults system)
    // Priority: emailAssigneeId > assigneeId (email takes precedence)
    const assigneeId = emailAssigneeId || data.assigneeId

    // Validate listIds exist if provided and filter out virtual lists
    let nonVirtualListIds: string[] = []
    let hasPublicList = false
    if (data.listIds && data.listIds.length > 0) {
      const existingLists = await prisma.taskList.findMany({
        where: { id: { in: data.listIds } },
        include: {
          owner: true,
          listMembers: {
            include: {
              user: true
            }
          }
        }
      })

      const missingListIds = data.listIds.filter(id => !existingLists?.some(list => list.id === id))
      if (missingListIds.length > 0) {
        log.error({ err: missingListIds }, "Invalid list IDs:")
        return NextResponse.json({ error: `Invalid list IDs: ${missingListIds.join(', ')}` }, { status: 400 })
      }

      // Validate user has permission to create tasks in these lists
      for (const list of existingLists) {
        log.info(
          { listId: list.id, userId: session.user.id, hasOwner: !!list.owner, memberCount: list.listMembers?.length || 0 },
          '🔍 Debug: Checking access for list'
        )

        const hasAccess = hasListAccess(list as any, session.user.id)
        const isCollaborativePublic = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'

        log.info({ hasAccess, isCollaborativePublic }, '🔍 Debug: access check result')

        if (!hasAccess && !isCollaborativePublic) {
          log.error(`User ${session.user.id} does not have permission to create tasks in list ${list.id}`)
          return NextResponse.json({
            error: `You don't have permission to create tasks in this list`
          }, { status: 403 })
        }
      }

      // Check if any list is PUBLIC (copy-only, not collaborative)
      // Copy-only public lists require unassigned tasks for security
      hasPublicList = existingLists.some(list =>
        list.privacy === 'PUBLIC' && list.publicListType !== 'collaborative'
      )

      // Filter out virtual lists - tasks should not be connected to virtual lists
      nonVirtualListIds = existingLists
        .filter(list => !list.isVirtual)
        .map(list => list.id)

      const projectIds = existingLists
        .map(list => list.projectId)
        .filter((id): id is string => Boolean(id))

      if (projectIds.length > 0) {
        const projectStatusLists = await prisma.taskList.findMany({
          where: {
            projectId: { in: Array.from(new Set(projectIds)) },
            listType: "status",
          },
        })
        const normalized = normalizeProjectStatusListIds(
          nonVirtualListIds,
          [...existingLists, ...projectStatusLists] as any,
          { completed: false }
        )
        nonVirtualListIds = normalized.listIds
        if (normalized.completedFromStatus !== undefined) {
          ;(data as any).completed = normalized.completedFromStatus
        }
      }
    }

    // Determine final assignee
    // Client-side defaults may have already applied, but we need to handle:
    // 1. Direct API calls (non-client requests)
    // 2. MCP requests
    // 3. Special cases (PUBLIC lists, test users)
    let finalAssigneeId: string | null

    // Copy-only PUBLIC lists MUST have unassigned tasks (security requirement)
    // Collaborative public lists can have assignees since only members can add tasks
    if (hasPublicList) {
      log.info(`📢 Task being created in copy-only PUBLIC list - forcing unassigned`)
      finalAssigneeId = null
    }
    // Override for test user debugging
    else if (testUserId) {
      finalAssigneeId = testUserId
    }
    // If assigneeId provided, use it (could be null for unassigned, or a user ID)
    else if (assigneeId !== undefined) {
      finalAssigneeId = assigneeId
    }
    // Fallback: apply first list's default assignee (for MCP/API clients)
    else if (nonVirtualListIds.length > 0) {
      const firstList = await prisma.taskList.findUnique({
        where: { id: nonVirtualListIds[0] },
        select: { defaultAssigneeId: true }
      })

      // Apply list's default assignee logic:
      // - undefined (not set) = leave unassigned
      // - null = task creator
      // - "unassigned" = explicitly unassigned (null)
      // - user ID = specific user
      if (firstList?.defaultAssigneeId === undefined) {
        finalAssigneeId = null
      } else if (firstList.defaultAssigneeId === null) {
        finalAssigneeId = session.user.id
      } else if (firstList.defaultAssigneeId === 'unassigned') {
        finalAssigneeId = null
      } else {
        finalAssigneeId = firstList.defaultAssigneeId
      }
    }
    // No assignee and no lists - leave unassigned
    else {
      finalAssigneeId = null
    }

    // Validate assignee exists if one is specified (null is valid for unassigned tasks)
    if (finalAssigneeId) {
      const assigneeExists = await prisma.user.findUnique({
        where: { id: finalAssigneeId },
        select: { id: true }
      })
      
      if (!assigneeExists) {
        log.error({ err: finalAssigneeId }, "Invalid assignee ID:")
        return NextResponse.json({ error: `Invalid assignee ID: ${finalAssigneeId}` }, { status: 400 })
      }
    }

    log.info({
      title: data.title.trim(),
      assigneeId: finalAssigneeId,
      creatorId: session.user.id,
      listIds: nonVirtualListIds, // Only non-virtual lists
      originalListIds: data.listIds || [], // Original list IDs for reference
      repeating: data.repeating,
      customRepeatingData: data.customRepeatingData
    }, "Creating task with data:")

    // Sanitize customRepeatingData - ensure it's proper JSON or null
    let sanitizedRepeatingData = data.customRepeatingData
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

    // Handle the "when" field - convert "none" to null, parse dates properly (legacy field)
    let whenValue: Date | null = null
    if (data.when) {
      if (typeof data.when === "string") {
        if (data.when === "none") {
          whenValue = null
        } else {
          whenValue = new Date(data.when)
          // Check if the date is valid
          if (isNaN(whenValue.getTime())) {
            log.error({ when: data.when }, "Invalid date format")
            return NextResponse.json({ error: `Invalid date format: ${data.when}` }, { status: 400 })
          }
        }
      } else if (data.when instanceof Date) {
        whenValue = data.when
      }
    }

    // Handle the new dueDateTime field with full date and time support
    let dueDateTimeValue: Date | null = null
    if (data.dueDateTime) {
      if (typeof data.dueDateTime === "string") {
        dueDateTimeValue = new Date(data.dueDateTime)
        if (isNaN(dueDateTimeValue.getTime())) {
          log.error({ dueDateTime: data.dueDateTime }, "Invalid dueDateTime format")
          return NextResponse.json({ error: `Invalid dueDateTime format: ${data.dueDateTime}` }, { status: 400 })
        }
      } else if (data.dueDateTime instanceof Date) {
        dueDateTimeValue = data.dueDateTime
      }
    }

    // Handle reminder time
    let reminderTimeValue: Date | null = null
    if (data.reminderTime) {
      if (typeof data.reminderTime === "string") {
        reminderTimeValue = new Date(data.reminderTime)
        if (isNaN(reminderTimeValue.getTime())) {
          log.error({ reminderTime: data.reminderTime }, "Invalid reminderTime format")
          return NextResponse.json({ error: `Invalid reminderTime format: ${data.reminderTime}` }, { status: 400 })
        }
      } else if (data.reminderTime instanceof Date) {
        reminderTimeValue = data.reminderTime
      }
    }

    // Use dueDateTime as the single source of truth
    const finalDueDateTime = dueDateTimeValue || whenValue
    const finalIsAllDay = data.isAllDay ?? (whenValue !== null && dueDateTimeValue === null)

    // Task include shape (reused for idempotency and creation)
    const taskFullInclude = {
      assignee: true,
      creator: true,
      lists: {
        include: {
          owner: true,
          listMembers: {
            include: {
              user: true
            }
          }
        }
      },
      comments: {
        include: {
          author: true,
        },
      },
      attachments: true,
    } as const

    // ── Idempotency: clientRequestId-based (preferred) ─────────────────
    const rawClientRequestId = typeof (data as any).clientRequestId === 'string' ? (data as any).clientRequestId.trim() : null
    if (rawClientRequestId !== null) {
      if (rawClientRequestId.length < 8 || rawClientRequestId.length > 128) {
        return NextResponse.json({ error: 'clientRequestId must be between 8 and 128 characters' }, { status: 400 })
      }

      // Optimistic check
      const existing = await prisma.task.findUnique({
        where: { clientRequestId: rawClientRequestId },
        include: taskFullInclude,
      })
      if (existing) {
        log.info(`[tasks API] Idempotency (clientRequestId): returning existing task ${existing.id}`)
        return NextResponse.json(existing)
      }
    }

    // ── Idempotency: time-based dedup (fallback for clients without clientRequestId) ──
    if (rawClientRequestId === null) {
      const recentDuplicate = await prisma.task.findFirst({
        where: {
          title: data.title.trim(),
          creatorId: session.user.id,
          createdAt: { gte: new Date(Date.now() - 60_000) },
          ...(nonVirtualListIds.length > 0
            ? { lists: { some: { id: { in: nonVirtualListIds } } } }
            : {}),
        },
        include: taskFullInclude,
      })

      if (recentDuplicate) {
        log.info(`[tasks API] Idempotency (time-based): returning existing task ${recentDuplicate.id} (created ${Date.now() - recentDuplicate.createdAt.getTime()}ms ago)`)
        return NextResponse.json(recentDuplicate)
      }
    }

    // Create the task with attachments
    const taskData: any = {
      title: data.title.trim(),
      description: data.description || "",
      priority: data.priority ?? 0,
      repeating: data.repeating || "never",
      repeatingData: sanitizedRepeatingData,
      isPrivate: data.isPrivate ?? true,
      dueDateTime: finalDueDateTime,
      isAllDay: finalIsAllDay,
      reminderTime: reminderTimeValue,
      reminderType: data.reminderType || null,
      reminderSent: false,
      completed: (data as any).completed ?? false,
      creatorId: session.user.id,
      lists: {
        connect: nonVirtualListIds.map((id) => ({ id })),
      },
    }

    if (finalAssigneeId) {
      taskData.assigneeId = finalAssigneeId
    }

    // Include clientRequestId if provided (for database-level dedup)
    if (rawClientRequestId) {
      taskData.clientRequestId = rawClientRequestId
    }

    let task
    try {
      task = await prisma.task.create({
        data: taskData,
        include: taskFullInclude,
      })
    } catch (err) {
      // P2002 = unique constraint violation on clientRequestId (race condition)
      if (rawClientRequestId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raceExisting = await prisma.task.findUnique({
          where: { clientRequestId: rawClientRequestId },
          include: taskFullInclude,
        })
        if (raceExisting && raceExisting.creatorId === session.user.id) {
          log.info(`[tasks API] Idempotency (P2002 fallback): returning existing task ${raceExisting.id}`)
          return NextResponse.json(raceExisting)
        }
        return NextResponse.json({ error: 'clientRequestId already used by another request' }, { status: 409 })
      }
      throw err
    }

    // System comment recording the creation (authorId: null), rendered behind
    // the task-detail "Show system" toggle. Placed after the successful create
    // and outside the P2002 catch so an idempotent retry never double-posts.
    await recordTaskCreationComment({
      taskId: task.id,
      creatorName: session.user.name || session.user.email || "Someone",
    })

    if (nonVirtualListIds.length > 0) {
      // Batch-fetch all candidate lists in one round-trip instead of N findUniques.
      // Filter to manual-sort lists in memory, then run updates in parallel.
      try {
        const candidateLists = await prisma.taskList.findMany({
          where: { id: { in: nonVirtualListIds }, sortBy: 'manual' },
          include: {
            owner: true,
            listMembers: { include: { user: true } },
          },
        })

        const listsNeedingUpdate = candidateLists.filter(listRecord => {
          const existingOrder = Array.isArray((listRecord as any).manualSortOrder)
            ? (listRecord.manualSortOrder as string[])
            : []
          return !existingOrder.includes(task.id)
        })

        await Promise.all(
          listsNeedingUpdate.map(async listRecord => {
            try {
              const existingOrder = Array.isArray((listRecord as any).manualSortOrder)
                ? (listRecord.manualSortOrder as string[])
                : []

              const updatedList = await prisma.taskList.update({
                where: { id: listRecord.id },
                data: {
                  manualSortOrder: [...existingOrder, task.id] as Prisma.JsonArray
                },
                include: {
                  owner: true,
                  listMembers: { include: { user: true } },
                }
              })

              const memberIds = getListMemberIds(updatedList as any)
              await Promise.all(memberIds.map(userId => RedisCache.del(RedisCache.keys.userLists(userId))))
              await broadcastToUsers(memberIds, {
                type: 'list_updated',
                data: updatedList
              })
            } catch (error) {
              log.error({ err: error }, `Failed to append task to manual sort order for list ${listRecord.id}:`)
            }
          })
        )
      } catch (error) {
        log.error({ err: error }, 'Failed to fetch candidate manual-sort lists:')
      }
    }

    // Add reminders to queue: an explicit reminder if set, otherwise the
    // standard automatic schedule for the due date. Both routes share the
    // same helpers so POST/PUT can't drift apart.
    const reminders: ReminderScheduleEntry[] = []
    if (reminderTimeValue) {
      reminders.push({
        scheduledFor: reminderTimeValue,
        type: "due_reminder",
        source: "explicit",
      })
    } else if (dueDateTimeValue) {
      reminders.push(...computeAutomaticReminders(new Date(dueDateTimeValue), "automatic"))
    }

    if (reminders.length > 0) {
      await scheduleReminders({
        taskId: task.id,
        taskTitle: task.title,
        userId: finalAssigneeId || session.user.id,
        reminders,
        checkDuplicates: true,
        reminderTypeLabel: data.reminderType,
      })
    }

    // Broadcast SSE event to task assignee if different from creator
    if (task.assigneeId && task.assigneeId !== session.user.id) {
      try {
        broadcastToUsers([task.assigneeId], {
          type: 'task_assigned',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            task: enrichTaskForAgent(task),
            title: (task as any).title,
            description: (task as any).description,
            priority: (task as any).priority,
            dueDateTime: (task as any).dueDateTime,
            listId: (task as any).lists?.[0]?.id,
            listName: (task as any).lists?.[0]?.name,
            githubRepositoryId: (task as any).lists?.[0]?.githubRepositoryId,
            assignerName: (task as any).creator?.name || (task as any).creator?.email || "Someone",
            assignerId: (task as any).creator?.id,
            // Legacy fields for backward compatibility
            taskTitle: (task as any).title,
            taskPriority: (task as any).priority,
            taskDueDateTime: (task as any).dueDateTime,
            userId: session.user.id,
            listNames: (task as any).lists?.map((list: any) => list.name) || [],
            comments: (task as any).comments?.map((c: any) => ({
              id: c.id,
              content: c.content,
              authorName: c.author?.name,
              createdAt: c.createdAt
            })) || []
          }
        })
      } catch (sseError) {
        log.error({ err: sseError }, "Failed to send SSE notification:")
        // Continue - task was still created
      }
    }

    // If task belongs to shared lists, broadcast to all list members
    const taskListIds = (task as any).lists?.map((list: any) => list.id) || []
    if (taskListIds.length > 0) {
      try {        
        const listsWithMembers = await prisma.taskList.findMany({
          where: { id: { in: taskListIds } },
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          }
        })

        // Collect all user IDs who should be notified using utility function
        const userIds = new Set<string>()
        
        log.info(listsWithMembers.map(l => ({ name: l.name, id: l.id, ownerId: l.ownerId })), `[SSE] Task created in ${listsWithMembers.length} lists:`)
        
        // Add all list members from all associated lists using utility function
        for (const list of listsWithMembers) {
          log.info(`[SSE] Processing list "${list.name}":`)
          const memberIds = getListMemberIds(list as any)
          log.info({ memberIds }, `  - All members (${memberIds.length}):`)
          memberIds.forEach(id => userIds.add(id))
        }
        
        // Remove the user who created the task (they already see it)
        userIds.delete(session.user.id)

        // Remove the assignee — they already got a task_assigned event above
        if (task.assigneeId) {
          userIds.delete(task.assigneeId)
        }

        if (userIds.size > 0) {
          log.info(Array.from(userIds), `[SSE] Broadcasting task creation to ${userIds.size} users:`)
          broadcastToUsers(Array.from(userIds), {
            type: 'task_created',
            timestamp: new Date().toISOString(),
            data: {
              taskId: task.id,
              taskTitle: task.title,
              taskPriority: task.priority,
              taskDueDateTime: task.dueDateTime,
              creatorName: (task as any).creator?.name || (task as any).creator?.email || "Someone",
              userId: session.user.id, // Add userId for client-side filtering
              listNames: (task as any).lists?.map((list: any) => list.name) || [],
              task: {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                completed: task.completed,
                assigneeId: task.assigneeId,
                creatorId: task.creatorId,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                assignee: task.assignee,
                creator: task.creator,
                lists: task.lists,
                comments: task.comments,
                attachments: task.attachments,
                dueDateTime: task.dueDateTime,
                isAllDay: task.isAllDay,
                repeating: task.repeating,
                repeatingData: task.repeatingData,
                isPrivate: task.isPrivate
              }
            }
          })
        }
      } catch (sseError) {
        log.error({ err: sseError }, "Failed to send task creation SSE notifications:")
        // Continue - task was still created
      }
    }

    // Notify AI agent if task is assigned to an AI agent
    if (task.assigneeId) {
      try {
        const assignee = await prisma.user.findUnique({
          where: { id: task.assigneeId },
          select: { isAIAgent: true, aiAgentType: true, name: true }
        })

        if (assignee?.isAIAgent) {
          log.info(`🤖 Task assigned to AI agent ${assignee.name} (${assignee.aiAgentType}), sending notification...`)
          await aiAgentWebhookService.notifyTaskAssignment(task.id, task.assigneeId)
        }
      } catch (aiNotificationError) {
        log.error({ err: aiNotificationError }, "Failed to notify AI agent about task assignment:")
        // Don't fail the task creation if AI notification fails
      }
    }
    // Also check for aiAgentId assignments (new system)
    else if (task.aiAgentId) {
      try {
        log.info(`🤖 Task assigned to AI agent via aiAgentId ${task.aiAgentId}, sending notification...`)
        await aiAgentWebhookService.notifyTaskAssignmentViaAIAgentId(task.id, task.aiAgentId)
      } catch (aiNotificationError) {
        log.error({ err: aiNotificationError }, "Failed to notify AI agent about task assignment:")
        // Don't fail the task creation if AI notification fails
      }
    }

    // Invalidate relevant caches after task creation (if Redis is available)
    try {
      const redisAvailable = await isRedisAvailable()
      if (redisAvailable) {
        await RedisCache.invalidate.userTasks(session.user.id, nonVirtualListIds)
        log.info(`🗑️ Invalidated task caches after task creation`)
      } else {
        log.info(`ℹ️ Redis not available, skipping cache invalidation`)
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, 'Failed to invalidate task cache:')
      // Don't fail the request for cache errors
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.TASK_CREATED, { taskId: task.id })

    return NextResponse.json(task)
  } catch (error) {
    logError('tasks-api/POST', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
