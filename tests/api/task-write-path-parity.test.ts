/**
 * Contract test for task fb94f2ee — the acceptance criterion.
 *
 * The same completion scenario is driven through all three task-write
 * surfaces (legacy PUT, v1 PUT, agent PATCH) and the resulting DB state and
 * side effects must be identical. Five independent implementations of "update
 * a task" had drifted: v1 never rescheduled reminders, never cancelled an
 * in-flight coding workflow and never synced manual-sort memberships; the
 * agent PATCH was a raw prisma.task.update with no completion stamping, no
 * statusRole clearing (violating the schema invariant), no repeating
 * roll-forward and no events at all — so an agent completing a repeating task
 * killed the series.
 *
 * Whatever the surfaces do, they must now do it the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const taskFindUnique = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const taskUpdate = vi.hoisted(() => vi.fn())
const cancelActiveCodingWorkflow = vi.hoisted(() => vi.fn())
const rescheduleRemindersForUpdate = vi.hoisted(() => vi.fn())
const handleRepeatingTaskCompletion = vi.hoisted(() => vi.fn())
const applyRepeatingTaskRollForward = vi.hoisted(() => vi.fn())
const recordTaskEvents = vi.hoisted(() => vi.fn())
const notifyTaskUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, findFirst: taskFindFirst, update: taskUpdate },
    taskList: { findMany: vi.fn(async () => []) },
    comment: { create: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ isAIAgent: false })) },
    codingTaskWorkflow: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/tasks/cancel-active-coding-workflow', () => ({ cancelActiveCodingWorkflow }))
vi.mock('@/lib/reminder-scheduling', () => ({ rescheduleRemindersForUpdate }))
// The real task-update-handler runs, so the closed-reason rule is exercised
// rather than asserted against a mock. Only the leaf handlers are stubbed.
vi.mock('@/lib/repeating-task-handler', () => ({
  handleRepeatingTaskCompletion,
  applyRepeatingTaskRollForward,
}))
vi.mock('@/lib/task-state-change-tracker', () => ({
  detectTaskStateChanges: vi.fn(() => []),
  formatStateChangesAsComment: vi.fn(() => ''),
}))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents }))
vi.mock('@/lib/notification-store', () => ({ notifyTaskUpdate }))

// Everything else the handlers fire off afterwards wants a real DB/Redis/SSE.
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { del: vi.fn(), keys: { userTasks: (id: string) => id } }, isRedisAvailable: vi.fn(async () => false) }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))
vi.mock('@/lib/task-recipients', () => ({ collectListRecipientUserIds: vi.fn(() => []) }))
vi.mock('@/lib/list-member-utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasListAccess: vi.fn(() => true),
  getListMemberIds: vi.fn(() => []),
}))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))
vi.mock('@/lib/agent-protocol', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enrichTaskForAgent: vi.fn((t: unknown) => t),
}))
vi.mock('@/lib/deletion-log', () => ({ audienceForTask: vi.fn(async () => []), recordDeletion: vi.fn() }))
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats: vi.fn() }))
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships: vi.fn() }))
vi.mock('@/lib/placeholder-user-service', () => ({ placeholderUserService: { resolvePlaceholder: vi.fn() } }))
vi.mock('@/lib/list-permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canUserEditTask: vi.fn(() => true),
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn(async () => ({ user: { id: 'user-1', email: 'jon@example.com', name: 'Jon' } })) }))
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(async () => ({
      userId: 'user-1', source: 'oauth', scopes: ['tasks:write'], isAIAgent: false,
      user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
    })),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    requireTaskReadAccess: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError, ForbiddenError,
  }
})
vi.mock('@/lib/api-agent-auth-wrapper', () => ({
  withAgentAuth: (_opts: unknown, handler: (...a: unknown[]) => unknown) =>
    (req: unknown, ctx: unknown) =>
      handler(req, { userId: 'user-1', clientId: 'agent-1', scopes: ['tasks:read', 'tasks:write'] }, ctx),
}))
vi.mock('@/lib/agent-rate-limiter', () => ({
  checkAgentRateLimit: vi.fn(async () => ({ response: null, headers: {} })),
  addRateLimitHeaders: (res: unknown) => res,
  AGENT_RATE_LIMITS: { TASKS: {} },
}))

const OPEN_TASK = {
  id: 'task-1',
  title: 'A task',
  description: '',
  completed: false,
  completedAt: null,
  completedSource: null,
  closedReason: null,
  statusRole: 'doing',
  priority: 0,
  assigneeId: 'user-1',
  creatorId: 'user-1',
  dueDateTime: new Date('2026-09-10T10:00:00.000Z'),
  isAllDay: false,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  repeating: 'never',
  repeatingData: null,
  repeatFrom: 'COMPLETION_DATE',
  occurrenceCount: 0,
  lists: [],
  assignee: null,
  comments: [],
}

function ctx() {
  return { params: Promise.resolve({ id: 'task-1' }) } as never
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as never
}

/** Drive `{ completed: true }` through one surface and return the prisma update data. */
const SURFACES = {
  async legacy(body: unknown) {
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    return await PUT(jsonReq('http://localhost/api/tasks/task-1', 'PUT', { title: 'A task', ...(body as object) }), ctx())
  },
  async v1(body: unknown) {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    return await PUT(jsonReq('http://localhost/api/v1/tasks/task-1', 'PUT', body), ctx())
  },
  async agent(body: unknown) {
    const { PATCH } = await import('@/app/api/v1/agent/tasks/[id]/route')
    return await PATCH(jsonReq('http://localhost/api/v1/agent/tasks/task-1', 'PATCH', body), ctx())
  },
}

const NAMES = ['legacy', 'v1', 'agent'] as const

function updateData() {
  return taskUpdate.mock.calls.at(-1)?.[0]?.data ?? {}
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue({ ...OPEN_TASK })
  taskFindFirst.mockResolvedValue({ ...OPEN_TASK })
  taskUpdate.mockResolvedValue({ ...OPEN_TASK, completed: true })
  handleRepeatingTaskCompletion.mockResolvedValue(null)
  cancelActiveCodingWorkflow.mockResolvedValue({ cancelled: false })
})

describe.each(NAMES)('%s task-write surface — completion semantics (task fb94f2ee)', (name) => {
  const drive = SURFACES[name]

  it('stamps completedAt and completedSource', async () => {
    await drive({ completed: true })
    const data = updateData()
    expect(data.completedAt).toBeInstanceOf(Date)
    expect(data.completedSource).toBe('astrid')
  })

  it('clears statusRole — a done task carries no board status', async () => {
    await drive({ completed: true })
    expect(updateData().statusRole).toBeNull()
  })

  it('cancels an in-flight coding workflow', async () => {
    await drive({ completed: true })
    expect(cancelActiveCodingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' })
    )
  })

  it('reschedules reminders', async () => {
    await drive({ completed: true })
    expect(rescheduleRemindersForUpdate).toHaveBeenCalled()
  })

  it('records task events and notifies', async () => {
    await drive({ completed: true })
    expect(recordTaskEvents).toHaveBeenCalled()
    expect(notifyTaskUpdate).toHaveBeenCalled()
  })

  it('rolls a repeating series forward on an ordinary completion', async () => {
    handleRepeatingTaskCompletion.mockResolvedValue({
      shouldRollForward: true, shouldTerminate: false,
      nextDueDate: new Date('2026-09-17T10:00:00.000Z'), newOccurrenceCount: 1,
    })

    await drive({ completed: true })

    expect(applyRepeatingTaskRollForward).toHaveBeenCalledWith('task-1', expect.anything())
  })

  it('does NOT roll a repeating series forward when the occurrence is CANCELED', async () => {
    // "we're not doing this one" and "this one is done, schedule the next" are
    // opposite intents (task 11042ae3). v1 skipped this guard entirely.
    handleRepeatingTaskCompletion.mockResolvedValue({
      shouldRollForward: true, shouldTerminate: false,
      nextDueDate: new Date('2026-09-17T10:00:00.000Z'), newOccurrenceCount: 1,
    })

    await drive({ completed: true, closedReason: 'canceled' })

    expect(applyRepeatingTaskRollForward).not.toHaveBeenCalled()
  })

  it('clears the completion stamp when the task is reopened', async () => {
    taskFindUnique.mockResolvedValue({ ...OPEN_TASK, completed: true, completedAt: new Date(), completedSource: 'astrid' })
    taskFindFirst.mockResolvedValue({ ...OPEN_TASK, completed: true, completedAt: new Date(), completedSource: 'astrid' })

    await drive({ completed: false })

    const data = updateData()
    expect(data.completedAt).toBeNull()
    expect(data.completedSource).toBeNull()
  })
})
