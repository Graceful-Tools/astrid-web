import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/v1/lists/[id]/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

/**
 * Task dce843a1 — per-list `showSubtasks` on PUT /api/v1/lists/:id.
 *
 * These cases were written against the legacy `/api/lists/:id`, which the web
 * client's `handleUpdateList` PUT the entire TaskList object to; AWTD-839
 * retired that route and they now run against v1. The guard matters just as
 * much here: a client sending a whole list object is exactly the "older client"
 * the field has to survive — every unrelated settings save would otherwise
 * rewrite the toggle.
 */

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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    listMember: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(),
  },
}))

const mockUser = { id: 'user-123', email: 'test@example.com', name: 'Test User' }

const existingList = {
  id: 'list-123',
  name: 'Test List',
  ownerId: mockUser.id,
  listType: 'regular',
  privacy: 'PRIVATE',
  showSubtasks: true,
  admins: [],
  members: [],
  listMembers: [],
}

function makePut(body: unknown) {
  return new NextRequest('http://localhost/api/v1/lists/list-123', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function updateData() {
  return (vi.mocked(prisma.taskList.update) as any).mock.calls[0][0].data
}

describe('PUT /api/v1/lists/[id] — showSubtasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue({
      userId: mockUser.id,
      source: 'session',
      scopes: ['*'],
      isAIAgent: false,
      user: { ...mockUser, isAIAgent: false },
    })
    ;(prisma.$transaction as any).mockImplementation((operation: any) => operation(prisma))
    vi.mocked(prisma.taskList.findFirst).mockResolvedValue(existingList as any)
    vi.mocked(prisma.taskList.update).mockResolvedValue({
      ...existingList,
      owner: mockUser,
      listMembers: [],
      _count: { tasks: 0 },
    } as any)
  })

  it('persists an explicit false', async () => {
    const res = await PUT(makePut({ name: 'Test List', showSubtasks: false }), {
      params: Promise.resolve({ id: 'list-123' }),
    })
    expect(res.status).toBe(200)
    expect(updateData().showSubtasks).toBe(false)
  })

  it('persists an explicit true', async () => {
    await PUT(makePut({ name: 'Test List', showSubtasks: true }), {
      params: Promise.resolve({ id: 'list-123' }),
    })
    expect(updateData().showSubtasks).toBe(true)
  })

  it('leaves the stored value alone when the key is absent', async () => {
    // The regression this guards: the web client round-trips the whole list
    // object on every settings save, so an omitted key must mean "unchanged",
    // never "reset to default".
    await PUT(makePut({ name: 'Renamed', color: '#ff0000' }), {
      params: Promise.resolve({ id: 'list-123' }),
    })
    expect(updateData()).not.toHaveProperty('showSubtasks')
  })

  it('ignores a non-boolean rather than coercing it', async () => {
    await PUT(makePut({ name: 'Test List', showSubtasks: 'false' }), {
      params: Promise.resolve({ id: 'list-123' }),
    })
    expect(updateData()).not.toHaveProperty('showSubtasks')
  })
})
