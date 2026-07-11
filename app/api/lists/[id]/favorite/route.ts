import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { toggleFavorite, hydrateSingleListFavorite } from "@/lib/favorites"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].favorite')


export async function PATCH(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const { id: listId } = await context.params
    const body = await request.json()
    const { isFavorite } = body

    // Verify the user owns or has access to this list.
    const list = await prisma.taskList.findFirst({
      where: {
        id: listId,
        OR: [
          { ownerId: userId },
          { listMembers: { some: { userId: userId } } },
        ]
      }
    })

    if (!list) {
      return NextResponse.json(
        { error: "List not found or access denied" },
        { status: 404 }
      )
    }

    // Toggle favorite in the per-user table
    await toggleFavorite(userId, listId, isFavorite)

    // Fetch the updated list with all needed relations
    const updatedList = await prisma.taskList.findUnique({
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

    if (!updatedList) {
      return NextResponse.json(
        { error: "Failed to fetch updated list" },
        { status: 500 }
      )
    }

    // Manually fetch defaultAssignee if it's a valid user ID (not "unassigned")
    let defaultAssignee = null
    if (updatedList.defaultAssigneeId && updatedList.defaultAssigneeId !== "unassigned") {
      defaultAssignee = await prisma.user.findUnique({
        where: { id: updatedList.defaultAssigneeId }
      })
    }

    const updatedListWithDefaultAssignee = {
      ...updatedList,
      defaultAssignee
    }

    // Hydrate per-user favorite state onto the response
    await hydrateSingleListFavorite(updatedListWithDefaultAssignee, userId)

    return NextResponse.json({
      success: true,
      isFavorite,
      listId,
      list: updatedListWithDefaultAssignee
    })

  } catch (error) {
    log.error({ err: error }, "Error toggling saved filter:")
    return NextResponse.json(
      { error: "Failed to toggle saved filter" },
      { status: 500 }
    )
  }
}
