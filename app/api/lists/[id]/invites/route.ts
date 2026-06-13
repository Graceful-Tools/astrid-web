import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { canUserManageMembers, getUserRoleInList, prismaToTaskList } from "@/lib/list-permissions"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].invites')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/lists/[id]/invites - Get pending invitations for a list
export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    // Get the list
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        // Project owner / admins manage members like a list admin (sub-task #3).
        project: {
          select: {
            ownerId: true,
            members: { select: { userId: true, role: true } },
          },
        },
      },
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user has permission to view invitations
    const currentUser = { id: session.user.id, email: session.user.email!, name: session.user.name, createdAt: new Date() }
    const taskList = prismaToTaskList(list)
    
    if (!canUserManageMembers(currentUser, taskList)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Get pending invitations for this list
    const invitations = await prisma.invitation.findMany({
      where: {
        listId,
        status: "PENDING",
        type: "LIST_SHARING",
        expiresAt: {
          gt: new Date(), // Only non-expired invitations
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        message: true,
        createdAt: true,
        expiresAt: true,
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ invites: invitations })
  } catch (error) {
    log.error({ err: error }, "Error fetching list invitations:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
