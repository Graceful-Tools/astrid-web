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
import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'
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
  // v1 now shares legacy's closed-reason-aware repeating decision (task fb94f2ee).
  resolveRepeatingTaskCompletion: vi.fn(async () => null),
}))

// Post-update fan-out — not what this test is about.
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents: vi.fn() }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn() }, isRedisAvailable: vi.fn(() => false) }))
vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The shared task-write verbs record analytics themselves now, so the real
  // module is spread in for detectPlatform and the write is stubbed.
  trackAnalyticsEvent: vi.fn(),
 trackEventFromRequest: vi.fn(), AnalyticsEventType: {}
}))
// getListMemberIds is synchronous; mocking it async made it return a Promise,
// which only mattered once the shared update verb started reading the SSE
// audience off it.
vi.mock('@/lib/list-member-utils', () => ({ hasListAccess: vi.fn(() => true), getListMemberIds: vi.fn(() => []) }))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: vi.fn((t: unknown) => t) }))
vi.mock('@/lib/deletion-log', () => ({ audienceForTask: vi.fn(async () => []), recordDeletion: vi.fn() }))

import { PUT } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'
import { recordStateChangeComment } from '@/lib/task-update-handler'
import { BRAND } from '@/lib/brand/config'

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
  ;(mockPrisma.task.findUnique as never as Mock)
    .mockResolvedValue(EXISTING as never)
  ;(mockPrisma.task.update as never as Mock)
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
    ;(mockPrisma.task.findUnique as never as Mock).mockResolvedValue(EXISTING as never)
    ;(mockPrisma.task.update as never as Mock)
      .mockResolvedValue({ ...EXISTING, completed: true, comments: [] } as never)
    mockRecordComment.mockResolvedValue(null as never)

    await PUT(putReq({ completed: true }) as never, ctx as never)
    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('jon@example.com')
  })

  it('prepends the new comment to the response so the client shows it without a refetch', async () => {
    const comment = { id: 'c-new', content: 'Jon marked this as complete', systemEventType: 'COMPLETED' }
    mockRecordComment.mockResolvedValue(comment as never)
    ;(mockPrisma.task.update as never as Mock).mockResolvedValue({
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

/**
 * AWTD-974 — and the system line must name WHO actually acted.
 *
 * AWTD-878 fixed this for comments: `POST /api/v1/tasks/:id/comments` takes an
 * `aiAgentId` and resolves it through `lib/ai-agent-author.ts`, so the /fixall
 * loop's strategy notes stopped arriving with the account holder's name and
 * face. The SYSTEM lines were left behind, and they are the louder half — every
 * status move the loop makes emits one.
 *
 * Client-credentials auth resolves `auth.userId` to the OAuth client's OWNER,
 * so `actorName: auth.user?.name` signed every agent-driven update as Jon. The
 * board read "Jon Paris reassigned from Unassigned to Claude Agent" for a move
 * Jon never made, and "Jon Paris marked this as complete" for a task the loop
 * closed. An audit trail that names the wrong actor is worse than none: it
 * reads as authoritative.
 *
 * The same precedence as the comments route, for the same reason — it is the
 * same question. `auth.agentUser` (a token bound to a mailbox) beats a body
 * field, and a body field that does not name a real agent is a 400 rather than
 * a silent fall back to the human, because a silent fallback is invisible in
 * the response and is exactly the bug.
 */
describe('PUT /api/v1/tasks/[id] — who the system line names (AWTD-974)', () => {
  const CLAUDE = {
    id: 'ai-agent-claude',
    email: `claude@${BRAND.agentEmailDomain}`,
    name: 'Claude Agent',
    isAIAgent: true,
  }

  it('names the agent when the token is bound to an agent mailbox', async () => {
    // The stronger claim: the credential itself says who is acting, so no
    // request body can contradict it.
    mockAuth.mockResolvedValue({ ...auth, agentUser: CLAUDE } as never)

    await PUT(putReq({ statusRole: 'doing' }) as never, ctx as never)

    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('Claude Agent')
  })

  it('names the agent a client-credentials caller declares in the body', async () => {
    // The local harnesses have no agent-bound credential yet, so this is the
    // path scripts/set-task-status.ts and the MCP server actually take.
    ;(mockPrisma.user.findUnique as never as Mock).mockResolvedValue(CLAUDE as never)

    await PUT(putReq({ statusRole: 'waiting', aiAgentId: 'ai-agent-claude' }) as never, ctx as never)

    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('Claude Agent')
  })

  it('still names the human on an ordinary update', async () => {
    await PUT(putReq({ completed: true }) as never, ctx as never)

    expect(mockRecordComment.mock.calls[0][0].updaterName).toBe('Jon')
  })

  it('rejects an aiAgentId that does not name an agent, rather than quietly signing as the owner', async () => {
    ;(mockPrisma.user.findUnique as never as Mock).mockResolvedValue({
      id: 'user-2', email: 'someone@example.com', name: 'Someone Else', isAIAgent: false,
    } as never)

    const response = await PUT(putReq({ completed: true, aiAgentId: 'user-2' }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mockRecordComment).not.toHaveBeenCalled()
  })

  it('refuses a caller-chosen agent on legacy MCP, as the comments route does', async () => {
    // That credential cannot prove which harness is speaking, so letting it
    // pick an identity would make the attribution a suggestion.
    mockAuth.mockResolvedValue({ ...auth, source: 'legacy_mcp' } as never)

    const response = await PUT(putReq({ completed: true, aiAgentId: 'ai-agent-claude' }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mockRecordComment).not.toHaveBeenCalled()
  })
})
