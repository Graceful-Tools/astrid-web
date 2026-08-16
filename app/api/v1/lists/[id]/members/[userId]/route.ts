/**
 * Individual List Member API v1
 *
 * PUT /api/v1/lists/:id/members/:userId - Update member role
 * DELETE /api/v1/lists/:id/members/:userId - Remove member
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { isListAdminOrOwner, getListMemberIds } from '@/lib/list-member-utils'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { getUserRoleInList } from "@/lib/list-permissions"
import { invalidateMemberCache } from '@/lib/list-member-operations'

const log = createLogger('v1.lists.members.id')

type RouteContext = { params: Promise<{ id: string; userId: string }> }

/**
 * PUT /api/v1/lists/:id/members/:userId
 * Update member role
 *
 * Body: { role: 'admin' | 'member' }
 */
export const PUT = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.members.id' },
  async (req, auth, { params }) => {
    const { id, userId } = await params
    const body = await req.json()
    const { role } = body

    if (!role || (role !== 'admin' && role !== 'member')) {
      return NextResponse.json(
        { error: 'Role must be "admin" or "member"' },
        { status: 400 }
      )
    }

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
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    if (!isListAdminOrOwner(list as any, auth.userId)) {
      return NextResponse.json(
        { error: 'Only list admins and owners can update member roles' },
        { status: 403 }
      )
    }

    if (getUserRoleInList({ id: userId }, list as never) === 'owner') {
      return NextResponse.json(
        { error: 'Cannot change the owner\'s role' },
        { status: 400 }
      )
    }

    const member = list.listMembers.find(m => m.userId === userId)
    if (!member) {
      return NextResponse.json(
        { error: 'User is not a member of this list' },
        { status: 404 }
      )
    }

    await prisma.listMember.update({
      where: {
        listId_userId: { listId: id, userId },
      },
      data: { role }
    })

    try {
      const memberIds = getListMemberIds(list as any)
      broadcastToUsers(memberIds, {
        type: 'list_member_updated',
        data: { listId: id, userId, role }
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
  }
)

/**
 * DELETE /api/v1/lists/:id/members/:userId
 * Remove member from list
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.members.id' },
  async (_req, auth, { params }) => {
    const { id, userId } = await params

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
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const isAdminOrOwner = isListAdminOrOwner(list as any, auth.userId)
    const isRemovingSelf = userId === auth.userId

    if (!isAdminOrOwner && !isRemovingSelf) {
      return NextResponse.json(
        { error: 'You can only remove yourself or you must be an admin/owner' },
        { status: 403 }
      )
    }

    if (getUserRoleInList({ id: userId }, list as never) === 'owner') {
      return NextResponse.json(
        { error: 'Cannot remove the list owner' },
        { status: 400 }
      )
    }

    const member = list.listMembers.find(m => m.userId === userId)
    if (!member) {
      return NextResponse.json(
        { error: 'User is not a member of this list' },
        { status: 404 }
      )
    }

    await prisma.listMember.delete({
      where: {
        listId_userId: { listId: id, userId },
      }
    })

    // The row is gone, but `userLists`/`userTasks` still name this member until
    // the cache is cleared — so the next read puts them back and the removal
    // looks like it never happened. That is the whole of task e27642cc: an
    // agent removed from a list "keeps showing back up". Nothing was re-adding
    // it; the write simply outlived its cache.
    //
    // The legacy handler has always done this. This one deleted, broadcast SSE
    // and returned, never importing a cache module at all — so the divergence
    // arrived the moment a caller moved from the legacy route to v1.
    await invalidateMemberCache(userId)

    try {
      const memberIds = getListMemberIds(list as any)
      broadcastToUsers(memberIds, {
        type: 'list_member_removed',
        data: { listId: id, userId }
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
  }
)
