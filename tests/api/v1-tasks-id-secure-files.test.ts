/**
 * v1 GET/PUT /api/v1/tasks/[id] must return secureFiles (task 641a7615, step 3).
 *
 * Legacy's TASK_FULL_INCLUDE carries `secureFiles` on the task and on each
 * comment. v1's include carried neither. That did not matter while nothing on
 * the web called v1 for a single task — and then step 3 moved task-detail's
 * refresh onto it, and every attachment silently disappeared the moment a user
 * refreshed comments.
 *
 * The client reads both:
 *   - `lib/task-attachments.ts` → `taskLevelAttachments(task)` reads
 *     `task.secureFiles`
 *   - `components/task-detail/CommentSection.tsx` reads `comment.secureFiles`
 *
 * and the refresh replaces the whole task object, so a missing relation is not
 * a partial render — it is attachments vanishing from a task that has them.
 *
 * Asserting on the Prisma include rather than the response body: the bug is
 * that the data was never fetched, and a body assertion against a mock would
 * pass whatever the include said.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
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
    authenticateAPI: vi.fn(), requireScopes: vi.fn(), requireTaskAccess: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id),
}))

import { GET } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const ctx = { params: Promise.resolve({ id: 'task-1' }) }
const req = () => new NextRequest('http://localhost/api/v1/tasks/task-1')

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.task.findUnique.mockResolvedValue({ id: 'task-1', lists: [] } as never)
})

describe('GET /api/v1/tasks/[id] secureFiles parity (task 641a7615)', () => {
  it('fetches the task-level secure files', async () => {
    await GET(req(), ctx as never)

    const call = mockPrisma.task.findUnique.mock.calls[0][0] as never as {
      include: Record<string, unknown>
    }
    expect(call.include.secureFiles).toBeTruthy()
  })

  it('fetches the secure files attached to each comment', async () => {
    // Comment attachments render from comment.secureFiles; without this the
    // comment survives the refresh and its files do not.
    await GET(req(), ctx as never)

    const call = mockPrisma.task.findUnique.mock.calls[0][0] as never as {
      include: { comments: { include: Record<string, unknown> } }
    }
    expect(call.include.comments.include.secureFiles).toBeTruthy()
  })

  it('still fetches the relations it already had', async () => {
    // Guard against a fix that rewrites the include and drops something else.
    await GET(req(), ctx as never)

    const call = mockPrisma.task.findUnique.mock.calls[0][0] as never as {
      include: Record<string, unknown>
    }
    for (const relation of ['lists', 'assignee', 'creator', 'comments', 'attachments']) {
      expect(call.include[relation]).toBeTruthy()
    }
  })
})

describe('PUT /api/v1/tasks/[id] attachment parity (task 641a7615)', () => {
  // The update path matters more than the read path: every task edit replaces
  // the task object in client state from this response, so a relation missing
  // here makes attachments disappear after an unrelated edit — a title change
  // dropping a file off the task.
  beforeEach(() => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-1', completed: false, lists: [] } as never)
    mockPrisma.task.update.mockResolvedValue({ id: 'task-1', lists: [] } as never)
  })

  it('returns the same relations legacy TASK_FULL_INCLUDE does', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')

    await PUT(
      new NextRequest('http://localhost/api/v1/tasks/task-1', {
        method: 'PUT',
        body: JSON.stringify({ title: 'renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx as never
    )

    const call = mockPrisma.task.update.mock.calls[0]?.[0] as never as {
      include: Record<string, unknown>
    }
    expect(call).toBeDefined()
    expect(call.include.attachments).toBeTruthy()
    expect(call.include.secureFiles).toBeTruthy()
  })
})
