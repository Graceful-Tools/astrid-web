/**
 * Cross-surface contract test for the comment UPDATE and DELETE verbs
 * (epic 9dedd8aa). The CREATE half is comment-create-parity.test.ts.
 *
 * UPDATE has two implementations and DELETE has three, and they disagree in
 * two ways that a client can actually see:
 *
 * 1. THE ACTOR RULE ON DELETE. v1 drops an AI-agent deleter from its own
 *    audience — `commentAudience(task, { id, isAIAgent })` — because agents
 *    share the SSE pool and one that reacts to comment events would react to
 *    its own. The legacy route and the MCP handler pass no actor at all, so an
 *    agent deleting through those doors gets its own event back. Task cb1581e0
 *    put that rule in one function precisely so the surfaces would stop
 *    disagreeing about it; two of the three delete paths never adopted it.
 *
 * 2. THE PAYLOAD. Legacy and MCP send `taskTitle` and `deletedByName`; v1 sends
 *    neither. A client cannot render "X deleted a comment on Y" from a v1
 *    delete but can from the other two, so the notification it can show
 *    depends on which door the deleter used.
 *
 * DELETE also duplicates its permission rule: `canDeleteComment` exists in
 * lib/comment-permissions.ts and legacy and v1 both call it, while the MCP
 * handler re-derives the same four clauses by hand. It happens to agree today.
 * "Happens to agree today" is the thing this epic exists to stop.
 *
 * As with create, these assert the GUARANTEE rather than the mechanism: an
 * edit or a delete means the same thing whichever surface performs it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const broadcastToUsers = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())
const authenticateAPI = vi.hoisted(() => vi.fn())
const resolveMCPActor = vi.hoisted(() => vi.fn())
const getListMemberIdsByListId = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    task: { findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers, sendEventToUser: vi.fn() }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI,
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/app/api/mcp/operations/handlers/shared', () => ({
  resolveMCPActor,
  getListMemberIdsByListId,
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_ADDED: 'COMMENT_ADDED', COMMENT_DELETED: 'COMMENT_DELETED' },
  trackEventFromRequest: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}))

import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)

/** An AI agent is the actor throughout: that is what makes the actor rule observable. */
const AGENT = 'user-agent'
const JON = 'user-jon'
const MEMBER = 'user-member'

const task = () => ({
  id: 'task-1',
  title: 'A task',
  creatorId: JON,
  assigneeId: AGENT,
  lists: [
    {
      id: 'list-1',
      name: 'Astrid Web To-do',
      ownerId: JON,
      privacy: 'PRIVATE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      owner: { id: JON, email: 'jon@example.com', name: 'Jon', image: null },
      listMembers: [
        { userId: JON, role: 'admin', user: { id: JON, email: 'jon@example.com', name: 'Jon', image: null } },
        { userId: MEMBER, role: 'member', user: { id: MEMBER, email: 'm@example.com', name: 'M', image: null } },
        { userId: AGENT, role: 'member', user: { id: AGENT, email: 'claude@astrid.cc', name: 'Claude', image: null } },
      ],
    },
  ],
})

const existing = () => ({
  id: 'comment-1',
  content: 'original',
  type: 'TEXT',
  authorId: AGENT,
  taskId: 'task-1',
  parentCommentId: null,
  createdAt: new Date('2026-09-07T00:00:00Z'),
  updatedAt: new Date('2026-09-07T00:00:00Z'),
  author: { id: AGENT, name: 'Claude', email: 'claude@astrid.cc', image: null, isAIAgent: true },
  secureFiles: [],
  task: task(),
})

const updated = () => ({ ...existing(), content: 'edited', updatedAt: new Date('2026-09-07T01:00:00Z') })

const jsonRequest = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as never

const eventOfType = (type: string) =>
  broadcastToUsers.mock.calls.find(call => (call[1] as { type: string }).type === type)

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.comment.findUnique.mockResolvedValue(existing() as never)
  mockPrisma.comment.update.mockResolvedValue(updated() as never)
  mockPrisma.comment.delete.mockResolvedValue(existing() as never)
  mockPrisma.user.findUnique.mockResolvedValue({
    id: AGENT, name: 'Claude', email: 'claude@astrid.cc', isAIAgent: true,
  } as never)

  // The AGENT is the one editing and deleting, on every surface.
  getUnifiedSession.mockResolvedValue({ user: { id: AGENT, name: 'Claude', email: 'claude@astrid.cc', isAIAgent: true } })
  authenticateAPI.mockResolvedValue({
    userId: AGENT,
    user: { id: AGENT, name: 'Claude', email: 'claude@astrid.cc', isAIAgent: true },
    isAIAgent: true,
    source: 'oauth',
    scopes: ['comments:write'],
  })
  resolveMCPActor.mockResolvedValue({
    userId: AGENT,
    user: { id: AGENT, name: 'Claude', email: 'claude@astrid.cc', isAIAgent: true },
    token: { userId: AGENT },
  })
  getListMemberIdsByListId.mockResolvedValue([JON, MEMBER, AGENT])
})

const updateSurfaces = [
  {
    name: 'legacy PUT /api/comments/:id',
    run: async () => {
      const { PUT } = await import('@/app/api/comments/[id]/route')
      return PUT(jsonRequest('http://localhost/api/comments/comment-1', 'PUT', { content: 'edited' }), {
        params: Promise.resolve({ id: 'comment-1' }),
      } as never)
    },
  },
  {
    name: 'v1 PUT /api/v1/comments/:id',
    run: async () => {
      const { PUT } = await import('@/app/api/v1/comments/[id]/route')
      return PUT(jsonRequest('http://localhost/api/v1/comments/comment-1', 'PUT', { content: 'edited' }), {
        params: Promise.resolve({ id: 'comment-1' }),
      } as never)
    },
  },
]

const deleteSurfaces = [
  {
    name: 'legacy DELETE /api/comments/:id',
    run: async () => {
      const { DELETE } = await import('@/app/api/comments/[id]/route')
      return DELETE(jsonRequest('http://localhost/api/comments/comment-1', 'DELETE'), {
        params: Promise.resolve({ id: 'comment-1' }),
      } as never)
    },
  },
  {
    name: 'v1 DELETE /api/v1/comments/:id',
    run: async () => {
      const { DELETE } = await import('@/app/api/v1/comments/[id]/route')
      return DELETE(jsonRequest('http://localhost/api/v1/comments/comment-1', 'DELETE'), {
        params: Promise.resolve({ id: 'comment-1' }),
      } as never)
    },
  },
  {
    name: 'MCP deleteComment',
    run: async () => {
      const { deleteComment } = await import('@/app/api/mcp/operations/handlers/comment-operations')
      return deleteComment('mcp-token', 'comment-1', AGENT)
    },
  },
]

describe('comment UPDATE means the same thing on every surface (epic 9dedd8aa)', () => {
  for (const surface of updateSurfaces) {
    it(`${surface.name} broadcasts comment_updated with the agreed payload`, async () => {
      await surface.run()

      const event = eventOfType('comment_updated')
      expect(event, `${surface.name} broadcast no comment_updated`).toBeTruthy()

      const data = (event![1] as { data: Record<string, unknown> }).data
      expect(Object.keys(data).sort()).toEqual(
        ['comment', 'commentContent', 'commentId', 'editorName', 'listNames', 'taskId', 'taskTitle', 'userId'],
      )
      expect(data.userId).toBe(AGENT)
    })

    it(`${surface.name} keeps the editor in the audience`, async () => {
      await surface.run()

      // The editor STAYS in on update — unlike delete. task-detail.tsx renders
      // the edited text from this event, and the editor's other devices need it.
      const event = eventOfType('comment_updated')
      expect(event![0] as string[]).toContain(AGENT)
    })
  }
})

describe('comment DELETE means the same thing on every surface (epic 9dedd8aa)', () => {
  for (const surface of deleteSurfaces) {
    it(`${surface.name} broadcasts comment_deleted with the agreed payload`, async () => {
      await surface.run()

      const event = eventOfType('comment_deleted')
      expect(event, `${surface.name} broadcast no comment_deleted`).toBeTruthy()

      const data = (event![1] as { data: Record<string, unknown> }).data
      expect(
        Object.keys(data).sort(),
        `${surface.name} sends a different comment_deleted payload than the other delete surfaces, ` +
          `so what a client can render depends on which door the deleter used.`,
      ).toEqual(['commentId', 'deletedByName', 'listNames', 'taskId', 'taskTitle', 'userId'])
      expect(data.userId).toBe(AGENT)
    })

    it(`${surface.name} drops an AI-agent deleter from its own audience`, async () => {
      await surface.run()

      const event = eventOfType('comment_deleted')
      expect(
        event![0] as string[],
        `${surface.name} sent the agent its own delete event. Agents share the SSE pool, so one ` +
          `that reacts to comment events reacts to itself — that is why applyCommentActorRule exists.`,
      ).not.toContain(AGENT)
      // Everyone else still hears about it.
      expect(event![0] as string[]).toContain(JON)
      expect(event![0] as string[]).toContain(MEMBER)
    })
  }
})
