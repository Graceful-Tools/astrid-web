/**
 * AWTD-1007 step 4 — a task that leaves its board leaves its column too.
 *
 * Changing a task's lists never touched `statusRole`, so a task dragged off
 * its project board kept `waiting` (or `ready`/`doing`). `isTaskInProject`
 * trusts a role even with no visible project list — deliberately, since a
 * collaborator may hold a role from a board they cannot see — so the stranded
 * task showed the board-state row AND the "Waiting on" row on a plain list.
 *
 * Fixed on the write, where the server can see every list, not in the four
 * clients' predicates (option 1 in the task's step-4 comment). Narrow on
 * purpose: only a task that WAS on a project list and is now on none loses its
 * role. A task that never had a board keeps whatever `update_task
 * { statusRole }` gave it, and a request that sets the role itself wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskUpdate = vi.hoisted(() => vi.fn())
const taskListFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: taskUpdate },
    taskList: { findMany: taskListFindMany },
    comment: { create: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ isAIAgent: false })) },
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

const BOARD = { id: 'board', name: 'Board', projectId: 'project-1', listType: null }
const PLAIN = { id: 'plain', name: 'Plain', projectId: null, listType: null }
const ALL_LISTS = [BOARD, PLAIN].map(list => ({
  ...list,
  ownerId: 'user-1',
  privacy: 'PRIVATE',
  publicListType: null,
  isVirtual: false,
  listMembers: [],
}))

function existing(lists: typeof ALL_LISTS, statusRole: string | null) {
  return {
    id: 'task-1',
    title: 'Blocked thing',
    completed: false,
    creatorId: 'user-1',
    assigneeId: null,
    identifier: 'AWTD-1',
    statusRole,
    updatedAt: new Date('2026-09-27T00:00:00Z'),
    lists,
  }
}

async function moveTo(listIds: string[], task: ReturnType<typeof existing>, extra = {}) {
  await updateTaskWithSideEffects({
    taskId: 'task-1',
    actorId: 'user-1',
    intent: { listIds, ...extra },
    existingTask: task,
  })
  return taskUpdate.mock.calls[0][0].data as Record<string, unknown>
}

describe('a task that leaves its board leaves its column (AWTD-1007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskListFindMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) =>
      ALL_LISTS.filter(list => where.id?.in.includes(list.id))
    )
    taskUpdate.mockImplementation(async () => ({ ...existing([], null), comments: [] }))
  })

  it('moving from a board to a plain list clears the role (AWTD-1007)', async () => {
    const data = await moveTo(['plain'], existing([ALL_LISTS[0]], 'waiting'))
    expect(data.statusRole).toBeNull()
  })

  it('removing every list from a board task clears the role (AWTD-1007)', async () => {
    const data = await moveTo([], existing([ALL_LISTS[0]], 'doing'))
    expect(data.statusRole).toBeNull()
  })

  it('staying on the board keeps the role (AWTD-1007)', async () => {
    const data = await moveTo(['board', 'plain'], existing([ALL_LISTS[0]], 'waiting'))
    expect(data).not.toHaveProperty('statusRole')
  })

  it('a task that never had a board keeps a role it was given directly (AWTD-1007)', async () => {
    const data = await moveTo(['plain'], existing([ALL_LISTS[1]], 'ready'))
    expect(data).not.toHaveProperty('statusRole')
  })

  it('a request that sets the role itself wins (AWTD-1007)', async () => {
    const data = await moveTo(['plain'], existing([ALL_LISTS[0]], 'waiting'), { statusRole: 'ready' })
    expect(data.statusRole).toBe('ready')
  })
})
