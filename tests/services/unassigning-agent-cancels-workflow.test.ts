/**
 * AWTD-1109 — unassigning an AI agent stops its coding workflow.
 *
 * The service cancelled a task's CodingTaskWorkflow on completion and on
 * delete, and on nothing else. So taking an agent off a task — by hand, or in
 * bulk when its list went public — left the agent working, commenting and
 * eventually "finishing" a task nobody had given it any more.
 *
 * Narrow on purpose: only agent → nobody. A hand-over from one assignee to
 * another is left to the assignment dispatch, which owns the workflow row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskUpdate = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
const cancelActiveCodingWorkflow = vi.hoisted(() => vi.fn(async () => ({ cancelled: true })))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: taskUpdate },
    taskList: { findMany: vi.fn(async () => []) },
    comment: { create: vi.fn() },
    user: { findUnique: userFindUnique },
  },
}))
vi.mock('@/lib/list-member-utils', async importOriginal => ({
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
vi.mock('@/lib/tasks/cancel-active-coding-workflow', () => ({ cancelActiveCodingWorkflow }))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships: vi.fn() }))
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats: vi.fn() }))
vi.mock('@/lib/analytics-events', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent: vi.fn(),
}))

import { updateTaskWithSideEffects } from '@/services/task.service'

function existing(assigneeId: string | null) {
  return {
    id: 'task-1',
    title: 'Agent work',
    completed: false,
    creatorId: 'user-1',
    assigneeId,
    statusRole: null,
    updatedAt: new Date('2026-10-06T00:00:00Z'),
    lists: [],
  }
}

async function reassign(from: string | null, to: string | null) {
  taskUpdate.mockResolvedValue({ ...existing(to), comments: [] })
  const result = await updateTaskWithSideEffects({
    taskId: 'task-1',
    actorId: 'user-1',
    intent: { assigneeId: to },
    existingTask: existing(from),
  })
  expect(result.ok).toBe(true)
}

describe('unassigning an AI agent cancels its coding workflow (AWTD-1109)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      isAIAgent: where.id.startsWith('ai-agent-'),
    }))
  })

  it('agent → nobody cancels the workflow (AWTD-1109)', async () => {
    await reassign('ai-agent-claude', null)
    expect(cancelActiveCodingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
    )
  })

  it('person → nobody does not touch workflows (AWTD-1109)', async () => {
    await reassign('user-2', null)
    expect(cancelActiveCodingWorkflow).not.toHaveBeenCalled()
  })

  it('agent → person is left to the assignment dispatch (AWTD-1109)', async () => {
    await reassign('ai-agent-claude', 'user-1')
    expect(cancelActiveCodingWorkflow).not.toHaveBeenCalled()
  })
})
