/**
 * Task db7c6670 — `PUT /api/v1/tasks/<id> { completed: true }` must not leave
 * the task holding a status-list membership.
 *
 * The pure decision is covered in tests/lib/completion-strips-status.test.ts.
 * This pins the wiring: the route has to actually reach for it on the
 * completion-only path, which is the path that had no enforcement at all
 * (`if (body.listIds !== undefined)` gated the whole block).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskList: { findMany: vi.fn() },
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
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    requireTaskReadAccess: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

// Everything the handler fires off AFTER the update — none of it is what this
// test is about, and all of it wants a real DB / Redis / SSE.
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents: vi.fn() }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn() }, isRedisAvailable: vi.fn(() => false) }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))
vi.mock('@/lib/task-recipients', () => ({ collectListRecipientUserIds: vi.fn(async () => []) }))
vi.mock('@/lib/list-member-utils', () => ({ hasListAccess: vi.fn(() => true), getListMemberIds: vi.fn(async () => []) }))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: vi.fn((t: unknown) => t) }))
vi.mock('@/lib/deletion-log', () => ({ audienceForTask: vi.fn(async () => []), recordDeletion: vi.fn() }))

import { PUT } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)
const mockRequireTaskAccess = vi.mocked(requireTaskAccess)

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const READY = { id: 'ready-list', name: 'Ready', color: '#fff', listType: 'status' }
const WORK = { id: 'work-list', name: 'Work', color: '#000', listType: null }

function existing(lists: unknown[]) {
  return {
    id: 'task-1',
    title: 'A task',
    completed: false,
    closedReason: null,
    priority: 0,
    assigneeId: null,
    dueDateTime: null,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    repeating: 'never',
    lists,
    assignee: null,
  }
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/tasks/task-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The `data` prisma.task.update was called with. */
function updateData() {
  const call = (mockPrisma.task.update as never as ReturnType<typeof vi.fn>).mock.calls[0]
  return call?.[0]?.data
}

describe('PUT /api/v1/tasks/[id] — completion strips status membership (task db7c6670)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(auth as never)
    mockRequireScopes.mockReturnValue(undefined as never)
    mockRequireTaskAccess.mockResolvedValue(undefined as never)
    ;(mockPrisma.task.update as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ...existing([WORK]), completed: true } as never)
  })

  it('disconnects the status list when the task is completed with no listIds in the body', async () => {
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue(existing([READY, WORK]) as never)

    await PUT(putReq({ completed: true }) as never, { params: Promise.resolve({ id: 'task-1' }) } as never)

    expect(mockPrisma.task.update).toHaveBeenCalled()
    expect(updateData().lists).toEqual({ disconnect: [{ id: 'ready-list' }] })
  })

  it('leaves the non-status lists attached — completing a task does not unfile it', async () => {
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue(existing([READY, WORK]) as never)

    await PUT(putReq({ completed: true }) as never, { params: Promise.resolve({ id: 'task-1' }) } as never)

    expect(mockPrisma.task.update).toHaveBeenCalled()
    const disconnected = updateData().lists?.disconnect?.map((l: { id: string }) => l.id) ?? []
    expect(disconnected).not.toContain('work-list')
  })

  it('touches nothing when the completed task holds no status membership', async () => {
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue(existing([WORK]) as never)

    await PUT(putReq({ completed: true }) as never, { params: Promise.resolve({ id: 'task-1' }) } as never)

    expect(mockPrisma.task.update).toHaveBeenCalled()
    expect(updateData().lists).toBeUndefined()
  })

  it('leaves status membership alone when the task is being REOPENED', async () => {
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ...existing([READY, WORK]), completed: true } as never)

    await PUT(putReq({ completed: false }) as never, { params: Promise.resolve({ id: 'task-1' }) } as never)

    expect(mockPrisma.task.update).toHaveBeenCalled()
    expect(updateData().lists).toBeUndefined()
  })

  it('leaves status membership alone for an update that is not about completion', async () => {
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue(existing([READY, WORK]) as never)

    await PUT(putReq({ title: 'Renamed' }) as never, { params: Promise.resolve({ id: 'task-1' }) } as never)

    expect(mockPrisma.task.update).toHaveBeenCalled()
    expect(updateData().lists).toBeUndefined()
  })
})
