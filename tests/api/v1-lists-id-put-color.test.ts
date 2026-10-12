/**
 * PUT /api/v1/lists/[id] validates `color` (list colour picker).
 *
 * The route stored whatever string it was sent, and the colour is painted
 * straight into inline styles on every surface that shows the list, and on
 * iOS. Only `#rrggbb` is accepted. Every stored colour in production was
 * already in that form (checked 2026-10-09), so callers that resend the whole
 * list object on each save are not affected.
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

const mockPrisma = vi.mocked(prisma, true)
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

let lastStatus = 0
const ctx = { params: Promise.resolve({ id: 'l1' }) }

async function put(body: Record<string, unknown>) {
  lastStatus = (await PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )).status
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

describe('PUT /api/v1/lists/[id] — color', () => {
  it('stores a #rrggbb colour', async () => {
    const data = await put({ color: '#22c55e' })

    // Only the write is asserted: the response is built by code these mocks do
    // not stand up, exactly as in v1-lists-id-put-allow-list.test.ts.
    expect(data?.color).toBe('#22c55e')
  })

  it.each([['red'], ['#fff'], ['#12345g'], ['url(javascript:alert(1))'], [null], [42]])('rejects %j', async color => {
    const data = await put({ color })

    expect(lastStatus).toBe(400)
    expect(data).toBeUndefined()
  })
})
