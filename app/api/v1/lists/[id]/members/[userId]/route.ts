/**
 * Individual List Member API v1
 *
 * PUT /api/v1/lists/:id/members/:userId - Update member role
 * DELETE /api/v1/lists/:id/members/:userId - Remove member
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { isListAdminOrOwner, getListMemberIds } from '@/lib/list-member-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.members.id')

type RouteContext = {
  params: Promise<{ id: string; userId: string }>
}

/**
 * PUT /api/v1/lists/:id/members/:userId
 * Update member role
 *
 * Body:
 * {
 *   role: 'admin' | 'member'
 * }
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const { id, userId } = await params
    const body = await req.json()

    const { role } = body

    if (!role || (role !== 'admin' && role !== 'member')) {
      return NextResponse.json(
        { error: 'Role must be "admin" or "member"' },
        { status: 400 }
      )
    }

    // Fetch list
    const list = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true }
            }
          }
        }
      }
    })

    if (!list) {
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    // Check permissions: only owner and admins can update roles
    if (!isListAdminOrOwner(list as any, auth.userId)) {
      return NextResponse.json(
        { error: 'Only list admins and owners can update member roles' },
        { status: 403 }
      )
    }

    // Cannot change owner role
    if (list.ownerId === userId) {
      return NextResponse.json(
        { error: 'Cannot change the owner\'s role' },
        { status: 400 }
      )
    }

    // Find member
    const member = list.listMembers.find(m => m.userId === userId)
    if (!member) {
      return NextResponse.json(
        { error: 'User is not a member of this list' },
        { status: 404 }
      )
    }

    // Update role
    await prisma.listMember.update({
      where: {
        listId_userId: {
          listId: id,
          userId,
        }
      },
      data: { role }
    })

    // Broadcast SSE event
    try {
      const memberIds = getListMemberIds(list as any)
      broadcastToUsers(memberIds, {
        type: 'list_member_updated',
        data: {
          listId: id,
          userId,
          role,
        }
      })
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to broadcast list member updated event')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Member role updated successfully',
        member: {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image,
          role,
          isOwner: false,
          isAdmin: role === 'admin',
        },
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    log.error({ err: error }, 'PUT /lists/:id/members/:userId error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/lists/:id/members/:userId
 * Remove member from list
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const { id, userId } = await params

    // Fetch list
    const list = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true }
            }
          }
        }
      }
    })

    if (!list) {
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    // Check permissions: owner/admins can remove anyone, members can remove themselves
    const isAdminOrOwner = isListAdminOrOwner(list as any, auth.userId)
    const isRemovingSelf = userId === auth.userId

    if (!isAdminOrOwner && !isRemovingSelf) {
      return NextResponse.json(
        { error: 'You can only remove yourself or you must be an admin/owner' },
        { status: 403 }
      )
    }

    // Cannot remove owner
    if (list.ownerId === userId) {
      return NextResponse.json(
        { error: 'Cannot remove the list owner' },
        { status: 400 }
      )
    }

    // Find member
    const member = list.listMembers.find(m => m.userId === userId)
    if (!member) {
      return NextResponse.json(
        { error: 'User is not a member of this list' },
        { status: 404 }
      )
    }

    // Remove member
    await prisma.listMember.delete({
      where: {
        listId_userId: {
          listId: id,
          userId,
        }
      }
    })

    // Broadcast SSE event
    try {
      const memberIds = getListMemberIds(list as any)
      broadcastToUsers(memberIds, {
        type: 'list_member_removed',
        data: {
          listId: id,
          userId,
        }
      })
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to broadcast list member removed event')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Member removed successfully',
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    log.error({ err: error }, 'DELETE /lists/:id/members/:userId error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
