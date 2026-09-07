/**
 * Cross-surface contract test for the comment CREATE verb (epic 9dedd8aa).
 *
 * The epic's second sentence — "the same is true for comments (4
 * implementations)" — is this file. Five surfaces created comments and they did
 * not agree about what creating a comment MEANS:
 *
 *   legacy app/api/tasks/[id]/comments        idempotency ✅  side effects ✅
 *   v1     app/api/v1/tasks/[id]/comments     idempotency ✅  side effects ✅
 *   MCP    mcp/handlers/comments.ts (stdio)   idempotency ❌  side effects ✅
 *   agent  app/api/v1/agent/tasks/[id]/...    idempotency ❌  side effects ❌
 *   MCP    operations/comment-operations.ts   idempotency ❌  side effects ❌
 *
 * The last two columns are not style. `dispatchPostCommentSideEffects` is what
 * sends an @-mention push, triggers the mentioned AI agent, detects a workflow
 * command (approve / ship-it / changes) and invalidates stats. A surface that
 * skips it accepts the comment, stores it, broadcasts it — and then silently
 * does none of the things a comment is FOR.
 *
 * That mattered most on the MCP surface, because that is the door agents come
 * through. Posting "ship it" or "@someone please look" through MCP was inert:
 * the row existed and nothing happened. Task 390bccc3 fixed exactly this bug —
 * for the stdio MCP server only, leaving the HTTP one it did not know about.
 *
 * These tests assert the GUARANTEE, not the implementation: however a surface
 * creates a comment, the side effects must fire. The agent and MCP rows failed
 * when this file was written; all four now route through
 * services/comment.service.ts, and this is what keeps a fifth surface — or a
 * rewrite of one of these four — from quietly dropping a guarantee again.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatchPostCommentSideEffects = vi.hoisted(() => vi.fn())
const broadcastToUsers = vi.hoisted(() => vi.fn())
const authenticateAgentRequest = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())
const authenticateAPI = vi.hoisted(() => vi.fn())
const resolveMCPActor = vi.hoisted(() => vi.fn())
const getListMemberIdsByListId = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn(), findUnique: vi.fn() },
    comment: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    secureFile: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/comments/post-comment-side-effects', () => ({
  dispatchPostCommentSideEffects,
}))

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers,
  sendEventToUser: vi.fn(),
}))

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

vi.mock('@/lib/agent-protocol', () => ({ authenticateAgentRequest }))

vi.mock('@/lib/agent-rate-limiter', () => ({
  checkAgentRateLimit: vi.fn(async () => ({ response: null, headers: {} })),
  addRateLimitHeaders: vi.fn((res: unknown) => res),
  AGENT_RATE_LIMITS: { COMMENTS: {} },
}))

vi.mock('@/app/api/mcp/operations/handlers/shared', () => ({
  resolveMCPActor,
  getListMemberIdsByListId,
}))

// The stdio MCP server validates its own token and loads schemas through
// require(); both are CommonJS, hence the module paths rather than aliases.


vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn((list: { ownerId?: string; listMembers?: { userId: string }[] }) => [
    ...(list.ownerId ? [list.ownerId] : []),
    ...(list.listMembers?.map(m => m.userId) ?? []),
  ]),
  hasListAccess: vi.fn(() => true),
  canAccessList: vi.fn(() => true),
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_ADDED: 'COMMENT_ADDED', COMMENT_DELETED: 'COMMENT_DELETED' },
  trackEventFromRequest: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}))

import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)

/** Jon owns the list and created the task; MENTIONED is who the comment @-mentions. */
const JON = 'user-jon'
const AGENT = 'user-agent'
const MENTIONED = 'user-mentioned'

/** The content every surface posts — an @-mention AND a workflow command. */
const CONTENT = 'ship it @[Someone](user-mentioned)'

const task = () => ({
  id: 'task-1',
  title: 'A task',
  creatorId: JON,
  assigneeId: AGENT,
  assignee: { id: AGENT, email: 'claude@astrid.cc', name: 'Claude', isAIAgent: true, aiAgentType: 'claude_agent' },
  lists: [
    {
      id: 'list-1',
      name: 'Astrid Web To-do',
      ownerId: JON,
      privacy: 'PRIVATE',
      githubRepositoryId: null,
      aiAgentConfiguredBy: null,
      listMembers: [
        { userId: JON, role: 'OWNER', user: { id: JON, name: 'Jon', email: 'jon@example.com' } },
        { userId: MENTIONED, role: 'MEMBER', user: { id: MENTIONED, name: 'Someone', email: 's@example.com' } },
      ],
    },
  ],
})

const created = (over: Record<string, unknown> = {}) => ({
  id: 'comment-new',
  content: CONTENT,
  type: 'TEXT',
  authorId: JON,
  taskId: 'task-1',
  parentCommentId: null,
  createdAt: new Date('2026-09-07T00:00:00Z'),
  updatedAt: new Date('2026-09-07T00:00:00Z'),
  author: { id: JON, name: 'Jon', email: 'jon@example.com', image: null, isAIAgent: false },
  secureFiles: [],
  task: { id: 'task-1', title: 'A task' },
  ...over,
})

const request = (url: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: CONTENT }),
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.task.findFirst.mockResolvedValue(task() as never)
  mockPrisma.task.findUnique.mockResolvedValue(task() as never)
  mockPrisma.comment.create.mockResolvedValue(created() as never)
  mockPrisma.comment.findFirst.mockResolvedValue(null as never)
  mockPrisma.comment.findUnique.mockResolvedValue(created() as never)
  mockPrisma.comment.count.mockResolvedValue(0 as never)
  mockPrisma.user.findUnique.mockResolvedValue({ id: JON, name: 'Jon', email: 'jon@example.com', isAIAgent: false } as never)

  getUnifiedSession.mockResolvedValue({ user: { id: JON, email: 'jon@example.com' } })
  authenticateAPI.mockResolvedValue({ userId: JON, user: { id: JON, email: 'jon@example.com' }, agentUser: null, scopes: ['comments:write'] })
  authenticateAgentRequest.mockResolvedValue({ userId: AGENT, user: { id: AGENT, email: 'claude@astrid.cc', isAIAgent: true }, scopes: ['tasks:read', 'comments:write'] })
  resolveMCPActor.mockResolvedValue({ userId: JON, user: { id: JON, email: 'jon@example.com' }, token: { userId: JON } })
  getListMemberIdsByListId.mockResolvedValue([JON, MENTIONED])
})

/**
 * Each surface, driven the way its own callers drive it. The assertion is the
 * same for all of them, which is the entire point of a parity test.
 */
const surfaces: Array<{ name: string; post: () => Promise<unknown> }> = [
  {
    name: 'legacy app/api/tasks/[id]/comments',
    post: async () => {
      const { POST } = await import('@/app/api/tasks/[id]/comments/route')
      return POST(request('http://localhost:3000/api/tasks/task-1/comments'), {
        params: Promise.resolve({ id: 'task-1' }),
      } as never)
    },
  },
  {
    name: 'v1 app/api/v1/tasks/[id]/comments',
    post: async () => {
      const { POST } = await import('@/app/api/v1/tasks/[id]/comments/route')
      return POST(request('http://localhost:3000/api/v1/tasks/task-1/comments'), {
        params: Promise.resolve({ id: 'task-1' }),
      } as never)
    },
  },
  {
    name: 'agent app/api/v1/agent/tasks/[id]/comments',
    post: async () => {
      const { POST } = await import('@/app/api/v1/agent/tasks/[id]/comments/route')
      return POST(request('http://localhost:3000/api/v1/agent/tasks/task-1/comments'), {
        params: Promise.resolve({ id: 'task-1' }),
      } as never)
    },
  },
  {
    name: 'MCP app/api/mcp/operations/handlers/comment-operations',
    post: async () => {
      const { addComment } = await import('@/app/api/mcp/operations/handlers/comment-operations')
      return addComment('mcp-token', 'task-1', { content: CONTENT, type: 'TEXT' }, JON)
    },
  },
]

describe('every comment-create surface fires the post-comment side effects (epic 9dedd8aa)', () => {
  for (const surface of surfaces) {
    it(`${surface.name} dispatches side effects`, async () => {
      await surface.post()

      expect(
        dispatchPostCommentSideEffects,
        `${surface.name} created the comment without dispatching post-comment side effects. ` +
          `An @-mention sends no push, the mentioned agent is never triggered, a workflow ` +
          `command ("ship it") is never detected, and stats are never invalidated.`
      ).toHaveBeenCalledTimes(1)
    })

    it(`${surface.name} passes the created comment and its task to the side effects`, async () => {
      await surface.post()

      const call = dispatchPostCommentSideEffects.mock.calls[0]?.[0]
      expect(call, `${surface.name} dispatched nothing`).toBeTruthy()
      expect(call.comment.id).toBe('comment-new')
      expect(call.comment.content).toBe(CONTENT)
      expect(call.task.id).toBe('task-1')
      // The commenter drives "is this an agent talking to itself", so it must
      // be the comment's AUTHOR and never the credential's owner.
      expect(call.commenter.id).toBe(call.comment.authorId ?? call.commenter.id)
    })
  }
})

/**
 * The fifth surface, checked structurally rather than behaviourally.
 *
 * mcp/handlers/comments.ts is CommonJS by convention — it pulls its schemas and
 * token validator through require() — so vi.mock cannot intercept them and the
 * handler cannot be driven the way the four HTTP surfaces above are. That is a
 * property of the stdio MCP server's module style, not of the fix; converting
 * mcp/ to ESM is its own change with its own risk (that server has broken at
 * build and launch before) and does not belong in this slice.
 *
 * So this asserts the one thing that actually regresses: that the handler still
 * delegates instead of growing its own prisma.comment.create back. That is how
 * the drift started everywhere else.
 */
describe('the stdio MCP comment handler delegates to the service (epic 9dedd8aa)', () => {
  const source = readFileSync(
    join(process.cwd(), 'mcp/handlers/comments.ts'),
    'utf8',
  )

  it('calls createCommentWithSideEffects', () => {
    expect(source).toContain('createCommentWithSideEffects')
  })

  it('does not create comment rows itself', () => {
    expect(
      source,
      'mcp/handlers/comments.ts writes comments directly again. Every other ' +
        'surface goes through services/comment.service.ts; a raw create here ' +
        'skips the SSE fan-out and the post-comment side effects, which is the ' +
        'bug this epic was opened for.',
    ).not.toMatch(/prisma\.comment\.create/)
  })
})
