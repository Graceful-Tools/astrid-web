import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { sendListInvitationEmail } from "@/lib/email"
import { broadcastToUsers } from "@/lib/sse-utils"
import {
  addListMember,
  changeListMemberRole,
  removeListMember as removeListMemberService,
} from "@/services/list-member.service"
import { getListMemberIds } from "@/lib/list-member-utils"
import { RedisCache } from "@/lib/redis"
import {
  invalidateMemberCache,
  invalidateMemberCaches,
  loadListWithMembers,
  isLastAdminInList,
} from "@/lib/list-member-operations"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'
import { getUserRoleInList, canUserManageList } from "@/lib/list-permissions"
import { deleteListWithImageRelease } from "@/lib/images/update-list-image"

const log = createLogger('api.lists.members')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Helper function to check if a user is a list admin
async function isListAdmin(listId: string, userId: string): Promise<boolean> {
  try {
    // Owner check via the canonical helper rather than an inline compare
    // (task e2803305). The two-query shape is kept deliberately: the admin
    // lookup below is a separate query, and this route's tests assert on that
    // call sequence — collapsing it is a change for its own commit.
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: { ownerId: true }
    })
    if (list && getUserRoleInList({ id: userId }, list as never) === 'owner') {
      return true
    }

    // Then check if user is an admin member
    const memberResult = await prisma.listMember.findFirst({
      where: {
        listId,
        userId,
        role: "admin"
      }
    })
    return !!memberResult
  } catch (error) {
    log.error({ err: error }, 'Error checking list admin status:')
    return false
  }
}

// GET /api/lists/[id]/members - Get members and pending invites for a list
export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    // Get the list and check permissions
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        privacy: true
      }
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user is a member of the list or has admin access
    const isMember = await prisma.listMember.findFirst({
      where: {
        listId,
        userId: session.user.id
      }
    })

    const isAdmin = await isListAdmin(listId, session.user.id)

    if (!isMember && !isAdmin) {
      // For public lists, return empty members with viewer role instead of 403
      // This allows non-members to view public lists without seeing member details
      if (list.privacy === 'PUBLIC') {
        return NextResponse.json({
          members: [],
          user_role: 'viewer'
        })
      }
      return NextResponse.json({ error: "You do not have permission to view members" }, { status: 403 })
    }

    // Get list members with user details
    const members = await prisma.listMember.findMany({
      where: { listId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isAIAgent: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Get pending invites (excluding those for users who are already members)
    const memberEmails = new Set(members.map(m => m.user.email).filter(Boolean))
    const invites = await prisma.invitation.findMany({
      where: {
        listId,
        type: "LIST_SHARING",
        status: "PENDING",
        NOT: {
          email: {
            in: Array.from(memberEmails)
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Combine members and invites in the format expected by the frontend
    const allMembers = [
      ...members.map(m => ({
        id: `member_${m.id}`,
        user_id: m.userId,
        list_id: m.listId,
        role: m.role,
        email: m.user.email!,
        name: m.user.name,
        image: m.user.image,
        isAIAgent: m.user.isAIAgent,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
        type: 'member' as const
      })),
      ...invites.map(i => ({
        id: `invite_${i.id}`,
        list_id: i.listId,
        email: i.email,
        role: i.role,
        created_at: i.createdAt,
        updated_at: i.updatedAt,
        type: 'invite' as const
      }))
    ]

    // Determine user's actual role
    let userRole = 'viewer'
    if (isAdmin) {
      userRole = 'admin'
    } else if (isMember) {
      userRole = isMember.role
    }

    return NextResponse.json({
      members: allMembers,
      user_role: userRole
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching list members:")
    return NextResponse.json({ error: "Failed to fetch list members" }, { status: 500 })
  }
}

// POST /api/lists/[id]/members - Add a new member or send invite
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
    const { email, role = 'member' } = await request.json()

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    if (!['admin', 'member'].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    // Check admin permissions
    if (!(await isListAdmin(listId, session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Get list details
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: { id: true, name: true }
    })
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      // Check if user is already a member
      const existingMember = await prisma.listMember.findFirst({
        where: {
          listId,
          userId: existingUser.id
        }
      })
      
      if (existingMember) {
        return NextResponse.json({ error: "User is already a member" }, { status: 409 })
      }

      // Add existing user as member immediately (quote_vote approach).
      // Through the service, which owns the write, the cache invalidation and
      // the list_member_added broadcast for every surface.
      await addListMember({
        list: await loadListWithMembers(listId) ?? list,
        member: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          image: (existingUser as { image?: string | null }).image ?? null,
        },
        role,
        actor: { id: session.user.id, name: session.user.name, email: session.user.email },
      })

      // Still create an invitation record for notification purposes
      const token = crypto.randomBytes(32).toString('hex')
      await prisma.listInvite.create({
        data: {
          listId,
          email,
          token,
          role,
          createdBy: session.user.id
        }
      })

      // Send notification email
      try {
        await sendListInvitationEmail({
          to: email,
          inviterName: session.user.name || session.user.email || "Someone",
          listName: list.name,
          role: role === "admin" ? "manager" : "member",
          invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${token}`,
        })
      } catch (emailError) {
        log.error({ err: emailError }, "Failed to send notification email:")
        // Continue - member was still added
      }

      return NextResponse.json({ 
        success: true, 
        message: "Member added and invitation sent successfully" 
      })
    } else {
      // For new users, create invitation record and send email.
      //
      // Invitation, not ListInvite: /api/invitations/:token — the route the
      // emailed link resolves against — reads Invitation and has no knowledge
      // of ListInvite, so a row written there could never be accepted and the
      // recipient hit a dead end. type/listId/role are what its LIST_SHARING
      // branch upserts the ListMember from. (Task 706230e3.)
      const token = crypto.randomBytes(32).toString('hex')

      await prisma.invitation.create({
        data: {
          type: "LIST_SHARING",
          listId,
          email,
          token,
          role,
          senderId: session.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }
      })

      // Send invitation email
      try {
        await sendListInvitationEmail({
          to: email,
          inviterName: session.user.name || session.user.email || "Someone",
          listName: list.name,
          role: role === "admin" ? "manager" : "member", 
          invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${token}`,
        })
      } catch (emailError) {
        log.error({ err: emailError }, "Failed to send invitation email:")
        // Continue even if email fails
      }

      return NextResponse.json({ 
        success: true, 
        message: "Invitation sent successfully" 
      })
    }
  } catch (error) {
    log.error({ err: error }, "Error adding member:")
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 })
  }
}

// DELETE /api/lists/[id]/members - Remove a member or cancel invite
export async function DELETE(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params
    const { memberId, email, isInvitation } = await request.json()

    if (!listId || (!memberId && !email)) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Check admin permissions
    if (!(await isListAdmin(listId, session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (isInvitation) {
      if (!email) {
        return NextResponse.json({ error: "Email is required to cancel an invitation" }, { status: 400 })
      }
      
      const deleteResult = await prisma.listInvite.deleteMany({
        where: {
          listId,
          email
        }
      })

      if (deleteResult.count === 0) {
        return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
      }

      return NextResponse.json({ message: "Invitation cancelled successfully" })
    }

    if (!memberId) {
      return NextResponse.json({ error: "Member ID is required to remove a member" }, { status: 400 })
    }

    // Allow admins to remove other members (including themselves)
    // Note: We handle self-removal through a dedicated "leave" action in the UI

    // Check if this would remove the last admin
    const memberToRemove = await prisma.listMember.findFirst({
      where: {
        listId,
        userId: memberId
      }
    })

    if (!memberToRemove) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    if (await isLastAdminInList({ listId, removingAdmin: memberToRemove.role === 'admin' })) {
      return NextResponse.json({ error: "Cannot remove the last admin" }, { status: 400 })
    }

    // The audience has to be read BEFORE the row goes, or the one person who
    // must react to this event is the one person left out of it. This route
    // named its variable `allMemberIdsBeforeRemoval` and then loaded it AFTER
    // the delete, so the removed member never heard that they were removed and
    // their web client kept showing the list. The service takes the audience
    // first; that is the fix. (Epic 9dedd8aa.)
    const fullListBeforeRemoval = await loadListWithMembers(listId)

    if (!fullListBeforeRemoval) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    const removed = await removeListMemberService({
      list: fullListBeforeRemoval,
      member: { id: memberId },
      actor: { id: session.user.id, name: session.user.name, email: session.user.email },
    })

    if (!removed) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // Also delete any pending invitations for the same email
    const user = await prisma.user.findUnique({
      where: { id: memberId },
      select: { email: true }
    })

    if (user?.email) {
      await prisma.listInvite.deleteMany({
        where: {
          listId,
          email: user.email
        }
      })
    }

    // Check if the removed user was the default assignee, and reset to "unassigned" if so
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: { defaultAssigneeId: true }
    })

    if (list && list.defaultAssigneeId === memberId) {
      await prisma.taskList.update({
        where: { id: listId },
        data: { defaultAssigneeId: "unassigned" }
      })
    }

    // Get all remaining member IDs BEFORE removing the member (for cache invalidation and broadcast)

    return NextResponse.json({ message: "Member removed successfully" })
  } catch (error) {
    log.error({ err: error }, "Error removing member:")
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }
}

// PATCH /api/lists/[id]/members - Update member role or handle leave action
export async function PATCH(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params
    const { memberId, role, email, isInvitation, action } = await request.json()

    // Handle leave action
    if (action === 'leave') {
      // Get the list to check ownership
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

      const isOwner = getUserRoleInList({ id: session.user.id }, existingList as never) === 'owner'

      if (isOwner) {
        // Owner is leaving - need to transfer ownership or prevent leaving
        
        // Find admins (excluding the owner)
        const adminMembers = await prisma.listMember.findMany({
          where: {
            listId,
            role: 'admin',
            userId: { not: session.user.id }
          },
          include: { user: true }
        })
        
        // Find regular members (excluding the owner)
        const regularMembers = await prisma.listMember.findMany({
          where: {
            listId,
            role: 'member',
            userId: { not: session.user.id }
          }
        })
        
        // Check if there are any admins to transfer ownership to
        if (adminMembers.length === 0 && regularMembers.length === 0) {
          // No one else in the list - delete the list entirely
          await deleteListWithImageRelease(
            listId,
            client => client.taskList.delete({ where: { id: listId } }),
          )

          await invalidateMemberCache(session.user.id)
          return NextResponse.json({ message: "Successfully left the list", deleted: true })
        } else if (adminMembers.length === 0 && regularMembers.length > 0) {
          // No admins but has regular members - cannot leave as owner
          return NextResponse.json({ 
            error: "Cannot leave as owner when no admins exist. Please promote a member to admin first or delete the list." 
          }, { status: 400 })
        } else {
          // Transfer ownership to the first admin
          const newOwner = adminMembers[0]
          
          // First, add the leaving owner as a regular member (so we can remove them properly)
          // This ensures they're in the listMember table before we transfer ownership
          const existingOwnerMembership = await prisma.listMember.findFirst({
            where: {
              listId,
              userId: session.user.id
            }
          })
          
          if (!existingOwnerMembership) {
            // Owner was not in listMember table, add them temporarily so we can remove them
            await prisma.listMember.create({
              data: {
                listId,
                userId: session.user.id,
                role: 'admin' // Temporarily add as admin
              }
            })
          }
          
          // Transfer ownership to the new owner
          await prisma.taskList.update({
            where: { id: listId },
            data: {
              ownerId: newOwner.userId
            }
          })
          
          // Remove the new owner from admin members since they're now the owner
          await prisma.listMember.delete({
            where: { id: newOwner.id }
          })
          
          // Remove the old owner from members (this is the key fix)
          if (existingOwnerMembership) {
            await prisma.listMember.delete({
              where: { id: existingOwnerMembership.id }
            })
          } else {
            // Remove the temporarily added membership
            const tempMembership = await prisma.listMember.findFirst({
              where: {
                listId,
                userId: session.user.id
              }
            })
            if (tempMembership) {
              await prisma.listMember.delete({
                where: { id: tempMembership.id }
              })
            }
          }
          
          await invalidateMemberCaches([session.user.id, newOwner.userId])
        }
      } else {
        // Regular member/admin leaving - check if user is actually a member
        const memberToRemove = await prisma.listMember.findFirst({
          where: {
            listId,
            userId: session.user.id
          }
        })

        if (!memberToRemove) {
          return NextResponse.json({ error: "You are not a member of this list" }, { status: 404 })
        }

        if (await isLastAdminInList({ listId, removingAdmin: memberToRemove.role === 'admin' })) {
          return NextResponse.json({ error: "Cannot leave as the last admin" }, { status: 400 })
        }

        // Remove the member
        await prisma.listMember.delete({
          where: {
            id: memberToRemove.id
          }
        })
      }

      // Also delete any pending invitations for the same email
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true }
      })

      if (user?.email) {
        await prisma.listInvite.deleteMany({
          where: {
            listId,
            email: user.email
          }
        })
      }

      await invalidateMemberCache(session.user.id)
      return NextResponse.json({ message: "Successfully left the list" })
    }

    if ((!memberId && !email) || !role) {
      return NextResponse.json({ error: "Member ID/email and role are required" }, { status: 400 })
    }

    if (!['admin', 'member'].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    // Check admin permissions
    if (!(await isListAdmin(listId, session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (isInvitation && email) {
      // Update invitation role
      const result = await prisma.listInvite.updateMany({
        where: {
          listId,
          email
        },
        data: { role }
      })

      if (result.count === 0) {
        return NextResponse.json({ error: "Invitation not found" }, { status: 404 })
      }

      return NextResponse.json({ message: "Invitation role updated successfully" })
    }

    if (!memberId) {
      return NextResponse.json({ error: "Member ID is required" }, { status: 400 })
    }

    // Check if demoting to non-admin would leave no admins
    if (role !== 'admin') {
      const memberToUpdate = await prisma.listMember.findFirst({
        where: { listId, userId: memberId },
      })

      if (await isLastAdminInList({ listId, removingAdmin: memberToUpdate?.role === 'admin' })) {
        return NextResponse.json({ error: "Cannot remove the last admin" }, { status: 400 })
      }
    }

    const fullList = await loadListWithMembers(listId)

    if (!fullList) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Owns the update, the cache invalidation for the whole roster, and the
    // list_admin_role_granted / list_member_role_changed broadcast. Returns
    // false when no such membership existed, which is this route's 404.
    const updated = await changeListMemberRole({
      list: fullList,
      member: { id: memberId },
      role,
      actor: { id: session.user.id, name: session.user.name, email: session.user.email },
    })

    if (!updated) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }


    return NextResponse.json({ message: "Member role updated successfully" })
  } catch (error) {
    log.error({ err: error }, "Error updating member role:")
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }
}
