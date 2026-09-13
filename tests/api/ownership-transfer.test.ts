/**
 * Ownership transfer, through BOTH doors — task aa5a35f0.
 *
 * `POST /api/lists/:id/transfer-ownership` and `POST
 * /api/v1/lists/:id/transfer-ownership` are two handlers over one rule
 * (lib/list-ownership-transfer.ts). Each owns only what genuinely differs:
 * legacy has session auth and a bare response, v1 has OAuth scopes and a `meta`
 * envelope.
 *
 * Every behavioural case below therefore runs through BOTH routes against the
 * same mocked database, and asserts the same end state — so a future change to
 * one path cannot silently skip the other. That is the whole point of the
 * refactor: the legacy handler used to own its own copy, inlining its owner
 * check as `existingList.ownerId !== session.user.id` rather than going through
 * lib/list-permissions.ts (CLAUDE.md rule 6), and hand-rolling the membership
 * deletes.
 *
 * This file used to assert the legacy route's internal Prisma call sequence.
 * Those assertions moved to tests/lib/list-ownership-transfer.test.ts, where
 * the rule now lives; what belongs here is that both routes agree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    listMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))

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
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

import { POST as legacyPOST } from '@/app/api/lists/[id]/transfer-ownership/route'
import { POST as v1POST } from '@/app/api/v1/lists/[id]/transfer-ownership/route'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { getUnifiedSession } from '@/lib/session-utils'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockRedis = vi.mocked(RedisCache, true)
const mockSession = vi.mocked(getUnifiedSession)
const mockApiAuth = vi.mocked(authenticateAPI)

const OWNER = 'owner-id'
const NEW_OWNER = 'new-owner-id'
const LIST = { id: 'list-1', ownerId: OWNER }

type MockTx = {
  taskList: { update: ReturnType<typeof vi.fn> }
  listMember: { deleteMany: ReturnType<typeof vi.fn> }
}

let tx: MockTx

/** Drives one route, hiding only the auth plumbing that differs between them. */
const DOORS = {
  legacy: (body?: unknown) =>
    legacyPOST(makeReq('http://localhost/api/lists/list-1/transfer-ownership', body), {
      params: Promise.resolve({ id: 'list-1' }),
    } as never),
  v1: (body?: unknown) =>
    v1POST(makeReq('http://localhost/api/v1/lists/list-1/transfer-ownership', body), {
      params: Promise.resolve({ id: 'list-1' }),
    } as never),
} as const

function makeReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Signs in `userId` on BOTH auth mechanisms, so either door can be driven. */
function signIn(userId: string) {
  mockSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@example.com`, name: userId },
  } as never)
  mockApiAuth.mockResolvedValue({
    userId,
    source: 'oauth' as const,
    scopes: ['lists:read', 'lists:write', 'lists:manage_members'],
    isAIAgent: false,
    user: { id: userId, email: `${userId}@example.com`, name: userId, isAIAgent: false },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  signIn(OWNER)
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
  // `user` is selected by the real query: eligibility turns on whether the
  // successor is an AI agent (task f4b40af3).
  mockPrisma.listMember.findFirst.mockResolvedValue({
    id: 'member-1',
    listId: 'list-1',
    userId: NEW_OWNER,
    role: 'admin',
    user: { isAIAgent: false },
  } as never)
  mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)

  tx = {
    taskList: { update: vi.fn() },
    listMember: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  }
  mockPrisma.$transaction.mockImplementation((async (cb: (t: MockTx) => unknown) => cb(tx)) as never)
})

describe.each(Object.keys(DOORS) as Array<keyof typeof DOORS>)(
  'POST transfer-ownership — %s route (task aa5a35f0)',
  door => {
    const post = (body?: unknown) => DOORS[door](body)

    it('transfers ownership and removes both membership rows in one transaction', async () => {
      const res = await post({ newOwnerId: NEW_OWNER })

      expect(res.status).toBe(200)
      expect((await res.json()).message).toBe('Ownership transferred successfully')
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.taskList.update).toHaveBeenCalledWith({
        where: { id: 'list-1' },
        data: { ownerId: NEW_OWNER },
      })
      expect(tx.listMember.deleteMany).toHaveBeenCalledWith({
        where: { listId: 'list-1', userId: { in: [NEW_OWNER, OWNER] } },
      })
    })

    it('invalidates the lists cache for both the old and the new owner', async () => {
      await post({ newOwnerId: NEW_OWNER })

      expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith(OWNER)
      expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith(NEW_OWNER)
    })

    it('400s a missing newOwnerId', async () => {
      const res = await post({})

      expect(res.status).toBe(400)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s a list that does not exist', async () => {
      mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

      const res = await post({ newOwnerId: NEW_OWNER })

      expect(res.status).toBe(404)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('403s a caller who is not the owner', async () => {
      signIn('not-the-owner')

      const res = await post({ newOwnerId: NEW_OWNER })

      expect(res.status).toBe(403)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('400s a successor who is not already a member', async () => {
      mockPrisma.listMember.findFirst.mockResolvedValue(null as never)

      const res = await post({ newOwnerId: 'stranger-id' })

      expect(res.status).toBe(400)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('transfers to a plain member, not only to an admin', async () => {
      mockPrisma.listMember.findFirst.mockResolvedValue({
        id: 'member-9',
        listId: 'list-1',
        userId: NEW_OWNER,
        role: 'member',
        user: { isAIAgent: false },
      } as never)

      const res = await post({ newOwnerId: NEW_OWNER })

      expect(res.status).toBe(200)
      expect(tx.taskList.update).toHaveBeenCalledWith({
        where: { id: 'list-1' },
        data: { ownerId: NEW_OWNER },
      })
    })

    it('500s when the transaction fails, rather than reporting a transfer that did not happen', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('db down') as never)

      const res = await post({ newOwnerId: NEW_OWNER })

      expect(res.status).toBe(500)
      expect(mockRedis.invalidate.userListsAllVersions).not.toHaveBeenCalled()
    })

    it('answers a transfer-to-self with 200 and writes nothing', async () => {
      mockPrisma.listMember.findFirst.mockResolvedValue({
        id: 'member-1',
        listId: 'list-1',
        userId: OWNER,
        role: 'admin',
        user: { isAIAgent: false },
      } as never)

      const res = await post({ newOwnerId: OWNER })

      // 200 is the long-standing contract here, and it is the right answer —
      // you do own the list. What used to happen underneath was not: it deleted
      // the owner's own membership row.
      expect(res.status).toBe(200)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })
  }
)

describe('POST transfer-ownership — what differs between the doors', () => {
  it('401s the legacy route with no session', async () => {
    mockSession.mockResolvedValue(null as never)

    const res = await DOORS.legacy({ newOwnerId: NEW_OWNER })

    expect(res.status).toBe(401)
  })

  it('carries the v1 meta envelope on v1 only', async () => {
    const v1Body = await (await DOORS.v1({ newOwnerId: NEW_OWNER })).json()
    const legacyBody = await (await DOORS.legacy({ newOwnerId: NEW_OWNER })).json()

    expect(v1Body.meta).toEqual({ apiVersion: 'v1', authSource: 'oauth' })
    expect(legacyBody.meta).toBeUndefined()
  })
})
