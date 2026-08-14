import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { RedisCache } from "@/lib/redis"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].transfer-ownership')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/lists/[id]/transfer-ownership - Transfer ownership and remove old owner
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
    const { newOwnerId } = await request.json()

    if (!newOwnerId) {
      return NextResponse.json({ error: "New owner ID is required" }, { status: 400 })
    }

    // Get the list and verify current user is the owner
    const existingList = await prisma.taskList.findUnique({
      where: { id: listId },
      select: { 
        ownerId: true,
        id: true 
      }
    })

    if (!existingList) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    if (existingList.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Only the owner can transfer ownership" }, { status: 403 })
    }

    // Verify the new owner is a member of the list
    const newOwnerMember = await prisma.listMember.findFirst({
      where: {
        listId,
        userId: newOwnerId
      }
    })

    if (!newOwnerMember) {
      return NextResponse.json({ error: "New owner must be a current member of the list" }, { status: 400 })
    }

    // Transfer ownership and remove old owner completely
    await prisma.$transaction(async (tx) => {
      // 1. Transfer ownership
      await tx.taskList.update({
        where: { id: listId },
        data: {
          ownerId: newOwnerId
        }
      })
      
      // 2. Remove new owner from listMembers since they're now the owner
      await tx.listMember.delete({
        where: { id: newOwnerMember.id }
      })
      
      // 3. Remove old owner from any listMember relationships
      const oldOwnerMembership = await tx.listMember.findFirst({
        where: {
          listId,
          userId: session.user.id
        }
      })
      
      if (oldOwnerMembership) {
        await tx.listMember.delete({
          where: { id: oldOwnerMembership.id }
        })
      }

      // Note: Old owner is removed from listMembers above.
      // They will lose access to the list unless explicitly re-added as admin/member.
    })

    // Invalidate cache for both old and new owners
    log.info({ oldOwnerId: session.user.id, newOwnerId }, '🗄️ Invalidating cache for ownership transfer')
    try {
      // Invalidate cache for the old owner (who left)
      await RedisCache.invalidate.userListsAllVersions(session.user.id)
      log.info(`✅ Cache invalidated for old owner: ${session.user.id}`)
      
      // Invalidate cache for the new owner (who now owns the list)
      await RedisCache.invalidate.userListsAllVersions(newOwnerId)
      log.info(`✅ Cache invalidated for new owner: ${newOwnerId}`)
    } catch (error) {
      log.error({ err: error }, `❌ Failed to invalidate cache for ownership transfer:`)
    }

    return NextResponse.json({ message: "Ownership transferred successfully" })
  } catch (error) {
    log.error({ err: error }, "Error transferring ownership:")
    return NextResponse.json({ error: "Failed to transfer ownership" }, { status: 500 })
  }
}
