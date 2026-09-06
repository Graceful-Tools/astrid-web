/**
 * RED for task e0613ae5 — the two list-create routes each validate what the
 * other does not, so a caller gets a different answer depending which one the
 * client happens to use.
 *
 *   legacy POST /api/lists   trims the name, does NOT validate privacy
 *   v1     POST /api/v1/lists validates privacy, does NOT trim the name
 *
 * Both gaps are the same shape as bugs already fixed elsewhere in this repo:
 * an unvalidated value reaching a Postgres enum surfaces as a driver error —
 * a 500 where the caller deserved a 400 — and an untrimmed string means a list
 * can be created named "   ", which renders as a blank row nobody can identify.
 *
 * Legacy is the endpoint the WEB client uses, so the missing privacy check is
 * the live one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn() },
    listMember: { create: vi.fn(), createMany: vi.fn() },
    listInvite: { create: vi.fn() },
    user: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)({}) : fn
    ),
  },
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendListInvitationEmail: vi.fn() }))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { LIST_ADDED: 'LIST_ADDED' },
  trackEventFromRequest: vi.fn(),
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

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    get: vi.fn(), set: vi.fn(), del: vi.fn(),
    delPattern: vi.fn(async () => undefined),
    getOrSet: vi.fn((_k: string, f: () => unknown) => f()),
    keys: { userLists: (id: string) => `lists:user:${id}`, userListsV1: (id: string) => `lists:user:${id}:v1` },
    invalidate: { userLists: vi.fn(), userListsAllVersions: vi.fn() },
  },
}))

import { POST as legacyPOST } from '@/app/api/lists/route'
import { POST as v1POST } from '@/app/api/v1/lists/route'
import { prisma } from '@/lib/prisma'
import { getUnifiedSession } from '@/lib/session-utils'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockSession = vi.mocked(getUnifiedSession)
const mockAuth = vi.mocked(authenticateAPI)

const USER = 'user-1'

function legacyReq(body: unknown) {
  return new NextRequest('http://localhost/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function v1Req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: USER, email: 'jon@example.com' } } as never)
  mockAuth.mockResolvedValue({
    userId: USER,
    source: 'oauth' as const,
    scopes: ['lists:read', 'lists:write'],
    isAIAgent: false,
    user: { id: USER, email: 'jon@example.com', name: 'Jon', isAIAgent: false },
  } as never)
  mockPrisma.taskList.create.mockResolvedValue({
    id: 'list-1', name: 'Work', ownerId: USER, owner: {}, listMembers: [],
  } as never)
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
  mockPrisma.taskList.update.mockResolvedValue({ id: 'list-1', name: 'Work', owner: {}, listMembers: [] } as never)
  mockPrisma.listMember.createMany.mockResolvedValue({ count: 0 } as never)
})

describe('legacy POST /api/lists rejects an invalid privacy (task e0613ae5)', () => {
  it('answers 400 rather than letting the value reach the enum column', async () => {
    // v1 already does this. Legacy is the route the web client uses, so this
    // is the one users can actually hit: Prisma rejects the unknown label and
    // the request surfaces as a 500.
    const res = await legacyPOST(legacyReq({ name: 'Work', privacy: 'BANANA' }))

    expect(res.status).toBe(400)
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })

  it('is case-sensitive, because the Postgres enum is', async () => {
    expect((await legacyPOST(legacyReq({ name: 'Work', privacy: 'private' }))).status).toBe(400)
  })

  it('still accepts the three real values', async () => {
    // No clearAllMocks inside the loop — it would wipe the beforeEach setup and
    // make every iteration fail for an unrelated reason.
    for (const privacy of ['PRIVATE', 'SHARED', 'PUBLIC']) {
      const res = await legacyPOST(legacyReq({ name: 'Work', privacy }))
      expect(res.status, `privacy ${privacy} should be accepted`).toBeLessThan(400)
    }
  })
})

describe('v1 POST /api/v1/lists trims the name (task e0613ae5)', () => {
  it('does not request a redundant task count include (task 96127607)', async () => {
    await v1POST(v1Req({ name: 'Work' }))

    expect(mockPrisma.taskList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({
          _count: expect.anything(),
        }),
      })
    )
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled()
  })

  it('stores a trimmed name, as legacy always has', async () => {
    await v1POST(v1Req({ name: '  Work  ' }))

    const data = (mockPrisma.taskList.create.mock.calls[0][0] as never as {
      data: { name: string }
    }).data
    expect(data.name).toBe('Work')
  })

  it('rejects a whitespace-only name instead of creating a blank list', async () => {
    // "   " is a non-empty string, so the old typeof check passed it and the
    // list rendered as an unidentifiable blank row.
    const res = await v1POST(v1Req({ name: '   ' }))

    expect(res.status).toBe(400)
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })
})

describe('legacy POST /api/lists batches list creation members', () => {
  it('loads email members once and inserts all memberships in one batch', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'email-user-1', email: 'one@example.com' },
      { id: 'email-user-2', email: 'two@example.com' },
    ] as never)
    mockPrisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.email === 'one@example.com') {
        return { id: 'email-user-1', email: where.email } as never
      }
      if (where.email === 'two@example.com') {
        return { id: 'email-user-2', email: where.email } as never
      }
      return null
    })
    mockPrisma.listMember.create.mockResolvedValue({ id: 'membership' } as never)
    mockPrisma.listInvite.create.mockResolvedValue({ id: 'invite' } as never)

    const res = await legacyPOST(legacyReq({
      name: 'Work',
      privacy: 'SHARED',
      adminIds: ['admin-1'],
      memberIds: ['member-1'],
      memberEmails: ['ONE@example.com', ' two@example.com '],
    }))

    expect(res.status).toBe(200)
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.listMember.create).not.toHaveBeenCalled()
    expect(mockPrisma.listMember.createMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.listMember.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { listId: 'list-1', userId: USER, role: 'admin' },
        { listId: 'list-1', userId: 'admin-1', role: 'admin' },
        { listId: 'list-1', userId: 'member-1', role: 'member' },
        { listId: 'list-1', userId: 'email-user-1', role: 'member' },
        { listId: 'list-1', userId: 'email-user-2', role: 'member' },
      ]),
      skipDuplicates: true,
    })
  })

  it('creates missing email users in one race-safe batch and deduplicates invitations', async () => {
    mockPrisma.user.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { id: 'new-user', email: 'new@example.com' },
      ] as never)
    mockPrisma.user.createMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.listInvite.create.mockResolvedValue({ id: 'invite' } as never)

    const res = await legacyPOST(legacyReq({
      name: 'Work',
      privacy: 'SHARED',
      memberEmails: ['New@example.com', ' new@example.com '],
    }))

    expect(res.status).toBe(200)
    expect(mockPrisma.user.createMany).toHaveBeenCalledWith({
      data: [{ email: 'new@example.com', name: null }],
      skipDuplicates: true,
    })
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2)
    expect(mockPrisma.listInvite.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.listMember.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { listId: 'list-1', userId: 'new-user', role: 'member' },
      ]),
      skipDuplicates: true,
    })
  })
})
