/**
 * Task Creation Idempotency Tests
 *
 * Tests clientRequestId-based idempotency for both /api/v1/tasks and /api/tasks endpoints.
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error { name = 'UnauthorizedError' }
  class ForbiddenError extends Error { name = 'ForbiddenError' }
  return {
    authenticateAPI: vi.fn().mockResolvedValue({
      userId: 'user-1',
      source: 'oauth',
      scopes: ['*'],
      clientId: 'test-client',
    }),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/analytics-events', () => ({
  trackEventFromRequest: vi.fn(),
  AnalyticsEventType: {
    TASK_CREATED: 'task_created',
  },
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => ['user-1']),
  hasListAccess: vi.fn(() => true),
}))

vi.mock('@/lib/agent-protocol', () => ({
  enrichTaskForAgent: vi.fn((task: any) => task),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    taskList: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

// ── Test Data ──────────────────────────────────────────────────────────

const now = new Date()

const mockTask = {
  id: 'task-1',
  title: 'Test Task',
  description: '',
  priority: 0,
  completed: false,
  dueDateTime: null,
  isAllDay: false,
  isPrivate: true,
  repeating: 'never',
  repeatingData: null,
  repeatFrom: 'COMPLETION_DATE',
  assigneeId: null,
  creatorId: 'user-1',
  clientRequestId: 'test-request-id-12345',
  createdAt: now,
  updatedAt: now,
  lists: [],
  assignee: null,
  creator: {
    id: 'user-1',
    name: 'Test User',
    email: 'test@test.com',
    image: null,
    isAIAgent: false,
  },
  comments: [],
  attachments: [],
}

// ── Tests: /api/v1/tasks ──────────────────────────────────────────────

/**
 * Warm the route module before the timed tests (task aca946b8).
 *
 * Every test here does `await import('@/app/api/v1/tasks/route')` in its body, so the FIRST one paid
 * the transform-and-import cost of that whole module graph inside its 5000ms
 * budget. Alone that is fine; under the full suite it competes with every other
 * worker for CPU and the first test times out. That is exactly what was
 * observed — the failing test was always the first in the file, isolation
 * always passed, and a re-run on the same commit passed with the transform
 * cache warm.
 *
 * Importing here moves the cost out of the assertion window (and a hook gets
 * the 10s budget rather than a test's 5s). The `await import` calls inside the
 * tests then hit the module cache and are free.
 */
beforeAll(async () => {
  await import('@/app/api/v1/tasks/route')
})

describe('Task Creation Idempotency — POST /api/v1/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create task with clientRequestId on first request', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findUnique).mockResolvedValue(null) // no existing
    vi.mocked(prisma.task.create).mockResolvedValue(mockTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'test-request-id-12345',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(201)

    const body = await response.json()
    expect(body.task.id).toBe('task-1')
    expect(body.meta.idempotent).toBeUndefined()

    // Verify create was called with clientRequestId
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientRequestId: 'test-request-id-12345',
        }),
      })
    )
  })

  it('should return existing task on duplicate clientRequestId (optimistic check)', async () => {
    const { prisma } = await import('@/lib/prisma')

    // findUnique returns existing task (optimistic check hits)
    vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'test-request-id-12345',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.task.id).toBe('task-1')
    expect(body.meta.idempotent).toBe(true)

    // Should NOT call create
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('should return existing task on P2002 unique violation (race condition)', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { Prisma } = await import('@prisma/client')

    // findUnique returns null first time (optimistic miss), then returns task on P2002 retry
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce(null) // first optimistic check
      .mockResolvedValueOnce(mockTask as any) // P2002 fallback query

    // create throws P2002
    const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.0.0',
      meta: { target: ['clientRequestId'] },
    })
    vi.mocked(prisma.task.create).mockRejectedValue(p2002Error)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'test-request-id-12345',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.task.id).toBe('task-1')
    expect(body.meta.idempotent).toBe(true)
  })

  it('should reject clientRequestId shorter than 8 characters', async () => {
    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'short',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toMatch(/clientRequestId/)
  })

  it('should reject clientRequestId longer than 128 characters', async () => {
    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'a'.repeat(129),
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(400)
  })

  it('should fall through to time-based dedup when no clientRequestId', async () => {
    const { prisma } = await import('@/lib/prisma')

    // No clientRequestId → time-based dedup fires, finds recent duplicate
    vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        // no clientRequestId
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.meta.idempotent).toBe(true)

    // Should call findFirst for time-based dedup, not findUnique
    expect(prisma.task.findFirst).toHaveBeenCalled()
    expect(prisma.task.findUnique).not.toHaveBeenCalled()
  })

  it('should return CURRENT state (with updates) on idempotent clientRequestId hit', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Task was created, then updated (priority changed from 0→3, dueDateTime set)
    const updatedMockTask = {
      ...mockTask,
      priority: 3,
      dueDateTime: new Date('2026-03-15T00:00:00Z'),
      updatedAt: new Date(now.getTime() + 60_000), // updated 1 min after creation
    }

    // findUnique returns the CURRENT state (after updates)
    vi.mocked(prisma.task.findUnique).mockResolvedValue(updatedMockTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'test-request-id-12345',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.meta.idempotent).toBe(true)

    // CRITICAL: Response must include the LATEST updates, not the original creation data
    expect(body.task.priority).toBe(3)
    expect(body.task.dueDateTime).toBe(updatedMockTask.dueDateTime.toISOString())
    expect(body.task.updatedAt).toBe(updatedMockTask.updatedAt.toISOString())
  })

  it('should return CURRENT state on time-based dedup hit (with updates applied)', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Task was created 20s ago, then updated (priority set to HIGH, date added)
    const updatedMockTask = {
      ...mockTask,
      clientRequestId: null, // no clientRequestId
      priority: 3,
      dueDateTime: new Date('2026-03-15T00:00:00Z'),
      isAllDay: true,
      updatedAt: new Date(now.getTime() + 15_000), // updated 15s after creation
    }

    // No clientRequestId → time-based dedup fires
    vi.mocked(prisma.task.findFirst).mockResolvedValue(updatedMockTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        // no clientRequestId — falls through to time-based dedup
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.meta.idempotent).toBe(true)

    // CRITICAL: Returns current state with updates, not original creation data
    expect(body.task.priority).toBe(3)
    expect(body.task.dueDateTime).toBe(updatedMockTask.dueDateTime.toISOString())
    expect(body.task.isAllDay).toBe(true)
  })

  it('should use 60-second window for time-based dedup', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Task created 45 seconds ago (outside old 30s window, inside new 60s window)
    const recentTask = {
      ...mockTask,
      clientRequestId: null,
      createdAt: new Date(Date.now() - 45_000),
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(recentTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Task' }),
    })

    const response = await POST(req)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.meta.idempotent).toBe(true)

    // Verify findFirst was called with 60s window (not 30s)
    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
          }),
        }),
      })
    )
    // Verify the date is ~60s ago (with tolerance)
    const callArgs = vi.mocked(prisma.task.findFirst).mock.calls[0][0] as any
    const gteDate = callArgs.where.createdAt.gte as Date
    const diffMs = Date.now() - gteDate.getTime()
    expect(diffMs).toBeGreaterThan(59_000)
    expect(diffMs).toBeLessThan(61_000)
  })

  it('should return 409 on P2002 if creatorId does not match', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { Prisma } = await import('@prisma/client')

    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce(null) // optimistic miss
      .mockResolvedValueOnce({ ...mockTask, creatorId: 'other-user' } as any) // different creator

    const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.0.0',
      meta: { target: ['clientRequestId'] },
    })
    vi.mocked(prisma.task.create).mockRejectedValue(p2002Error)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Task',
        clientRequestId: 'test-request-id-12345',
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(409)
  })
})
