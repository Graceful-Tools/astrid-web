import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { CreateTaskData } from "@/types/api"
import { RedisCache } from "@/lib/redis"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { logError } from "@/lib/logging/error-sanitizer"
import { detectPlatform } from "@/lib/analytics-events"
import { createLogger } from '@/lib/logger'
import { getUnifiedSession } from "@/lib/session-utils"
import { createTaskWithSideEffects } from "@/services/task.service"
import { getDeletionsSince } from '@/lib/deletion-log'

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
    // Delta responses also carry what disappeared. Tasks are hard-deleted, so
    // without this an incremental sync leaves deleted tasks on screen. Only
    // present for delta requests, so a full sync keeps its exact prior shape.
    const deletedIds = updatedSince
      ? await getDeletionsSince('task', session.user.id, new Date(updatedSince))
      : undefined

    const response = {
      tasks,
      timestamp: new Date().toISOString(),
      isIncremental: !!updatedSince,
      count: tasks.length,
      ...(deletedIds ? { deletedIds } : {})
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

    // Handle test user email for debugging (override assigneeId)
    let testUserId: string | null = null
    if (data.testUserEmail) {
      const testUser = await prisma.user.findUnique({
        where: { email: data.testUserEmail },
        select: { id: true }
      })

      if (!testUser) {
        return NextResponse.json({ error: `Test user not found: ${data.testUserEmail}` }, { status: 404 })
      }
      testUserId = testUser.id
      log.info(`🧪 Debug: Creating task for test user ${data.testUserEmail} (${testUserId})`)
    }

    // Assigning by email to someone who has not signed up yet mints a
    // placeholder user for them. This stays at the surface rather than moving
    // into the service: it is the one create input that is not a task field but
    // a side effect on the User table, and only this route accepts it.
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

    // Precedence unchanged: the debug override beats assign-by-email, which
    // beats whatever the client sent. `undefined` still has to survive as
    // "decide from the list default" — it is not the same as null.
    const assigneeId = testUserId ?? emailAssigneeId ?? data.assigneeId

    const result = await createTaskWithSideEffects({
      input: { ...data, assigneeId },
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || "Someone",
      platform: detectPlatform(request),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.task)
  } catch (error) {
    logError('tasks-api/POST', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
