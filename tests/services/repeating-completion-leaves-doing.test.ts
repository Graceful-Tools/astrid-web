/**
 * A finished recurring run must leave Doing (2026-11-04), through the real update service.
 *
 * The pure rule is pinned in tests/lib/repeating-roll-forward-leaves-doing.test.ts; this pins
 * that `updateTaskWithSideEffects` hands it to the roll-forward. The default update include
 * does not load the assignee, so the service looks it up — only for a task in Doing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskUpdate = vi.hoisted(() => vi.fn())
const taskListFindMany = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: taskUpdate },
    taskList: { findMany: taskListFindMany },
    comment: { create: vi.fn() },
    user: { findUnique: userFindUnique },
  },
}))
vi.mock('@/lib/list-member-utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasListAccess: vi.fn(() => true),
  getListMemberIds: vi.fn(() => []),
}))
vi.mock('@/lib/repeating-task-handler', () => ({
  handleRepeatingTaskCompletion: vi.fn(),
  applyRepeatingTaskRollForward: vi.fn(),
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/redis', () => ({
  RedisCache: { del: vi.fn(), keys: { userTasks: (id: string) => id } },
  isRedisAvailable: vi.fn(async () => false),
}))
vi.mock('@/lib/notification-store', () => ({ notifyTaskUpdate: vi.fn() }))
vi.mock('@/lib/task-events', () => ({ diffTaskEvents: vi.fn(() => []), recordTaskEvents: vi.fn() }))
vi.mock('@/lib/reminder-scheduling', () => ({ rescheduleRemindersForUpdate: vi.fn() }))
vi.mock('@/lib/tasks/cancel-active-coding-workflow', () => ({ cancelActiveCodingWorkflow: vi.fn() }))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships: vi.fn() }))
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats: vi.fn() }))
vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent: vi.fn(),
}))

import { updateTaskWithSideEffects } from '@/services/task.service'
import { handleRepeatingTaskCompletion, applyRepeatingTaskRollForward } from '@/lib/repeating-task-handler'
import { prisma } from '@/lib/prisma'

function weekly(statusRole: string | null, assigneeId: string | null) {
  return {
    id: 'task-1',
    title: 'Weekly audit',
    completed: false,
    creatorId: 'user-1',
    assigneeId,
    identifier: 'AWTD-914',
    statusRole,
    repeating: 'weekly',
    updatedAt: new Date('2026-10-30T00:00:00Z'),
    lists: [],
  }
}

async function complete(task: ReturnType<typeof weekly>) {
  await updateTaskWithSideEffects({
    taskId: 'task-1',
    actorId: 'ai-agent-claude',
    intent: { completed: true },
    existingTask: task,
  })
  return vi.mocked(applyRepeatingTaskRollForward).mock.calls[0]
}

describe('completing a recurring task the agent claimed takes it out of Doing (2026-11-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskListFindMany.mockResolvedValue([])
    vi.mocked(handleRepeatingTaskCompletion).mockResolvedValue({ shouldRollForward: true, nextDueDate: new Date('2026-11-06') } as never)
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ ...weekly('ready', 'ai-agent-claude'), comments: [] } as never)
    userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ isAIAgent: where.id.startsWith('ai-agent-') }))
  })

  it("an agent's occurrence in Doing rolls forward into Ready", async () => {
    const [, , lane] = await complete(weekly('doing', 'ai-agent-claude'))
    expect(lane).toBe('ready')
  })

  it("a person's occurrence in Doing keeps its lane", async () => {
    const [, , lane] = await complete(weekly('doing', 'user-1'))
    expect(lane).toBeUndefined()
  })

  it('an occurrence completed from any other lane keeps it, and costs no lookup', async () => {
    const [, , lane] = await complete(weekly('ready', 'ai-agent-claude'))
    expect(lane).toBeUndefined()
    expect(userFindUnique).not.toHaveBeenCalled()
  })
})
