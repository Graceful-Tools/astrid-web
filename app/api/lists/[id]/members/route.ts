import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { sendListInvitationEmail } from "@/lib/email"
import { broadcastToUsers } from "@/lib/sse-utils"
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
    const invites = await prisma.listInvite.findMany({
      where: {
        listId,
        NOT: {
          email: {
            in: Array.from(memberEmails)
          }
        }
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
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

      // Add existing user as member immediately (quote_vote approach)
      await prisma.listMember.create({
        data: {
          listId,
          userId: existingUser.id,
          role
        }
      })


      // Generate token for notification
      const token = crypto.randomBytes(32).toString('hex')

      // Still create an invitation record for notification purposes
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

      await invalidateMemberCache(existingUser.id)

      // Broadcast SSE event to ALL list members (including the person who added them)
      try {
        const fullList = await loadListWithMembers(listId)

        if (fullList) {
          const allMemberIds = getListMemberIds(fullList as any)

          broadcastToUsers(allMemberIds, {
            type: 'list_member_added',
            timestamp: new Date().toISOString(),
            data: {
              listId: list.id,
              listName: list.name,
              listColor: (list as any).color || null,
              inviterName: session.user.name || session.user.email || "Someone",
              newMemberId: existingUser.id,
              newMemberEmail: existingUser.email,
              role: role
            }
          })
        }
      } catch (sseError) {
        log.error({ err: sseError }, "Failed to send SSE notification:")
        // Continue - member was still added
      }

      return NextResponse.json({ 
        success: true, 
        message: "Member added and invitation sent successfully" 
      })
    } else {
      // For new users, create invitation record and send email
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

    // Remove the member
    const deleteResult = await prisma.listMember.deleteMany({
      where: {
        listId,
        userId: memberId
      }
    })

    if (deleteResult.count === 0) {
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
    const fullListBeforeRemoval = await loadListWithMembers(listId)

    if (!fullListBeforeRemoval) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    const allMemberIdsBeforeRemoval = getListMemberIds(fullListBeforeRemoval as any)

    await invalidateMemberCache(memberId)

    // Broadcast SSE event to ALL members (including the person who removed them)
    try {
      const listDetails = await prisma.taskList.findUnique({
        where: { id: listId },
        select: { id: true, name: true, color: true }
      })

      if (listDetails) {
        // Broadcast to all members who had access before removal
        broadcastToUsers(allMemberIdsBeforeRemoval, {
          type: 'list_member_removed',
          timestamp: new Date().toISOString(),
          data: {
            listId: listDetails.id,
            listName: listDetails.name,
            listColor: listDetails.color || null,
            removedMemberId: memberId,
            removedBy: session.user.name || session.user.email || "Someone"
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send SSE notification for member removal:")
      // Continue - member was still removed
    }

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
          await prisma.taskList.delete({
            where: { id: listId }
          })

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

    // Update member role
    const result = await prisma.listMember.updateMany({
      where: {
        listId,
        userId: memberId
      },
      data: { role }
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // Fetch full list to get all member IDs for cache invalidation and SSE broadcast
    const fullList = await loadListWithMembers(listId)

    if (!fullList) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Invalidate Redis cache for all affected users
    try {
      const allMemberIds = getListMemberIds(fullList as any)
      await Promise.all(
        allMemberIds.map(userId => RedisCache.del(RedisCache.keys.userLists(userId)))
      )
    } catch (cacheError) {
      log.error({ err: cacheError }, "Failed to invalidate cache for list members:")
    }

    // Send SSE notification to ALL list members (including the user making the change)
    try {
      const allMemberIds = getListMemberIds(fullList as any)

      // Broadcast to all list members
      broadcastToUsers(allMemberIds, {
        type: role === 'admin' ? 'list_admin_role_granted' : 'list_member_role_changed',
        timestamp: new Date().toISOString(),
        data: {
          listId: fullList.id,
          listName: fullList.name,
          listColor: fullList.color || null,
          memberId,
          updatedBy: session.user.name || session.user.email || "Someone",
          newRole: role
        }
      })
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send SSE notification for role update:")
      // Continue - role was still updated
    }

    return NextResponse.json({ message: "Member role updated successfully" })
  } catch (error) {
    log.error({ err: error }, "Error updating member role:")
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }
}
