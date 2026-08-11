/**
 * List Invitations API v1
 *
 * GET /api/v1/lists/:id/invitations - Get pending invitations for a list
 * PUT /api/v1/lists/:id/invitations - Change a pending invitation's role
 * DELETE /api/v1/lists/:id/invitations - Cancel a pending invitation by email
 *
 * Invitations are their own resource rather than part of /members: a pending
 * invite has no userId, so it cannot be addressed as /members/[userId]. It is
 * addressed by email here instead.
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { isListAdminOrOwner } from '@/lib/list-member-utils'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ id: string }> }

/** Roles an invitation can be given. Ownership transfer is a separate flow. */
const ASSIGNABLE_INVITE_ROLES = ['admin', 'member']

/**
 * GET /api/v1/lists/:id/invitations
 * Get pending invitations for a list
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.invitations' },
  async (_req, auth, { params }) => {
    const { id } = await params

    const list = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true }
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
        { error: 'Only list admins and owners can view invitations' },
        { status: 403 }
      )
    }

    const memberEmails = new Set(
      await prisma.listMember.findMany({
        where: { listId: id },
        include: { user: { select: { email: true } } }
      }).then(members => members.map(m => m.user.email).filter(Boolean) as string[])
    )

    const invites = await prisma.listInvite.findMany({
      where: {
        listId: id,
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

    const invitations = invites.map(i => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt.toISOString(),
      createdBy: i.creator ? {
        id: i.creator.id,
        name: i.creator.name,
        email: i.creator.email,
      } : null,
    }))

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        invitations,
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
 * PUT /api/v1/lists/:id/invitations
 * Change a pending invitation's role.
 *
 * Body: { email: string, role: 'admin' | 'member' }
 *
 * The v1 successor to legacy `PATCH /api/lists/:id/members` with
 * `{ email, role, isInvitation: true }` — the one capability the members
 * migration (task dc143ab2) had nowhere to go, because v1 addresses members
 * by userId and a pending invite has none.
 *
 * No last-admin check here, unlike the member role change: an invitation is
 * not yet an admin, so demoting one cannot leave a list without admins.
 */
export const PUT = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.invitations' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json()
    const { email, role } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!ASSIGNABLE_INVITE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const list = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true }
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
        { error: 'Only list admins and owners can change invitation roles' },
        { status: 403 }
      )
    }

    // Lowercased to match DELETE on this route. Legacy's PATCH compared the
    // raw string, so a role change on a mixed-case invite could miss the row
    // while the cancel of that same invite found it.
    const updateResult = await prisma.listInvite.updateMany({
      where: {
        listId: id,
        email: email.toLowerCase(),
      },
      data: { role },
    })

    if (updateResult.count === 0) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Invitation role updated successfully',
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
 * DELETE /api/v1/lists/:id/invitations
 * Cancel a pending invitation
 *
 * Body: { email: string }
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.invitations' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const list = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true }
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
        { error: 'Only list admins and owners can cancel invitations' },
        { status: 403 }
      )
    }

    const deleteResult = await prisma.listInvite.deleteMany({
      where: {
        listId: id,
        email: email.toLowerCase(),
      }
    })

    if (deleteResult.count === 0) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Invitation cancelled successfully',
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)
