/**
 * List member operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { validateMCPToken } from "./shared"
import { getUserRoleInList } from "@/lib/list-permissions"

export async function getListMembers(accessToken: string, listId: string, userId: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } }
      ]
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      listMembers: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        }
      }
    }
  })

  if (!list) {
    throw new Error('List not found or access denied')
  }

  // Combine all members using listMembers table
  const members: Array<{id: string, name?: string | null, email: string, role: string}> = []

  // Add owner
  members.push({
    ...list.owner,
    role: 'owner'
  })

  // Add all members from listMembers table
  list.listMembers.forEach(listMember => {
    // Skip owner (already added)
    if (listMember.user.id !== list.ownerId) {
      members.push({
        ...listMember.user,
        role: listMember.role
      })
    }
  })

  return { members }
}

export async function addListMember(accessToken: string, listId: string, email: string, role: string, userId: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  // Verify user is admin of the list
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { listMembers: { some: { userId: mcpToken.userId, role: 'admin' } } }
      ]
    },
    include: {
      owner: true
    }
  })

  if (!list) {
    throw new Error('List not found or insufficient permissions (admin required)')
  }

  if (!email) {
    throw new Error('Email is required')
  }

  const memberRole = role || 'member'
  if (!['admin', 'member'].includes(memberRole)) {
    throw new Error('Invalid role')
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  })

  if (existingUser) {
    // Check if user is the list owner
    if (getUserRoleInList({ id: existingUser.id }, list as never) === 'owner') {
      throw new Error('Cannot add the list owner as a member (they already have full access)')
    }

    // Check if user is already a member
    const existingMember = await prisma.listMember.findFirst({
      where: {
        listId,
        userId: existingUser.id
      }
    })

    if (existingMember) {
      throw new Error('User is already a member')
    }

    // Add existing user as member immediately
    await prisma.listMember.create({
      data: {
        listId,
        userId: existingUser.id,
        role: memberRole
      }
    })

    return {
      success: true,
      message: "Member added successfully"
    }
  } else {
    // Check if email belongs to the list owner
    if (list.owner?.email === email) {
      throw new Error('Cannot add the list owner as a member (they already have full access)')
    }

    // Check if invitation already exists
    const existingInvite = await prisma.listInvite.findFirst({
      where: {
        listId,
        email
      }
    })

    if (existingInvite) {
      // Update existing invitation with new role
      await prisma.listInvite.update({
        where: { id: existingInvite.id },
        data: {
          role: memberRole,
          createdBy: mcpToken.userId,
          updatedAt: new Date()
        }
      })

      return {
        success: true,
        message: "Invitation updated successfully"
      }
    }

    // For new users, create invitation record
    const token = crypto.randomBytes(32).toString('hex')

    await prisma.listInvite.create({
      data: {
        listId,
        email,
        token,
        role: memberRole,
        createdBy: mcpToken.userId
      }
    })

    return {
      success: true,
      message: "Invitation sent successfully"
    }
  }
}

export async function updateListMember(accessToken: string, listId: string, memberId: string, role: string, userId: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  // Verify user is admin of the list
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { listMembers: { some: { userId: mcpToken.userId, role: 'admin' } } }
      ]
    }
  })

  if (!list) {
    throw new Error('List not found or insufficient permissions (admin required)')
  }

  if (!['admin', 'member'].includes(role)) {
    throw new Error('Invalid role')
  }

  // Check if member exists
  const existingMember = await prisma.listMember.findFirst({
    where: {
      listId,
      userId: memberId
    }
  })

  if (!existingMember) {
    throw new Error('Member not found')
  }

  // If demoting from admin to member, check if this would remove the last admin
  if (existingMember.role === 'admin' && role !== 'admin') {
    const adminCount = await prisma.listMember.count({
      where: {
        listId,
        role: 'admin'
      }
    })

    const totalAdmins = adminCount + (list.ownerId ? 1 : 0)

    if (totalAdmins <= 1) {
      throw new Error('Cannot remove the last admin')
    }
  }

  // Update the member's role
  await prisma.listMember.update({
    where: {
      id: existingMember.id
    },
    data: {
      role
    }
  })

  return { success: true, message: `Member role updated to ${role}` }
}

export async function removeListMember(accessToken: string, listId: string, memberId?: string, email?: string, isInvitation?: boolean, userId?: string) {
  const mcpToken = await validateMCPToken(accessToken, listId)

  // Verify user is admin of the list
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: mcpToken.userId },
        { listMembers: { some: { userId: mcpToken.userId } } },
        { listMembers: { some: { userId: mcpToken.userId, role: 'admin' } } }
      ]
    }
  })

  if (!list) {
    throw new Error('List not found or insufficient permissions (admin required)')
  }

  if (!memberId && !email) {
    throw new Error('Member ID or email is required')
  }

  if (isInvitation) {
    if (!email) {
      throw new Error('Email is required to cancel an invitation')
    }

    const deleteResult = await prisma.listInvite.deleteMany({
      where: {
        listId,
        email
      }
    })

    if (deleteResult.count === 0) {
      throw new Error('Invitation not found')
    }

    return { success: true, message: "Invitation cancelled successfully" }
  }

  if (!memberId) {
    throw new Error('Member ID is required to remove a member')
  }

  // Check if this would remove the last admin
  const memberToRemove = await prisma.listMember.findFirst({
    where: {
      listId,
      userId: memberId
    }
  })

  if (!memberToRemove) {
    throw new Error('Member not found')
  }

  if (memberToRemove.role === 'admin') {
    const adminCount = await prisma.listMember.count({
      where: {
        listId,
        role: 'admin'
      }
    })

    const totalAdmins = adminCount + (list.ownerId ? 1 : 0)

    if (totalAdmins <= 1) {
      throw new Error('Cannot remove the last admin')
    }
  }

  // Remove the member
  const deleteResult = await prisma.listMember.deleteMany({
    where: {
      listId,
      userId: memberId
    }
  })

  if (deleteResult.count === 0) {
    throw new Error('Member not found')
  }

  return { success: true, message: "Member removed successfully" }
}
