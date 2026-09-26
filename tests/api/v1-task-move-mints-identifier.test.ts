/**
 * AWTD-1016 — a task gets its identifier when it FIRST lands on a project
 * list, whether it was created there or moved there.
 *
 * Only create minted, so a task filed in the Inbox and later moved onto a
 * board stayed id-less forever: no `AWTD-n` to put in a branch name, a commit
 * or the "Waiting on" picker. Minting is permanent, so a task that already has
 * one keeps it on every later move (docs/specs/TASK_IDENTIFIERS.md §4).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
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

vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id),
  allocateTaskIdentifier: vi.fn(),
}))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents: vi.fn() }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn() }, isRedisAvailable: vi.fn(() => false) }))
vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent: vi.fn(),
  trackEventFromRequest: vi.fn(),
  AnalyticsEventType: {},
}))
vi.mock('@/lib/list-member-utils', () => ({ hasListAccess: vi.fn(() => true), getListMemberIds: vi.fn(async () => []) }))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: vi.fn((t: unknown) => t) }))
vi.mock('@/lib/deletion-log', () => ({ audienceForTask: vi.fn(async () => []), recordDeletion: vi.fn() }))

import { PUT } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'
import { allocateTaskIdentifier } from '@/lib/task-identifier'

const mockPrisma = vi.mocked(prisma, true)
const mockAllocate = vi.mocked(allocateTaskIdentifier)

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const INBOX = { id: 'inbox-list', name: 'Inbox', projectId: null, listType: null, isVirtual: false }
const BOARD = { id: 'board-list', name: 'Board', projectId: 'project-1', listType: null, isVirtual: false }

function existing(identifier: string | null) {
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
    identifier,
    sequence: identifier ? 3 : null,
    lists: [INBOX],
    assignee: null,
  }
}

function moveTo(listIds: string[]) {
  return PUT(
    new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      body: JSON.stringify({ listIds }),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    { params: Promise.resolve({ id: 'task-1' }) } as never
  )
}

function updateData() {
  return (mockPrisma.task.update as never as Mock).mock.calls[0]?.[0]?.data
}

describe('moving a task onto a project list mints its identifier (AWTD-1016)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(auth as never)
    vi.mocked(requireScopes).mockReturnValue(undefined as never)
    vi.mocked(requireTaskAccess).mockResolvedValue(undefined as never)
    ;(mockPrisma.taskList.findMany as never as Mock).mockImplementation(async (query: never) => {
      const where = (query as { where: { id?: { in: string[] } } }).where
      // The requested lists; the project's status lists are a second query.
      return where.id ? [INBOX, BOARD].filter(list => where.id!.in.includes(list.id)) : []
    })
    ;(mockPrisma.task.update as never as Mock).mockResolvedValue({ ...existing(null), lists: [BOARD] } as never)
    mockAllocate.mockResolvedValue({ identifier: 'AWTD-9', sequence: 9 })
  })

  it('an id-less task moved onto a board gets an identifier (AWTD-1016)', async () => {
    ;(mockPrisma.task.findUnique as never as Mock).mockResolvedValue(existing(null) as never)

    const res = await moveTo(['board-list'])

    expect(res.status).toBe(200)
    expect(mockAllocate).toHaveBeenCalledWith(['board-list'])
    expect(updateData()).toMatchObject({ identifier: 'AWTD-9', sequence: 9 })
  })

  it('a task that already has an identifier keeps it — ids are permanent (AWTD-1016)', async () => {
    ;(mockPrisma.task.findUnique as never as Mock).mockResolvedValue(existing('OTHER-3') as never)

    await moveTo(['board-list'])

    expect(mockAllocate).not.toHaveBeenCalled()
    expect(updateData().identifier).toBeUndefined()
  })

  it('a move that lands on no project mints nothing (AWTD-1016)', async () => {
    ;(mockPrisma.task.findUnique as never as Mock).mockResolvedValue(existing(null) as never)
    mockAllocate.mockResolvedValue(null)

    await moveTo(['inbox-list'])

    expect(updateData().identifier).toBeUndefined()
  })

  it('a failed allocation never fails the move itself (AWTD-1016)', async () => {
    ;(mockPrisma.task.findUnique as never as Mock).mockResolvedValue(existing(null) as never)
    mockAllocate.mockRejectedValue(new Error('db hiccup'))

    const res = await moveTo(['board-list'])

    expect(res.status).toBe(200)
    expect(mockPrisma.task.update).toHaveBeenCalled()
    expect(updateData().identifier).toBeUndefined()
  })
})
