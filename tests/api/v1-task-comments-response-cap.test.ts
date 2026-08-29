/**
 * Task responses must not embed an unbounded comment collection (task a86b5bed).
 *
 * A runaway GitHub comment-sync echo put 142k comments on one task, at which
 * point PUT /api/v1/tasks/[id] answered 500 — the write landed but the
 * response could not serialize the full collection. The cap is enforced in the
 * query (`take`), so these tests pin the query arguments — the property that
 * matters is "the response embeds at most TASK_COMMENTS_RESPONSE_LIMIT
 * comments, the newest ones, in the same ascending order as before".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:write'], source: 'oauth', isAIAgent: false }, ctx),
}))

const taskUpdate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, findFirst: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    taskEvent: { createMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => ({
  getDeprecationWarning: () => null,
  requireTaskAccess: vi.fn().mockResolvedValue(undefined),
  requireTaskReadAccess: vi.fn().mockResolvedValue(undefined),
}))

import { TASK_COMMENTS_RESPONSE_LIMIT } from '@/lib/task-query-utils'

// Newest-first, as the capped query returns them.
const COMMENTS_DESC = [
  { id: 'c-new', authorId: 'user-2', createdAt: new Date('2026-02-02') },
  { id: 'c-old', authorId: 'user-3', createdAt: new Date('2026-01-01') },
]

const TASK = {
  id: 'task-1',
  title: 'Task',
  completed: false,
  closedReason: null,
  priority: 1,
  creatorId: 'user-1',
  assigneeId: null,
  parentTaskId: null,
  dueDateTime: null,
  lists: [{ id: 'list-1', ownerId: 'user-1', listMembers: [], privacy: 'PRIVATE' }],
  comments: [...COMMENTS_DESC],
}

const ctx = { params: Promise.resolve({ id: 'task-1' }) } as never

const commentsArgOf = (mock: ReturnType<typeof vi.fn>) => {
  // The identifier resolver issues its own select-only findUnique first, so
  // pick the call that actually embeds comments.
  const call = mock.mock.calls.find(
    c => (c[0] as { include?: { comments?: unknown } }).include?.comments
  )
  expect(call).toBeDefined()
  return (call![0] as { include: { comments: { take?: number; orderBy: unknown } } }).include.comments
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue({ ...TASK, comments: [...COMMENTS_DESC] })
  taskUpdate.mockResolvedValue({ ...TASK, comments: [...COMMENTS_DESC] })
})

describe('comment cap on task responses (task a86b5bed)', () => {
  it('GET bounds the embedded comments and keeps ascending order on the wire', async () => {
    const { GET } = await import('@/app/api/v1/tasks/[id]/route')
    const response = await GET(new NextRequest('http://localhost/api/v1/tasks/task-1'), ctx)
    expect(response.status).toBe(200)

    const commentsArg = commentsArgOf(taskFindUnique)
    expect(commentsArg.take).toBe(TASK_COMMENTS_RESPONSE_LIMIT)
    // take slices from the top, so newest-first is what makes the cap keep
    // the NEWEST comments rather than the oldest.
    expect(commentsArg.orderBy).toEqual({ createdAt: 'desc' })

    const body = await response.json()
    expect(body.task.comments.map((c: { id: string }) => c.id)).toEqual(['c-old', 'c-new'])
  })

  it('PUT bounds the embedded comments and keeps ascending order on the wire', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/v1/tasks/task-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
      ctx
    )
    expect(response.status).toBe(200)

    const commentsArg = commentsArgOf(taskUpdate)
    expect(commentsArg.take).toBe(TASK_COMMENTS_RESPONSE_LIMIT)
    expect(commentsArg.orderBy).toEqual({ createdAt: 'desc' })

    const body = await response.json()
    const ids = body.task.comments.map((c: { id: string }) => c.id)
    // Ascending order preserved; a state-change comment may be prepended.
    expect(ids.indexOf('c-old')).toBeLessThan(ids.indexOf('c-new'))
  })
})
