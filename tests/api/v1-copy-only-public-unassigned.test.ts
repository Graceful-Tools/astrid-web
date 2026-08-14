/**
 * Task e0613ae5 — `POST /api/v1/tasks` must leave tasks unassigned when any
 * target list is a copy-only PUBLIC list.
 *
 * Legacy has enforced this since it was written, and calls it a security
 * requirement in its own comment:
 *
 *   // Copy-only PUBLIC lists MUST have unassigned tasks (security requirement)
 *   // Collaborative public lists can have assignees since only members can add
 *   if (hasPublicList) { finalAssigneeId = null }
 *
 * v1 never carried the rule across. Its only assignee guard is that the
 * assignee belongs to one of the lists — which does not help here, because the
 * people who can post to a copy-only public list ARE members. The result is
 * that the same request produces an unassigned task through web and an
 * assigned one through v1.
 *
 * Why it matters: a copy-only public list is a template anyone can read and
 * copy. An assignee on one publishes a real person's identity on a public
 * artifact, and means nothing once copied into somebody else's account.
 *
 * The distinction legacy draws is deliberate and preserved here: COLLABORATIVE
 * public lists keep their assignees, because only members can add tasks there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findMany: vi.fn(), findUnique: vi.fn() },
    task: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
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
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null), UnauthorizedError, ForbiddenError,
  }
})

vi.mock('@/lib/list-member-utils', () => ({
  hasListAccess: vi.fn(() => true),
  getListMemberIds: vi.fn(async () => []),
}))

// Post-create fan-out; not what this test is about.
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn() }, isRedisAvailable: vi.fn(() => false) }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))
vi.mock('@/lib/task-recipients', () => ({ collectListRecipientUserIds: vi.fn(() => []) }))
vi.mock('@/lib/task-update-handler', () => ({ recordTaskCreationComment: vi.fn() }))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: vi.fn((t: unknown) => t) }))
vi.mock('@/lib/reminder-scheduling', () => ({ scheduleRemindersForTask: vi.fn() }))

import { POST } from '@/app/api/v1/tasks/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const USER = 'user-1'
const ASSIGNEE = 'user-2'

function list(overrides: Record<string, unknown>) {
  return {
    id: 'list-1', name: 'L', isVirtual: false, projectId: null,
    privacy: 'PRIVATE', publicListType: null,
    ownerId: USER, listMembers: [{ userId: USER, role: 'admin' }],
    ...overrides,
  }
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The assigneeId prisma.task.create was called with. */
function createdAssignee() {
  const call = (mockPrisma.task.create as never as ReturnType<typeof vi.fn>).mock.calls[0]
  return call?.[0]?.data?.assigneeId
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    userId: USER, source: 'oauth', scopes: ['tasks:write'], isAIAgent: false,
    user: { id: USER, email: 'u@example.com', name: 'U', isAIAgent: false },
  } as never)
  ;(mockPrisma.task.create as never as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'task-1', title: 'T', lists: [], comments: [], attachments: [], assigneeId: null,
  } as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(null as never)
})

describe('POST /api/v1/tasks — copy-only public lists stay unassigned (task e0613ae5)', () => {
  it('forces the task unassigned on a copy-only PUBLIC list', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue([
      list({ privacy: 'PUBLIC', publicListType: 'copy' }),
    ] as never)

    await POST(req({ title: 'T', listIds: ['list-1'], assigneeId: ASSIGNEE }) as never)

    expect(mockPrisma.task.create).toHaveBeenCalled()
    expect(createdAssignee()).toBeNull()
  })

  it('treats a PUBLIC list with no publicListType as copy-only', async () => {
    // Legacy's test is `publicListType !== 'collaborative'`, so null counts.
    mockPrisma.taskList.findMany.mockResolvedValue([
      list({ privacy: 'PUBLIC', publicListType: null }),
    ] as never)

    await POST(req({ title: 'T', listIds: ['list-1'], assigneeId: ASSIGNEE }) as never)

    expect(createdAssignee()).toBeNull()
  })

  it('KEEPS the assignee on a collaborative public list', async () => {
    // The distinction legacy draws deliberately: only members can add tasks to
    // a collaborative list, so an assignee there is meaningful and safe.
    mockPrisma.taskList.findMany.mockResolvedValue([
      list({ privacy: 'PUBLIC', publicListType: 'collaborative' }),
    ] as never)

    await POST(req({ title: 'T', listIds: ['list-1'], assigneeId: ASSIGNEE }) as never)

    expect(createdAssignee()).toBe(ASSIGNEE)
  })

  it('keeps the assignee on an ordinary private list', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue([list({})] as never)

    await POST(req({ title: 'T', listIds: ['list-1'], assigneeId: ASSIGNEE }) as never)

    expect(createdAssignee()).toBe(ASSIGNEE)
  })

  it('unassigns when ANY of several target lists is copy-only public', async () => {
    // One public list in the set is enough — the task becomes publicly visible
    // through it regardless of the others.
    mockPrisma.taskList.findMany.mockResolvedValue([
      list({ id: 'list-1' }),
      list({ id: 'list-2', privacy: 'PUBLIC', publicListType: 'copy' }),
    ] as never)

    await POST(req({ title: 'T', listIds: ['list-1', 'list-2'], assigneeId: ASSIGNEE }) as never)

    expect(createdAssignee()).toBeNull()
  })
})
