import { NextRequest, NextResponse } from "next/server"
import { inviteRateLimiter } from "@/lib/rate-limiter"
import { randomBytes } from "crypto"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { canUserManageMembers, canAssignRole, prismaToTaskList, getUserRoleInList } from "@/lib/list-permissions"
import { sendListInvitationEmail } from "@/lib/email"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].invite')


// Generate cryptographically secure invitation token
function generateInvitationToken(): string {
  return `inv_${randomBytes(16).toString('hex')}`
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/lists/[id]/invite - Invite a user to join a list
export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Per-user invite rate limit (spam guard — invites email arbitrary addresses).
    const inviteRate = await inviteRateLimiter.checkRateLimitByKeyAsync(`invite:${session.user.id}`)
    if (!inviteRate.allowed) {
      return NextResponse.json(
        { error: 'Too many invitations. Please try again later.' },
        { status: 429, headers: { 'Retry-After': Math.ceil((inviteRate.resetTime - Date.now()) / 1000).toString() } }
      )
    }

    const { id: listId } = await context.params
    const { email, role, message } = await request.json()

    if (!email || !role) {
      return NextResponse.json({ error: "Email and role are required" }, { status: 400 })
    }

    if (!["admin", "member"].includes(role)) {
      return NextResponse.json({ error: "Invalid role. Must be 'admin' or 'member'" }, { status: 400 })
    }

    // Get the list
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        },
      },
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check permissions
    const currentUser = { id: session.user.id, email: session.user.email!, name: session.user.name, createdAt: new Date() }
    const taskList = prismaToTaskList(list)
    
    if (!canUserManageMembers(currentUser, taskList)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (!canAssignRole(currentUser, taskList, role)) {
      return NextResponse.json({ error: "Cannot assign this role" }, { status: 403 })
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    // If user exists, check if they're already a member
    if (existingUser) {
      const isOwner = getUserRoleInList({ id: existingUser.id }, list as never) === 'owner'
      const isAlreadyMember = list.listMembers?.some((lm: any) => lm.userId === existingUser.id)

      if (isOwner || isAlreadyMember) {
        return NextResponse.json({ error: "User is already a member of this list" }, { status: 400 })
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await prisma.invitation.findFirst({
      where: {
        email,
        listId,
        status: "PENDING",
        type: "LIST_SHARING",
      },
    })

    if (existingInvitation) {
      return NextResponse.json({ error: "Invitation already pending for this user" }, { status: 400 })
    }

    // Generate unique token for the invitation
    const token = generateInvitationToken()

    // Create invitation
    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        type: "LIST_SHARING",
        listId,
        role,
        message,
        senderId: session.user.id,
        receiverId: existingUser?.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    })

    // Send invitation email
    try {
      const inviterName = session.user.name || session.user.email || "Someone"
      const roleDisplayName = role === "admin" ? "manager" : "member"
      
      await sendListInvitationEmail({
        to: email,
        inviterName,
        listName: list.name,
        role: roleDisplayName,
        invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${invitation.token}`,
        message,
      })
    } catch (emailError) {
      log.error({ err: emailError }, "Failed to send invitation email:")
      // Continue even if email fails - invitation is still created
    }

    return NextResponse.json({ 
      message: "Invitation sent successfully",
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        type: invitation.type,
        createdAt: invitation.createdAt,
      }
    })
  } catch (error) {
    log.error({ err: error }, "Error sending list invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
