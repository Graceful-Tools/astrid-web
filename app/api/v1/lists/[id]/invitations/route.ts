/**
 * List Invitations API v1
 *
 * GET /api/v1/lists/:id/invitations - Get pending invitations for a list
 * DELETE /api/v1/lists/:id/invitations - Cancel a pending invitation by email
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { isListAdminOrOwner } from '@/lib/list-member-utils'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ id: string }> }

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
