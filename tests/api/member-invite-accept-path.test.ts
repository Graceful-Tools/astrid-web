/**
 * RED for task 706230e3 — inviting someone with no account, via Add Member,
 * emailed them a link that could not be accepted.
 *
 * Both members routes wrote a `ListInvite` row and mailed
 * `${NEXTAUTH_URL}/invite/${token}`. That page calls /api/invitations/:token,
 * which reads `Invitation` and has no knowledge of `ListInvite` — and nothing
 * anywhere resolves a ListInvite token for acceptance. So the row was
 * write-only and the recipient hit a dead end.
 *
 * These tests assert on the WRITE, because that is where the bug is: the
 * invitation has to land in the table the accept route actually reads. Asserting
 * the accept route works would test code that was already correct.
 *
 * The row must also be shaped so the existing LIST_SHARING branch of
 * /api/invitations/:token can act on it — it upserts a ListMember from
 * `invitation.listId` and `invitation.role`, so both have to be set, and the
 * type has to be LIST_SHARING or that branch never runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    listMember: { findFirst: vi.fn(), create: vi.fn() },
    listInvite: { create: vi.fn(), findFirst: vi.fn() },
    invitation: { create: vi.fn(), findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const sendListInvitationEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email', () => ({ sendListInvitationEmail }))

vi.mock('@/lib/list-permissions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/list-permissions')>()
  return { ...actual }
})

import { POST as v1POST } from '@/app/api/v1/lists/[id]/members/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const OWNER = 'owner-1'
const auth = {
  userId: OWNER,
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: OWNER, email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const params = Promise.resolve({ id: 'list-1' })

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/lists/list-1/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockPrisma.taskList.findUnique.mockResolvedValue({
    id: 'list-1',
    name: 'Work',
    ownerId: OWNER,
    owner: { id: OWNER, name: 'Jon', email: 'jon@example.com', image: null, isAIAgent: false },
    listMembers: [],
  } as never)
  // The address has no account — this is the branch that mails an invite.
  mockPrisma.user.findUnique.mockResolvedValue(null as never)
  mockPrisma.invitation.findFirst.mockResolvedValue(null as never)
  mockPrisma.listInvite.findFirst.mockResolvedValue(null as never)
  mockPrisma.invitation.create.mockResolvedValue({ id: 'inv-1', token: 'tok' } as never)
  mockPrisma.listInvite.create.mockResolvedValue({ id: 'li-1', token: 'tok' } as never)
  sendListInvitationEmail.mockResolvedValue(undefined)
})

describe('v1 Add Member writes an acceptable invitation (task 706230e3)', () => {
  it('writes to the table the accept route reads', async () => {
    await v1POST(req({ email: 'new@example.com', role: 'member' }), { params } as never)

    expect(mockPrisma.invitation.create).toHaveBeenCalled()
  })

  it('shapes the row so the LIST_SHARING accept branch can act on it', async () => {
    // /api/invitations/:token switches on type, then upserts a ListMember from
    // listId + role. Any of the three missing and acceptance silently does
    // nothing useful.
    await v1POST(req({ email: 'new@example.com', role: 'admin' }), { params } as never)

    const data = (mockPrisma.invitation.create.mock.calls[0][0] as never as {
      data: Record<string, unknown>
    }).data

    expect(data.type).toBe('LIST_SHARING')
    expect(data.listId).toBe('list-1')
    expect(data.role).toBe('admin')
    expect(data.email).toBe('new@example.com')
    expect(data.token).toEqual(expect.any(String))
    expect(data.expiresAt).toBeInstanceOf(Date)
  })

  it('emails the same token it stored', async () => {
    // The link and the row have to agree, or the fix is cosmetic.
    await v1POST(req({ email: 'new@example.com', role: 'member' }), { params } as never)

    const stored = (mockPrisma.invitation.create.mock.calls[0][0] as never as {
      data: { token: string }
    }).data.token
    const mailed = sendListInvitationEmail.mock.calls[0][0].invitationUrl as string

    expect(mailed).toContain(stored)
  })
})
