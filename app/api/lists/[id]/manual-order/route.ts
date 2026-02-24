import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { RouteContextParams } from "@/types/next"
import { getListMemberIds } from "@/lib/list-member-utils"
import { RedisCache } from "@/lib/redis"
import { broadcastToUsers } from "@/lib/sse-utils"

export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params
    const body = await request.json()
    const orderInput = Array.isArray(body?.order) ? body.order : null

    if (!orderInput) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

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

    if (list.isVirtual) {
      return NextResponse.json({ error: "Manual ordering is not supported for virtual lists" }, { status: 400 })
    }

    const memberIds = getListMemberIds(list as any)
    const hasAccess = memberIds.includes(session.user.id) || list.privacy === "PUBLIC"

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch tasks currently associated with this list
    const tasksInList = await prisma.task.findMany({
      where: {
        lists: {
          some: {
            id: listId
          }
        }
      },
      select: {
        id: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "asc"
      }
    })

    const validTaskIds = tasksInList.map(task => task.id)

    // Sanitize incoming order: keep valid IDs, unique, then append missing ones in creation order
    const incomingIds = orderInput
      .filter((id: unknown): id is string => typeof id === "string" && validTaskIds.includes(id))

    const uniqueIds = Array.from(new Set(incomingIds))
    const missingIds = validTaskIds.filter(id => !uniqueIds.includes(id))
    const sanitizedOrder = [...uniqueIds, ...missingIds]

    const updatedList = await prisma.taskList.update({
      where: { id: listId },
      data: {
        manualSortOrder: sanitizedOrder as Prisma.JsonArray
      },
      include: {
        owner: { select: { id: true, name: true, email: true, image: true } },
        listMembers: {
          select: { userId: true, role: true }
        }
      }
    })

    // Invalidate caches for all members
    const broadcastIds = getListMemberIds(updatedList)
    await Promise.all(broadcastIds.map(userId => RedisCache.del(RedisCache.keys.userLists(userId))))

    // Broadcast update so other clients refresh
    await broadcastToUsers(broadcastIds, {
      type: "list_updated",
      data: updatedList
    })

    return NextResponse.json(updatedList)
  } catch (error) {
    console.error("Error updating manual task order:", error)
    return NextResponse.json({ error: "Failed to update manual order" }, { status: 500 })
  }
}
