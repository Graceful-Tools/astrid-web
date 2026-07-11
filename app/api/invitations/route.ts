import { NextRequest, NextResponse } from "next/server"
import { inviteRateLimiter } from "@/lib/rate-limiter"
import { randomBytes } from "crypto"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { sendInvitationEmail } from "@/lib/email"
import { createLogger } from '@/lib/logger'

const log = createLogger('invitations')


// Generate cryptographically secure invitation token
function generateInvitationToken(): string {
  return `inv_${randomBytes(16).toString('hex')}`
}

interface CreateInvitationData {
  email: string
  type: "TASK_ASSIGNMENT" | "LIST_SHARING" | "WORKSPACE_INVITE"
  taskId?: string
  listId?: string
  message?: string
}

export async function POST(request: NextRequest) {
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

    const data: CreateInvitationData = await request.json()

    // Validate required fields
    if (!data.email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Normalize email
    const email = data.email.toLowerCase().trim()

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true }
    })

    if (existingUser) {
      // User exists, handle based on invitation type
      if (data.type === "TASK_ASSIGNMENT" && data.taskId) {
        // SECURITY: Verify caller has permission to assign this task
        const task = await prisma.task.findFirst({
          where: {
            id: data.taskId,
            OR: [
              { creatorId: session.user.id },
              { assigneeId: session.user.id },
              {
                lists: {
                  some: {
                    OR: [
                      { ownerId: session.user.id },
                      { listMembers: { some: { userId: session.user.id } } }
                    ]
                  }
                }
              }
            ]
          }
        })

        if (!task) {
          return NextResponse.json(
            { error: "Task not found or access denied" },
            { status: 403 }
          )
        }

        // Assign task directly to existing user
        await prisma.task.update({
          where: { id: data.taskId },
          data: { assigneeId: existingUser.id }
        })

        return NextResponse.json({
          success: true,
          userExists: true,
          assignedUser: existingUser,
          message: "Task assigned to existing user"
        })
      }

      return NextResponse.json({
        success: true,
        userExists: true,
        user: existingUser
      })
    }

    // SECURITY: Validate caller has access to the task/list before creating invitation
    if (data.taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: data.taskId,
          OR: [
            { creatorId: session.user.id },
            { assigneeId: session.user.id },
            {
              lists: {
                some: {
                  OR: [
                    { ownerId: session.user.id },
                    { listMembers: { some: { userId: session.user.id } } }
                  ]
                }
              }
            }
          ]
        }
      })

      if (!task) {
        return NextResponse.json(
          { error: "Task not found or access denied" },
          { status: 403 }
        )
      }
    }

    if (data.listId) {
      const list = await prisma.taskList.findFirst({
        where: {
          id: data.listId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } }
          ]
        }
      })

      if (!list) {
        return NextResponse.json(
          { error: "List not found or access denied" },
          { status: 403 }
        )
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await prisma.invitation.findFirst({
      where: {
        email,
        status: "PENDING",
        type: data.type,
        ...(data.taskId && { taskId: data.taskId }),
        ...(data.listId && { listId: data.listId })
      }
    })

    if (existingInvitation) {
      return NextResponse.json({
        error: "Invitation already sent for this email"
      }, { status: 409 })
    }

    // Create invitation
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiration
    
    // Generate a unique token for the invitation
    const token = generateInvitationToken()

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        type: data.type,
        senderId: session.user.id,
        taskId: data.taskId,
        listId: data.listId,
        message: data.message,
        expiresAt
      },
      include: {
        sender: {
          select: { name: true, email: true }
        }
      }
    })

    // Send invitation email (implement this function)
    try {
      await sendInvitationEmail(invitation)
    } catch (emailError) {
      log.error({ err: emailError }, "Failed to send invitation email:")
      // Don't fail the request if email fails
    }

    return NextResponse.json({ 
      success: true, 
      userExists: false,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        type: invitation.type,
        expiresAt: invitation.expiresAt
      },
      message: "Invitation sent"
    })

  } catch (error) {
    log.error({ err: error }, "Error creating invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")

    const whereClause: any = {
      OR: [
        { senderId: session.user.id },
        { receiverId: session.user.id }
      ]
    }

    if (type) {
      whereClause.type = type
    }

    const invitations = await prisma.invitation.findMany({
      where: whereClause,
      include: {
        sender: {
          select: { id: true, name: true, email: true }
        },
        receiver: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    return NextResponse.json({ invitations })
  } catch (error) {
    log.error({ err: error }, "Error fetching invitations:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
