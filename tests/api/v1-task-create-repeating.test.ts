/**
 * POST /api/v1/tasks must accept repeatingData and repeatFrom (task ee44bc35).
 *
 * The create surface accepted `repeating` and nothing else, so a repeating task
 * could not be created in one call — `repeatingData` and `repeatFrom` were
 * documented in lib/api-contracts/v1-request-shapes.ts as "accepted on PUT but
 * IGNORED here". That made the one mechanism docs/FIXALL_WORKFLOW.md tells
 * agents to use instead of a cron — an Astrid task with a date and a repeat —
 * the one mechanism an agent could not create. The two weekly deep review
 * tasks had to be made by hand for exactly this reason.
 *
 * `repeatFrom` is the half that is easy to skip and matters most for scheduled
 * work: the column defaults to COMPLETION_DATE, which drags the slot forward
 * every time a run lands late. Nothing here computes a next occurrence — that
 * stays in the calculator (ASTRID.md rule 4).
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
  // The create service records the analytics event itself now, so the
  // write has to be stubbed even where the test does not assert on it.
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

const WEEKLY_PATTERN = {
  type: 'custom',
  unit: 'weeks',
  interval: 1,
  endCondition: 'never',
  weekdays: ['monday'],
}

const createdTask = {
  id: 'task-1',
  title: 'Weekly deep review',
  description: '',
  priority: 0,
  completed: false,
  dueDateTime: null,
  isAllDay: false,
  isPrivate: true,
  repeating: 'custom',
  repeatingData: WEEKLY_PATTERN,
  repeatFrom: 'DUE_DATE',
  assigneeId: null,
  creatorId: 'user-1',
  statusRole: null,
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

async function post(body: Record<string, unknown>) {
  const { prisma } = await import('@/lib/prisma')
  vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.task.create).mockResolvedValue(createdTask as never)

  const { POST } = await import('@/app/api/v1/tasks/route')
  const response = await POST(
    new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
  const createArgs = vi.mocked(prisma.task.create).mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined
  return { response, data: createArgs?.data }
}

describe('POST /api/v1/tasks repeat configuration (task ee44bc35)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a custom repeat pattern sent as repeatingData', async () => {
    const { response, data } = await post({
      title: 'Weekly deep review',
      repeating: 'custom',
      repeatingData: WEEKLY_PATTERN,
    })

    expect(response.status).toBe(201)
    expect(data?.repeating).toBe('custom')
    expect(data?.repeatingData).toEqual(WEEKLY_PATTERN)
  })

  it('persists repeatFrom, so a late run does not drag the slot forward', async () => {
    const { data } = await post({
      title: 'Weekly deep review',
      repeating: 'weekly',
      repeatFrom: 'DUE_DATE',
    })

    expect(data?.repeatFrom).toBe('DUE_DATE')
  })

  it('leaves repeatFrom unset when the body omits it, so the column default stands', async () => {
    // COMPLETION_DATE is the schema default; writing it explicitly here would
    // be the same value by luck, not by contract.
    const { data } = await post({ title: 'A task', repeating: 'weekly' })

    expect(data?.repeatFrom ?? null).toBeNull()
  })

  it('drops repeatingData for a non-custom schedule, where it means nothing', async () => {
    const { data } = await post({
      title: 'A task',
      repeating: 'weekly',
      repeatingData: WEEKLY_PATTERN,
    })

    expect(data?.repeatingData ?? null).toBeNull()
  })
})
