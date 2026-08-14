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
import { getUserRoleInList } from "@/lib/list-permissions"

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
          select: { id: true, name: true, email: true, image: true, isAIAgent: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, isAIAgent: true }
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

    // Invitation(LIST_SHARING), matching where Add Member now writes — see the
    // note on the create below. Only the fields this response already used are
    // read, so the shape is unchanged. (Task 706230e3.)
    const pendingInvites = await prisma.invitation.findMany({
      where: {
        listId: id,
        type: 'LIST_SHARING',
        status: 'PENDING',
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
        // list-members-manager tells agents apart from people by this field.
        // Legacy carries it; without it every AI agent renders as an ordinary
        // user — and since undefined is falsy, PEOPLE still render correctly,
        // which is what would have hidden the bug. (Task dc143ab2)
        isAIAgent: list.owner.isAIAgent ?? false,
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
        isAIAgent: member.user.isAIAgent ?? false,
        type: 'member' as const,
      })),
      ...pendingInvites.map(invite => ({
        id: `invite_${invite.id}`,
        name: null,
        email: invite.email,
        image: null,
        role: invite.role as 'admin' | 'member',
        isOwner: false,
        // A pending invite is an email, not a user yet — nothing to be an
        // agent. Stated rather than omitted so the key is always present.
        isAIAgent: false,
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
          select: { id: true, name: true, email: true, image: true, isAIAgent: true }
        },
        listMembers: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, isAIAgent: true }
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
      select: { id: true, name: true, email: true, image: true, isAIAgent: true }
    })

    // No existing user → create an invitation instead
    if (!user) {
      const inviter = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { name: true, email: true }
      })

      const token = randomBytes(32).toString('hex')

      // Invitation, not ListInvite. /api/invitations/:token — the route the
      // emailed link resolves against — reads Invitation and has no knowledge
      // of ListInvite, so a row written there could never be accepted and the
      // recipient hit a dead end. type/listId/role are what its LIST_SHARING
      // branch upserts the ListMember from. (Task 706230e3.)
      const existingInvitation = await prisma.invitation.findFirst({
        where: {
          listId: id,
          email: email.toLowerCase(),
          type: 'LIST_SHARING',
          status: 'PENDING',
        }
      })

      if (existingInvitation) {
        return NextResponse.json(
          { error: 'An invitation has already been sent to this email' },
          { status: 400 }
        )
      }

      await prisma.invitation.create({
        data: {
          type: 'LIST_SHARING',
          listId: id,
          email: email.toLowerCase(),
          token,
          role,
          senderId: auth.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

    if (getUserRoleInList({ id: user.id }, list as never) === 'owner') {
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
          // Same field the GET reports — a member added through POST must not
          // arrive without it and render as a person. (Task dc143ab2)
          isAIAgent: user.isAIAgent ?? false,
          type: 'member' as const,
        },
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)
