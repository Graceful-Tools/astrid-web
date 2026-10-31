/**
 * POST /api/v1/tasks must honour reminderTime and reminderType (AWTD-1446).
 *
 * MCP create_task advertises both and the stdio server forwards them, but the
 * route built the service input field by field and never named them, so a
 * create came back with reminderTime/reminderType null while update_task stuck.
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

vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent: vi.fn(),
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
  title: 'Reminder task',
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
  statusRole: null,
  reminderTime: new Date('2026-10-31T20:53:00Z'),
  reminderType: 'email',
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

describe('POST /api/v1/tasks reminders (AWTD-1446)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists reminderTime and reminderType on create', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.task.create).mockResolvedValue(createdTask as never)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const response = await POST(
      new NextRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Reminder task',
          reminderTime: '2026-10-31T20:53:00Z',
          reminderType: 'email',
        }),
      })
    )

    expect(response.status).toBe(201)
    const createArgs = vi.mocked(prisma.task.create).mock.calls[0][0] as { data: Record<string, any> }
    expect(new Date(createArgs.data.reminderTime).toISOString()).toBe('2026-10-31T20:53:00.000Z')
    expect(createArgs.data.reminderType).toBe('email')
  })
})
