/**
 * Task efecc4b8 — `PUT /api/v1/tasks/<id>` must write the state-change system
 * comment that the legacy route writes.
 *
 * Legacy calls `recordStateChangeComment` on every update; v1 never imported
 * it. Both routes record structured `TaskEvent`s, so this is not a missing
 * audit trail — it is a missing *comment*, and the comment is what the user
 * sees:
 *
 *   - completing a task from web (legacy) leaves "Jon marked this as complete"
 *     in the thread; doing the same from iOS (v1) leaves nothing, so a
 *     repeating task's history reads differently depending on which client
 *     touched it
 *   - the comment carries `systemEventType`, which is what
 *     lib/completion-streak.ts folds on. No comment, nothing to fold.
 *
 * Legacy also prepends the new comment to the response so the client renders it
 * without a refetch; v1 must do the same or the comment appears only on the
 * next load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    taskList: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    comment: { create: vi.fn() },
    taskEvent: { createMany: vi.fn() },
  },
}))

vi.mock('@/lib/agent-lifecycle-mutations', () => ({
  reconcileTaskLifecycleAfterMutation: vi.fn().mockResolvedValue({
    scanned: 1,
    transitioned: 0,
    unchanged: 1,
  }),
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

vi.mock('@/lib/task-update-handler', () => ({
  recordStateChangeComment: vi.fn(),
  recordTaskCreationComment: vi.fn(),
  applyRepeatingTaskCompletion: vi.fn(),
}))

// Post-update fan-out — not what this test is about.
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents: vi.fn() }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn() }, isRedisAvailable: vi.fn(() => false) }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))
vi.mock('@/lib/task-recipients', () => ({ collectListRecipientUserIds: vi.fn(() => []) }))
vi.mock('@/lib/list-member-utils', () => ({ hasListAccess: vi.fn(() => true), getListMemberIds: vi.fn(async () => []) }))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: vi.fn((t: unknown) => t) }))
vi.mock('@/lib/deletion-log', () => ({ audienceForTask: vi.fn(async () => []), recordDeletion: vi.fn() }))

import { PUT } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'
import { recordStateChangeComment } from '@/lib/task-update-handler'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)
const mockRecordComment = vi.mocked(recordStateChangeComment)

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const WORK = { id: 'work-list', name: 'Work', color: '#000', listType: null }

const EXISTING = {
  id: 'task-1',
  title: 'A task',
  completed: false,
  closedReason: null,
  priority: 0,
  assigneeId: null,
  dueDateTime: null,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  repeating: 'never',
  lists: [WORK],
  assignee: null,
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/tasks/task-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ctx = { params: Promise.resolve({ id: 'task-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  vi.mocked(requireScopes).mockReturnValue(undefined as never)
  vi.mocked(requireTaskAccess).mockResolvedValue(undefined as never)
  ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>)
    .mockResolvedValue(EXISTING as never)
  ;(mockPrisma.task.update as never as ReturnType<typeof vi.fn>)
    .mockResolvedValue({ ...EXISTING, completed: true, comments: [] } as never)
  mockRecordComment.mockResolvedValue(null as never)
})

describe('PUT /api/v1/tasks/[id] — state-change comment (task efecc4b8)', () => {
  it('records the state-change comment, as legacy does', async () => {
    await PUT(putReq({ completed: true }) as never, ctx as never)

    expect(mockRecordComment).toHaveBeenCalledTimes(1)
    const args = mockRecordComment.mock.calls[0][0]
    expect(args.existingTask).toMatchObject({ id: 'task-1', completed: false })
    expect(args.updatedTask).toMatchObject({ id: 'task-1', completed: true })
  })

  it('names the updater, falling back through name → email → Someone', async () => {
    await PUT(putReq({ completed: true }) as never, ctx as never)
    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('Jon')

    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ ...auth, user: { ...auth.user, name: null } } as never)
    ;(mockPrisma.task.findUnique as never as ReturnType<typeof vi.fn>).mockResolvedValue(EXISTING as never)
    ;(mockPrisma.task.update as never as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ...EXISTING, completed: true, comments: [] } as never)
    mockRecordComment.mockResolvedValue(null as never)

    await PUT(putReq({ completed: true }) as never, ctx as never)
    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('jon@example.com')
  })

  it('prepends the new comment to the response so the client shows it without a refetch', async () => {
    const comment = { id: 'c-new', content: 'Jon marked this as complete', systemEventType: 'COMPLETED' }
    mockRecordComment.mockResolvedValue(comment as never)
    ;(mockPrisma.task.update as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...EXISTING, completed: true, comments: [{ id: 'c-old' }],
    } as never)

    const response = await PUT(putReq({ completed: true }) as never, ctx as never)
    const body = await response.json()

    expect(body.task.comments.map((c: { id: string }) => c.id)).toEqual(['c-new', 'c-old'])
  })

  it('still returns the task when comment creation yields nothing', async () => {
    // recordStateChangeComment returns null both when there is no reportable
    // change and when it fails — an update must not 500 either way.
    mockRecordComment.mockResolvedValue(null as never)

    const response = await PUT(putReq({ title: 'Renamed' }) as never, ctx as never)

    expect(response.status).toBe(200)
  })
})
