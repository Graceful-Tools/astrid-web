/**
 * RED for task cb1581e0 — "comments from Mac aren't always showing up on web."
 *
 * Every comment fan-out removed the actor from its own SSE audience, on the
 * reasoning that they already see the comment through the optimistic update.
 * That reasoning holds for the ONE TAB that posted and for nothing else: a user
 * is not a device. Commenting on the Mac app and reading on the web app is the
 * same user id on two connections, and the web connection was deliberately cut
 * out of the event — so the comment only appeared on a manual refresh.
 *
 * Four surfaces did it (create on v1, create on legacy, delete on v1, create on
 * MCP), while comment_updated already kept the editor in (see
 * v1-comment-edit-broadcast.test.ts). Clients dedupe by comment id, which is
 * device-count-independent, so nothing needs the actor removed.
 *
 * The one exception is an AI-agent author. Agents register in the same SSE pool
 * (app/api/v1/agent/events delivers comment_created as task.commented), so an
 * agent that answers comments on its own tasks would answer itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), findFirst: vi.fn() },
    comment: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn() },
    secureFile: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn((list: { ownerId?: string; listMembers?: { userId: string }[] }) => [
    ...(list.ownerId ? [list.ownerId] : []),
    ...(list.listMembers?.map(m => m.userId) ?? []),
  ]),
}))

vi.mock('@/lib/comments/post-comment-side-effects', () => ({
  runPostCommentSideEffects: vi.fn(),
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_DELETED: 'COMMENT_DELETED' },
  trackEventFromRequest: vi.fn(),
}))

import { POST } from '@/app/api/v1/tasks/[id]/comments/route'
import { DELETE } from '@/app/api/v1/comments/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

/** Jon: the task creator, a list member, and the person on both devices. */
const JON = 'user-jon'
const AGENT = 'user-agent'

const taskContext = () => ({
  id: 'task-1',
  title: 'A task',
  creatorId: JON,
  assigneeId: null,
  lists: [
    {
      id: 'list-1',
      name: 'Astrid Web To-do',
      ownerId: JON,
      privacy: 'PRIVATE',
      listMembers: [{ userId: JON, role: 'OWNER' }, { userId: 'user-other', role: 'MEMBER' }],
    },
  ],
  assignee: null,
})

const createdComment = (over: Record<string, unknown> = {}) => ({
  id: 'comment-new',
  content: 'from the Mac',
  type: 'TEXT',
  authorId: JON,
  taskId: 'task-1',
  parentCommentId: null,
  createdAt: new Date('2026-09-07T00:00:00Z'),
  updatedAt: new Date('2026-09-07T00:00:00Z'),
  author: { id: JON, name: 'Jon', email: 'jon@example.com', image: null, isAIAgent: false },
  secureFiles: [],
  ...over,
})

const postRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost:3000/api/v1/tasks/task-1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const commentCreatedCall = () =>
  broadcastToUsers.mock.calls.find(
    call => (call[1] as { type: string }).type === 'comment_created'
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    userId: JON,
    source: 'oauth',
    scopes: ['comments:read', 'comments:write', 'comments:delete'],
  } as never)
  mockPrisma.task.findUnique.mockResolvedValue(taskContext() as never)
  mockPrisma.comment.findFirst.mockResolvedValue(null as never)
  mockPrisma.comment.create.mockResolvedValue(createdComment() as never)
})

describe('POST /api/v1/tasks/:id/comments keeps the author in the SSE audience (task cb1581e0)', () => {
  it('reaches the author, so their other devices render the comment live', async () => {
    await POST(postRequest({ content: 'from the Mac' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    const call = commentCreatedCall()
    expect(call).toBeDefined()
    expect(call![0] as string[]).toContain(JON)
  })

  it('still reaches everyone else', async () => {
    await POST(postRequest({ content: 'from the Mac' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    expect(commentCreatedCall()![0] as string[]).toContain('user-other')
  })

  it('names the author in the payload so a client can tell where it came from', async () => {
    // The receiving client dedupes on comment id, but the origin is still
    // useful (scroll behaviour, read state) and comment_updated already
    // carries it. Without it the two events describe themselves differently.
    await POST(postRequest({ content: 'from the Mac' }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    const payload = commentCreatedCall()![1] as { data: Record<string, unknown> }
    expect(payload.data.userId).toBe(JON)
  })

  it('drops an AI-agent author, which has no second device and would echo-loop', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: AGENT,
      isAIAgent: true,
      email: 'claude@astrid.cc',
    } as never)
    mockPrisma.comment.create.mockResolvedValue(
      createdComment({
        authorId: AGENT,
        author: { id: AGENT, name: 'Claude', email: 'claude@astrid.cc', image: null, isAIAgent: true },
      }) as never
    )
    mockPrisma.task.findUnique.mockResolvedValue(
      { ...taskContext(), creatorId: AGENT } as never
    )

    await POST(postRequest({ content: 'agent says hi', aiAgentId: AGENT }), {
      params: Promise.resolve({ id: 'task-1' }),
    } as never)

    expect(commentCreatedCall()![0] as string[]).not.toContain(AGENT)
  })
})

describe('DELETE /api/v1/comments/:id keeps the deleter in the SSE audience (task cb1581e0)', () => {
  beforeEach(() => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      authorId: JON,
      task: taskContext(),
      author: { id: JON, name: 'Jon', email: 'jon@example.com' },
    } as never)
    mockPrisma.comment.delete.mockResolvedValue({ id: 'comment-1' } as never)
  })

  it('reaches the deleter, so the comment also disappears on their other devices', async () => {
    // Without this the Mac deletes a comment and the web tab keeps showing it
    // until a refresh — the "comments get deleted with repeat refreshing" half
    // of the report, seen from the other end.
    await DELETE(
      new Request('http://localhost:3000/api/v1/comments/comment-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ id: 'comment-1' }) } as never
    )

    const call = broadcastToUsers.mock.calls.find(
      c => (c[1] as { type: string }).type === 'comment_deleted'
    )
    expect(call).toBeDefined()
    expect(call![0] as string[]).toContain(JON)
  })

  it('names the actor in the payload, like comment_updated does', async () => {
    await DELETE(
      new Request('http://localhost:3000/api/v1/comments/comment-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ id: 'comment-1' }) } as never
    )

    const call = broadcastToUsers.mock.calls.find(
      c => (c[1] as { type: string }).type === 'comment_deleted'
    )
    const payload = call![1] as { data: Record<string, unknown> }
    expect(payload.data.userId).toBe(JON)
  })
})
