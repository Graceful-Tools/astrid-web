/**
 * POST /api/v1/lists/:id/invite
 *
 * Send an email invitation to join a list at a specific role.
 * Mirrors POST /api/lists/[id]/invite.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  canUserManageMembers,
  canAssignRole,
  prismaToTaskList,
} from '@/lib/list-permissions'
import { sendListInvitationEmail } from '@/lib/email'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.invite')

type RouteContext = { params: Promise<{ id: string }> }

const generateInvitationToken = () => `inv_${randomBytes(16).toString('hex')}`

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:manage_members'], tag: 'v1.lists.invite' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params
      const { email, role, message } = await req.json()

      if (!email || !role) {
        return NextResponse.json(
          { error: 'Email and role are required' },
          { status: 400 }
        )
      }
      if (!['admin', 'member'].includes(role)) {
        return NextResponse.json(
          { error: "Invalid role. Must be 'admin' or 'member'" },
          { status: 400 }
        )
      }

      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        include: {
          owner: true,
          listMembers: { include: { user: true } },
        },
      })
      if (!list) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 })
      }

      const currentUser = {
        id: auth.userId,
        email: auth.user.email ?? '',
        name: auth.user.name,
        createdAt: new Date(),
      }
      const taskList = prismaToTaskList(list)

      if (!canUserManageMembers(currentUser, taskList)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      if (!canAssignRole(currentUser, taskList, role)) {
        return NextResponse.json({ error: 'Cannot assign this role' }, { status: 403 })
      }

      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (existingUser) {
        const isOwner = list.ownerId === existingUser.id
        const isAlreadyMember = list.listMembers?.some(
          (lm: { userId: string }) => lm.userId === existingUser.id
        )
        if (isOwner || isAlreadyMember) {
          return NextResponse.json(
            { error: 'User is already a member of this list' },
            { status: 400 }
          )
        }
      }

      const existingInvitation = await prisma.invitation.findFirst({
        where: { email, listId, status: 'PENDING', type: 'LIST_SHARING' },
      })
      if (existingInvitation) {
        return NextResponse.json(
          { error: 'Invitation already pending for this user' },
          { status: 400 }
        )
      }

      const token = generateInvitationToken()
      const invitation = await prisma.invitation.create({
        data: {
          email, token, type: 'LIST_SHARING', listId, role, message,
          senderId: auth.userId,
          receiverId: existingUser?.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      try {
        const inviterName = auth.user.name || auth.user.email || 'Someone'
        const roleDisplayName = role === 'admin' ? 'manager' : 'member'
        await sendListInvitationEmail({
          to: email,
          inviterName,
          listName: list.name,
          role: roleDisplayName,
          invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${invitation.token}`,
          message,
        })
      } catch (emailError) {
        log.error({ err: emailError }, 'Failed to send invitation email')
      }

      return NextResponse.json({
        message: 'Invitation sent successfully',
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          type: invitation.type,
          createdAt: invitation.createdAt,
        },
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error sending list invitation')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
