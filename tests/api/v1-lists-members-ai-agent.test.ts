/**
 * GET /api/v1/lists/[id]/members must report isAIAgent (task dc143ab2).
 *
 * `components/list-members-manager.tsx` reads `member.isAIAgent` to tell an AI
 * agent member apart from a person. Legacy's members response carries it; v1's
 * projection does not, so migrating that call site would render every AI agent
 * as an ordinary user — no error, just a member list that quietly stops
 * distinguishing them.
 *
 * Seventh gap of this shape under the retirement. The rule by now: check the
 * projection against real consumer reads before moving any call site.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), findFirst: vi.fn() },
    listInvite: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET } from '@/app/api/v1/lists/[id]/members/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const owner = { id: 'u1', name: 'Jon', email: 'j@e.com', image: null, isAIAgent: false }
const human = { id: 'u2', name: 'Sam', email: 's@e.com', image: null, isAIAgent: false }
const agent = { id: 'u3', name: 'Astrid', email: 'astrid@e.com', image: null, isAIAgent: true }

const ctx = { params: Promise.resolve({ id: 'l1' }) }

async function members() {
  const response = await GET(new NextRequest('http://localhost/api/v1/lists/l1/members'), ctx as never)
  const body = await response.json()
  return body.members as Array<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findUnique.mockResolvedValue({
    id: 'l1',
    ownerId: 'u1',
    owner,
    listMembers: [
      { role: 'member', user: human },
      { role: 'member', user: agent },
    ],
  } as never)
  mockPrisma.listInvite.findMany.mockResolvedValue([] as never)
})

describe('GET /api/v1/lists/[id]/members isAIAgent (task dc143ab2)', () => {
  it('marks an AI agent member as one', async () => {
    const found = (await members()).find((m) => m.id === 'u3')

    expect(found?.isAIAgent).toBe(true)
  })

  it('marks a person as not an agent, rather than leaving it undefined', async () => {
    // undefined is falsy, so the UI would happen to render people correctly and
    // agents incorrectly — the half-working case that hides the bug.
    const found = (await members()).find((m) => m.id === 'u2')

    expect(found?.isAIAgent).toBe(false)
  })

  it('reports the owner too', async () => {
    const found = (await members()).find((m) => m.id === 'u1')

    expect(found?.isAIAgent).toBe(false)
  })

  it('keeps the fields it already returned', async () => {
    const found = (await members()).find((m) => m.id === 'u2')

    expect(found).toMatchObject({ name: 'Sam', role: 'member', type: 'member', isOwner: false })
  })
})

describe('the query actually fetches isAIAgent (task dc143ab2)', () => {
  // The tests above mock Prisma, so they would stay green against a query that
  // never selects the field — the projection would read undefined in
  // production and pass in CI. Assert the select, not just the shape.
  it('selects isAIAgent for the owner and for each member', async () => {
    await members()

    const call = mockPrisma.taskList.findUnique.mock.calls[0][0] as never as {
      include: {
        owner: { select: Record<string, boolean> }
        listMembers: { include: { user: { select: Record<string, boolean> } } }
      }
    }
    expect(call.include.owner.select.isAIAgent).toBe(true)
    expect(call.include.listMembers.include.user.select.isAIAgent).toBe(true)
  })
})
