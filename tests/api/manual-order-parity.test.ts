/**
 * Manual reorder through BOTH doors — task 7883f710.
 *
 * `POST /api/lists/:id/manual-order` and its v1 twin are two handlers over one
 * rule (lib/list-manual-order.ts). Legacy has session auth and returns the bare
 * list; v1 has OAuth scopes and returns `{ list, order, meta }`.
 *
 * Every behavioural case runs through both against the same mocked database, so
 * the versioned door the Windows client uses cannot drift from the one the web
 * client uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
}))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

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

import { POST as legacyPOST } from '@/app/api/lists/[id]/manual-order/route'
import { POST as v1POST } from '@/app/api/v1/lists/[id]/manual-order/route'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { getUnifiedSession } from '@/lib/session-utils'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockRedis = vi.mocked(RedisCache, true)
const mockSession = vi.mocked(getUnifiedSession)
const mockApiAuth = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

const OWNER = 'owner-1'

const LIST = {
  id: 'list-1',
  ownerId: OWNER,
  isVirtual: false,
  privacy: 'PRIVATE',
  publicListType: null,
  listMembers: [] as Array<{ userId: string; role: string }>,
}

function makeReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const DOORS = {
  legacy: (body?: unknown) =>
    legacyPOST(makeReq('http://localhost/api/lists/list-1/manual-order', body), {
      params: Promise.resolve({ id: 'list-1' }),
    } as never),
  v1: (body?: unknown) =>
    v1POST(makeReq('http://localhost/api/v1/lists/list-1/manual-order', body), {
      params: Promise.resolve({ id: 'list-1' }),
    } as never),
} as const

function signIn(userId: string) {
  mockSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@example.com`, name: userId },
  } as never)
  mockApiAuth.mockResolvedValue({
    userId,
    source: 'oauth' as const,
    scopes: ['lists:read', 'lists:write'],
    isAIAgent: false,
    user: { id: userId, email: `${userId}@example.com`, name: userId, isAIAgent: false },
  } as never)
}

function writtenOrder(): string[] {
  return mockPrisma.taskList.update.mock.calls[0][0].data.manualSortOrder as string[]
}

beforeEach(() => {
  vi.clearAllMocks()
  signIn(OWNER)
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
  mockPrisma.task.findMany.mockResolvedValue(
    [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as never
  )
  mockPrisma.taskList.update.mockImplementation((async (args: {
    data: { manualSortOrder: string[] }
  }) => ({
    ...LIST,
    manualSortOrder: args.data.manualSortOrder,
    owner: { id: OWNER, name: 'Owner', email: 'owner@example.com', image: null },
  })) as never)
  mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)
  broadcastToUsers.mockResolvedValue(undefined)
})

describe.each(Object.keys(DOORS) as Array<keyof typeof DOORS>)(
  'POST manual-order — %s route (task 7883f710)',
  door => {
    const post = (body?: unknown) => DOORS[door](body)

    it('saves the sanitized order and broadcasts it', async () => {
      const res = await post({ order: ['t3', 'stale', 't3'] })

      expect(res.status).toBe(200)
      expect(writtenOrder()).toEqual(['t3', 't1', 't2'])
      expect(broadcastToUsers).toHaveBeenCalledTimes(1)
    })

    it('400s a body with no order array', async () => {
      const res = await post({})

      expect(res.status).toBe(400)
      expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
    })

    it('400s a malformed body instead of 500ing on the JSON parse', async () => {
      const res = await post()

      expect(res.status).toBe(400)
    })

    it('404s a list that does not exist', async () => {
      mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

      expect((await post({ order: [] })).status).toBe(404)
    })

    it('400s a virtual list', async () => {
      mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST, isVirtual: true } as never)

      expect((await post({ order: [] })).status).toBe(400)
    })

    it('403s a caller with no role on the list', async () => {
      signIn('stranger-1')

      const res = await post({ order: ['t1'] })

      expect(res.status).toBe(403)
      expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
    })
  }
)

describe('POST manual-order — what differs between the doors', () => {
  it('401s the legacy route with no session', async () => {
    mockSession.mockResolvedValue(null as never)

    expect((await DOORS.legacy({ order: ['t1'] })).status).toBe(401)
  })

  it('requires lists:write on v1', async () => {
    await DOORS.v1({ order: ['t1'] })

    expect(mockRequireScopes).toHaveBeenCalledWith(expect.anything(), ['lists:write'])
  })

  it('legacy returns the bare list; v1 wraps it and names the saved order', async () => {
    const legacyBody = await (await DOORS.legacy({ order: ['t2'] })).json()
    vi.clearAllMocks()
    signIn(OWNER)
    mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
    mockPrisma.task.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }] as never)
    mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)
    broadcastToUsers.mockResolvedValue(undefined)
    mockPrisma.taskList.update.mockImplementation((async (args: {
      data: { manualSortOrder: string[] }
    }) => ({ ...LIST, manualSortOrder: args.data.manualSortOrder })) as never)
    const v1Body = await (await DOORS.v1({ order: ['t2'] })).json()

    expect(legacyBody.id).toBe('list-1')
    expect(legacyBody.meta).toBeUndefined()

    expect(v1Body.list.id).toBe('list-1')
    expect(v1Body.meta).toEqual({ apiVersion: 'v1', authSource: 'oauth' })
    // The saved order is not necessarily the one that was sent, so v1 says what
    // it stored rather than making the client dig it out of the list object.
    expect(v1Body.order).toEqual(['t2', 't1'])
  })
})
