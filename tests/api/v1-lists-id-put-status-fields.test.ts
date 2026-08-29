/**
 * PUT /api/v1/lists/[id] must accept the status-board fields (task dc143ab2).
 *
 * v1's PUT applies an allow-list of 27 fields. Legacy's applies `statusRole`,
 * `statusOrder`, `statusDescription`, `statusCompleted`, `listType` and
 * `publicListType` as well — and the web depends on it:
 * `ManageStatusesPanel` reorders status columns by PUTing `{ statusOrder }`.
 *
 * Migrating that call site against the current allow-list would make column
 * reordering **silently do nothing**: the request succeeds, 200 comes back, the
 * order is unchanged. That is the fifth gap of this exact shape found under the
 * retirement, and the pattern is always the same — v1 routes written as
 * allow-lists or projections drop something a client depends on, and the
 * failure presents as a feature that quietly stopped working rather than an
 * error anyone would notice.
 *
 * Pinned per field rather than as one assertion so a future edit that trims the
 * allow-list names exactly what it broke.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    // The route also writes activity and recounts tasks; neither is what these
    // tests are about, so they just need to exist.
    listActivity: { create: vi.fn() },
    activityLog: { create: vi.fn() },
    task: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userListsV1: (id: string) => `lists:v1:${id}` },
    getOrSet: vi.fn(async (_k: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn() },
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

import { PUT } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const listRow = {
  id: 'l1',
  ownerId: 'u1',
  name: 'Doing',
  privacy: 'PRIVATE',
  owner: { id: 'u1', name: 'Jon', email: 'j@e.com', image: null },
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }

async function put(body: Record<string, unknown>) {
  await PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )
  return (mockPrisma.taskList.update.mock.calls[0]?.[0] as never as {
    data: Record<string, unknown>
  })?.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow as never)
  ;(mockPrisma.$transaction as any).mockImplementation((operation: any) => operation(mockPrisma))
  mockPrisma.user.findMany.mockResolvedValue([] as never)
})

describe('PUT /api/v1/lists/[id] status-board fields (task dc143ab2)', () => {
  it('applies statusOrder', async () => {
    // ManageStatusesPanel's reorder is exactly this call. Dropped, the columns
    // spring back to their old order with no error shown.
    const data = await put({ statusOrder: 3 })

    expect(data?.statusOrder).toBe(3)
  })

  it('applies statusRole', async () => {
    const data = await put({ statusRole: 'doing' })

    expect(data?.statusRole).toBe('doing')
  })

  it('applies statusDescription and statusCompleted', async () => {
    const data = await put({ statusDescription: 'In progress', statusCompleted: true })

    expect(data?.statusDescription).toBe('In progress')
    expect(data?.statusCompleted).toBe(true)
  })

  it('applies publicListType', async () => {
    const data = await put({ publicListType: 'copy' })

    expect(data?.publicListType).toBe('copy')
  })

  it('still ignores fields outside the allow-list', async () => {
    // Widening the list must not turn it into a pass-through — the callers
    // spread the whole list object into the body, so anything accepted here is
    // accepted on every save.
    const data = await put({ statusOrder: 1, ownerId: 'someone-else' })

    expect(data?.ownerId).toBeUndefined()
  })
})
