import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].leave')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/lists/[id]/leave - Leave a list
export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    // Get the list details
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: { 
        id: true, 
        name: true, 
        ownerId: true 
      }
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user would be the last admin
    const userMember = await prisma.listMember.findFirst({
      where: {
        listId,
        userId: session.user.id
      }
    })

    if (!userMember) {
      return NextResponse.json({ error: "You are not a member of this list" }, { status: 404 })
    }

    // Check if user is an admin or the owner (both are considered admins for leave purposes)
    const isUserAdmin = userMember.role === 'admin' || list.ownerId === session.user.id

    if (isUserAdmin) {
      // Count all admins (including the owner if they're in the members table)
      const adminCount = await prisma.listMember.count({
        where: {
          listId,
          role: 'admin'
        }
      })

      // If the owner is not in the ListMember table as admin, they still count as an admin
      const ownerIsAdmin = await prisma.listMember.findFirst({
        where: {
          listId,
          userId: list.ownerId,
          role: 'admin'
        }
      })

      const totalAdmins = adminCount + (list.ownerId && !ownerIsAdmin ? 1 : 0)

      // Only prevent leaving if this would be the last admin
      if (totalAdmins <= 1) {
        return NextResponse.json(
          { 
            error: "Cannot leave as the last admin. Either promote another member to admin or delete the list.",
            isLastAdmin: true 
          },
          { status: 400 }
        )
      }
    }

    // Remove the user from the list members
    const deleteResult = await prisma.listMember.deleteMany({
      where: {
        listId,
        userId: session.user.id
      }
    })

    if (deleteResult.count === 0) {
      return NextResponse.json({ error: "You are not a member of this list" }, { status: 404 })
    }

    // Also remove any pending invitations for this user and list
    await prisma.listInvite.deleteMany({
      where: {
        listId,
        email: session.user.email!
      }
    })

    // Invalidate cache for the user who left
    log.info({ userId: session.user.id }, "🗄️ Invalidating cache for user who left list")
    try {
      await RedisCache.del(RedisCache.keys.userLists(session.user.id))
      log.info(`✅ Cache invalidated for leaving user: ${session.user.id}`)
    } catch (error) {
      log.error({ err: error }, `❌ Failed to invalidate cache for user ${session.user.id}:`)
    }

    return NextResponse.json({ message: "Successfully left the list" })
  } catch (error) {
    log.error({ err: error }, "Error leaving list:")
    return NextResponse.json({ error: "Failed to leave list" }, { status: 500 })
  }
}
