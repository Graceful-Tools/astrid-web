import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const commentFindUnique = vi.hoisted(() => vi.fn())
const commentUpdate = vi.hoisted(() => vi.fn())
const reconcileTaskLifecycleAfterMutation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      findUnique: commentFindUnique,
      update: commentUpdate,
    },
  },
}))

vi.mock('@/lib/agent-lifecycle-mutations', () => ({
  reconcileTaskLifecycleAfterMutation,
}))

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_options: unknown, handler: (...args: any[]) => Promise<Response>) =>
    async (request: NextRequest, context: unknown) => {
      try {
        return await handler(request, {
          userId: 'user-1',
          user: { name: 'User One', email: 'user@example.com' },
          source: 'oauth',
        }, context)
      } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
}))

vi.mock('@/lib/api-auth-middleware', () => ({
  getDeprecationWarning: () => null,
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/analytics-events', () => ({
  trackEventFromRequest: vi.fn(),
  AnalyticsEventType: { COMMENT_DELETED: 'comment_deleted' },
}))

const existingComment = {
  authorId: 'user-1',
  task: {
    id: 'task-1',
    title: 'Waiting task',
    creatorId: 'user-1',
    assigneeId: null,
    lists: [],
  },
}

const updatedComment = {
  id: 'comment-1',
  taskId: 'task-1',
  content: 'BLOCKED-BY: completed-task',
  type: 'TEXT',
  authorId: 'user-1',
  author: { id: 'user-1', name: 'User One', email: 'user@example.com', image: null },
  secureFiles: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  parentCommentId: null,
}

describe('comment lifecycle mutation hook (AWTD-760)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commentFindUnique.mockResolvedValue(existingComment)
    commentUpdate.mockResolvedValue(updatedComment)
    reconcileTaskLifecycleAfterMutation.mockResolvedValue({
      scanned: 1,
      transitioned: 0,
      unchanged: 1,
    })
  })

  it('reconciles the task after a comment edit', async () => {
    const { PUT } = await import('@/app/api/v1/comments/[id]/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/v1/comments/comment-1', {
        method: 'PUT',
        body: JSON.stringify({ content: updatedComment.content }),
      }),
      { params: Promise.resolve({ id: 'comment-1' }) } as never,
    )

    expect(response.status).toBe(200)
    expect(reconcileTaskLifecycleAfterMutation).toHaveBeenCalledWith('task-1')
  })

  it('does not return a success-shaped response when reconciliation fails', async () => {
    reconcileTaskLifecycleAfterMutation.mockRejectedValue(new Error('reconciliation unavailable'))
    const { PUT } = await import('@/app/api/v1/comments/[id]/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/v1/comments/comment-1', {
        method: 'PUT',
        body: JSON.stringify({ content: updatedComment.content }),
      }),
      { params: Promise.resolve({ id: 'comment-1' }) } as never,
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Internal server error' })
  })
})
