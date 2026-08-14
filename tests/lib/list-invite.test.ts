/**
 * Task e0613ae5 — the list invitation flow, shared by /api/lists/:id/invite and
 * its v1 twin.
 *
 * This endpoint emails an arbitrary address, with a caller-supplied message,
 * from our domain. So the order of the checks is part of the contract, not an
 * implementation detail: the rate limit runs before any query, and the two
 * permission checks are separate because "may manage members" and "may grant
 * THIS role" are different questions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

const checkRateLimitByKeyAsync = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rate-limiter', () => ({
  inviteRateLimiter: { checkRateLimitByKeyAsync },
}))

const canUserManageMembers = vi.hoisted(() => vi.fn(() => true))
const canAssignRole = vi.hoisted(() => vi.fn(() => true))
const getUserRoleInList = vi.hoisted(() => vi.fn(() => null))
vi.mock('@/lib/list-permissions', () => ({
  canUserManageMembers, canAssignRole, getUserRoleInList,
  prismaToTaskList: vi.fn((l: unknown) => l),
}))

const sendListInvitationEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email', () => ({ sendListInvitationEmail }))

import { inviteToList } from '@/lib/list-invite'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

const inviter = { id: 'inviter-1', email: 'jon@example.com', name: 'Jon' }
const base = { listId: 'list-1', inviter, email: 'new@example.com', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  checkRateLimitByKeyAsync.mockResolvedValue({ allowed: true, resetTime: 0 })
  canUserManageMembers.mockReturnValue(true)
  canAssignRole.mockReturnValue(true)
  getUserRoleInList.mockReturnValue(null)
  mockPrisma.taskList.findUnique.mockResolvedValue(
    { id: 'list-1', name: 'Work', owner: {}, listMembers: [] } as never
  )
  mockPrisma.user.findUnique.mockResolvedValue(null as never)
  mockPrisma.invitation.findFirst.mockResolvedValue(null as never)
  mockPrisma.invitation.create.mockResolvedValue({
    id: 'inv-1', email: 'new@example.com', role: 'member',
    type: 'LIST_SHARING', createdAt: new Date(), token: 'inv_abc',
  } as never)
  sendListInvitationEmail.mockResolvedValue(undefined)
})

describe('inviteToList (task e0613ae5)', () => {
  it('sends the invitation on the happy path', async () => {
    const result = await inviteToList(base)

    expect(result).toMatchObject({ ok: true, invitation: { id: 'inv-1' } })
    expect(sendListInvitationEmail).toHaveBeenCalled()
  })

  it('rate limits BEFORE touching the database', async () => {
    // A limited caller must not be able to burn queries either.
    checkRateLimitByKeyAsync.mockResolvedValue({ allowed: false, resetTime: Date.now() + 30_000 })

    const result = await inviteToList(base)

    expect(result).toMatchObject({ ok: false, status: 429 })
    expect(result.ok === false && result.retryAfterSeconds).toBeGreaterThan(0)
    expect(mockPrisma.taskList.findUnique).not.toHaveBeenCalled()
    expect(sendListInvitationEmail).not.toHaveBeenCalled()
  })

  it('rate limits per inviter, not globally', async () => {
    await inviteToList(base)

    expect(checkRateLimitByKeyAsync).toHaveBeenCalledWith('invite:inviter-1')
  })

  it('requires both email and role', async () => {
    expect(await inviteToList({ ...base, email: undefined })).toMatchObject({ ok: false, status: 400 })
    expect(await inviteToList({ ...base, role: undefined })).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses roles that are not grantable by invitation', async () => {
    // owner is transferred, not handed out; viewer is a property of a public
    // list rather than a seat.
    for (const role of ['owner', 'viewer', 'ADMIN', 'superuser']) {
      expect(await inviteToList({ ...base, role })).toMatchObject({ ok: false, status: 400 })
    }
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled()
  })

  it('404s a list that does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

    expect(await inviteToList(base)).toMatchObject({ ok: false, status: 404, error: 'List not found' })
  })

  it('refuses a caller who cannot manage members', async () => {
    canUserManageMembers.mockReturnValue(false)

    expect(await inviteToList(base)).toMatchObject({ ok: false, status: 403, error: 'Access denied' })
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled()
  })

  it('refuses a caller who may manage members but not grant THIS role', async () => {
    // Separate check on purpose: an admin may invite members without being
    // able to mint other admins.
    canUserManageMembers.mockReturnValue(true)
    canAssignRole.mockReturnValue(false)

    expect(await inviteToList({ ...base, role: 'admin' }))
      .toMatchObject({ ok: false, status: 403, error: 'Cannot assign this role' })
  })

  it('refuses to invite the list owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner-1' } as never)
    getUserRoleInList.mockReturnValue('owner' as never)

    expect(await inviteToList(base))
      .toMatchObject({ ok: false, status: 400, error: 'User is already a member of this list' })
  })

  it('refuses to invite an existing member', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'member-2' } as never)
    mockPrisma.taskList.findUnique.mockResolvedValue(
      { id: 'list-1', name: 'Work', owner: {}, listMembers: [{ userId: 'member-2' }] } as never
    )

    expect(await inviteToList(base)).toMatchObject({ ok: false, status: 400 })
  })

  it('invites an address with no account yet', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never)

    const result = await inviteToList(base)

    expect(result.ok).toBe(true)
    const data = (mockPrisma.invitation.create.mock.calls[0][0] as never as {
      data: { receiverId?: string }
    }).data
    expect(data.receiverId).toBeUndefined()
  })

  it('refuses a duplicate pending invitation', async () => {
    mockPrisma.invitation.findFirst.mockResolvedValue({ id: 'inv-old' } as never)

    expect(await inviteToList(base))
      .toMatchObject({ ok: false, status: 400, error: 'Invitation already pending for this user' })
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled()
  })

  it('mints an unguessable token and a 7-day expiry', async () => {
    const before = Date.now()

    await inviteToList(base)

    const data = (mockPrisma.invitation.create.mock.calls[0][0] as never as {
      data: { token: string; expiresAt: Date; type: string }
    }).data
    expect(data.token).toMatch(/^inv_[0-9a-f]{32}$/)
    expect(data.type).toBe('LIST_SHARING')
    const days = (data.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('calls an admin invite a "manager" in the email', async () => {
    await inviteToList({ ...base, role: 'admin' })

    expect(sendListInvitationEmail.mock.calls[0][0]).toMatchObject({ role: 'manager' })
  })

  it('still succeeds when the email fails to send', async () => {
    // The invitation row is what makes the link work. A mail outage must not
    // fail the request or leave the caller thinking nothing happened.
    sendListInvitationEmail.mockRejectedValue(new Error('smtp down'))

    expect((await inviteToList(base)).ok).toBe(true)
  })
})
