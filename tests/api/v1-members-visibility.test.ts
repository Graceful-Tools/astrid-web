/**
 * RED for task 10579245 — GET /api/v1/lists/:id/members refused a plain member.
 *
 * Legacy and v1 disagreed, so the same user got different answers depending on
 * which client they opened:
 *
 *   caller                     legacy (web)                       v1 (iOS)
 *   owner / admin              full member list                   full member list
 *   plain member               full member list                   403
 *   non-member, PUBLIC list    { members: [], user_role:'viewer' } 403
 *   non-member, private list   403                                403
 *
 * Jon's call (2026-08-14): "List members should see other list members. This is
 * correct." So v1 moves to legacy's rule, not the other way round.
 *
 * The member list carries EMAIL ADDRESSES, which is why this was raised as a
 * decision rather than fixed on sight — widening it is a privacy change, and it
 * needed to be someone's deliberate choice.
 *
 * The PUBLIC-list case is covered too. It is the subtle half: a non-member
 * looking at a public list must get an EMPTY member list rather than either a
 * 403 or the real one. Empty-plus-viewer is what lets the UI render a public
 * list without disclosing who is on it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { userId: CALLER, scopes: ['lists:read'] }, ctx),
}))

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique },
    listInvite: { findMany: vi.fn().mockResolvedValue([]) },
    invitation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const CALLER = 'user-caller'
const OWNER = 'user-owner'

function listWith(opts: {
  role?: 'admin' | 'member'
  privacy?: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  includeCaller?: boolean
}) {
  const { role = 'member', privacy = 'SHARED', includeCaller = true } = opts
  return {
    id: 'list-1',
    name: 'Shared list',
    privacy,
    ownerId: OWNER,
    owner: { id: OWNER, name: 'Owner', email: 'owner@example.com', image: null, isAIAgent: false },
    listMembers: [
      {
        userId: 'user-other',
        role: 'member',
        user: { id: 'user-other', name: 'Other', email: 'other@example.com', image: null, isAIAgent: false },
      },
      ...(includeCaller
        ? [{
            userId: CALLER,
            role,
            user: { id: CALLER, name: 'Caller', email: 'caller@example.com', image: null, isAIAgent: false },
          }]
        : []),
    ],
  }
}

function get() {
  return new NextRequest('http://localhost/api/v1/lists/list-1/members')
}

const ctx = { params: Promise.resolve({ id: 'list-1' }) } as never

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/lists/:id/members visibility (task 10579245)', () => {
  it('lets a PLAIN MEMBER see the other members', async () => {
    findUnique.mockResolvedValue(listWith({ role: 'member' }))
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')

    const response = await GET(get(), ctx)

    expect(response.status).toBe(200)
    const body = await response.json()
    // The whole point of the decision: a member can tell who else has access
    // to their tasks.
    const ids = body.members.map((m: { id: string }) => m.id)
    expect(ids).toContain(OWNER)
    expect(ids).toContain('user-other')
  })

  it('still lets an admin see the members', async () => {
    findUnique.mockResolvedValue(listWith({ role: 'admin' }))
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')

    expect((await GET(get(), ctx)).status).toBe(200)
  })

  it('still 403s a non-member on a private list', async () => {
    findUnique.mockResolvedValue(listWith({ includeCaller: false, privacy: 'PRIVATE' }))
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')

    // Widening this to members must NOT widen it to strangers — the response
    // carries email addresses.
    expect((await GET(get(), ctx)).status).toBe(403)
  })

  it('gives a non-member on a PUBLIC list an empty list, not a 403 and not the real one', async () => {
    findUnique.mockResolvedValue(listWith({ includeCaller: false, privacy: 'PUBLIC' }))
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')

    const response = await GET(get(), ctx)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.members).toEqual([])
    expect(body.user_role).toBe('viewer')
  })

  it('404s when the list does not exist, before any visibility question', async () => {
    findUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')

    expect((await GET(get(), ctx)).status).toBe(404)
  })
})
