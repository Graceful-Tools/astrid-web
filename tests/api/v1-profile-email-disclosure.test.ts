/**
 * Task e0613ae5 (found while collapsing the duplicated legacy↔v1 routes).
 *
 * `GET /api/v1/users/:userId/profile` disclosed EVERY user's email address to
 * any authenticated caller.
 *
 * The object literal read:
 *
 *   user: {
 *     id, name,
 *     email: profileUser.email,                              // unconditional
 *     image,
 *     ...(isOwnProfile ? { email: profileUser.email } : {}), // conditional
 *     ...
 *   }
 *
 * The conditional spread was written to gate the field, and its comment says
 * exactly that — "returning any user's email to any authenticated caller is an
 * info-disclosure". But an earlier unconditional `email` was left above it, and
 * a spread of `{}` overrides nothing. So the gate never gated: on someone
 * else's profile the spread contributed nothing and the unconditional value
 * survived.
 *
 * The legacy route has only the conditional spread and was always correct. The
 * two implementations disagreed about who may see an email address, which is
 * the strongest argument yet for not maintaining the same endpoint twice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/user-stats', () => ({
  getUserStats: vi.fn(async () => ({ completedTasks: 1, inspiredTasks: 2, supportedTasks: 3 })),
}))

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

import { GET } from '@/app/api/v1/users/[userId]/profile/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const VIEWER = 'viewer-1'
const OTHER = 'other-2'

function authAs(userId: string) {
  return {
    userId,
    source: 'oauth' as const,
    scopes: ['user:read'],
    isAIAgent: false,
    user: { id: userId, email: 'viewer@example.com', name: 'Viewer', isAIAgent: false },
  }
}

function profile(id: string) {
  return {
    id,
    name: 'Someone',
    email: `${id}@example.com`,
    image: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    isAIAgent: false,
    aiAgentType: null,
  }
}

async function getProfile(targetUserId: string) {
  const res = await GET(
    new NextRequest(`http://localhost/api/v1/users/${targetUserId}/profile`) as never,
    { params: Promise.resolve({ userId: targetUserId }) } as never,
  )
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(authAs(VIEWER) as never)
  mockPrisma.task.findMany.mockResolvedValue([] as never)
})

describe('GET /api/v1/users/:userId/profile — email disclosure (task e0613ae5)', () => {
  it("does NOT return another user's email address", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(profile(OTHER) as never)

    const body = await getProfile(OTHER)

    expect(body.user.id).toBe(OTHER)
    expect(body.user).not.toHaveProperty('email')
    expect(JSON.stringify(body.user)).not.toContain(`${OTHER}@example.com`)
    expect(body.isOwnProfile).toBe(false)
  })

  it('still returns your own email on your own profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(profile(VIEWER) as never)

    const body = await getProfile(VIEWER)

    expect(body.user.email).toBe(`${VIEWER}@example.com`)
    expect(body.isOwnProfile).toBe(true)
  })

  it('keeps the non-sensitive profile fields either way', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(profile(OTHER) as never)

    const body = await getProfile(OTHER)

    expect(body.user).toMatchObject({ id: OTHER, name: 'Someone', isAIAgent: false })
    expect(body.stats).toEqual({ completed: 1, inspired: 2, supported: 3 })
  })
})
