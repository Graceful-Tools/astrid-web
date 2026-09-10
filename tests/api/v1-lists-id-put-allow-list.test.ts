/**
 * PUT /api/v1/lists/[id] applies its allow-list — and no longer the four
 * retired status fields (task dc143ab2, then AWTD-853).
 *
 * v1's PUT applies an allow-list, and the original finding was that it dropped
 * fields legacy applied and the web depended on: `ManageStatusesPanel` reordered
 * status columns by PUTing `{ statusOrder }`, so migrating that call site would
 * have made reordering silently do nothing — 200 back, order unchanged. The
 * pattern is worth keeping in mind: a v1 route written as an allow-list drops
 * something a client needs, and it presents as a feature that quietly stopped
 * working rather than an error anyone notices.
 *
 * That specific worry is now moot from both ends. The panel writes
 * `/api/statuses` (soon `/api/v1/projects/:id/statuses`), and AWTD-853 retired
 * `statusRole` / `statusOrder` / `statusDescription` / `statusCompleted` off the
 * list contract entirely. Their absence is pinned in
 * tests/api/v1-list-status-fields-retired.ts; what remains here is the rest of
 * the allow-list, and the guard that widening it never made the route a
 * pass-through.
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

describe('PUT /api/v1/lists/[id] allow-list (task dc143ab2, AWTD-853)', () => {
  it('applies publicListType', async () => {
    const data = await put({ publicListType: 'copy' })

    expect(data?.publicListType).toBe('copy')
  })

  it('still ignores fields outside the allow-list', async () => {
    // Widening the list must not turn it into a pass-through — the callers
    // spread the whole list object into the body, so anything accepted here is
    // accepted on every save.
    const data = await put({ listType: 'regular', ownerId: 'someone-else' })

    expect(data?.ownerId).toBeUndefined()
  })
})
