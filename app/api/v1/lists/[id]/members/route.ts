/**
 * List Members API v1
 *
 * GET /api/v1/lists/:id/members - Get all members of a list
 * POST /api/v1/lists/:id/members - Add a member to a list
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { isListAdminOrOwner, getListMemberIds } from '@/lib/list-member-utils'
import { sendListInvitationEmail } from '@/lib/email'
import { randomBytes } from 'crypto'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.members')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/lists/:id/members
 * Get all members of a list
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.members' },
  async (_req, auth, { params }) => {
    const { id } = await params

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
        { error: 'Only list admins and owners can view members' },
        { status: 403 }
      )
    }

    const memberEmails = new Set(
      list.listMembers.map(m => m.user.email).filter(Boolean) as string[]
    )
    if (list.owner.email) {
      memberEmails.add(list.owner.email)
    }

    const pendingInvites = await prisma.listInvite.findMany({
      where: {
        listId: id,
        NOT: {
          email: { in: Array.from(memberEmails) }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const members = [
      {
        id: list.owner.id,
        name: list.owner.name,
        email: list.owner.email,
        image: list.owner.image,
        role: 'owner' as const,
        isOwner: true,
        isAdmin: false,
        type: 'member' as const,
      },
      ...list.listMembers.map(member => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
        role: member.role === 'admin' ? 'admin' as const : 'member' as const,
        isOwner: false,
        isAdmin: member.role === 'admin',
        type: 'member' as const,
      })),
      ...pendingInvites.map(invite => ({
        id: `invite_${invite.id}`,
        name: null,
        email: invite.email,
        image: null,
        role: invite.role as 'admin' | 'member',
        isOwner: false,
        isAdmin: invite.role === 'admin',
        type: 'invite' as const,
      }))
    ]

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        members,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/lists/:id/members
 * Add a member to a list
 *
 * Body: { email: string, role?: 'admin' | 'member' }
 */
export const POST = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.members' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json()
    const { email, role = 'member' } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (role !== 'admin' && role !== 'member') {
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
        { error: 'Only list admins and owners can add members' },
        { status: 403 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, name: true, email: true, image: true }
    })

    // No existing user → create an invitation instead
    if (!user) {
      const inviter = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { name: true, email: true }
      })

      const token = randomBytes(32).toString('hex')

      const existingInvitation = await prisma.listInvite.findFirst({
        where: { listId: id, email: email.toLowerCase() }
      })

      if (existingInvitation) {
        return NextResponse.json(
          { error: 'An invitation has already been sent to this email' },
          { status: 400 }
        )
      }

      await prisma.listInvite.create({
        data: {
          listId: id,
          email: email.toLowerCase(),
          token,
          role,
          createdBy: auth.userId
        }
      })

      try {
        await sendListInvitationEmail({
          to: email.toLowerCase(),
          inviterName: inviter?.name || inviter?.email || 'Someone',
          listName: list.name,
          role: role === 'admin' ? 'manager' : 'member',
          invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${token}`,
        })
      } catch (emailError) {
        // Invitation row is created either way; the email is best-effort
        log.error({ err: emailError }, 'Failed to send invitation email')
      }

      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) {
        headers['X-Deprecation-Warning'] = deprecationWarning
      }

      return NextResponse.json(
        {
          message: 'Invitation sent successfully',
          invitation: {
            email: email.toLowerCase(),
            role,
            status: 'pending',
          },
          meta: { apiVersion: 'v1', authSource: auth.source },
        },
        { headers }
      )
    }

    if (list.ownerId === user.id) {
      return NextResponse.json(
        { error: 'User is already the owner of this list' },
        { status: 400 }
      )
    }

    const existingMember = list.listMembers.find(m => m.userId === user.id)
    if (existingMember) {
      return NextResponse.json(
        { error: 'User is already a member of this list' },
        { status: 400 }
      )
    }

    await prisma.listMember.create({
      data: { listId: id, userId: user.id, role }
    })

    try {
      const memberIds = getListMemberIds(list as any)
      broadcastToUsers(memberIds, {
        type: 'list_member_added',
        data: {
          listId: id,
          member: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role,
          }
        }
      })
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to broadcast list member added event')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Member added successfully',
        member: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role,
          isOwner: false,
          isAdmin: role === 'admin',
        },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)
