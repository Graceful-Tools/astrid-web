/**
 * POST /api/v1/tasks must accept statusRole (task eb7fce2f).
 *
 * "Adding task to board fails on web": since Stage D a board column's id is
 * its ROLE ("ready"), not a list id — the rows are gone. The board's add-task
 * form still sent that role inside listIds, so every create on a status column
 * answered 400 "Invalid list IDs: ready". The MOVE path learned this exact
 * lesson already (lib/project-status.ts resolveProjectColumnMove: "the column
 * id is a ROLE... never appended"); the CREATE path missed the same treatment.
 *
 * Fix shape: the board sends { listIds: [domain list], statusRole: role }, so
 * the server has to persist statusRole on create the way the update route
 * already does.
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error { name = 'UnauthorizedError' }
  class ForbiddenError extends Error { name = 'ForbiddenError' }
  return {
    authenticateAPI: vi.fn().mockResolvedValue({
      userId: 'user-1',
      source: 'oauth',
      scopes: ['*'],
      clientId: 'test-client',
    }),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/analytics-events', () => ({
  trackEventFromRequest: vi.fn(),
  AnalyticsEventType: { TASK_CREATED: 'task_created' },
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => ['user-1']),
  hasListAccess: vi.fn(() => true),
}))

vi.mock('@/lib/agent-protocol', () => ({
  enrichTaskForAgent: vi.fn((task: unknown) => task),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const now = new Date()
const createdTask = {
  id: 'task-1',
  title: 'Board task',
  description: '',
  priority: 0,
  completed: false,
  dueDateTime: null,
  isAllDay: false,
  isPrivate: true,
  repeating: 'never',
  repeatingData: null,
  repeatFrom: 'COMPLETION_DATE',
  assigneeId: null,
  creatorId: 'user-1',
  statusRole: 'ready',
  createdAt: now,
  updatedAt: now,
  lists: [],
  assignee: null,
  creator: { id: 'user-1', name: 'T', email: 't@t.co', image: null, isAIAgent: false },
  comments: [],
  attachments: [],
}

beforeAll(async () => {
  await import('@/app/api/v1/tasks/route')
})

describe('POST /api/v1/tasks statusRole (task eb7fce2f)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists statusRole so a task created on a board column lands in that column', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.task.create).mockResolvedValue(createdTask as never)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const response = await POST(
      new NextRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Board task', statusRole: 'ready' }),
      })
    )

    expect(response.status).toBe(201)
    const createArgs = vi.mocked(prisma.task.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArgs.data.statusRole).toBe('ready')
  })

  it('leaves statusRole null when the body does not send one — Inbox is the absence of a status', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.task.create).mockResolvedValue({ ...createdTask, statusRole: null } as never)

    const { POST } = await import('@/app/api/v1/tasks/route')
    await POST(
      new NextRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Inbox task' }),
      })
    )

    const createArgs = vi.mocked(prisma.task.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArgs.data.statusRole ?? null).toBeNull()
  })
})
