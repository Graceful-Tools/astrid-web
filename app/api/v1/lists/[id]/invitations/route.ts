/**
 * List Invitations API v1
 *
 * GET /api/v1/lists/:id/invitations - Get pending invitations for a list
 * DELETE /api/v1/lists/:id/invitations - Cancel a pending invitation by email
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { isListAdminOrOwner } from '@/lib/list-member-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.invitations')

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/v1/lists/:id/invitations
 * Get pending invitations for a list
 *
 * Response:
 * {
 *   invitations: [
 *     {
 *       id: string,
 *       email: string,
 *       role: string,
 *       createdAt: string,
 *       createdBy: { id, name, email } | null
 *     }
 *   ]
 * }
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:read'])

    const { id } = await params

    // Fetch list to check permissions
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
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    if (!isListAdminOrOwner(list as any, auth.userId)) {
      return NextResponse.json(
        { error: 'Only list admins and owners can view invitations' },
        { status: 403 }
      )
    }

    // Get emails of users who are already members (to exclude accepted invites)
    const memberEmails = new Set(
      await prisma.listMember.findMany({
        where: { listId: id },
        include: { user: { select: { email: true } } }
      }).then(members => members.map(m => m.user.email).filter(Boolean) as string[])
    )

    // Get pending invitations
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
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    log.error({ err: error }, 'GET /lists/:id/invitations error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/lists/:id/invitations
 * Cancel a pending invitation
 *
 * Body:
 * {
 *   email: string - The email of the invitation to cancel
 * }
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['lists:write'])

    const { id } = await params
    const body = await req.json()

    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Fetch list to check permissions
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
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    if (!isListAdminOrOwner(list as any, auth.userId)) {
      return NextResponse.json(
        { error: 'Only list admins and owners can cancel invitations' },
        { status: 403 }
      )
    }

    // Delete the invitation
    const deleteResult = await prisma.listInvite.deleteMany({
      where: {
        listId: id,
        email: email.toLowerCase(),
      }
    })

    if (deleteResult.count === 0) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      )
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
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    log.error({ err: error }, 'DELETE /lists/:id/invitations error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
