/**
 * Task e0613ae5 (found while reading the duplicated legacy↔v1 pairs).
 *
 * `POST /api/lists/:id/invite` is rate limited — 30 per user per hour — with an
 * explicit comment saying why: "spam guard — invites email arbitrary
 * addresses". The v1 twin had no limit at all, so the guard was bypassable by
 * calling the v1 route instead.
 *
 * That matters more than a typical parity gap because of what the endpoint
 * does: it sends email to an address the caller supplies, containing a
 * `message` the caller writes. An unlimited version of that is a spam relay
 * wearing the product's name and sending from its domain.
 *
 * Rate limiting is not a v1-wide omission either — v1's oauth/token,
 * auth/apple, auth/google, openclaw/register and agent/* routes all rate
 * limit. This one route was simply missed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// vi.hoisted, because vi.mock is hoisted above ordinary top-level consts — a
// plain `const fn = vi.fn()` referenced in the factory throws "Cannot access
// before initialization". It only surfaced once the route actually imported
// the limiter, since an unused mock factory is never evaluated.
const { checkRateLimitByKeyAsync } = vi.hoisted(() => ({
  checkRateLimitByKeyAsync: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({
  inviteRateLimiter: { checkRateLimitByKeyAsync },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/email', () => ({ sendListInvitationEmail: vi.fn() }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { POST } from '@/app/api/v1/lists/[id]/invite/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { sendListInvitationEmail } from '@/lib/email'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockSendEmail = vi.mocked(sendListInvitationEmail)

const OWNER = {
  id: 'owner-1', email: 'owner@example.com', name: 'Owner', isAIAgent: false,
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/lists/list-1/invite', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ctx = { params: Promise.resolve({ id: 'list-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    userId: OWNER.id,
    source: 'oauth',
    scopes: ['lists:manage_members'],
    isAIAgent: false,
    user: OWNER,
  } as never)
  checkRateLimitByKeyAsync.mockResolvedValue({
    allowed: true, remaining: 29, resetTime: Date.now() + 3_600_000, total: 30,
  })
  mockPrisma.taskList.findUnique.mockResolvedValue({
    id: 'list-1', name: 'Work', ownerId: OWNER.id, owner: OWNER, listMembers: [],
  } as never)
  mockPrisma.user.findUnique.mockResolvedValue(null as never)
  mockPrisma.invitation.findFirst.mockResolvedValue(null as never)
  mockPrisma.invitation.create.mockResolvedValue({
    id: 'inv-1', email: 'new@example.com', role: 'member',
    type: 'LIST_SHARING', token: 'inv_x', createdAt: new Date('2026-08-13T00:00:00.000Z'),
  } as never)
})

describe('POST /api/v1/lists/:id/invite — rate limit (task e0613ae5)', () => {
  it('rate limits per user, as the legacy route does', async () => {
    const resetTime = Date.now() + 120_000
    checkRateLimitByKeyAsync.mockResolvedValue({
      allowed: false, remaining: 0, resetTime, total: 30,
    })

    const response = await POST(req({ email: 'new@example.com', role: 'member' }) as never, ctx as never)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()

    // The point of the limit: no invitation row, and no email sent.
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('keys the limit on the inviting user, not the list or the IP', async () => {
    await POST(req({ email: 'new@example.com', role: 'member' }) as never, ctx as never)

    expect(checkRateLimitByKeyAsync).toHaveBeenCalledWith(`invite:${OWNER.id}`)
  })

  it('lets an invitation through when under the limit', async () => {
    const response = await POST(req({ email: 'new@example.com', role: 'member' }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mockPrisma.invitation.create).toHaveBeenCalled()
  })

  it('checks the limit BEFORE doing any work', async () => {
    // A limiter that runs after the lookups still lets an attacker burn
    // database queries; and if it ran after the create, it would not be a
    // limit at all.
    checkRateLimitByKeyAsync.mockResolvedValue({
      allowed: false, remaining: 0, resetTime: Date.now() + 1000, total: 30,
    })

    await POST(req({ email: 'new@example.com', role: 'member' }) as never, ctx as never)

    expect(mockPrisma.taskList.findUnique).not.toHaveBeenCalled()
  })
})
