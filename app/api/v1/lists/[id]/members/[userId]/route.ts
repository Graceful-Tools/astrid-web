/**
 * Individual List Member API v1
 *
 * PUT /api/v1/lists/:id/members/:userId - Update member role
 * DELETE /api/v1/lists/:id/members/:userId - Remove member
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { isListAdminOrOwner, getListMemberIds } from '@/lib/list-member-utils'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { getUserRoleInList } from "@/lib/list-permissions"
import {
  changeListMemberRole,
  removeListMember,
} from '@/services/list-member.service'

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

    await changeListMemberRole({
      list,
      member: { id: userId },
      role,
      actor: { id: auth.userId, name: auth.user?.name, email: auth.user?.email },
    })


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

    // The service deletes the row, clears the caches that still name this
    // member (task e27642cc: a removed agent "kept showing back up" because the
    // write outlived its cache) and broadcasts list_member_removed.
    //
    // It must be the ONLY delete. This route used to delete the row itself
    // first; the service's deleteMany then found nothing, read that as "was not
    // a member", and skipped the invalidation and the broadcast (AWTD-1091).
    await removeListMember({
      list,
      member: { id: userId },
      actor: { id: auth.userId, name: auth.user?.name, email: auth.user?.email },
    })


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
