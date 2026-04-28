import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].tasks')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params
    const { searchParams } = new URL(request.url)
    const completionFilter = searchParams.get('completion') || 'all' // 'all', 'completed', 'incomplete'

    // Check if list exists and user has access
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        }
      }
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user has access to this list
    const canAccess = hasListAccess(list as any, session.user.id)
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden - You don't have access to this list" }, { status: 403 })
    }

    // Build where clause based on completion filter
    const completionWhere: Prisma.TaskWhereInput = (() => {
      switch (completionFilter) {
        case 'completed':
          return { completed: true }
        case 'incomplete':
          return { completed: false }
        case 'all':
        default:
          return {}
      }
    })()

    // Fetch tasks that belong to this list
    const tasks = await prisma.task.findMany({
      where: {
        lists: {
          some: {
            id: listId
          }
        },
        ...completionWhere
      },
      include: {
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
            secureFiles: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        attachments: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    return NextResponse.json({
      listId,
      listName: list.name,
      completionFilter,
      taskCount: tasks.length,
      tasks
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching tasks for list:")
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    )
  }
}
