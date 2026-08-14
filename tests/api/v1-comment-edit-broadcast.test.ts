/**
 * RED for task 130508e3 — PUT /api/v1/comments/:id never broadcasts, so a
 * comment edited from iOS leaves every open web client showing the old text.
 *
 * The legacy PUT collects the task creator, assignee, list owners and list
 * members and emits comment_updated. The v1 PUT went straight from
 * prisma.comment.update to the response. Five client call sites read the event
 * (task-detail, task-detail-viewonly, use-cache-sync, use-sse-subscription).
 *
 * The payload shape is load-bearing: components/task-detail.tsx destructures
 * { taskId, comment, userId } and runs its own "not from the current user"
 * filter on userId. So the editor must be IN the audience and their id must be
 * in the payload — the opposite of v1 DELETE, which drops the actor
 * server-side. Copying the DELETE pattern here would silently do nothing for
 * everyone else, because the client would have no id to filter on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn((list: { listMembers?: { userId: string }[]; ownerId?: string }) => [
    ...(list.ownerId ? [list.ownerId] : []),
    ...(list.listMembers?.map(m => m.userId) ?? []),
  ]),
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_DELETED: 'COMMENT_DELETED' },
  trackEventFromRequest: vi.fn(),
}))

import { PUT } from '@/app/api/v1/comments/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const EDITOR = 'user-123'
const auth = {
  userId: EDITOR,
  source: 'oauth' as const,
  scopes: ['comments:read', 'comments:write', 'comments:delete'],
  isAIAgent: false,
  user: { id: EDITOR, email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const params = Promise.resolve({ id: 'comment-1' })

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/comments/comment-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const existingComment = {
  authorId: EDITOR,
  task: {
    id: 'task-1',
    title: 'Ship it',
    creatorId: 'creator-9',
    assigneeId: 'assignee-8',
    lists: [
      {
        id: 'list-1',
        name: 'Work',
        ownerId: 'owner-7',
        // The editor is a member of the list — they had to be, to comment on
        // the task at all. That is what puts them in the audience.
        listMembers: [{ userId: 'member-6' }, { userId: EDITOR }],
      },
    ],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockPrisma.comment.findUnique.mockResolvedValue(existingComment as never)
  mockPrisma.comment.update.mockResolvedValue({
    id: 'comment-1',
    content: 'edited text',
    type: 'user',
    parentCommentId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    author: { id: EDITOR, name: 'Jon', email: 'jon@example.com', image: null },
  } as never)
})

describe('PUT /api/v1/comments/:id broadcasts the edit (task 130508e3)', () => {
  it('emits comment_updated', async () => {
    await PUT(req({ content: 'edited text' }), { params } as never)

    expect(broadcastToUsers).toHaveBeenCalledTimes(1)
    expect(broadcastToUsers.mock.calls[0][1]).toMatchObject({ type: 'comment_updated' })
  })

  it('reaches the task creator, assignee, list owner and list members', async () => {
    await PUT(req({ content: 'edited text' }), { params } as never)

    const recipients = broadcastToUsers.mock.calls[0][0] as string[]
    expect(recipients).toEqual(
      expect.arrayContaining(['creator-9', 'assignee-8', 'owner-7', 'member-6'])
    )
  })

  it('KEEPS the editor in the audience and names them in the payload', async () => {
    // The editor is a list member, so they fall into the audience naturally.
    // Nothing removes them afterwards — task-detail.tsx filters on data.userId
    // itself, and v1 DELETE's server-side `userIds.delete(actor)` would leave
    // the client with nothing to compare against if it were copied here.
    await PUT(req({ content: 'edited text' }), { params } as never)

    const recipients = broadcastToUsers.mock.calls[0][0] as string[]
    const payload = broadcastToUsers.mock.calls[0][1] as { data: Record<string, unknown> }

    expect(recipients).toContain(EDITOR)
    expect(payload.data.userId).toBe(EDITOR)
  })

  it('carries the fields the client destructures', async () => {
    await PUT(req({ content: 'edited text' }), { params } as never)

    const { data } = broadcastToUsers.mock.calls[0][1] as { data: Record<string, unknown> }
    expect(data.taskId).toBe('task-1')
    expect(data.comment).toMatchObject({ id: 'comment-1', content: 'edited text' })
  })

  it('still returns the updated comment when the broadcast throws', async () => {
    // Best-effort: the edit is already committed.
    broadcastToUsers.mockImplementation(() => { throw new Error('sse down') })

    const res = await PUT(req({ content: 'edited text' }), { params } as never)

    expect(res.status).toBe(200)
  })

  it('does not broadcast when the caller is not the author', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(
      { ...existingComment, authorId: 'someone-else' } as never
    )

    const res = await PUT(req({ content: 'edited text' }), { params } as never)

    expect(res.status).toBe(403)
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/comments/:id content handling (task 130508e3)', () => {
  it('rejects whitespace-only content, as legacy always has', async () => {
    const res = await PUT(req({ content: '   ' }), { params } as never)

    expect(res.status).toBe(400)
    expect(mockPrisma.comment.update).not.toHaveBeenCalled()
  })

  it('trims stored content', async () => {
    await PUT(req({ content: '  edited text  ' }), { params } as never)

    const data = (mockPrisma.comment.update.mock.calls[0][0] as never as {
      data: { content: string }
    }).data
    expect(data.content).toBe('edited text')
  })
})
