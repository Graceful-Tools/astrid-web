/**
 * Inviting someone to a list.
 *
 * `/api/lists/:id/invite` and its v1 twin ran the same nine steps in the same
 * order: rate limit, validate, load the list, check the caller may manage
 * members, check they may grant *this* role, reject existing members, reject
 * duplicate pending invites, create the invitation, send the email.
 * (Task e0613ae5.)
 *
 * This route emails an arbitrary address, with a caller-supplied message, from
 * our domain — which is why the rate limit comes first and why a second copy of
 * these checks is a liability rather than just noise. An earlier round of this
 * same task found the v1 route had no rate limit at all, making the guard
 * bypassable by calling the other path.
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { inviteRateLimiter } from '@/lib/rate-limiter'
import {
  canUserManageMembers,
  canAssignRole,
  getUserRoleInList,
  prismaToTaskList,
} from '@/lib/list-permissions'
import { sendListInvitationEmail } from '@/lib/email'
import { createLogger } from '@/lib/logger'

const log = createLogger('list-invite')

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type InviteFailure = {
  ok: false
  status: 400 | 403 | 404 | 429
  error: string
  /** Present only on 429 — seconds until the caller may retry. */
  retryAfterSeconds?: number
}

export type InviteSuccess = {
  ok: true
  invitation: {
    id: string
    email: string
    role: string | null
    type: string
    createdAt: Date
  }
}

export interface InviterIdentity {
  id: string
  email: string
  name: string | null
}

function generateInvitationToken(): string {
  return `inv_${randomBytes(16).toString('hex')}`
}

export async function inviteToList(args: {
  listId: string
  inviter: InviterIdentity
  email?: string
  role?: string
  message?: string
}): Promise<InviteSuccess | InviteFailure> {
  const { listId, inviter, email, role, message } = args

  // Rate limit BEFORE anything else, so a limited caller cannot burn queries
  // either.
  const inviteRate = await inviteRateLimiter.checkRateLimitByKeyAsync(`invite:${inviter.id}`)
  if (!inviteRate.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many invitations. Please try again later.',
      retryAfterSeconds: Math.ceil((inviteRate.resetTime - Date.now()) / 1000),
    }
  }

  if (!email || !role) {
    return { ok: false, status: 400, error: 'Email and role are required' }
  }

  // Only these two are grantable by invitation. 'owner' is transferred, not
  // handed out, and 'viewer' is a property of a public list rather than a seat.
  // Narrowing here is what lets canAssignRole below take a real role type
  // instead of a bare string.
  if (role !== 'admin' && role !== 'member') {
    return { ok: false, status: 400, error: "Invalid role. Must be 'admin' or 'member'" }
  }

  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  })

  if (!list) {
    return { ok: false, status: 404, error: 'List not found' }
  }

  const currentUser = {
    id: inviter.id,
    email: inviter.email,
    name: inviter.name,
    createdAt: new Date(),
  }
  const taskList = prismaToTaskList(list)

  if (!canUserManageMembers(currentUser, taskList)) {
    return { ok: false, status: 403, error: 'Access denied' }
  }

  // Separate from the check above on purpose: an admin may invite members but
  // must not be able to mint other admins.
  if (!canAssignRole(currentUser, taskList, role)) {
    return { ok: false, status: 403, error: 'Cannot assign this role' }
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    const isOwner = getUserRoleInList({ id: existingUser.id }, list as never) === 'owner'
    const isAlreadyMember = list.listMembers?.some(lm => lm.userId === existingUser.id)

    if (isOwner || isAlreadyMember) {
      return { ok: false, status: 400, error: 'User is already a member of this list' }
    }
  }

  const existingInvitation = await prisma.invitation.findFirst({
    where: { email, listId, status: 'PENDING', type: 'LIST_SHARING' },
  })
  if (existingInvitation) {
    return { ok: false, status: 400, error: 'Invitation already pending for this user' }
  }

  const invitation = await prisma.invitation.create({
    data: {
      email,
      token: generateInvitationToken(),
      type: 'LIST_SHARING',
      listId,
      role,
      message,
      senderId: inviter.id,
      receiverId: existingUser?.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  })

  // Best-effort: the invitation row is what makes the link work, so a mail
  // outage must not fail the request or leave the caller thinking nothing
  // happened. They can resend.
  try {
    await sendListInvitationEmail({
      to: email,
      inviterName: inviter.name || inviter.email || 'Someone',
      listName: list.name,
      // "manager" reads better than "admin" to someone being invited.
      role: role === 'admin' ? 'manager' : 'member',
      invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${invitation.token}`,
      message,
    })
  } catch (emailError) {
    log.error({ err: emailError }, 'Failed to send invitation email')
  }

  return {
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      type: invitation.type,
      createdAt: invitation.createdAt,
    },
  }
}
