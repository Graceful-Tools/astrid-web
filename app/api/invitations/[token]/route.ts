import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('invitations.[token]')


export async function GET(request: NextRequest, context: RouteContextParams<{ token: string }>) {
  try {
    const { token } = await context.params

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: {
        sender: {
          select: { name: true, email: true }
        }
      }
    })

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json({ error: "Invitation already processed" }, { status: 410 })
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" }
      })
      return NextResponse.json({ error: "Invitation expired" }, { status: 410 })
    }

    return NextResponse.json({ invitation: {
      id: invitation.id,
      email: invitation.email,
      type: invitation.type,
      sender: invitation.sender,
      message: invitation.message,
      expiresAt: invitation.expiresAt
    }})
  } catch (error) {
    log.error({ err: error }, "Error fetching invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContextParams<{ token: string }>) {
  try {
    const session = await getServerSession(authConfig)
    const { token } = await context.params

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Must be logged in to accept invitation" }, { status: 401 })
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: {
        sender: true
      }
    })

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json({ error: "Invitation already processed" }, { status: 410 })
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" }
      })
      return NextResponse.json({ error: "Invitation expired" }, { status: 410 })
    }

    // Verify the user's email matches the invitation
    if (session.user.email !== invitation.email) {
      return NextResponse.json({ 
        error: "Email mismatch. Please sign in with the invited email address." 
      }, { status: 403 })
    }

    // Accept the invitation and perform the appropriate action
    const result = await prisma.$transaction(async (tx) => {
      // Update invitation status
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { 
          status: "ACCEPTED",
          receiverId: session.user!.id
        }
      })

      let actionResult = null

      // Perform the invitation-specific action
      switch (invitation.type) {
        case "TASK_ASSIGNMENT":
          if (invitation.taskId) {
            actionResult = await tx.task.update({
              where: { id: invitation.taskId },
              data: { assigneeId: session.user!.id },
              include: {
                assignee: true,
                creator: true,
                lists: true
              }
            })
          }
          break

        case "LIST_SHARING":
          if (invitation.listId) {
            // Add user to ListMember table based on the role specified in the invitation
            const role = invitation.role || "member"

            // Create or update list member entry
            await tx.listMember.upsert({
              where: {
                listId_userId: {
                  listId: invitation.listId,
                  userId: session.user!.id
                }
              },
              update: {
                role: role === "admin" ? "admin" : "member"
              },
              create: {
                listId: invitation.listId,
                userId: session.user!.id,
                role: role === "admin" ? "admin" : "member"
              }
            })

            // Fetch the updated list to return
            actionResult = await tx.taskList.findUnique({
              where: { id: invitation.listId },
              include: {
                owner: true,
                listMembers: {
                  include: {
                    user: true
                  }
                }
              }
            })
          }
          break

        case "WORKSPACE_INVITE":
          // For workspace invites, just mark as accepted
          // Additional workspace setup could be done here
          actionResult = { message: "Welcome to the workspace!" }
          break
      }

      return actionResult
    })

    return NextResponse.json({
      success: true,
      message: "Invitation accepted successfully",
      result
    })

  } catch (error) {
    log.error({ err: error }, "Error accepting invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContextParams<{ token: string }>) {
  try {
    const { token } = await context.params

    const invitation = await prisma.invitation.findUnique({
      where: { token }
    })

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json({ error: "Invitation already processed" }, { status: 410 })
    }

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "DECLINED" }
    })

    return NextResponse.json({ success: true, message: "Invitation declined" })
  } catch (error) {
    log.error({ err: error }, "Error declining invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
